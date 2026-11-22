// Local check of migration 183 (quote page fixes) without Docker: PGlite
// (Postgres in WebAssembly) with stand-ins for Supabase's auth / vault / net
// and the public tables the quote link uses. Loads the quote link as it is
// live (099, 105 sections 1-2, 120, 168), runs the migration under test
// twice, then checks:
//   1. a new recipient gets a new link: the old link stops working, the
//      new client does not see the old one's messages (the band still does);
//      a name-only edit, a first email, a draft or an accepted link keep it;
//      a draft link takes a changed summary as version 1 (105's branch, 42702);
//      review of #286: a field an older build leaves out, a Copy-link-only
//      quote, a 7-digit number, the old client's PDF, the version A saw or
//      declined, a stale status save, the accepted client name, the plan count;
//      round 2: no old summary on a rotated link, a late publish for the old
//      token, country codes, an old build's left-out contact, an accepted
//      quote's new address, the lock order (pageinspect), a "Client" quote;
//   2. an acceptance needs the exact version the client saw;
//   3. the page gets the deposit amount the band recorded, in the gig's
//      currency, and no amount when none was typed.
//
//   mkdir -p /tmp/pgC5 && cd /tmp/pgC5 && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/quote_page_fixes.pglite.mjs . && node quote_page_fixes.pglite.mjs <repo> <repo>/supabase/migrations/183_quote_page_fixes.sql
//
// With /dev/null as the migration the checks of 183 fail (the bugs as live).
import { PGlite } from '@electric-sql/pglite';
import { pageinspect } from '@electric-sql/pglite/contrib/pageinspect';
import { readFileSync } from 'node:fs';

const REPO = process.argv[2];
const MIG = process.argv[3];
const mig = (n) => readFileSync(`${REPO}/supabase/migrations/${n}`, 'utf8');
const db = new PGlite({ extensions: { pageinspect } });
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
  response_type varchar(20), rejection_reason text, converted_to_event_id uuid, currency varchar(3) DEFAULT 'EUR', updated_at timestamptz DEFAULT now());
CREATE TABLE public.events (id uuid PRIMARY KEY, band_id uuid, quote_id uuid, status varchar, payment_status varchar,
  deposit_paid boolean DEFAULT false, deposit_amount numeric, currency varchar(3), created_at timestamptz DEFAULT now());
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, band_id uuid, type text,
  title varchar, body text, data jsonb, created_at timestamptz DEFAULT now());
GRANT SELECT, UPDATE ON public.quotes TO authenticated;
CREATE FUNCTION public.bw_is_band_admin(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND role = 'admin' AND COALESCE(is_active, true)); $f$;
-- 161's plan guard (plans off): never blocks.
CREATE FUNCTION public.bw_plan_guard(p_band_id uuid, p_key text, p_add integer DEFAULT 1) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
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
  ok(l.status === 'draft' && l.first_viewed_at === null, `new recipient: the link waits to be sent to them (status ${l.status})`);
  // bw_plan_count (161) counts quote_links.sent_at this month: the send to A still counts.
  ok(l.sent_at !== null, 'new recipient: the send to the old client still counts for the plan (sent_at kept)');
  const qs = (await q(`SELECT status, sent_at, viewed_at FROM quotes WHERE id = $1`, [Q])).rows[0];
  ok(qs.status === 'draft' && qs.sent_at === null && qs.viewed_at === null, `new recipient: the quote is not sent to them yet (status ${qs.status})`);
  const v2 = await view(T2);
  ok(v2 && v2.messages.length === 0, `new recipient: the new client does not see the old messages (${v2 && v2.messages.length})`);
  ok(v2 && v2.client_name === 'Jordan Lee' && v2.quote.total === 4500, 'new recipient: the new link shows the new quote');
  const vers = (await q(`SELECT version, (snapshot->>'total')::int AS total FROM quote_link_versions WHERE quote_id = $1 ORDER BY version`, [Q])).rows;
  ok(vers.length === 2 && vers[0].total === 4200 && vers[1].total === 4500 && v2.version === 2,
    `new recipient: their summary is a new version, the one the old client saw is kept (${JSON.stringify(vers)})`);
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
  // A save of the wizard writes the name and the email on file (never the name alone).
  await editClient(Q, `client_name = 'Emma R. Carter', client_email = 'emma.carter@example.com'`);
  await editClient(Q, `client_email = '  Emma.Carter@Example.com '`);
  ok((await tokenOf(Q)) === T1, 'same recipient: a name fix or the same email in other case keeps the link');
}
{
  const Q = await sentQuote({ email: null, phone: '+1 (917) 555-0101' });
  const T1 = await tokenOf(Q);
  await editClient(Q, `client_email = 'emma.carter@example.com', client_phone = '+1 917-555-0101'`);
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
  // Round 2: a draft's token may be out (Copy hands it over before the send is recorded).
  const Q = await sentQuote({ send: false });
  const T1 = await tokenOf(Q);
  await editClient(Q, `client_email = 'jordan@brooklynevents.example'`);
  const rotated = (await q(`SELECT count(*)::int AS n FROM quote_activity WHERE quote_id = $1 AND kind = 'link_rotated'`, [Q])).rows[0].n;
  ok((await tokenOf(Q)) !== T1 && (await link(Q)).status === 'draft' && rotated === 0,
    'never sent: a draft link gets a new token quietly (status draft, nothing on the timeline)');
}
{
  const Q = await sentQuote();
  const T1 = await tokenOf(Q);
  await asAnon(() => q(`SELECT public.bw_quote_link_respond($1, 'accept', 'Emma Carter', NULL, 1)`, [T1]));
  await editClient(Q, `client_name = 'Emma R. Carter', client_email = 'emma.carter@example.com'`);
  ok((await tokenOf(Q)) === T1 && (await link(Q)).status === 'accepted', 'accepted: a name fix keeps the link and the acceptance');
}


