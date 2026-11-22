// Local check of migrations 185, 186 and 187 (quote money fixes, "Mark all
// as paid", the client's page) without Docker: PGlite (Postgres in
// WebAssembly) with stand-ins for Supabase's auth / vault / net and the
// public tables the quote link uses. Loads the quote link as it will be
// before these (099, 105 sections 1-2, 120, 168, 183) and 071's
// bw_mark_event_paid, runs the migrations under test twice, then checks:
//   1. a quote's lineup is saved with the quote (money #3);
//   2. "Mark as paid" then Undo gives back the deposit as it was (money #7);
//   3. a balance only published or previewed is not on the client's page;
//      the preview shows the draft with its key (money #8);
//   4. an acceptance or a message never lands on a link turned off while
//      it waited for the lock (public pages #8);
//   5. "Mark all as paid" pays only who is owed: confirmed, fee above 0
//      (events #9, money #11);
//   review of #293: a changed balance after "Mark as paid" (link and gig
//   agree, Undo still works, the send reopens both), the preview of a quote
//   accepted by phone, and the one-time copy of the balance sent;
//   6. round 3: a send recorded for a balance another admin replaced is
//      refused (BW_BALANCE_CHANGED), and every balance function locks the
//      quote before the link and the link before the gig (pageinspect).
//
//   mkdir -p /tmp/pgM && cd /tmp/pgM && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/money_fixes.pglite.mjs . && node money_fixes.pglite.mjs <repo>
//
// With /dev/null as a third argument the migrations under test are not
// loaded and their checks fail (the bugs as live).
import { PGlite } from '@electric-sql/pglite';
import { pageinspect } from '@electric-sql/pglite/contrib/pageinspect';
import { readFileSync } from 'node:fs';

const REPO = process.argv[2];
const ONLY = process.argv[3];
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
  response_type varchar(20), rejection_reason text, converted_to_event_id uuid, currency varchar(3) DEFAULT 'USD', updated_at timestamptz DEFAULT now());
CREATE TABLE public.quote_musicians (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  user_id uuid, name varchar(255) NOT NULL, instrument varchar(100), fee numeric(10,2) DEFAULT 0, is_external boolean DEFAULT false,
  is_available boolean DEFAULT true, created_at timestamptz DEFAULT now());
CREATE TABLE public.events (id uuid PRIMARY KEY, band_id uuid, quote_id uuid, status varchar, payment_status varchar,
  deposit_paid boolean DEFAULT false, deposit_amount numeric, currency varchar(3), created_at timestamptz DEFAULT now());
CREATE TABLE public.event_members (event_id uuid, user_id uuid, status text, fee numeric, paid_at timestamptz, PRIMARY KEY (event_id, user_id));
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, band_id uuid, type text,
  title varchar, body text, data jsonb, created_at timestamptz DEFAULT now());
GRANT SELECT, UPDATE ON public.quotes TO authenticated;
CREATE FUNCTION public.bw_is_band_admin(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND role = 'admin' AND COALESCE(is_active, true)); $f$;
CREATE FUNCTION public.bw_can_manage_event(p_event_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND public.bw_is_band_admin(e.band_id)); $f$;

