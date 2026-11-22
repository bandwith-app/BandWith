// Local check of migration 183 (quote page fixes) without Docker: PGlite
// (Postgres in WebAssembly) with stand-ins for Supabase's auth / vault / net
// and the public tables the quote link uses. Loads the quote link as it is
// live (099, 105 sections 1-2, 120, 168), runs the migration under test
// twice, then checks:
//   1. a new recipient gets a new link: the old link stops working, the
//      new client does not see the old one's messages (the band still does);
//      a name-only edit, a first email, a draft or an accepted link keep it;
//      a draft link takes a changed summary as version 1 (105's branch, 42702);
//   2. an acceptance needs the exact version the client saw;
//   3. the page gets the deposit amount the band recorded.
//
//   mkdir -p /tmp/pgC5 && cd /tmp/pgC5 && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/quote_page_fixes.pglite.mjs . && node quote_page_fixes.pglite.mjs <repo> <repo>/supabase/migrations/183_quote_page_fixes.sql
//
// With /dev/null as the migration the checks of 183 fail (the bugs as live).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const REPO = process.argv[2];
const MIG = process.argv[3];
const mig = (n) => readFileSync(`${REPO}/supabase/migrations/${n}`, 'utf8');
const db = new PGlite();
const q = (sql, p) => db.query(sql, p);
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth; CREATE SCHEMA vault; CREATE SCHEMA net; CREATE SCHEMA extensions;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) RETURNS bigint
  LANGUAGE sql AS $$ SELECT 1::bigint $$;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, preferred_language varchar, notification_preferences jsonb);
CREATE TABLE public.bands (id uuid PRIMARY KEY, name text);
CREATE TABLE public.band_members (band_id uuid, user_id uuid, role text, is_active boolean DEFAULT true);
CREATE TABLE public.quotes (id uuid PRIMARY KEY, band_id uuid, client_name text, client_email varchar(255), client_phone varchar(50),
  status varchar(50) DEFAULT 'draft', sent_at timestamptz, viewed_at timestamptz, responded_at timestamptz, accepted_at timestamptz,
  response_type varchar(20), rejection_reason text, converted_to_event_id uuid, updated_at timestamptz DEFAULT now());
CREATE TABLE public.events (id uuid PRIMARY KEY, band_id uuid, quote_id uuid, status varchar, payment_status varchar,
  deposit_paid boolean DEFAULT false, deposit_amount numeric, created_at timestamptz DEFAULT now());
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, band_id uuid, type text,
  title varchar, body text, data jsonb, created_at timestamptz DEFAULT now());
GRANT SELECT, UPDATE ON public.quotes TO authenticated;
CREATE FUNCTION public.bw_is_band_admin(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND role = 'admin' AND COALESCE(is_active, true)); $f$;
-- 163's mark (plans off): never shown.
CREATE FUNCTION public.bw_band_shows_mark(p_band_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;
`);

// The quote link as live: 099, 105 (publish + outcome; its rider part is not needed), 120, 168.
await db.exec(mig('099_quote_client_link.sql'));
const m105 = mig('105_quote_link_outcome_rider_preview.sql');
await db.exec(m105.slice(0, m105.indexOf('-- 3. The rider page')) + '\nCOMMIT;');
await db.exec(mig('120_quote_decline_once.sql'));
await db.exec(mig('168_quote_balance.sql'));
ok(true, 'live quote link loaded (099, 105, 120, 168)');

// Two runs: the migration is safe to run more than once.
const m = readFileSync(MIG, 'utf8');
await db.exec(m);
await db.exec(m);
ok(true, 'migration under test runs twice');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, ADMIN] = [1, 2].map(id);
await db.exec(`
INSERT INTO auth.users VALUES ('${ADMIN}');
INSERT INTO profiles (id, preferred_language) VALUES ('${ADMIN}', 'en');
INSERT INTO bands VALUES ('${BAND}', 'The Night Shift');
INSERT INTO band_members VALUES ('${BAND}', '${ADMIN}', 'admin', true);
`);

// As the band admin, committed (the app's calls are their own transactions).
async function asAdmin(fn) {
  await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN}","role":"authenticated"}', true); SET LOCAL ROLE authenticated;`);
  try {
    const r = await fn();
    await db.exec('COMMIT');
    return r;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}