// ---------------------------------------------------------------- 1b. review of #286
// Old builds leave a cleared field out of the UPDATE (supabase-js drops undefined).
{
  const Q = await sentQuote(); // email only
  const T1 = await tokenOf(Q);
  await editClient(Q, `client_name = 'Jordan Lee', client_phone = '+1 646 555 0199'`); // email "cleared" but not sent
  ok((await tokenOf(Q)) !== T1 && (await view(T1)) === null, 'old build: email-only client switched to a phone-only one gets a new link');
}
{
  const Q = await sentQuote({ email: null, phone: '+1 917 555 0101' });
  const T1 = await tokenOf(Q);
  await editClient(Q, `client_name = 'Jordan Lee', client_email = 'jordan@brooklynevents.example'`); // phone left out
  ok((await tokenOf(Q)) !== T1 && (await view(T1)) === null, 'old build: phone-only client switched to an email-only one gets a new link');
}
{
  const Q = await sentQuote(); // new builds send null for a cleared field
  const T1 = await tokenOf(Q);
  await editClient(Q, `client_name = 'Jordan Lee', client_email = NULL, client_phone = '+1 646 555 0199'`);
  ok((await tokenOf(Q)) !== T1, 'new build: email cleared, phone added: a new link');
}
{
  const Q = await sentQuote({ email: null, phone: null }); // sent with Copy link, nothing on file
  const T1 = await tokenOf(Q);
  await editClient(Q, `client_name = 'Jordan Lee', client_email = 'jordan@brooklynevents.example'`);
  ok((await tokenOf(Q)) !== T1 && (await view(T1)) === null, 'Copy link only: given to another named client, a new link');
}
{
  const Q = await sentQuote({ email: null, phone: '555-0101' }); // 7-digit local number
  const T1 = await tokenOf(Q);
  await editClient(Q, `client_phone = '+1 646 555 0101'`);
  ok((await tokenOf(Q)) !== T1, 'a 7-digit number and a full number in another area code are different recipients');
}
{
  const Q = await sentQuote({ email: 'emma.carter@example.com', phone: '+1 917 555 0101' });
  const T1 = await tokenOf(Q);
  await editClient(Q, `client_email = 'emma.carter@example.com', client_phone = '+1 646 555 0199'`);
  ok((await tokenOf(Q)) !== T1, 'a phone on file replaced by another number: a new link, even with the email unchanged');
}
{
  // A's PDF (addressed to A) must not stay on B's link when B's PDF upload fails.
  const Q = await sentQuote({ send: false });
  const pdf = `https://abcd.supabase.co/storage/v1/object/public/quotes/quotes/${BAND}/Q-2026-0042.pdf`;
  await asAdmin(() => q(`SELECT * FROM public.bw_quote_link_publish($1, $2::jsonb, 'en', $3)`, [Q, snap(4200), pdf]));
  await asAdmin(() => q(`SELECT public.bw_quote_link_mark_sent($1, 'sent', 'email')`, [Q]));
  ok((await view(await tokenOf(Q))).pdf_url === pdf, 'setup: the first client has their PDF');
  await editClient(Q, `client_name = 'Jordan Lee', client_email = 'jordan@brooklynevents.example'`);
  await asAdmin(() => q(`SELECT * FROM public.bw_quote_link_publish($1, $2::jsonb, 'en', NULL)`, [Q, snap(4200)])); // same summary, upload failed
  const v = await view(await tokenOf(Q));
  ok(v.pdf_url === null, `new recipient: the old client's PDF is not on the new link (${v.pdf_url})`);
  ok(v.version === 2, `new recipient: even an unchanged summary is their own version (${v.version})`);
}
{
  // A declined version 2; the band changes the terms for B.
  const Q = await sentQuote();
  const T1 = await tokenOf(Q);
  await asAdmin(() => q(`SELECT * FROM public.bw_quote_link_publish($1, $2::jsonb, 'en', NULL)`, [Q, snap(4300)]));
  await asAnon(() => q(`SELECT public.bw_quote_link_respond($1, 'decline', NULL, 'Too much', 2)`, [T1]));
  await editClient(Q, `client_name = 'Jordan Lee', client_email = 'jordan@brooklynevents.example'`);
  await asAdmin(() => q(`SELECT * FROM public.bw_quote_link_publish($1, $2::jsonb, 'en', NULL)`, [Q, snap(3900)]));
  const vers = (await q(`SELECT version, (snapshot->>'total')::int AS total FROM quote_link_versions WHERE quote_id = $1 ORDER BY version`, [Q])).rows;
  ok(vers.map((r) => r.total).join() === '4200,4300,3900', `the version the old client declined is kept (${JSON.stringify(vers)})`);
  // A screen loaded before the change saves the whole quote with the old status (no answer recorded).
  const stale = await editClient(Q, `client_name = 'Jordan Lee', client_email = 'jordan@brooklynevents.example', status = 'declined'`)
    .then(() => 'saved', (e) => e.message);
  const after = (await q(`SELECT status FROM quotes WHERE id = $1`, [Q])).rows[0];
  ok(/changed while it was open/.test(stale) && after.status === 'draft',
    `a stale save does not bring back the old client's status, and says so (${stale}, status ${after.status})`);
  // The band's own status change (no full save) goes through.
  await editClient(Q, `status = 'viewed', viewed_at = now()`);
  ok((await q(`SELECT status FROM quotes WHERE id = $1`, [Q])).rows[0].status === 'viewed', 'a status change alone, made in the app, is kept');
  await editClient(Q, `status = 'declined', response_type = 'declined', rejection_reason = 'By phone'`);
  ok((await q(`SELECT status FROM quotes WHERE id = $1`, [Q])).rows[0].status === 'declined', 'an answer recorded in the app still counts');
}
{
  // Accepted: the signer's page keeps the name it was accepted under.
  const Q = await sentQuote();
  const T = await tokenOf(Q);
  await asAnon(() => q(`SELECT public.bw_quote_link_respond($1, 'accept', 'Emma Carter', NULL, 1)`, [T]));
  // (Another address would be another recipient: a new link, R2-5 below.)
  await editClient(Q, `client_name = 'Emma Carter-Ross', client_email = 'emma.carter@example.com'`);
  ok((await view(T)).client_name === 'Emma Carter', `accepted: the page keeps the client name of the acceptance (${(await view(T)).client_name})`);
  // Links accepted before 183 get the name too (backfill, the migration run again).
  const backfilled = await db.exec(`UPDATE quote_links SET accepted_client_name = NULL WHERE quote_id = '${Q}'`)
    .then(() => db.exec(m)).then(() => link(Q)).then((r) => r.accepted_client_name, (e) => e.message);
  ok(backfilled === 'Emma Carter-Ross', `accepted before 183: backfilled from the quote (${backfilled})`);
}