-- 161's plan guard (plans off): never blocks.
CREATE FUNCTION public.bw_plan_guard(p_band_id uuid, p_key text, p_add integer DEFAULT 1) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
-- 163's mark, here also the stand-in for "the admin, at the same moment": when
-- a race is armed and the link row is not locked or written by this
-- transaction, the admin's revoke commits first (as it would while the
-- client's call waited for the row lock).
CREATE TABLE public.race (token text);
CREATE FUNCTION public.bw_band_shows_mark(p_band_id uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $f$
BEGIN
  UPDATE public.quote_links l SET revoked_at = now()
   WHERE l.token IN (SELECT token FROM public.race)
     AND l.xmax::text <> pg_current_xact_id()::xid::text
     AND l.xmin::text <> pg_current_xact_id()::xid::text;
  IF FOUND THEN DELETE FROM public.race; END IF;
  RETURN false;
END $f$;
`);

// The quote link before these migrations: 099, 105 (publish + outcome), 120, 168, 183.
await db.exec(mig('099_quote_client_link.sql'));
const m105 = mig('105_quote_link_outcome_rider_preview.sql');
await db.exec(m105.slice(0, m105.indexOf('-- 3. The rider page')) + '\nCOMMIT;');
await db.exec(mig('120_quote_decline_once.sql'));
await db.exec(mig('168_quote_balance.sql'));
await db.exec(mig('183_quote_page_fixes.sql'));
// 071's "mark all paid", as live.
const m071 = mig('071_member_permissions.sql');
const a = m071.indexOf('CREATE OR REPLACE FUNCTION public.bw_mark_event_paid');
await db.exec(m071.slice(a, m071.indexOf('$$;', m071.indexOf('$$', m071.indexOf('AS $$', a) + 5)) + 3));
await db.exec(`GRANT EXECUTE ON FUNCTION public.bw_mark_event_paid(uuid) TO authenticated;`);
ok(true, 'live quote link and payouts loaded (099, 105, 120, 168, 183, 071)');

const under = ONLY ? [ONLY] : ['185_quote_money_fixes.sql', '186_mark_event_paid_owed_only.sql', '187_quote_page_lock_balance_sent.sql'].map((n) => `${REPO}/supabase/migrations/${n}`);
for (const f of under) {
  const m = readFileSync(f, 'utf8');
  await db.exec(m);
  await db.exec(m);
}
ok(true, 'migrations under test run twice');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, ADMIN, MEMBER, SUB, OTHER] = [1, 2, 3, 4, 5].map(id);
await db.exec(`
INSERT INTO auth.users VALUES ('${ADMIN}'), ('${MEMBER}'), ('${SUB}'), ('${OTHER}');
INSERT INTO profiles (id, preferred_language) VALUES ('${ADMIN}', 'en'), ('${MEMBER}', 'en'), ('${SUB}', 'en');
INSERT INTO bands VALUES ('${BAND}', 'The Night Shift');
INSERT INTO band_members VALUES ('${BAND}', '${ADMIN}', 'admin', true), ('${BAND}', '${MEMBER}', 'member', true), ('${BAND}', '${SUB}', 'member', true);
`);

const as = (who) => async (fn) => {
  await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${who}","role":"authenticated"}', true); SET LOCAL ROLE authenticated;`);
  try { const r = await fn(); await db.exec('COMMIT'); return r; } catch (e) { await db.exec('ROLLBACK'); throw e; }
};
const asAdmin = as(ADMIN);
const asMember = as(MEMBER);
async function asAnon(fn) {
  await db.exec(`BEGIN; SET LOCAL ROLE anon;`);
  try { const r = await fn(); await db.exec('COMMIT'); return r; } catch (e) { await db.exec('ROLLBACK'); throw e; }
}
const tryIt = (p) => p.then((r) => ({ r }), (e) => ({ e: e.message }));
const snap = (total) => JSON.stringify({ v: 1, ref: 'Q-2026-0042', title: 'Rooftop wedding', total, totalLabel: `$${total}`, items: [] });
const view = (t) => asAnon(() => q(`SELECT public.bw_quote_link_view($1) v`, [t]).then((r) => r.rows[0].v));
const link = (quote) => q(`SELECT * FROM quote_links WHERE quote_id = $1`, [quote]).then((r) => r.rows[0]);
const balance = (amount, note = null) => JSON.stringify({ v: 1, currency: 'USD', total: 1000, received: [], amount, amountLabel: `$${amount}`,
  dueDate: '2099-06-01', reference: 'Q-2026-0042 · Balance', bank: null, stripeUrl: null, cash: 'Cash on the day', note });