// As the client's page (anon, by token).
async function asAnon(fn) {
  await db.exec(`BEGIN; SET LOCAL ROLE anon;`);
  try {
    const r = await fn();
    await db.exec('COMMIT');
    return r;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}
const snap = (total) => JSON.stringify({ v: 1, ref: 'Q-2026-0042', title: 'Rooftop wedding', total, totalLabel: `$${total}`, items: [] });
const view = (t) => asAnon(() => q(`SELECT public.bw_quote_link_view($1) v`, [t]).then((r) => r.rows[0].v));
const link = (quote) => q(`SELECT * FROM quote_links WHERE quote_id = $1`, [quote]).then((r) => r.rows[0]);
const tokenOf = async (quote) => (await link(quote)).token;

let n = 100;
/** A quote with its link published and sent to the client (as Share → WhatsApp / email). */
async function sentQuote({ email = 'emma.carter@example.com', phone = null, name = 'Emma Carter', send = true } = {}) {
  const Q = id(n++);
  await db.exec(`INSERT INTO quotes (id, band_id, client_name, client_email, client_phone, status) VALUES ('${Q}', '${BAND}', '${name}', ${email ? `'${email}'` : 'NULL'}, ${phone ? `'${phone}'` : 'NULL'}, 'draft')`);
  await asAdmin(() => q(`SELECT * FROM public.bw_quote_link_publish($1, $2::jsonb, 'en', NULL)`, [Q, snap(4200)]));
  if (send) await asAdmin(() => q(`SELECT public.bw_quote_link_mark_sent($1, 'sent', 'email')`, [Q]));
  return Q;
}
const editClient = (Q, set) => asAdmin(() => q(`UPDATE quotes SET ${set} WHERE id = $1`, [Q]));

// ---------------------------------------------------------------- 1. new recipient
{
  const Q = await sentQuote();
  const T1 = await tokenOf(Q);
  await asAnon(() => q(`SELECT public.bw_quote_link_seen($1)`, [T1]));
  await asAnon(() => q(`SELECT public.bw_quote_link_message($1, 'Can you play our first dance? — Emma')`, [T1]));
  ok((await view(T1)).messages.length === 1, 'setup: the first client wrote on the page');

  // The band corrects the client: someone else (Brooklyn planner) gets the quote.
  await editClient(Q, `client_name = 'Jordan Lee', client_email = 'jordan@brooklynevents.example'`);
  // Old and new builds then republish the edited quote on the link.
  await asAdmin(() => q(`SELECT * FROM public.bw_quote_link_publish($1, $2::jsonb, 'en', NULL)`, [Q, snap(4500)]));

  const T2 = await tokenOf(Q);
  ok(T2 !== T1, 'new recipient: the link gets a new token');
  ok((await view(T1)) === null, 'new recipient: the old link no longer opens');
  const acc = await asAnon(() => q(`SELECT public.bw_quote_link_respond($1, 'accept', 'Emma Carter', NULL, 2) v`, [T1]).then((r) => r.rows[0].v));
  ok(acc === null && (await link(Q)).status !== 'accepted', 'new recipient: the old client can no longer accept');
  const l = await link(Q);
  ok(l.status === 'draft' && l.sent_at === null && l.first_viewed_at === null, `new recipient: the link waits to be sent to them (status ${l.status})`);
  const qs = (await q(`SELECT status, sent_at, viewed_at FROM quotes WHERE id = $1`, [Q])).rows[0];
  ok(qs.status === 'draft' && qs.sent_at === null && qs.viewed_at === null, `new recipient: the quote is not sent to them yet (status ${qs.status})`);
  const v2 = await view(T2);
  ok(v2 && v2.messages.length === 0, `new recipient: the new client does not see the old messages (${v2 && v2.messages.length})`);
  ok(v2 && v2.client_name === 'Jordan Lee' && v2.quote.total === 4500, 'new recipient: the new link shows the new quote');
  ok(v2 && v2.updated_at === null, 'new recipient: their first version is not "updated"');
  const band = (await q(`SELECT kind, body FROM quote_activity WHERE quote_id = $1 ORDER BY created_at`, [Q])).rows;
  ok(band.some((a) => a.kind === 'client_message'), 'new recipient: the band keeps the old conversation');
  ok(band.some((a) => a.kind === 'link_rotated' && a.body === 'recipient_changed'), 'new recipient: the timeline says the link was replaced');

  // Sent to the new client: their own conversation from here.
  await asAdmin(() => q(`SELECT public.bw_quote_link_mark_sent($1, 'sent', 'email')`, [Q]));
  ok((await link(Q)).status === 'sent', 'new recipient: sending makes the link sent again');
  await asAnon(() => q(`SELECT public.bw_quote_link_message($1, 'Looks great — Jordan')`, [T2]));
  await asAdmin(() => q(`SELECT public.bw_quote_reply($1, 'Thanks Jordan!')`, [Q]));
  const v3 = await view(T2);
  ok(v3.messages.length === 2 && v3.messages.every((x) => !x.body.includes('Emma')), 'new recipient: they see only their own conversation');
}
{
  const Q = await sentQuote();
  const T1 = await tokenOf(Q);
  await editClient(Q, `client_name = 'Emma R. Carter'`);
  await editClient(Q, `client_email = '  Emma.Carter@Example.com '`);
  ok((await tokenOf(Q)) === T1, 'same recipient: a name fix or the same email in other case keeps the link');
}
{
  const Q = await sentQuote({ email: null, phone: '+1 (917) 555-0101' });
  const T1 = await tokenOf(Q);
  await editClient(Q, `client_email = 'emma.carter@example.com', client_phone = '917-555-0101'`);
  ok((await tokenOf(Q)) === T1, 'same recipient: adding an email, or the same phone written another way, keeps the link');
}
{
  const Q = await sentQuote({ email: null, phone: '+1 917 555 0101' });
  const T1 = await tokenOf(Q);
  await editClient(Q, `client_name = 'Jordan Lee', client_phone = '+1 646 555 0199'`);
  ok((await tokenOf(Q)) !== T1 && (await view(T1)) === null, 'WhatsApp client (no email): another phone number gets a new link');
}
{
  // The new recipient's first Share republishes the draft link: 105's draft branch (audit #10).
  const Q = await sentQuote({ send: false });
  const r = await asAdmin(() => q(`SELECT * FROM public.bw_quote_link_publish($1, $2::jsonb, 'en', NULL)`, [Q, snap(3900)]).then((x) => x.rows[0], (e) => e.message));
  ok(r && r.version === 1 && (await link(Q)).snapshot.total === 3900, `draft link: a changed summary replaces version 1 (${typeof r === 'string' ? r : r.version})`);
}
{
  const Q = await sentQuote({ send: false });
  const T1 = await tokenOf(Q);
  await editClient(Q, `client_email = 'jordan@brooklynevents.example'`);
  ok((await tokenOf(Q)) === T1, 'never sent: a draft link keeps its token');
}
{
  const Q = await sentQuote();
  const T1 = await tokenOf(Q);
  await asAnon(() => q(`SELECT public.bw_quote_link_respond($1, 'accept', 'Emma Carter', NULL, 1)`, [T1]));
  await editClient(Q, `client_email = 'emma@carter-family.example'`);
  ok((await tokenOf(Q)) === T1 && (await link(Q)).status === 'accepted', 'accepted: the link and the acceptance stay');
}

// ---------------------------------------------------------------- 2. accept needs the version
{
  const Q = await sentQuote();
  const T = await tokenOf(Q);
  const noVersion = await asAnon(() =>
    q(`SELECT public.bw_quote_link_respond($1, 'accept', 'Emma Carter', NULL, NULL) v`, [T]).then(() => 'ran', (e) => e.message),
  );
  ok(noVersion !== 'ran' && (await link(Q)).status !== 'accepted', `accept without a version records nothing (${noVersion})`);
  await asAdmin(() => q(`SELECT * FROM public.bw_quote_link_publish($1, $2::jsonb, 'en', NULL)`, [Q, snap(4800)]));
  const old = await asAnon(() => q(`SELECT public.bw_quote_link_respond($1, 'accept', 'Emma Carter', NULL, 1) v`, [T]).then((r) => r.rows[0].v));
  ok(old.stale === true && (await link(Q)).status !== 'accepted', 'accept on an old version: stale, nothing recorded');
  const now = await asAnon(() => q(`SELECT public.bw_quote_link_respond($1, 'accept', 'Emma Carter', NULL, 2) v`, [T]).then((r) => r.rows[0].v));
  ok(now.status === 'accepted' && (await link(Q)).accepted_version === 2, 'accept on the version shown: recorded on it');
  const T2 = await tokenOf(await sentQuote());
  const dec = await asAnon(() => q(`SELECT public.bw_quote_link_respond($1, 'decline', NULL, 'Other date', NULL) v`, [T2]).then((r) => r.rows[0].v));
  ok(dec.status === 'declined', 'decline without a version still works');
}

// ---------------------------------------------------------------- 3. deposit amount on the receipt
{
  const Q = await sentQuote();
  const T = await tokenOf(Q);
  await asAnon(() => q(`SELECT public.bw_quote_link_respond($1, 'accept', 'Emma Carter', NULL, 1)`, [T]));
  const EV = id(900);
  await db.exec(`INSERT INTO events (id, band_id, quote_id, status, payment_status, deposit_amount) VALUES ('${EV}', '${BAND}', '${Q}', 'tentative', 'pending', 500)`);
  let v = await view(T);
  ok(v.deposit_paid === false && (v.deposit_paid_amount ?? null) === null, 'deposit not received: no amount');
  await asAdmin(() => q(`SELECT public.bw_quote_deposit_received($1, 'transfer', 300, true)`, [Q]));
  v = await view(T);
  ok(v.deposit_paid === true && Number(v.deposit_paid_amount) === 300, `deposit received: the page gets the recorded amount (got ${v.deposit_paid_amount})`);
  await asAdmin(() => q(`SELECT public.bw_quote_deposit_received($1, 'other', NULL, false)`, [Q]));
  v = await view(T);
  ok(v.deposit_paid === false && (v.deposit_paid_amount ?? null) === null, 'deposit undone: no amount');
}

// ---------------------------------------------------------------- grants
// SECURITY DEFINER functions anon may run: the four page RPCs of 099, nothing new.
const anonFns = (await q(`SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
  AND has_function_privilege('anon', p.oid, 'EXECUTE') AND p.proname LIKE 'bw_quote%' ORDER BY 1`)).rows.map((r) => r.proname);
ok(anonFns.join() === 'bw_quote_link_message,bw_quote_link_respond,bw_quote_link_seen,bw_quote_link_view', `anon runs only the four page RPCs (${anonFns.join()})`);

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