// ---------------------------------------------------------------- 1c. round 2 of #286
{
  // R2-1: the new token can go out (Copy / WhatsApp) before B's version is published.
  const Q = await sentQuote();
  await editClient(Q, `client_name = 'Jordan Lee', client_email = 'jordan@brooklynevents.example'`);
  const T2 = await tokenOf(Q);
  const v = await view(T2);
  const acc = await asAnon(() => q(`SELECT public.bw_quote_link_respond($1, 'accept', 'Jordan Lee', NULL, 1) v`, [T2]).then((r) => r.rows[0].v, (e) => e.message));
  ok(v === null && (await link(Q)).status !== 'accepted',
    `rotated, not yet published: the new link shows nothing of the old client's quote and cannot be accepted (${v && v.quote && v.quote.total}, ${JSON.stringify(acc)})`);
}
{
  // R2-2: A's slow publish (PDF upload) lands after the quote went to B.
  const Q = await sentQuote();
  const T1 = await tokenOf(Q);
  await editClient(Q, `client_name = 'Jordan Lee', client_email = 'jordan@brooklynevents.example'`);
  const T2 = await tokenOf(Q);
  await asAdmin(() => q(`SELECT * FROM public.bw_quote_link_publish($1, $2::jsonb, 'en', NULL, $3)`, [Q, snap(4500), T2]).catch(() => null));
  await asAdmin(() => q(`SELECT public.bw_quote_link_mark_sent($1, 'sent', 'email')`, [Q]));
  const pdfA = `https://abcd.supabase.co/storage/v1/object/public/quotes/quotes/${BAND}/Q-2026-0042_A.pdf`;
  const late = await asAdmin(() => q(`SELECT * FROM public.bw_quote_link_publish($1, $2::jsonb, 'en', $3, $4)`, [Q, snap(4200), pdfA, T1]))
    .then(() => 'published', (e) => e.message);
  const v = await view(T2);
  ok(/BW_LINK_CHANGED/.test(late) && v && v.quote.total === 4500 && v.pdf_url !== pdfA,
    `a publish meant for the old link writes nothing on the new client's (${late}; total ${v && v.quote.total})`);
  const fine = await asAdmin(() => q(`SELECT * FROM public.bw_quote_link_publish($1, $2::jsonb, 'en', NULL, $3)`, [Q, snap(4600), T2]))
    .then(() => 'published', (e) => e.message);
  ok(fine === 'published' && (await view(T2)).quote.total === 4600, `a publish for the current link goes through (${fine})`);
}
{
  // R2-3: phones are compared with their country code.
  const same = async (a, b) => (await q(`SELECT public.bw_same_phone($1, $2) s`, [a, b]).then((r) => r.rows[0].s, (e) => e.message));
  ok((await same('+1 9175550101', '+91 9175550101')) === false, 'bw_same_phone: +1 9175550101 and +91 9175550101 are different numbers');
  ok((await same('917-555-0101', '+1 917 555 0101')) === false, 'bw_same_phone: a number without its country code is not the same as one with it');
  ok((await same('0044 20 7946 0958', '+44 20 7946 0958')) === true && (await same('+1 (917) 555-0101', '+1 917-555-0101')) === true,
    'bw_same_phone: 00 and + are the same prefix, spaces and dashes do not count');
  const Q = await sentQuote({ email: null, phone: '+1 9175550101' });
  const T1 = await tokenOf(Q);
  await editClient(Q, `client_phone = '+91 9175550101'`);
  ok((await tokenOf(Q)) !== T1 && (await view(T1)) === null, 'a phone-only quote moved from +1 9175550101 to +91 9175550101 gets a new link');
}
{
  // R2-4: an older build replaces A (email only) with B (name and phone): A's email is left out of the save.
  const Q = await sentQuote();
  await editClient(Q, `client_name = 'Jordan Lee', client_phone = '+1 646 555 0199'`);
  const r = (await q(`SELECT client_email, client_phone FROM quotes WHERE id = $1`, [Q])).rows[0];
  ok(r.client_email === null && r.client_phone === '+1 646 555 0199', `old build: the old client's email does not stay on the new client's quote (${r.client_email})`);
  const Q2 = await sentQuote({ email: 'emma.carter@example.com', phone: '+1 917 555 0101' });
  await editClient(Q2, `client_name = 'Jordan Lee', client_email = 'jordan@brooklynevents.example'`);
  const r2 = (await q(`SELECT client_phone FROM quotes WHERE id = $1`, [Q2])).rows[0];
  ok(r2.client_phone === null, `old build: the old client's phone does not stay either (${r2.client_phone})`);
  // A save that writes both (newer builds) keeps what it wrote.
  const Q3 = await sentQuote({ email: 'emma.carter@example.com', phone: '+1 917 555 0101' });
  await editClient(Q3, `client_name = 'Emma Carter', client_email = 'emma.carter@example.com', client_phone = '+1 646 555 0199'`);
  ok((await q(`SELECT client_email FROM quotes WHERE id = $1`, [Q3])).rows[0].client_email === 'emma.carter@example.com',
    'a save that writes the email keeps it');
  // A status change alone writes no contact: nothing is cleared.
  const Q4 = await sentQuote();
  await editClient(Q4, `status = 'viewed', viewed_at = now()`);
  ok((await q(`SELECT client_email FROM quotes WHERE id = $1`, [Q4])).rows[0].client_email === 'emma.carter@example.com',
    'an update without the client name clears no contact');
}
{
  // R2-5: an accepted quote's email changes: the balance emails go to the new address.
  const Q = await sentQuote();
  const T1 = await tokenOf(Q);
  const pdf = `https://abcd.supabase.co/storage/v1/object/public/quotes/quotes/${BAND}/Q-2026-0042_signed.pdf`;
  await asAdmin(() => q(`SELECT * FROM public.bw_quote_link_publish($1, $2::jsonb, 'en', $3)`, [Q, snap(4200), pdf]));
  await asAnon(() => q(`SELECT public.bw_quote_link_message($1, 'Deposit sent today — Emma')`, [T1]));
  const before = await view(T1);
  await asAnon(() => q(`SELECT public.bw_quote_link_respond($1, 'accept', 'Emma Carter', NULL, $2)`, [T1, before.version]));
  await editClient(Q, `client_name = 'Emma Carter', client_email = 'accounts@brooklynevents.example'`);
  const T2 = await tokenOf(Q);
  const v = T2 !== T1 ? await view(T2) : null;
  ok(T2 !== T1 && (await view(T1)) === null, 'accepted, new address: the link the balance emails carry is a new one');
  ok(v && v.status === 'accepted' && v.pdf_url === null && v.accepted_name === null && v.messages.length === 0,
    `accepted, new address: no signer's PDF, signature or conversation on it (${v && JSON.stringify({ pdf: v.pdf_url, name: v.accepted_name, m: v.messages.length })})`);
  const l = await link(Q);
  const qs = (await q(`SELECT status FROM quotes WHERE id = $1`, [Q])).rows[0];
  ok(l.status === 'accepted' && l.accepted_name === 'Emma Carter' && qs.status === 'accepted', 'accepted, new address: the acceptance stays for the band');
}
{
  // R2-6: lock order. A save of the quote locks the quote, then the link; the
  // page RPCs must lock the quote before they write the link (else deadlock).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS lock_log (fn text, quote_locked boolean, info text);
    CREATE EXTENSION IF NOT EXISTS pageinspect;
    -- Locked by this transaction with an exclusive row lock (FOR UPDATE / an
    -- update), not only the key-share lock a foreign key check takes.
    CREATE OR REPLACE FUNCTION test_link_lock_probe() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $f$
    DECLARE v_ctid point; v_mask int; v_xmax text;
    BEGIN
      SELECT q.ctid::text::point, q.xmax::text INTO v_ctid, v_xmax FROM quotes q WHERE q.id = NEW.quote_id;
      SELECT h.t_infomask INTO v_mask FROM heap_page_items(get_raw_page('public.quotes', v_ctid[0]::int)) h WHERE h.lp = v_ctid[1]::int;
      INSERT INTO lock_log VALUES (current_setting('test.fn', true),
        v_xmax = (txid_current() % 4294967296)::text AND (v_mask & 64) <> 0, v_xmax || '/' || txid_current()::text || ' mask ' || v_mask);
      RETURN NEW;
    END $f$;
    DROP TRIGGER IF EXISTS test_link_lock_probe ON quote_links;
    CREATE TRIGGER test_link_lock_probe BEFORE UPDATE ON quote_links FOR EACH ROW EXECUTE FUNCTION test_link_lock_probe();`);
  const probe = async (fn, run) => {
    await db.exec(`DELETE FROM lock_log`);
    await db.exec(`SELECT set_config('test.fn', '${fn}', false)`);
    await run().catch(() => null);
    const rows = (await q(`SELECT quote_locked, info FROM lock_log`)).rows;
    if (process.env.DEBUG) console.log(fn, JSON.stringify(rows));
    return rows.length > 0 && rows.every((r) => r.quote_locked);
  };
  const Q = await sentQuote();
  const T = await tokenOf(Q);
  ok(await probe('seen', () => asAnon(() => q(`SELECT public.bw_quote_link_seen($1)`, [T]))), 'lock order: seen locks the quote before the link');
  ok(await probe('message', () => asAnon(() => q(`SELECT public.bw_quote_link_message($1, 'Hi')`, [T]))), 'lock order: a message locks the quote before the link');
  ok(await probe('respond', () => asAnon(() => q(`SELECT public.bw_quote_link_respond($1, 'accept', 'Emma Carter', NULL, 1)`, [T]))), 'lock order: accept locks the quote before the link');
  const Q2 = await sentQuote({ send: false });
  ok(await probe('mark_sent', () => asAdmin(() => q(`SELECT public.bw_quote_link_mark_sent($1, 'sent', 'email')`, [Q2]))), 'lock order: mark sent locks the quote before the link');
  await db.exec(`DROP TRIGGER test_link_lock_probe ON quote_links`);
}
{
  // R2-7: a quote saved with no name ("Client") and sent with Copy link, then given a contact.
  const Q = await sentQuote({ email: null, phone: null, name: 'Client' });
  const T1 = await tokenOf(Q);
  await editClient(Q, `client_name = 'Client', client_email = 'jordan@brooklynevents.example', client_phone = NULL`);
  ok((await tokenOf(Q)) !== T1 && (await view(T1)) === null, 'no name ("Client"), no contact: a contact added gets a new link');
  const Q2 = await sentQuote({ email: null, phone: null, name: 'Emma Carter' });
  const T2 = await tokenOf(Q2);
  await editClient(Q2, `client_name = 'Emma Carter', client_email = 'emma.carter@example.com', client_phone = NULL`);
  ok((await tokenOf(Q2)) === T2, 'a named client given their first email keeps the link');
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
  await db.exec(`INSERT INTO events (id, band_id, quote_id, status, payment_status, deposit_amount, currency) VALUES ('${EV}', '${BAND}', '${Q}', 'tentative', 'pending', 500, 'USD')`);
  let v = await view(T);
  ok(v.deposit_paid === false && (v.deposit_paid_amount ?? null) === null, 'deposit not received: no amount');
  await asAdmin(() => q(`SELECT public.bw_quote_deposit_received($1, 'transfer', 300, true)`, [Q]));
  v = await view(T);
  ok(v.deposit_paid === true && Number(v.deposit_paid_amount) === 300, `deposit received: the page gets the recorded amount (got ${v.deposit_paid_amount})`);
  ok(v.deposit_paid_currency === 'USD', `deposit received: in the gig's currency, not the quote's EUR (got ${v.deposit_paid_currency})`);
  await asAdmin(() => q(`SELECT public.bw_quote_deposit_received($1, 'other', NULL, false)`, [Q]));
  v = await view(T);
  ok(v.deposit_paid === false && (v.deposit_paid_amount ?? null) === null, 'deposit undone: no amount');
  await asAdmin(() => q(`SELECT public.bw_quote_deposit_received($1, 'cash', NULL, true)`, [Q]));
  v = await view(T);
  ok(v.deposit_paid === true && (v.deposit_paid_amount ?? null) === null,
    `received without an amount: no amount, not the 500 asked (got ${v.deposit_paid_amount})`);
}

// ---------------------------------------------------------------- grants
// SECURITY DEFINER functions anon may run: the four page RPCs of 099, nothing new.
const anonFns = (await q(`SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
  AND has_function_privilege('anon', p.oid, 'EXECUTE') AND p.proname LIKE 'bw_quote%' ORDER BY 1`)).rows.map((r) => r.proname);
ok(anonFns.join() === 'bw_quote_link_message,bw_quote_link_respond,bw_quote_link_seen,bw_quote_link_view', `anon runs only the four page RPCs (${anonFns.join()})`);

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