let n = 100;
/** A sent quote; `accepted`: the client accepted, with its gig. */
async function quote({ accepted = false, deposit = false } = {}) {
  const Q = id(n++);
  const E = id(n++);
  await db.exec(`INSERT INTO quotes (id, band_id, client_name, client_email, status, converted_to_event_id) VALUES ('${Q}', '${BAND}', 'Emma Carter', 'emma.carter@example.com', 'draft', '${E}')`);
  await db.exec(`INSERT INTO events (id, band_id, quote_id, status, payment_status, deposit_paid, deposit_amount) VALUES ('${E}', '${BAND}', '${Q}', 'confirmed', '${deposit ? 'partial' : 'pending'}', ${deposit}, ${deposit ? 300 : 'NULL'})`);
  await asAdmin(() => q(`SELECT * FROM public.bw_quote_link_publish($1, $2::jsonb, 'en', NULL)`, [Q, snap(1000)]));
  await asAdmin(() => q(`SELECT public.bw_quote_link_mark_sent($1, 'sent', 'email')`, [Q]));
  const T = (await link(Q)).token;
  if (accepted) await asAnon(() => q(`SELECT public.bw_quote_link_respond($1, 'accept', 'Emma Carter', NULL, 1)`, [T]));
  return { Q, E, T };
}
const gig = (E) => q(`SELECT deposit_paid, payment_status FROM events WHERE id = $1`, [E]).then((r) => r.rows[0]);

// ---------------------------------------------------------------- 1. the quote's lineup
{
  const { Q } = await quote();
  await db.exec(`INSERT INTO quote_musicians (quote_id, user_id, name, instrument, fee) VALUES ('${Q}', '${MEMBER}', 'Maya Brooks', 'Bass', 300), ('${Q}', NULL, 'Leo Park', 'Drums', 250)`);
  const rows = [
    { user_id: MEMBER, name: 'Maya Brooks', instrument: 'Bass', fee: 350, is_external: false, is_available: true },
    { user_id: SUB, name: 'Sam Ortiz', instrument: 'Drums', fee: 275, is_external: false, is_available: true },
    { user_id: null, name: 'Ava Kim', instrument: 'Sax', fee: 200.5, is_external: true, is_available: true },
  ];
  const r = await tryIt(asAdmin(() => q(`SELECT * FROM public.bw_quote_save_musicians($1, $2::jsonb)`, [Q, JSON.stringify(rows)])));
  ok(!r.e && r.r.rows.length === 3, `lineup: the admin saves the edited lineup with the quote (${r.e || r.r.rows.length})`);
  const saved = (await q(`SELECT name, fee::float AS fee, user_id FROM quote_musicians WHERE quote_id = $1 ORDER BY created_at, name`, [Q])).rows;
  ok(saved.length === 3 && !saved.some((m) => m.name === 'Leo Park') && saved.find((m) => m.name === 'Maya Brooks')?.fee === 350,
    `lineup: reloading gives the new names and fees (${saved.map((m) => `${m.name} ${m.fee}`).join(', ')})`);
  const outsider = await tryIt(as(OTHER)(() => q(`SELECT * FROM public.bw_quote_save_musicians($1, '[]'::jsonb)`, [Q])));
  const member = await tryIt(asMember(() => q(`SELECT * FROM public.bw_quote_save_musicians($1, '[]'::jsonb)`, [Q])));
  ok(!!outsider.e && !!member.e && (await q(`SELECT count(*)::int c FROM quote_musicians WHERE quote_id = $1`, [Q])).rows[0].c === 3,
    'lineup: a member or an outsider cannot change it');
  const bad = await tryIt(asAdmin(() => q(`SELECT * FROM public.bw_quote_save_musicians($1, '[{"name":"X","fee":"-5"}]'::jsonb)`, [Q])));
  ok(!!bad.e && (await q(`SELECT count(*)::int c FROM quote_musicians WHERE quote_id = $1`, [Q])).rows[0].c === 3,
    'lineup: a bad fee changes nothing');
  const anon = await tryIt(asAnon(() => q(`SELECT * FROM public.bw_quote_save_musicians($1, '[]'::jsonb)`, [Q])));
  ok(!!anon.e, 'lineup: no anon access');
}

// ---------------------------------------------------------------- 2. mark paid, undo
{
  const { Q, E } = await quote({ accepted: true });
  await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb)`, [Q, balance(1000)]));
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_paid($1, true)`, [Q]));
  ok((await gig(E)).payment_status === 'paid', 'mark paid: the gig is paid');
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_paid($1, false)`, [Q]));
  const g = await gig(E);
  ok(g.deposit_paid === false && g.payment_status === 'pending', `undo: no deposit was received, none is invented (deposit_paid ${g.deposit_paid}, ${g.payment_status})`);
}
{
  const { Q, E } = await quote({ accepted: true, deposit: true });
  await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb)`, [Q, balance(700)]));
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_paid($1, true)`, [Q]));
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_paid($1, false)`, [Q]));
  const g = await gig(E);
  ok(g.deposit_paid === true && g.payment_status === 'partial', `undo: a deposit that was received stays received (${g.deposit_paid}, ${g.payment_status})`);
}

{
  // Round 3 (Claude review of #293): Undo must not wipe a deposit recorded after "Mark as paid".
  const { Q, E } = await quote({ accepted: true });
  await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb)`, [Q, balance(1000)]));
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_paid($1, true)`, [Q]));
  // The client then pays the deposit, and the band records it ($300).
  const rec = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_deposit_received($1, 'transfer', 300, true)`, [Q])));
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_paid($1, false)`, [Q]));
  const g = await q(`SELECT deposit_paid, deposit_amount::float AS amount, payment_status FROM events WHERE id = $1`, [E]).then((r) => r.rows[0]);
  ok(!rec.e && g.deposit_paid === true && g.amount === 300 && g.payment_status === 'partial',
    `undo after a deposit recorded since "Mark as paid": the deposit stays (${rec.e || ''} deposit_paid ${g.deposit_paid}, ${g.amount}, ${g.payment_status})`);
}
{
  // …and with nothing recorded since, Undo still gives back "no deposit".
  const { Q, E } = await quote({ accepted: true });
  await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb)`, [Q, balance(1000)]));
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_paid($1, true)`, [Q]));
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_paid($1, false)`, [Q]));
  const g = await gig(E);
  ok(g.deposit_paid === false && g.payment_status === 'pending', `undo with the deposit untouched since: back to no deposit (${g.deposit_paid}, ${g.payment_status})`);
}

// ---------------------------------------------------------------- 2c. a changed balance after "Mark as paid" (review of #293)
{
  const { Q, E, T } = await quote({ accepted: true });
  await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb)`, [Q, balance(1000)]));
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_sent($1, 'sent', 'email')`, [Q]));
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_paid($1, true)`, [Q]));
  // A changed balance published (an older build's Preview, or before the send).
  await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb)`, [Q, balance(1200, 'Overtime')]));
  let l = await link(Q);
  let g = await gig(E);
  ok((l.balance_paid_at !== null) === (g.payment_status === 'paid'),
    `paid, then a changed balance published: the link and the gig agree (link paid ${l.balance_paid_at !== null}, gig ${g.payment_status})`);
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_paid($1, false)`, [Q]));
  g = await gig(E);
  ok(g.deposit_paid === false && g.payment_status === 'pending', `…and Undo still gives back the deposit as it was (${g.deposit_paid}, ${g.payment_status})`);
  // Paid again, then the changed balance is sent: a new request, not paid on either side.
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_paid($1, true)`, [Q]));
  await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb)`, [Q, balance(1300, 'Overtime')]));
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_sent($1, 'sent', 'email')`, [Q]));
  l = await link(Q);
  g = await gig(E);
  const v = await view(T);
  ok(l.balance_paid_at === null && g.payment_status !== 'paid' && g.deposit_paid === false && v.balance_paid === false && v.balance?.amount === 1300,
    `a changed balance sent after paid reopens the link and the gig together (link ${l.balance_paid_at}, gig ${g.payment_status}, page paid ${v.balance_paid})`);
}
{
  // Accepted by phone (the quote, not the link); the balance sheet makes the link (a draft) and previews.
  const Q = id(n++);
  const E = id(n++);
  await db.exec(`INSERT INTO quotes (id, band_id, client_name, client_email, status, response_type, converted_to_event_id) VALUES ('${Q}', '${BAND}', 'Emma Carter', 'emma.carter@example.com', 'accepted', 'accepted', '${E}')`);
  await db.exec(`INSERT INTO events (id, band_id, quote_id, status, payment_status) VALUES ('${E}', '${BAND}', '${Q}', 'confirmed', 'pending')`);
  await asAdmin(() => q(`SELECT * FROM public.bw_quote_link_publish($1, $2::jsonb, 'en', NULL)`, [Q, snap(1000)]));
  const T = (await link(Q)).token;
  const key = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_balance_preview($1, $2::jsonb) k`, [Q, balance(600)]).then((r) => r.rows[0].k)));
  const pv = key.r ? await asAnon(() => q(`SELECT public.bw_quote_link_preview($1, $2) v`, [T, key.r]).then((r) => r.rows[0].v)) : null;
  ok(pv && pv.status === 'accepted' && pv.balance?.amount === 600,
    `preview of a quote accepted by phone: the balance page, not the draft quote (${pv && pv.status}, ${pv && pv.balance && pv.balance.amount})`);
  ok((await link(Q)).status === 'draft' && (await view(T)).balance == null, '…and nothing is recorded or shown to the client');
}

// ---------------------------------------------------------------- 2b. the backfill of balance_sent (review of #293)
{
  // Sent $500, then previewed $900 the old way (a publish) before 185: the client was sent $500.
  const { Q, T } = await quote({ accepted: true });
  await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb)`, [Q, balance(500)]));
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_sent($1, 'sent', 'email')`, [Q]));
  await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb)`, [Q, balance(900, 'Trial')]));
  // Sent $700 and nothing since.
  const B = await quote({ accepted: true });
  await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb)`, [B.Q, balance(700)]));
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_sent($1, 'sent', 'email')`, [B.Q]));
  // As before 185 (no balance_sent yet), then 185 again: its backfill.
  await db.exec(`UPDATE quote_links SET balance_sent = NULL WHERE quote_id IN ('${Q}', '${B.Q}')`);
  if (!ONLY) await db.exec(readFileSync(`${REPO}/supabase/migrations/185_quote_money_fixes.sql`, 'utf8'));
  const v = await view(T);
  ok(!v.balance || v.balance.amount !== 900, `backfill: a balance only previewed after the send is not published as sent (${v.balance && v.balance.amount})`);
  ok((await view(B.T)).balance?.amount === 700, 'backfill: the balance that was sent is copied');
}

// ---------------------------------------------------------------- 3. preview, published, sent
{
  const { Q, T } = await quote({ accepted: true });
  // Preview as builds up to 383f15b do it: publish, nothing sent.
  await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb)`, [Q, balance(650, 'Trial')]));
  ok((await view(T)).balance === null, 'preview: a balance never sent is not on the client\'s page');
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_sent($1, 'sent', 'whatsapp')`, [Q]));
  ok((await view(T)).balance?.amount === 650, 'sent: the client sees the balance once it is sent');
  // A later trial amount, previewed the old way and closed without sending.
  await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb)`, [Q, balance(1, 'Typo')]));
  const v = await view(T);
  ok(v.balance?.amount === 650 && v.balance?.note === 'Trial', `preview: the client still sees what was sent (${v.balance?.amount})`);
  const kinds = (await q(`SELECT kind FROM quote_activity WHERE quote_id = $1 ORDER BY created_at`, [Q])).rows.map((r) => r.kind);
  ok(!kinds.includes('balance_updated'), 'preview: the timeline does not say the balance changed');
  // The new preview: a draft with a key, nothing published.
  const key = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_balance_preview($1, $2::jsonb) k`, [Q, balance(480, 'Draft')]).then((r) => r.rows[0].k)));
  ok(!key.e && /^[0-9a-f]{64}$/.test(key.r || ''), `preview: the admin gets a preview key (${key.e || 'ok'})`);
  const pv = key.r ? await asAnon(() => q(`SELECT public.bw_quote_link_preview($1, $2) v`, [T, key.r]).then((r) => r.rows[0].v)) : null;
  ok(pv?.balance?.amount === 480, 'preview: the preview page shows the draft');
  const wrong = key.r ? await asAnon(() => q(`SELECT public.bw_quote_link_preview($1, $2) v`, [T, 'f'.repeat(64)]).then((r) => r.rows[0].v)) : null;
  ok(wrong?.balance?.amount === 650 && (await view(T)).balance?.amount === 650, 'preview: without the key, and for the client, the sent balance');
  const memberKey = await tryIt(asMember(() => q(`SELECT public.bw_quote_balance_preview($1, $2::jsonb)`, [Q, balance(1)])));
  ok(!!memberKey.e, 'preview: admins only');
  // Sent again after a change: now the client has it, and the timeline says so.
  await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb)`, [Q, balance(600)]));
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_sent($1, 'sent', 'email')`, [Q]));
  const after = (await q(`SELECT kind FROM quote_activity WHERE quote_id = $1 ORDER BY created_at`, [Q])).rows.map((r) => r.kind);
  ok((await view(T)).balance?.amount === 600 && after.includes('balance_updated'), 'update sent: the client sees it and the timeline says it changed');
}

// ---------------------------------------------------------------- 4. revoked while waiting
{
  const { Q, T } = await quote();
  await db.exec(`INSERT INTO race VALUES ('${T}')`);
  const r = await tryIt(asAnon(() => q(`SELECT public.bw_quote_link_respond($1, 'accept', 'Emma Carter', NULL, 1) v`, [T]).then((x) => x.rows[0].v)));
  await db.exec(`DELETE FROM race`);
  const l = await link(Q);
  const qs = (await q(`SELECT status FROM quotes WHERE id = $1`, [Q])).rows[0].status;
  const accepted = (await q(`SELECT count(*)::int c FROM quote_activity WHERE quote_id = $1 AND kind = 'accepted'`, [Q])).rows[0].c;
  ok(!(l.revoked_at && (l.status === 'accepted' || qs === 'accepted' || accepted > 0)),
    `turned off while accepting: no acceptance on a revoked link (link ${l.status}, quote ${qs}, revoked ${!!l.revoked_at}, ${r.e || 'no error'})`);
}
{
  const { Q, T } = await quote();
  await db.exec(`INSERT INTO race VALUES ('${T}')`);
  const r = await tryIt(asAnon(() => q(`SELECT public.bw_quote_link_message($1, 'Is the sax player available? — Emma') v`, [T]).then((x) => x.rows[0].v)));
  await db.exec(`DELETE FROM race`);
  const l = await link(Q);
  const msgs = (await q(`SELECT count(*)::int c FROM quote_activity WHERE quote_id = $1 AND kind = 'client_message'`, [Q])).rows[0].c;
  ok(!(l.revoked_at && msgs > 0), `turned off while writing: no message on a revoked link (${msgs} messages, revoked ${!!l.revoked_at}, ${r.e || 'no error'})`);
}
{
  // Not turned off: both still work.
  const { Q, T } = await quote();
  await asAnon(() => q(`SELECT public.bw_quote_link_message($1, 'Looks great — Emma')`, [T]));
  const v = await asAnon(() => q(`SELECT public.bw_quote_link_respond($1, 'accept', 'Emma Carter', NULL, 1) v`, [T]).then((x) => x.rows[0].v));
  ok(v?.status === 'accepted' && (await link(Q)).status === 'accepted', 'link on: a message and an acceptance go through');
}

// ---------------------------------------------------------------- 5. mark all paid
{
  const E = id(n++);
  await db.exec(`INSERT INTO events (id, band_id, status) VALUES ('${E}', '${BAND}', 'confirmed');
    INSERT INTO event_members (event_id, user_id, status, fee) VALUES
      ('${E}', '${ADMIN}', 'confirmed', 0), ('${E}', '${MEMBER}', 'confirmed', 400), ('${E}', '${SUB}', 'pending', 350), ('${E}', '${OTHER}', 'declined', 300);`);
  const r = await asAdmin(() => q(`SELECT * FROM public.bw_mark_event_paid($1)`, [E]));
  const paid = (await q(`SELECT user_id FROM event_members WHERE event_id = $1 AND paid_at IS NOT NULL`, [E])).rows.map((x) => x.user_id);
  ok(paid.length === 1 && paid[0] === MEMBER && r.rows.length === 1,
    `mark all paid: only the confirmed musician with a fee is paid (${paid.length} paid)`);
  const m = await tryIt(asMember(() => q(`SELECT * FROM public.bw_mark_event_paid($1)`, [E])));
  ok(!!m.e, 'mark all paid: admins only');
}

// ---------------------------------------------------------------- 6. round 3 (Codex review of #293)
{
  // 185:314: the send records whichever balance was published last.
  const { Q, T } = await quote({ accepted: true });
  const mine = await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb) r`, [Q, balance(800)]).then((r) => r.rows[0].r));
  // Another admin publishes a different amount before this send is recorded.
  await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb)`, [Q, balance(950, 'Overtime')]));
  const before = await link(Q);
  const acts = async () => (await q(`SELECT count(*)::int c FROM quote_activity WHERE quote_id = $1`, [Q])).rows[0].c;
  const n0 = await acts();
  const r = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_balance_mark_sent($1, 'sent', 'email', $2)`, [Q, mine.balance_version])));
  const after = await link(Q);
  ok(/BW_BALANCE_CHANGED/.test(r.e || ''), `send of a replaced balance: refused with BW_BALANCE_CHANGED (${r.e || 'went through'})`);
  ok(after.balance_sent == null && after.balance_sent_at == null && (await acts()) === n0 && (await view(T)).balance == null,
    `…and nothing recorded: the page asks for no amount the client was not sent (balance_sent ${after.balance_sent && after.balance_sent.amount})`);
  ok(before.balance_version === mine.balance_version + 1, 'the other admin\'s publish is the newer version');
  // The version that is on the link goes through.
  const ok2 = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_balance_mark_sent($1, 'sent', 'email', $2)`, [Q, before.balance_version])));
  ok(!ok2.e && (await view(T)).balance?.amount === 950, `send of the balance on the link: recorded (${ok2.e || 'ok'})`);
  // Older builds: three named arguments, no version, as before.
  const old = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_balance_mark_sent(p_quote_id => $1, p_kind => 'reminded', p_channel => 'whatsapp')`, [Q])));
  ok(!old.e, `older builds (no version) still record (${old.e || 'ok'})`);
  const grants = await tryIt(q(`SELECT has_function_privilege('anon', 'public.bw_quote_balance_mark_sent(uuid, text, text, int)', 'EXECUTE') a,
                                   has_function_privilege('authenticated', 'public.bw_quote_balance_mark_sent(uuid, text, text, int)', 'EXECUTE') u,
                                   (SELECT count(*)::int FROM pg_proc WHERE proname = 'bw_quote_balance_mark_sent') n`).then((x) => x.rows[0]));
  ok(!grants.e && !grants.r.a && grants.r.u && grants.r.n === 1, `mark sent: one function, admins (authenticated) only, no anon (${grants.e || JSON.stringify(grants.r)})`);
}
{
  // Lock order (183:594 / 185): the quote, then the link, then the gig. A
  // function that writes the link or the gig before the quote is locked can
  // deadlock with a save of the quote (quote, then link) or with another.
  await db.exec(`
    CREATE EXTENSION IF NOT EXISTS pageinspect;
    CREATE TABLE IF NOT EXISTS lock_log (fn text, tbl text, ok boolean, info text);
    -- Locked by this transaction with an exclusive row lock (FOR UPDATE or an
    -- update), not only the key-share lock a foreign key check takes.
    CREATE OR REPLACE FUNCTION test_row_locked(p_rel regclass, p_ctid tid, p_xmax xid) RETURNS boolean LANGUAGE plpgsql AS $f$
    DECLARE v_ctid point := p_ctid::text::point; v_mask int;
    BEGIN
      SELECT h.t_infomask INTO v_mask FROM heap_page_items(get_raw_page(p_rel::text, v_ctid[0]::int)) h WHERE h.lp = v_ctid[1]::int;
      RETURN p_xmax::text = (txid_current() % 4294967296)::text AND (v_mask & 64) <> 0;
    END $f$;
    CREATE OR REPLACE FUNCTION test_lock_probe() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $f$
    DECLARE v_quote boolean; v_link boolean := true;
    BEGIN
      SELECT test_row_locked('public.quotes', q.ctid, q.xmax) INTO v_quote FROM quotes q WHERE q.id = NEW.quote_id;
      IF TG_TABLE_NAME = 'events' THEN
        SELECT test_row_locked('public.quote_links', l.ctid, l.xmax) INTO v_link FROM quote_links l WHERE l.quote_id = NEW.quote_id;
      END IF;
      INSERT INTO lock_log VALUES (current_setting('test.fn', true), TG_TABLE_NAME, coalesce(v_quote, false) AND coalesce(v_link, true),
        'quote ' || coalesce(v_quote::text, '-') || ' link ' || coalesce(v_link::text, '-'));
      RETURN NEW;
    END $f$;
    DROP TRIGGER IF EXISTS test_lock_probe ON quote_links;
    CREATE TRIGGER test_lock_probe BEFORE UPDATE ON quote_links FOR EACH ROW EXECUTE FUNCTION test_lock_probe();
    DROP TRIGGER IF EXISTS test_lock_probe ON events;
    CREATE TRIGGER test_lock_probe BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION test_lock_probe();`);
  const probe = async (fn, run, tables) => {
    await db.exec(`DELETE FROM lock_log`);
    await db.exec(`SELECT set_config('test.fn', '${fn}', false)`);
    const r = await tryIt(run());
    const rows = (await q(`SELECT tbl, ok, info FROM lock_log`)).rows;
    if (process.env.DEBUG) console.log(fn, r.e || '', JSON.stringify(rows));
    return !r.e && tables.every((t) => rows.some((x) => x.tbl === t)) && rows.every((x) => x.ok);
  };
  const { Q } = await quote({ accepted: true });
  ok(await probe('publish', () => asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb)`, [Q, balance(1000)])), ['quote_links']),
    'lock order: balance publish locks the quote before the link');
  ok(await probe('preview', () => asAdmin(() => q(`SELECT public.bw_quote_balance_preview($1, $2::jsonb)`, [Q, balance(990)])), ['quote_links']),
    'lock order: balance preview locks the quote before the link');
  ok(await probe('mark_sent', () => asAdmin(() => q(`SELECT public.bw_quote_balance_mark_sent($1, 'sent', 'email')`, [Q])), ['quote_links']),
    'lock order: balance mark sent locks the quote before the link');
  ok(await probe('mark_paid', () => asAdmin(() => q(`SELECT public.bw_quote_balance_mark_paid($1, true)`, [Q])), ['quote_links', 'events']),
    'lock order: mark paid locks the quote, then the link, then the gig');
  await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb)`, [Q, balance(1100, 'Overtime')]));
  ok(await probe('mark_sent_reopen', () => asAdmin(() => q(`SELECT public.bw_quote_balance_mark_sent($1, 'sent', 'email')`, [Q])), ['quote_links', 'events']),
    'lock order: a send that reopens "paid" locks the quote, then the link, then the gig');
  await db.exec(`DROP TRIGGER test_lock_probe ON quote_links; DROP TRIGGER test_lock_probe ON events;`);
}

console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
