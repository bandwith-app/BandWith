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
//      quote before the link and the link before the gig (pageinspect);
//   8. round 4: replacing a musician on a quote changes the tentative gig's
//      lineup in the same transaction; a gig confirmed meanwhile is left as
//      it is; members never read the lineup's fees through it;
//   8b. round 5: a lineup changed meanwhile is refused, the gig loses only
//      who was on the quote's previous lineup, the message limit is per link;
//   10. round 10 (#294 review 1b): no acceptance on a cancelled or
//      deleted date (BWQ01, nothing written); decline and messages still
//      work; a version published after the deletion, or a new event, can
//      be accepted; an accepted quote is left as it is;
//   11. round 11: a band deleted with its events in the transaction that
//      made its link (the cascade) goes through; 176's pdf_keys trigger
//      and 180's account-deletion guard (loaded from their branches,
//      BW_176_REF / BW_180_REF, git repo BW_GIT or the repo; SKIP when
//      not found) let the
//      event_removed_at write through;
//   12. round 12 (Claude review of 5f062639): the accept locks the event
//      row and checks "is the date gone" in the statement after it (the
//      function's source, a lock probe, and a stand-in for a cancel that
//      commits while the accept is in flight); the event delete trigger
//      locks the quote before it writes the link (source and lock probe);
//      a refusal writes nothing, a decline and a message take no event
//      lock, a band going with its quotes and events still goes through;
//      "the client answered by phone" (bw_quote_link_set_outcome, 105's,
//      now redefined by 187) locks the quote before the link and answers
//      as it did.
//      PGlite is one connection: the two real races (two sessions) are
//      left to the real-Postgres pass on the release checklist;
//   13. round 12 (Claude review of #294's last 178): a save of the lineup
//      (bw_quote_save_lineup, bw_quote_save_with_lineup) locks the quote's
//      events rows FOR UPDATE right after the quote and before it writes
//      (source and lock probe), and still saves with and without an event;
//   14. round 13 (Claude review of 97e80955): bw_quote_balance_publish, the
//      third writer of an accepted link, locks the gig's row after the
//      link and reads its status in the next statement (source and lock
//      probe); bw_quote_lock_events never locks another band's event;
//   7. 187 is a superset of 183 round 3 (the receipt in the quote's
//      currency, deposit received locks the link before the gig, one
//      conversation per link, a new client's old link takes nothing), the
//      page says when the balance shown was sent, 183 refuses to run after
//      187, and 187 refuses to run before 183 and 185.
//
//   mkdir -p /tmp/pgM && cd /tmp/pgM && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/money_fixes.pglite.mjs . && node money_fixes.pglite.mjs <repo>
//
// With /dev/null as a third argument the migrations under test are not
// loaded and their checks fail (the bugs as live).
import { PGlite } from '@electric-sql/pglite';
import { pageinspect } from '@electric-sql/pglite/contrib/pageinspect';
import { existsSync, readFileSync } from 'node:fs';

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
CREATE TABLE public.event_members (event_id uuid, user_id uuid, status text, fee numeric, paid_at timestamptz, role text, PRIMARY KEY (event_id, user_id));
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, band_id uuid, type text,
  title varchar, body text, data jsonb, created_at timestamptz DEFAULT now());
GRANT SELECT, UPDATE ON public.quotes TO authenticated;
CREATE FUNCTION public.bw_is_band_admin(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND role = 'admin' AND COALESCE(is_active, true)); $f$;
CREATE FUNCTION public.bw_is_band_member(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND COALESCE(is_active, true)); $f$;
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
  const grants = await tryIt(q(`SELECT has_function_privilege('anon', 'public.bw_quote_balance_mark_sent(uuid, text, text, int, boolean)', 'EXECUTE') a,
                                   has_function_privilege('authenticated', 'public.bw_quote_balance_mark_sent(uuid, text, text, int, boolean)', 'EXECUTE') u,
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

// ---------------------------------------------------------------- 8. the lineup of the date on hold (round 4)
{
  const { Q, E } = await quote();
  await db.exec(`UPDATE events SET status = 'tentative' WHERE id = '${E}'`);
  // On hold with Maya (bass) and Sam (drums); Maya already said yes.
  await db.exec(`INSERT INTO quote_musicians (quote_id, user_id, name, instrument, fee) VALUES ('${Q}', '${MEMBER}', 'Maya Brooks', 'Bass', 300), ('${Q}', '${SUB}', 'Sam Ortiz', 'Drums', 250)`);
  await db.exec(`INSERT INTO event_members (event_id, user_id, status, fee, role) VALUES ('${E}', '${MEMBER}', 'confirmed', 300, 'Bass'), ('${E}', '${SUB}', 'pending', 250, 'Drums')`);
  // The admin replaces Sam with an outside drummer and raises Maya's fee.
  const rows = [
    { user_id: MEMBER, name: 'Maya Brooks', instrument: 'Bass', fee: 350, is_external: false, is_available: true },
    { user_id: null, name: 'Leo Park', instrument: 'Drums', fee: 275, is_external: true, is_available: true },
  ];
  const r = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_save_lineup($1, $2::jsonb) r`, [Q, JSON.stringify(rows)])));
  const out = r.r && r.r.rows[0].r;
  ok(!r.e && out && out.synced === true && out.event_id === E && out.musicians.length === 2,
    `lineup + hold: saved together (${r.e || JSON.stringify(out && { s: out.synced, n: out.musicians.length })})`);
  const em = (await q(`SELECT user_id, status, fee::float AS fee, role FROM event_members WHERE event_id = $1 ORDER BY user_id`, [E])).rows;
  ok(em.length === 1 && em[0].user_id === MEMBER && em[0].status === 'confirmed' && em[0].fee === 350,
    `lineup + hold: Sam is off the gig, Maya keeps her yes with the new fee (${JSON.stringify(em)})`);
  // The quote is confirmed: the gig's lineup is the quote's.
  await db.exec(`UPDATE events SET status = 'confirmed' WHERE id = '${E}'`);
  ok(!(await q(`SELECT 1 FROM event_members WHERE event_id = $1 AND user_id = $2`, [E, SUB])).rows.length,
    'lineup + hold: once the gig is confirmed, the replaced musician is not on it');
  // Confirmed meanwhile: the quote's lineup is saved, the gig is left as it is.
  const again = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_save_lineup($1, $2::jsonb) r`, [Q, JSON.stringify([rows[1]])])));
  const em2 = (await q(`SELECT count(*)::int c FROM event_members WHERE event_id = $1`, [E])).rows[0].c;
  const qm2 = (await q(`SELECT count(*)::int c FROM quote_musicians WHERE quote_id = $1`, [Q])).rows[0].c;
  ok(!again.e && again.r.rows[0].r.confirmed === true && again.r.rows[0].r.synced === false && em2 === 1 && qm2 === 1,
    `lineup + hold: a gig confirmed meanwhile is not touched (${again.e || JSON.stringify(again.r.rows[0].r.confirmed)}, ${em2} on the gig)`);
  // One transaction: a bad row changes neither.
  await db.exec(`UPDATE events SET status = 'tentative' WHERE id = '${E}'`);
  const bad = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_save_lineup($1, '[{"user_id":null,"name":"","fee":"1"}]'::jsonb)`, [Q])));
  ok(!!bad.e && (await q(`SELECT count(*)::int c FROM event_members WHERE event_id = $1`, [E])).rows[0].c === 1,
    'lineup + hold: a refused lineup changes neither the quote nor the gig');
  const member = await tryIt(asMember(() => q(`SELECT public.bw_quote_save_lineup($1, '[]'::jsonb)`, [Q])));
  const anon = await tryIt(asAnon(() => q(`SELECT public.bw_quote_save_lineup($1, '[]'::jsonb)`, [Q])));
  ok(!!member.e && !!anon.e, 'lineup + hold: members and anon cannot call it (no fees through it)');
}

// ---------------------------------------------------------------- 8b. round 5 (Codex + Claude review of #293)
{
  const DIRECT = id(90);
  const DEPUTY = id(91);
  await db.exec(`INSERT INTO auth.users VALUES ('${DIRECT}'), ('${DEPUTY}') ON CONFLICT DO NOTHING;
                 INSERT INTO band_members (band_id, user_id, role, is_active)
                 SELECT '${BAND}', '${DIRECT}', 'member', true WHERE NOT EXISTS (SELECT 1 FROM band_members WHERE user_id = '${DIRECT}');`);
  const lineupOf = (Q) => q(`SELECT name, instrument, fee::float AS fee FROM quote_musicians WHERE quote_id = $1 ORDER BY name`, [Q]).then((r) => r.rows);
  const onGig = (E) => q(`SELECT user_id FROM event_members WHERE event_id = $1 ORDER BY user_id`, [E]).then((r) => r.rows.map((x) => x.user_id));

  // MINOR 3: the gig loses only who was on the quote's lineup before.
  const { Q, E } = await quote();
  await db.exec(`UPDATE events SET status = 'tentative' WHERE id = '${E}'`);
  await db.exec(`INSERT INTO quote_musicians (quote_id, user_id, name, instrument, fee) VALUES ('${Q}', '${MEMBER}', 'Maya Brooks', 'Bass', 300), ('${Q}', '${SUB}', 'Sam Ortiz', 'Drums', 250)`);
  await db.exec(`INSERT INTO event_members (event_id, user_id, status, fee, role) VALUES
    ('${E}', '${MEMBER}', 'confirmed', 300, 'Bass'), ('${E}', '${SUB}', 'pending', 250, 'Drums'),
    ('${E}', '${ADMIN}', 'confirmed', 0, 'Keys'), ('${E}', '${DIRECT}', 'pending', 200, 'Guitar'), ('${E}', '${DEPUTY}', 'confirmed', 180, 'Sax')`);
  const base = [
    { user_id: MEMBER, name: 'Maya Brooks', instrument: 'Bass', fee: 300 },
    { user_id: SUB, name: 'Sam Ortiz', instrument: 'Drums', fee: 250 },
  ];
  const keep = [{ user_id: MEMBER, name: 'Maya Brooks', instrument: 'Bass', fee: 300, is_external: false, is_available: true }];
  // (The two-argument call: the round 4 shape, so this check fails on round 4's 185.)
  const r1 = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_save_lineup($1, $2::jsonb) r`, [Q, JSON.stringify(keep)])));
  const g1 = await onGig(E);
  ok(!r1.e && !g1.includes(SUB) && [MEMBER, ADMIN, DIRECT, DEPUTY].every((u) => g1.includes(u)),
    `round 5: Sam leaves the gig; the admin, a direct add and a deputy stay (${r1.e || g1.length})`);

  // Item 9: a lineup changed meanwhile is refused; nothing comes back.
  const stale = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_save_lineup($1, $2::jsonb, $3::jsonb) r`,
    [Q, JSON.stringify([...keep, { user_id: SUB, name: 'Sam Ortiz', instrument: 'Drums', fee: 250 }]), JSON.stringify(base)])));
  const l2 = await lineupOf(Q);
  ok(!!stale.e && /changed this quote’s lineup/.test(stale.e) && l2.length === 1 && !(await onGig(E)).includes(SUB),
    `round 5: a lineup saved over one changed meanwhile is refused, Sam stays off (${stale.e})`);
  // The same lineup as stored (any order, fee as a number or text): accepted.
  const same = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_save_lineup($1, $2::jsonb, $3::jsonb) r`,
    [Q, JSON.stringify([{ ...keep[0], fee: 325 }]), JSON.stringify([{ user_id: MEMBER.toUpperCase(), name: ' maya brooks ', instrument: 'bass', fee: '300.00' }])])));
  ok(!same.e && (await lineupOf(Q))[0].fee === 325, `round 5: the lineup as opened saves (${same.e || 'fee 325'})`);
  // An old call (no base) keeps working.
  const old = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_save_lineup($1, $2::jsonb) r`, [Q, JSON.stringify(keep)])));
  ok(!old.e && old.r.rows[0].r.synced === true, `round 5: the two-argument call still works (${old.e || 'synced'})`);

  // MINOR 3: a quote with no lineup takes nobody off its gig.
  const { Q: Q2, E: E2 } = await quote();
  await db.exec(`UPDATE events SET status = 'tentative' WHERE id = '${E2}'`);
  await db.exec(`INSERT INTO event_members (event_id, user_id, status, fee, role) VALUES ('${E2}', '${MEMBER}', 'confirmed', 300, 'Bass'), ('${E2}', '${DIRECT}', 'pending', 200, 'Guitar')`);
  const none = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_save_lineup($1, '[]'::jsonb) r`, [Q2])));
  const g2 = await onGig(E2);
  ok(!none.e && g2.length === 2, `round 5: a quote with no musicians takes nobody off the gig (${none.e || g2.length})`);

  // MINOR 9b: the message limit counts this link's messages, not the quote's.
  const { Q: Q3, T: T3 } = await quote();
  await db.exec(`INSERT INTO quote_activity (quote_id, band_id, kind, body, version, link_id)
                 SELECT '${Q3}', '${BAND}', 'client_message', 'to the previous client ' || g, 1, gen_random_uuid() FROM generate_series(1, 20) g`);
  const first = await tryIt(asAnon(() => q(`SELECT public.bw_quote_link_message($1, 'Hi, is the date still free?') v`, [T3])));
  ok(!first.e && first.r.rows[0].v !== null, `round 5: 20 messages on an old link do not block the new client (${first.e || 'sent'})`);
  await db.exec(`INSERT INTO quote_activity (quote_id, band_id, kind, body, version, link_id)
                 SELECT '${Q3}', '${BAND}', 'client_message', 'more ' || g, 1, (SELECT id FROM quote_links WHERE quote_id = '${Q3}') FROM generate_series(1, 19) g`);
  const limit = await tryIt(asAnon(() => q(`SELECT public.bw_quote_link_message($1, 'One more') v`, [T3])));
  ok(!!limit.e && /Too many/.test(limit.e), `round 5: 20 on this link and the next waits (${limit.e})`);
}

// ---------------------------------------------------------------- 9. round 6 (Codex + Claude review of #293)
{
  await db.exec(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS base_fee numeric(10,2), ADD COLUMN IF NOT EXISTS venue_name text`);
  const lineupOf = (Q) => q(`SELECT name, fee::float AS fee FROM quote_musicians WHERE quote_id = $1 ORDER BY name`, [Q]).then((r) => r.rows);
  const baseFee = (Q) => q(`SELECT base_fee::float AS f, venue_name FROM quotes WHERE id = $1`, [Q]).then((r) => r.rows[0]);
  const m = (name, fee, user_id = null) => ({ user_id, name, instrument: name === 'Sam Ortiz' ? 'Drums' : 'Guitar', fee, is_external: !user_id, is_available: true });
  const save = (who, Q, updates, musicians, base) => tryIt(who(() => q(`SELECT public.bw_quote_save_with_lineup($1, $2::jsonb, $3::jsonb, $4::jsonb) r`,
    [Q, JSON.stringify(updates), JSON.stringify(musicians), base == null ? null : JSON.stringify(base)]).then((r) => r.rows[0].r)));

  // Blocker (r8): A has Sam $200 + Jo $150 open; B removes Sam; A raises Jo to $180.
  const { Q, E } = await quote();
  await db.exec(`UPDATE events SET status = 'tentative' WHERE id = '${E}'`);
  await db.exec(`UPDATE quotes SET base_fee = 350 WHERE id = '${Q}'`);
  await db.exec(`INSERT INTO quote_musicians (quote_id, user_id, name, instrument, fee) VALUES ('${Q}', '${SUB}', 'Sam Ortiz', 'Drums', 200), ('${Q}', NULL, 'Jo Kim', 'Guitar', 150)`);
  const opened = [m('Sam Ortiz', 200, SUB), m('Jo Kim', 150)];
  const b = await save(asAdmin, Q, { base_fee: 150 }, [m('Jo Kim', 150)], opened);
  ok(!b.e && b.r.quote.base_fee == 150 && b.r.lineup.musicians.length === 1 && b.r.lineup.synced === true,
    `round 6: B removes Sam, the quote and the lineup together (${b.e || JSON.stringify(b.r && b.r.quote.base_fee)})`);
  const a = await save(asAdmin, Q, { base_fee: 380, venue_name: 'Brooklyn Bowl' }, [m('Sam Ortiz', 200, SUB), m('Jo Kim', 180)], opened);
  const afterA = await baseFee(Q);
  const lA = await lineupOf(Q);
  ok(!!a.e && /changed this quote’s lineup/.test(a.e) && afterA.f === 150 && afterA.venue_name === null && lA.length === 1 && lA[0].fee === 150,
    `round 6: A's stale save is refused whole: base fee ${afterA.f}, venue ${afterA.venue_name}, lineup ${JSON.stringify(lA)} (${a.e})`);
  const hint = await tryIt(asAdmin(() => q(`DO $d$ DECLARE h text; c text; BEGIN
      PERFORM public.bw_quote_save_with_lineup('${Q}', '{"base_fee":380}'::jsonb, '[]'::jsonb, '${JSON.stringify(opened)}'::jsonb);
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS h = PG_EXCEPTION_HINT, c = RETURNED_SQLSTATE; RAISE EXCEPTION 'got %/%', c, h; END $d$`)));
  ok(/got 40001\/BW_LINEUP_CHANGED/.test(hint.e || ''), `round 6: refused as 40001, hint BW_LINEUP_CHANGED (${hint.e})`);
  // Reloaded: the lineup as stored now, then the raise saves both.
  const fresh = await save(asAdmin, Q, { base_fee: 180, venue_name: 'Brooklyn Bowl' }, [m('Jo Kim', 180)], [m('Jo Kim', 150)]);
  const afterF = await baseFee(Q);
  ok(!fresh.e && afterF.f === 180 && afterF.venue_name === 'Brooklyn Bowl' && (await lineupOf(Q))[0].fee === 180 && fresh.r.quote.venue_name === 'Brooklyn Bowl',
    `round 6: reopened with the lineup as stored, the raise saves the quote and the lineup (${fresh.e || afterF.f})`);
  // Refusals write nothing either: an unknown column, a member, anon.
  const col = await save(asAdmin, Q, { base_fee: 1, no_such_column: 1 }, [m('Jo Kim', 1)], [m('Jo Kim', 180)]);
  ok(!!col.e && /no_such_column/.test(col.e) && (await baseFee(Q)).f === 180 && (await lineupOf(Q))[0].fee === 180,
    `round 6: an unknown column: nothing written (${col.e})`);
  const mem = await save(asMember, Q, { base_fee: 1 }, [m('Jo Kim', 1)], null);
  const an = await save(asAnon, Q, { base_fee: 1 }, [m('Jo Kim', 1)], null);
  ok(!!mem.e && !!an.e && (await baseFee(Q)).f === 180, `round 6: members and anon cannot save through it (${mem.e} / ${an.e})`);
  const g = await q(`SELECT has_function_privilege('anon', 'public.bw_quote_save_with_lineup(uuid, jsonb, jsonb, jsonb)', 'EXECUTE') a,
                             has_function_privilege('authenticated', 'public.bw_quote_save_with_lineup(uuid, jsonb, jsonb, jsonb)', 'EXECUTE') u,
                             (SELECT prosecdef FROM pg_proc WHERE proname = 'bw_quote_save_with_lineup') d,
                             has_function_privilege('anon', 'public.bw_quote_lineup_current(uuid, jsonb)', 'EXECUTE') ca`).then((r) => r.rows[0], (e) => ({ a: true, e: e.message }));
  ok(!g.a && g.u && g.d === false && !g.ca, `round 6: authenticated only, security invoker (${JSON.stringify(g)})`);
  // Older builds: the direct update and the two calls still work.
  const oldWay = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_save_lineup($1, $2::jsonb, $3::jsonb) r`, [Q, JSON.stringify([m('Jo Kim', 190)]), JSON.stringify([m('Jo Kim', 180)])])));
  ok(!oldWay.e, `round 6: bw_quote_save_lineup as round 5 calls it (${oldWay.e || 'ok'})`);

  // Item 9: who includes the profile; a profile not of the band counts as none.
  const { Q: Q9 } = await quote();
  await db.exec(`INSERT INTO quote_musicians (quote_id, user_id, name, instrument, fee) VALUES ('${Q9}', '${SUB}', 'Sam Ortiz', 'Drums', 250)`);
  const other = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_save_lineup($1, '[]'::jsonb, $2::jsonb)`, [Q9, JSON.stringify([m('Sam Ortiz', 250, MEMBER)])])));
  ok(!!other.e && /changed this quote’s lineup/.test(other.e) && (await lineupOf(Q9)).length === 1,
    `round 6: another Sam Ortiz (another profile, same fee) is another lineup (${other.e})`);
  await db.exec(`UPDATE quote_musicians SET user_id = '${OTHER}' WHERE quote_id = '${Q9}'`);
  const former = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_save_lineup($1, $2::jsonb, $3::jsonb)`, [Q9, JSON.stringify([m('Sam Ortiz', 275)]), JSON.stringify([m('Sam Ortiz', 250)])])));
  ok(!former.e && (await lineupOf(Q9))[0].fee === 275, `round 6: a former member's profile counts as none on both sides (${former.e || 'saved'})`);

  // Item 7: the email's send is recorded first (pending), then confirmed or put back.
  const { Q: Q7, T: T7 } = await quote({ accepted: true });
  const pub = async (amount) => (await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb) r`, [Q7, balance(amount)]))).rows[0].r;
  const ver = (await pub(700)).balance_version;
  const kinds = () => q(`SELECT kind FROM quote_activity WHERE quote_id = $1 AND kind LIKE 'balance_%' ORDER BY created_at`, [Q7]).then((r) => r.rows.map((x) => x.kind));
  const pend = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_balance_mark_sent($1, 'sent', 'email', $2, true) k`, [Q7, ver]).then((r) => r.rows[0].k)));
  const pl = await link(Q7);
  ok(!pend.e && (await view(T7)).balance?.amount === 700 && pl.balance_send_pending?.version === ver,
    `round 6: before the email, the page already shows the balance it names (${pend.e || (await view(T7)).balance?.amount})`);
  const failed = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_balance_send_failed($1, $2) r`, [Q7, ver]).then((r) => r.rows[0].r)));
  ok(!failed.e && failed.r === true && (await view(T7)).balance === null && (await kinds()).length === 0 && (await link(Q7)).balance_send_pending === null,
    `round 6: the email did not go out: the page and the timeline are as before (${failed.e || JSON.stringify(await kinds())})`);
  await tryIt(asAdmin(() => q(`SELECT public.bw_quote_balance_mark_sent($1, 'sent', 'email', $2, true)`, [Q7, ver])));
  const conf = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_balance_mark_sent($1, 'sent', 'email', $2, false) k`, [Q7, ver]).then((r) => r.rows[0].k)));
  ok(!conf.e && conf.r === 'balance_requested' && (await kinds()).length === 1 && (await link(Q7)).balance_send_pending === null,
    `round 6: the email went out: confirmed, recorded once (${conf.e || JSON.stringify(await kinds())})`);
  const late = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_balance_send_failed($1, $2) r`, [Q7, ver]).then((r) => r.rows[0].r)));
  ok(!late.e && late.r === false && (await view(T7)).balance?.amount === 700, 'round 6: a confirmed send is never put back');
  // A changed balance, its email refused: the page goes back to the one sent before.
  const sentAt = (await link(Q7)).balance_sent_at;
  const v2 = (await pub(820)).balance_version;
  await tryIt(asAdmin(() => q(`SELECT public.bw_quote_balance_mark_sent($1, 'sent', 'email', $2, true)`, [Q7, v2])));
  ok((await view(T7)).balance?.amount === 820 && (await kinds()).length === 3, 'round 6: the changed balance is on the page before its email');
  const other7 = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_balance_send_failed($1, $2) r`, [Q7, ver]).then((r) => r.rows[0].r)));
  ok(!other7.e && other7.r === false && (await view(T7)).balance?.amount === 820, 'round 6: another version is not put back');
  await tryIt(asAdmin(() => q(`SELECT public.bw_quote_balance_send_failed($1, $2)`, [Q7, v2])));
  const back = await link(Q7);
  ok((await view(T7)).balance?.amount === 700 && (await kinds()).length === 1 && String(back.balance_sent_at) === String(sentAt),
    `round 6: refused email of a changed balance: the page shows the one sent before (${(await view(T7)).balance?.amount})`);
  // Paid: no email goes out, so none is recorded.
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_paid($1, true)`, [Q7]));
  const paid = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_balance_mark_sent($1, 'sent', 'email', $2, true)`, [Q7, v2])));
  ok(!!paid.e && /no open balance/.test(paid.e), `round 6: a paid balance records no email send (${paid.e})`);
  const fn = await q(`SELECT has_function_privilege('anon', 'public.bw_quote_balance_send_failed(uuid, int)', 'EXECUTE') a,
                              has_function_privilege('authenticated', 'public.bw_quote_balance_send_failed(uuid, int)', 'EXECUTE') u`).then((r) => r.rows[0], (e) => ({ a: true, e: e.message }));
  const memFail = await tryIt(asMember(() => q(`SELECT public.bw_quote_balance_send_failed($1, $2)`, [Q7, v2])));
  ok(!fn.a && fn.u && !!memFail.e, `round 6: put back: admins only (${JSON.stringify(fn)}, member ${memFail.e ? 'refused' : 'allowed'})`);
}

// ---------------------------------------------------------------- 10. round 10: the date is gone (#294 review 1b)
{
  const answer = (T, action, version = 1) =>
    asAnon(() => q(`SELECT public.bw_quote_link_respond($1, $2, 'Emma Carter', NULL, $3) v`, [T, action, version]).then((r) => r.rows[0].v))
      .then((r) => ({ r }), (e) => ({ e: e.message, code: e.code }));
  const state = (Q) => q(`SELECT q.status qs, l.status ls, l.accepted_name,
      (SELECT count(*)::int FROM quote_activity a WHERE a.quote_id = q.id AND a.kind = 'accepted') acts
      FROM quotes q JOIN quote_links l ON l.quote_id = q.id WHERE q.id = $1`, [Q]).then((r) => r.rows[0]);

  // a. The band cancels the quote's event; the client accepts the live link: refused, nothing written.
  const c = await quote();
  await db.exec(`UPDATE events SET status = 'cancelled' WHERE id = '${c.E}'`);
  const cv = await view(c.T);
  const ca = await answer(c.T, 'accept');
  const cs = await state(c.Q);
  ok(cv?.unavailable === true, `round 10: the page of a quote whose event is cancelled says the date is gone (${cv?.unavailable})`);
  ok(ca.code === 'BWQ01' && cs.qs !== 'accepted' && cs.ls !== 'accepted' && !cs.accepted_name && cs.acts === 0,
    `round 10: accept on a cancelled event is refused (BWQ01), the quote stays unaccepted (${ca.code || ca.e || 'accepted'}, quote ${cs.qs}, link ${cs.ls}, ${cs.acts} accepted rows)`);
  // A message (to ask for a new quote) and a decline still go through.
  const cm = await tryIt(asAnon(() => q(`SELECT public.bw_quote_link_message($1, 'Could we pick another date?') v`, [c.T]).then((r) => r.rows[0].v)));
  const cd = await answer(c.T, 'decline');
  const cds = await state(c.Q);
  ok(!cm.e && cm.r && !cd.e && cd.r?.status === 'declined' && cds.qs === 'declined' && cds.ls === 'declined',
    `round 10: on a cancelled event, a message and a decline still work (${cm.e || 'sent'}, ${cd.e || cd.r?.status}, quote ${cds.qs})`);
  // Declined, then a change of mind: still no accept.
  const ca2 = await answer(c.T, 'accept');
  ok(ca2.code === 'BWQ01' && (await state(c.Q)).qs === 'declined', `round 10: accept after a decline on a cancelled event: refused (${ca2.code || ca2.e || 'accepted'})`);

  // b. The band deletes the quote's event: refused too.
  const d = await quote();
  await db.exec(`DELETE FROM events WHERE id = '${d.E}'`);
  await db.exec(`UPDATE quotes SET converted_to_event_id = NULL WHERE id = '${d.Q}'`); // the FK's ON DELETE SET NULL
  const dl = await link(d.Q);
  const dv = await view(d.T);
  const da = await answer(d.T, 'accept');
  const ds = await state(d.Q);
  ok(dl.event_removed_at !== null && dv?.unavailable === true, `round 10: deleting the quote's event marks the link, the page says the date is gone (${dl.event_removed_at}, ${dv?.unavailable})`);
  ok(da.code === 'BWQ01' && ds.qs !== 'accepted' && ds.ls !== 'accepted' && ds.acts === 0,
    `round 10: accept on a deleted event is refused (BWQ01), the quote stays unaccepted (${da.code || da.e || 'accepted'}, quote ${ds.qs}, link ${ds.ls})`);
  // A version published after the deletion is a new offer: it can be accepted.
  await asAdmin(() => q(`SELECT * FROM public.bw_quote_link_publish($1, $2::jsonb, 'en', NULL)`, [d.Q, snap(900)]));
  const dv2 = await view(d.T);
  const da2 = await answer(d.T, 'accept', dv2?.version);
  ok(dv2?.unavailable === false && !da2.e && da2.r?.status === 'accepted', `round 10: a version published after the deletion can be accepted (${dv2?.unavailable}, ${da2.e || da2.r?.status})`);

  // c. Deleted, then a new event linked to the quote: that event decides.
  const r = await quote();
  const NEWE = id(n++);
  await db.exec(`DELETE FROM events WHERE id = '${r.E}'`);
  await db.exec(`INSERT INTO events (id, band_id, status, payment_status) VALUES ('${NEWE}', '${BAND}', 'tentative', 'pending');
                 UPDATE quotes SET converted_to_event_id = '${NEWE}' WHERE id = '${r.Q}'`);
  const ra = await answer(r.T, 'accept');
  ok(!ra.e && ra.r?.status === 'accepted', `round 10: deleted, then a new event for the quote: accept works (${ra.e || ra.r?.status})`);

  // d. An accepted quote whose gig is deleted afterwards: left as it is.
  const k = await quote({ accepted: true });
  await db.exec(`DELETE FROM events WHERE id = '${k.E}'`);
  const kl = await link(k.Q);
  const kv = await view(k.T);
  ok(kl.status === 'accepted' && kl.event_removed_at === null && kv?.status === 'accepted' && kv?.unavailable === false,
    `round 10: an accepted quote's link is not marked when its gig is deleted (${kl.event_removed_at}, ${kv?.unavailable})`);

  // e. A quote with a live event (and another band's deleted event) still accepts.
  const l = await quote();
  await db.exec(`INSERT INTO events (id, band_id, quote_id, status) VALUES ('${id(n)}', '${id(99)}', NULL, 'tentative'); DELETE FROM events WHERE id = '${id(n++)}'`);
  const la = await answer(l.T, 'accept');
  ok(!la.e && la.r?.status === 'accepted' && la.r?.unavailable === false, `round 10: a live date still accepts (${la.e || la.r?.status})`);

  // f. The marker is not for apps: anon and members cannot call the helper.
  const h1 = await tryIt(asAnon(() => q(`SELECT public.bw_quote_date_unavailable($1, NULL, NULL)`, [l.Q])));
  const h2 = await tryIt(asMember(() => q(`SELECT public.bw_quote_date_unavailable($1, NULL, NULL)`, [l.Q])));
  ok(!!h1.e && !!h2.e, `round 10: bw_quote_date_unavailable is not callable by anon or members (${h1.e ? 'refused' : 'allowed'}, ${h2.e ? 'refused' : 'allowed'})`);
}

// ---------------------------------------------------------------- 11. round 11: the delete trigger from a cascade, 176 and 180
{
  // a. As prod: events go with their band (the events FK older than the
  // link's, so its cascade runs first). In one transaction: a band, its
  // event, a quote on it and a link, then the band is deleted.
  await db.exec(`
    ALTER TABLE events ADD CONSTRAINT test_events_band_fkey FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE quote_links DROP CONSTRAINT quote_links_band_id_fkey;
    ALTER TABLE quote_links ADD CONSTRAINT quote_links_band_id_fkey FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE CASCADE;`);
  const [B2, E2, Q2] = [id(n++), id(n++), id(n++)];
  const cascade = await db.exec(`BEGIN;
    INSERT INTO bands VALUES ('${B2}', 'The Hudson Horns');
    INSERT INTO events (id, band_id, status) VALUES ('${E2}', '${B2}', 'tentative');
    INSERT INTO quotes (id, band_id, client_name, status, converted_to_event_id) VALUES ('${Q2}', '${B2}', 'Emma Carter', 'sent', '${E2}');
    INSERT INTO quote_links (quote_id, band_id, snapshot, version, status) VALUES ('${Q2}', '${B2}', '{}'::jsonb, 1, 'sent');
    DELETE FROM bands WHERE id = '${B2}';
    COMMIT;`).then(() => null, async (e) => { await db.exec('ROLLBACK').catch(() => {}); return `${e.code} ${e.message}`; });
  const left = (await q(`SELECT (SELECT count(*)::int FROM bands WHERE id = $1) b, (SELECT count(*)::int FROM quote_links WHERE band_id = $1) l,
                          (SELECT count(*)::int FROM events WHERE band_id = $1) e`, [B2])).rows[0];
  ok(cascade === null && left.b === 0 && left.l === 0 && left.e === 0,
    `round 11: a band deleted in the transaction that made its link goes through, with its events and link (${cascade || JSON.stringify(left)})`);
  // b. An event deleted on its own still marks the link (the band is there).
  const { Q: Q3, E: E3 } = await quote();
  await db.exec(`DELETE FROM events WHERE id = '${E3}'`);
  ok((await link(Q3)).event_removed_at !== null, `round 11: an event deleted on its own still marks its quote's link`);
  await db.exec(`ALTER TABLE events DROP CONSTRAINT test_events_band_fkey`);
}
{
  // c. 176's pdf_keys trigger (BEFORE INSERT OR UPDATE, no column list) and
  // 180's account-deletion guard (AFTER, WHEN auth.uid() IS NOT NULL) also
  // fire on the event_removed_at write. Loaded from the checkout, or from
  // their own branches while they are not merged.
  const { execFileSync } = await import('node:child_process');
  const show = (ref, path) => { try { return execFileSync('git', ['-C', process.env.BW_GIT || REPO, 'show', `${ref}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
  // The env ref when one is given, else the file on the checkout (the release is on main), else its branch.
  const rel = (envRef, branch, path) => (!envRef && existsSync(`${REPO}/${path}`) ? readFileSync(`${REPO}/${path}`, 'utf8') : show(envRef || branch, path));
  const m176 = rel(process.env.BW_176_REF, 'origin/fix/security-audit', 'supabase/migrations/176_quote_pdf_gate.sql');
  const m180 = rel(process.env.BW_180_REF, 'origin/fix/account-deletion', 'supabase/migrations/180_account_deletion_safety.sql');
  const cut = (src, from, to) => { const a = src?.indexOf(from) ?? -1; const b = a < 0 ? -1 : src.indexOf(to, a); return a < 0 || b < 0 ? null : src.slice(a, b + to.length); };
  const keys176 = m176 && cut(m176, 'ALTER TABLE public.quote_links', 'EXECUTE FUNCTION public.bw_trg_quote_link_pdf_keys();');
  const guard180 = m180 && cut(m180, 'CREATE OR REPLACE FUNCTION public.bw_trg_deleting_account_writes()', '$$;');
  // The app's admins delete events (as RLS allows them on prod).
  await db.exec(`GRANT SELECT, DELETE ON public.events TO authenticated`);
  if (!keys176) console.log('SKIP round 11: 176 (pdf keys) not found on the checkout nor on its branch');
  if (!guard180) console.log('SKIP round 11: 180 (account-deletion guard) not found on the checkout nor on its branch');
  if (keys176) {
    await db.exec(keys176);
    // A legacy link: a PDF on the version, no keys, and an odd key document.
    const { Q, E } = await quote();
    await db.exec(`UPDATE quote_links SET pdf_url = 'https://example.supabase.co/storage/v1/object/public/quotes/q_Emma_Carter.pdf', pdf_version = version WHERE quote_id = '${Q}';
                   ALTER TABLE quote_links DISABLE TRIGGER bw_quote_link_pdf_keys;
                   UPDATE quote_links SET pdf_key = NULL, pdf_key_doc = 'not-a-hash', balance_pdf_key = NULL, balance_pdf_key_doc = NULL WHERE quote_id = '${Q}';
                   ALTER TABLE quote_links ENABLE TRIGGER bw_quote_link_pdf_keys;`);
    const del = await asAdmin(() => q(`DELETE FROM events WHERE id = $1`, [E])).then(() => null, (e) => e.message);
    const l = await link(Q);
    ok(del === null && l.event_removed_at !== null && l.pdf_key && l.pdf_key_doc !== 'not-a-hash',
      `round 11: 176's pdf_keys trigger on a legacy link (no key, odd key document): the event delete goes through and marks the link; the trigger gives it its key (${del || `key ${!!l.pdf_key}`})`);
    // A link with its keys: the write keeps them (the document is the same).
    const { Q: Qk, E: Ek } = await quote();
    await db.exec(`UPDATE quote_links SET pdf_url = 'https://example.supabase.co/storage/v1/object/public/quotes/q_Emma_Carter.pdf', pdf_version = version WHERE quote_id = '${Qk}'`);
    const before = (await link(Qk)).pdf_key;
    await db.exec(`DELETE FROM events WHERE id = '${Ek}'`);
    const after = await link(Qk);
    ok(!!before && after.pdf_key === before && after.event_removed_at !== null, `round 11: the event_removed_at write keeps the link's PDF key (${before === after.pdf_key})`);
  }
  if (guard180) {
    await db.exec(`CREATE TABLE IF NOT EXISTS public.account_deletions_pending (user_id uuid PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(),
                     band_ids uuid[] NOT NULL DEFAULT '{}', committed_at timestamptz);
                   ${guard180}
                   ALTER TABLE quote_links ALTER COLUMN created_by DROP DEFAULT;
                   CREATE TRIGGER bw_deleting_account_writes AFTER INSERT OR UPDATE OR DELETE ON public.quote_links
                     FOR EACH ROW WHEN (auth.uid() IS NOT NULL) EXECUTE FUNCTION public.bw_trg_deleting_account_writes('created_by');
                   ALTER TABLE events ADD COLUMN IF NOT EXISTS created_by uuid;
                   CREATE TRIGGER bw_deleting_account_writes AFTER INSERT OR UPDATE OR DELETE ON public.events
                     FOR EACH ROW WHEN (auth.uid() IS NOT NULL) EXECUTE FUNCTION public.bw_trg_deleting_account_writes('created_by');
`);
    // The link's creator is deleting their account (committed); another admin deletes the event.
    const { Q, E } = await quote();
    await db.exec(`UPDATE quote_links SET created_by = '${SUB}' WHERE quote_id = '${Q}';
                   INSERT INTO account_deletions_pending (user_id, committed_at) VALUES ('${SUB}', now());`);
    const del = await asAdmin(() => q(`DELETE FROM events WHERE id = $1`, [E])).then(() => null, (e) => e.message);
    ok(del === null && (await link(Q)).event_removed_at !== null,
      `round 11: 180's guard: an admin deletes the event of a link made by an account being deleted: goes through, link marked (${del})`);
    // The admin's own deletion started, not committed yet: their delete goes through too.
    const { Q: Qp, E: Ep } = await quote();
    await db.exec(`INSERT INTO account_deletions_pending (user_id) VALUES ('${ADMIN}')`);
    const delp = await asAdmin(() => q(`DELETE FROM events WHERE id = $1`, [Ep])).then(() => null, (e) => e.message);
    ok(delp === null && (await link(Qp)).event_removed_at !== null, `round 11: an admin whose account deletion is pending (not committed) deletes an event: goes through, link marked (${delp})`);
    // Committed: 180 refuses that account's writes and deletes by design; the
    // events delete is refused as a whole (no half-written mark).
    const { Q: Qc, E: Ec } = await quote();
    await db.exec(`UPDATE account_deletions_pending SET committed_at = now() WHERE user_id = '${ADMIN}'`);
    const delc = await asAdmin(() => q(`DELETE FROM events WHERE id = $1`, [Ec])).then(() => null, (e) => e.message);
    const lc = await link(Qc);
    const still = (await q(`SELECT count(*)::int c FROM events WHERE id = $1`, [Ec])).rows[0].c;
    ok(!!delc && /being deleted/.test(delc) && lc.event_removed_at === null && still === 1,
      `round 11: an admin whose account deletion is committed: 180 refuses the event delete as on any table, nothing marked (${delc})`);
    await db.exec(`DELETE FROM account_deletions_pending; DROP TRIGGER bw_deleting_account_writes ON quote_links; DROP TRIGGER bw_deleting_account_writes ON events;`);
  }
}

// ---------------------------------------------------------------- 12. round 12: the accept locks the event, the delete locks the quote
{
  const answer = (T, action, version = 1) =>
    asAnon(() => q(`SELECT public.bw_quote_link_respond($1, $2, 'Emma Carter', NULL, $3) v`, [T, action, version]).then((r) => r.rows[0].v))
      .then((r) => ({ r }), (e) => ({ e: e.message, code: e.code }));
  const src = (fn) => q(`SELECT prosrc FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`, [fn])
    .then((r) => (r.rows[0]?.prosrc ?? '').replace(/--[^\n]*/g, '')); // without its comments
  // Everything an answer can write: the quote, the link, the event, the timeline, the notifications.
  const written = (Q, E) => q(`SELECT jsonb_build_object(
      'quote', (SELECT to_jsonb(x) FROM quotes x WHERE x.id = $1),
      'link', (SELECT to_jsonb(x) FROM quote_links x WHERE x.quote_id = $1),
      'event', (SELECT to_jsonb(x) FROM events x WHERE x.id = $2),
      'activity', (SELECT count(*) FROM quote_activity x WHERE x.quote_id = $1),
      'notifications', (SELECT count(*) FROM notifications x WHERE x.data ->> 'quote_id' = $1::text)) w`, [Q, E]).then((r) => JSON.stringify(r.rows[0].w));

  // a. The source (PGlite cannot run two sessions): in the accept, the event
  // row is locked FOR NO KEY UPDATE, and "is the date gone" is asked in a
  // later statement; the page read before the lock (v_view) does not decide.
  const rs = await src('bw_quote_link_respond');
  const lockAt = rs.search(/PERFORM\s+1\s+FROM\s+public\.events\s+e\b[^;]*\bFOR\s+NO\s+KEY\s+UPDATE\s*;/i);
  const lockEnd = lockAt < 0 ? -1 : rs.indexOf(';', lockAt);
  const checkAt = rs.search(/bw_quote_date_unavailable\s*\(/);
  const raiseAt = rs.indexOf("'BWQ01'");
  const acceptAt = rs.search(/IF\s+v_action\s*=\s*'accept'\s+THEN/i);
  ok(lockAt > acceptAt && acceptAt >= 0 && checkAt > lockEnd && raiseAt > checkAt && !/v_view\s*->>\s*'unavailable'/.test(rs),
    `round 12: respond's accept locks the event row (FOR NO KEY UPDATE), then asks bw_quote_date_unavailable in a later statement, then refuses (accept ${acceptAt}, lock ${lockAt}..${lockEnd}, check ${checkAt}, BWQ01 ${raiseAt})`);
  // b. The source of the delete trigger: its first statement locks the quote(s), in id order.
  const ts = await src('bw_trg_quote_link_event_removed');
  ok(/^\s*BEGIN\s+PERFORM\s+1\s+FROM\s+public\.quotes\s+q\b[^;]*\bORDER\s+BY\s+q\.id\s+FOR\s+UPDATE\s*;/i.test(ts)
     && /EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.bands\s+b\s+WHERE\s+b\.id\s*=\s*l\.band_id\s*\)/i.test(ts),
    `round 12: the event delete trigger's first statement locks the quote (FOR UPDATE, ORDER BY q.id), and round 11's skip of a deleted band's link stays`);

  // c. A stand-in for the admin's cancel that commits while the accept is in
  // flight (as section 4's revoke): when armed, and the event row is not
  // locked by this transaction, the cancel lands right after the page was
  // read. An accept that decides on that read goes through on a cancelled
  // event; one that locks the event and asks again refuses.
  const mark = (await q(`SELECT pg_get_functiondef('public.bw_band_shows_mark(uuid)'::regprocedure) d`)).rows[0].d;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.race_cancel (event_id uuid);
    CREATE OR REPLACE FUNCTION public.bw_band_shows_mark(p_band_id uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $f$
    BEGIN
      UPDATE public.events e SET status = 'cancelled'
       WHERE e.id IN (SELECT event_id FROM public.race_cancel)
         AND e.xmax::text <> pg_current_xact_id()::xid::text;
      IF FOUND THEN DELETE FROM public.race_cancel; END IF;
      RETURN false;
    END $f$;`);
  const rc = await quote();
  await db.exec(`INSERT INTO race_cancel VALUES ('${rc.E}')`);
  const ra = await answer(rc.T, 'accept');
  await db.exec(`DELETE FROM race_cancel`);
  const rst = (await q(`SELECT q.status qs, l.status ls, e.status es, (SELECT count(*)::int FROM quote_activity a WHERE a.quote_id = q.id AND a.kind = 'accepted') acts
                          FROM quotes q JOIN quote_links l ON l.quote_id = q.id JOIN events e ON e.id = $2 WHERE q.id = $1`, [rc.Q, rc.E])).rows[0];
  ok(ra.code === 'BWQ01' && rst.qs !== 'accepted' && rst.ls !== 'accepted' && rst.acts === 0,
    `round 12: a cancel that lands while the accept is in flight: refused (BWQ01), no accepted quote on a cancelled event (${ra.code || ra.e || ra.r?.status}; event ${rst.es}, quote ${rst.qs}, link ${rst.ls})`);
  await db.exec(mark);

  // d. Lock probes (pageinspect, as section 6): what this transaction holds
  // at the moment the link is written.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS r12_log (fn text, quote_locked boolean, event_locked boolean);
    CREATE OR REPLACE FUNCTION test_r12_probe() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $f$
    DECLARE v_quote boolean; v_event boolean;
    BEGIN
      SELECT test_row_locked('public.quotes', x.ctid, x.xmax) INTO v_quote FROM quotes x WHERE x.id = NEW.quote_id;
      SELECT test_row_locked('public.events', x.ctid, x.xmax) INTO v_event FROM events x WHERE x.id = public.bw_quote_gig_id(NEW.quote_id);
      INSERT INTO r12_log VALUES (current_setting('test.fn', true), coalesce(v_quote, false), coalesce(v_event, false));
      RETURN NEW;
    END $f$;
    CREATE TRIGGER test_r12_probe BEFORE UPDATE ON quote_links FOR EACH ROW EXECUTE FUNCTION test_r12_probe();`);
  const probed = async (fn, run) => {
    await db.exec(`DELETE FROM r12_log; SELECT set_config('test.fn', '${fn}', false)`);
    const r = await run();
    return { r, log: (await q(`SELECT quote_locked q, event_locked e FROM r12_log`)).rows };
  };
  // An accept on a live event: the event is locked when the link is
  // written, and it writes what it wrote before.
  const a = await quote();
  const acc = await probed('accept', () => answer(a.T, 'accept'));
  const al = await link(a.Q);
  const aq = (await q(`SELECT status, response_type, accepted_at IS NOT NULL at, responded_at IS NOT NULL rat, rejection_reason FROM quotes WHERE id = $1`, [a.Q])).rows[0];
  const aa = (await q(`SELECT kind, body, version FROM quote_activity WHERE quote_id = $1 AND kind IN ('accepted', 'declined')`, [a.Q])).rows;
  const an = (await q(`SELECT type, data ->> 'accepted_name' name, user_id FROM notifications WHERE data ->> 'quote_id' = $1`, [a.Q])).rows;
  const ae = (await q(`SELECT status, payment_status, deposit_paid FROM events WHERE id = $1`, [a.E])).rows[0];
  ok(acc.log.length === 1 && acc.log[0].q && acc.log[0].e,
    `round 12: an accept writes the link with the quote and the event row locked by its transaction (${JSON.stringify(acc.log)})`);
  ok(!acc.r.e && acc.r.r?.status === 'accepted' && acc.r.r?.unavailable === false && acc.r.r?.accepted_name === 'Emma Carter'
     && al.status === 'accepted' && al.accepted_name === 'Emma Carter' && al.accepted_version === 1 && al.responded_at !== null
     && JSON.stringify(al.accepted_snapshot) === JSON.stringify(al.snapshot) && al.decline_reason === null
     && aq.status === 'accepted' && aq.response_type === 'accepted' && aq.at && aq.rat && aq.rejection_reason === null
     && aa.length === 1 && aa[0].kind === 'accepted' && aa[0].body === 'Emma Carter' && aa[0].version === 1
     && an.length === 1 && an[0].type === 'quote_accepted' && an[0].name === 'Emma Carter' && an[0].user_id === ADMIN
     && ae.status === 'confirmed' && ae.payment_status === 'pending' && ae.deposit_paid === false,
    `round 12: an accept on a live event writes what it wrote before: link, quote, one timeline row, one notification, the event untouched (${acc.r.e || `${al.status}/${aq.status}, ${aa.length} rows, ${an.length} notified, event ${ae.status}`})`);
  // The reply is the page, as before (older pages read it).
  const keys = (o) => Object.keys(o || {}).sort().join(',');
  ok(keys(acc.r.r) === keys(await view(a.T)) && keys(acc.r.r).includes('unavailable'), `round 12: the accept's reply has the page's shape (${keys(acc.r.r)})`);
  // A decline and a message never lock the event.
  const dq = await quote();
  const msg = await probed('message', () => tryIt(asAnon(() => q(`SELECT public.bw_quote_link_message($1, 'Is the load-in from 33rd Street?') v`, [dq.T]).then((r) => r.rows[0].v))));
  const dec = await probed('decline', () => answer(dq.T, 'decline'));
  ok(!msg.r.e && msg.log.length === 1 && msg.log[0].q && !msg.log[0].e && !dec.r.e && dec.r.r?.status === 'declined' && dec.log.length === 1 && dec.log[0].q && !dec.log[0].e,
    `round 12: a message and a decline lock the quote and the link, never the event (message ${msg.r.e || JSON.stringify(msg.log)}, decline ${dec.r.e || JSON.stringify(dec.log)})`);
  // A gig deleted: the trigger writes the link with the quote locked first.
  const g = await quote();
  const other = await quote();
  const del = await probed('delete', () => tryIt(db.exec(`DELETE FROM events WHERE id = '${g.E}'`)));
  ok(!del.r.e && del.log.length === 1 && del.log[0].q, `round 12: a gig delete writes its quote's link with the quote locked first (${del.r.e || JSON.stringify(del.log)})`);
  await db.exec(`DROP TRIGGER test_r12_probe ON quote_links`);
  // ... and still marks only its own quote's link, and no accepted one.
  const k = await quote({ accepted: true });
  await db.exec(`DELETE FROM events WHERE id = '${k.E}'`);
  ok((await link(g.Q)).event_removed_at !== null && (await link(other.Q)).event_removed_at === null && (await link(k.Q)).event_removed_at === null
     && (await q(`SELECT count(*)::int c FROM events WHERE id = $1`, [other.E])).rows[0].c === 1,
    `round 12: a gig delete marks only its own quote's link: not another quote's, not an accepted one`);

  // e. A cancelled event: refused as before, and the refusal writes nothing
  // (the lock goes with the transaction).
  const c = await quote();
  await db.exec(`UPDATE events SET status = 'cancelled' WHERE id = '${c.E}'`);
  const before = await written(c.Q, c.E);
  const ca = await answer(c.T, 'accept');
  const after = await written(c.Q, c.E);
  const free = (await q(`SELECT count(*)::int c FROM pg_locks WHERE locktype IN ('tuple', 'transactionid') AND NOT granted`)).rows[0].c;
  ok(ca.code === 'BWQ01' && /no longer available/.test(ca.e || '') && before === after && free === 0,
    `round 12: accept on a cancelled event: BWQ01, and the quote, link, event, timeline and notifications are as they were (${ca.code || ca.e || 'accepted'}, same ${before === after})`);
  // No event at all (a quote never put on the calendar): the lock finds no row, the accept goes through.
  const ne = await quote();
  await db.exec(`DELETE FROM events WHERE id = '${ne.E}'; UPDATE quotes SET converted_to_event_id = NULL WHERE id = '${ne.Q}'; UPDATE quote_links SET event_removed_at = NULL WHERE quote_id = '${ne.Q}'`);
  const na = await answer(ne.T, 'accept');
  ok(!na.e && na.r?.status === 'accepted', `round 12: a quote with no event (never on the calendar) still accepts (${na.e || na.r?.status})`);

  // f. A band going with its quotes and its events in one statement (as an
  // account deletion does): the trigger's lock meets a quote this statement
  // deletes, before or after the events. Neither order errors or waits.
  for (const first of ['quotes', 'events']) {
    const fk = {
      quotes: `ALTER TABLE quotes ADD CONSTRAINT test_quotes_band_fkey FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE CASCADE NOT VALID;`,
      events: `ALTER TABLE events ADD CONSTRAINT test_events_band_fkey FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE CASCADE NOT VALID;`,
    };
    // Postgres fires a table's cascades in the order its FKs were made; the link's is the youngest (as 11a).
    await db.exec(`${fk[first]} ${fk[first === 'quotes' ? 'events' : 'quotes']}
      ALTER TABLE quote_links DROP CONSTRAINT quote_links_band_id_fkey;
      ALTER TABLE quote_links ADD CONSTRAINT quote_links_band_id_fkey FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE CASCADE;
      ALTER TABLE quote_activity DROP CONSTRAINT IF EXISTS quote_activity_band_id_fkey;`);
    const [B, E1, E2, Q1, Q2] = [id(n++), id(n++), id(n++), id(n++), id(n++)];
    const seed = `INSERT INTO bands VALUES ('${B}', 'The Hudson Horns');
      INSERT INTO events (id, band_id, status) VALUES ('${E1}', '${B}', 'tentative'), ('${E2}', '${B}', 'confirmed');
      INSERT INTO quotes (id, band_id, client_name, status, converted_to_event_id) VALUES ('${Q1}', '${B}', 'Emma Carter', 'sent', '${E1}'), ('${Q2}', '${B}', 'Jordan Lee', 'accepted', '${E2}');
      INSERT INTO quote_links (quote_id, band_id, snapshot, version, status) VALUES ('${Q1}', '${B}', '{}'::jsonb, 1, 'sent'), ('${Q2}', '${B}', '{}'::jsonb, 1, 'accepted');`;
    const run = (sql) => db.exec(sql).then(() => null, async (e) => { await db.exec('ROLLBACK').catch(() => {}); return `${e.code} ${e.message}`; });
    const left = () => q(`SELECT (SELECT count(*)::int FROM bands WHERE id = $1) + (SELECT count(*)::int FROM quotes WHERE band_id = $1)
                             + (SELECT count(*)::int FROM quote_links WHERE band_id = $1) + (SELECT count(*)::int FROM events WHERE band_id = $1) c`, [B]).then((r) => r.rows[0].c);
    // Rows from an earlier transaction, then rows made in the deleting transaction (round 11's case).
    const e1 = await run(`${seed} BEGIN; SET LOCAL lock_timeout = '2s'; DELETE FROM bands WHERE id = '${B}'; COMMIT;`);
    const l1 = await left();
    const e2 = await run(`BEGIN; SET LOCAL lock_timeout = '2s'; ${seed} DELETE FROM bands WHERE id = '${B}'; COMMIT;`);
    const l2 = await left();
    ok(e1 === null && l1 === 0 && e2 === null && l2 === 0,
      `round 12: a band deleted with its quotes and events (${first} cascade first): goes through, committed rows and rows of the same transaction (${e1 || `left ${l1}`}; ${e2 || `left ${l2}`})`);
    await db.exec(`ALTER TABLE quotes DROP CONSTRAINT test_quotes_band_fkey; ALTER TABLE events DROP CONSTRAINT test_events_band_fkey;`);
  }

  // g. Same signature, same grants (older builds and cached pages call it).
  const sig = (await q(`SELECT pg_get_function_identity_arguments(p.oid) a, pg_get_function_result(p.oid) r, p.prosecdef d,
      has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
      (SELECT count(*)::int FROM pg_proc x WHERE x.proname = p.proname) n,
      has_function_privilege('anon', 'public.bw_trg_quote_link_event_removed()', 'EXECUTE') tanon,
      has_function_privilege('authenticated', 'public.bw_trg_quote_link_event_removed()', 'EXECUTE') tauth
      FROM pg_proc p WHERE p.proname = 'bw_quote_link_respond'`)).rows[0];
  ok(sig.a === 'p_token text, p_action text, p_name text, p_reason text, p_version integer' && sig.r === 'jsonb' && sig.d && sig.anon && sig.auth && sig.n === 1 && !sig.tanon && !sig.tauth,
    `round 12: bw_quote_link_respond keeps its one signature and grants; the trigger function is not callable (${JSON.stringify(sig)})`);

  // h. "The client answered by phone" (bw_quote_link_set_outcome, 105's body
  // with the quote locked first): the source, a lock probe, and its replies.
  const outcome = (Q, o, reason = null, who = asAdmin) =>
    who(() => q(`SELECT public.bw_quote_link_set_outcome($1, $2, $3) v`, [Q, o, reason]).then((r) => r.rows[0].v)).then((r) => ({ r }), (e) => ({ e: e.message, code: e.code }));
  const os = await src('bw_quote_link_set_outcome');
  const oq = os.search(/FROM\s+public\.quotes\s+q\s+WHERE\s+q\.id\s*=\s*p_quote_id\s+FOR\s+UPDATE\s*;/i);
  const ol = os.search(/FROM\s+public\.quote_links\s+l\b[^;]*\bFOR\s+UPDATE\s*;/i);
  ok(oq >= 0 && ol > oq && os.indexOf('UPDATE public.quote_links') > ol,
    `round 12: set_outcome locks the quote (FOR UPDATE) before the link, and writes after both (quote ${oq}, link ${ol})`);
  await db.exec(`CREATE TRIGGER test_r12_probe BEFORE UPDATE ON quote_links FOR EACH ROW EXECUTE FUNCTION test_r12_probe();`);
  const o1 = await quote();
  const op = await probed('outcome', () => outcome(o1.Q, 'accepted'));
  await db.exec(`DROP TRIGGER test_r12_probe ON quote_links`);
  ok(!op.r.e && op.log.length === 1 && op.log[0].q, `round 12: set_outcome writes the link with the quote locked first (${op.r.e || JSON.stringify(op.log)})`);
  // An 'accepted' also holds the event row when it writes the link (another
  // admin's cancel is waited for, so 178's privacy trigger sees it); a
  // 'declined' does not need it.
  const oe = os.search(/PERFORM\s+1\s+FROM\s+public\.events\s+e\b[^;]*\bFOR\s+NO\s+KEY\s+UPDATE\s*;/i);
  await db.exec(`CREATE TRIGGER test_r12_probe BEFORE UPDATE ON quote_links FOR EACH ROW EXECUTE FUNCTION test_r12_probe();`);
  const od = await quote();
  const odp = await probed('outcome_declined', () => outcome(od.Q, 'declined', 'Went with a DJ'));
  await db.exec(`DROP TRIGGER test_r12_probe ON quote_links`);
  ok(oe > ol && oe < os.indexOf('UPDATE public.quote_links') && op.log[0]?.e === true && !odp.r.e && odp.log.length === 1 && odp.log[0].q && !odp.log[0].e,
    `round 12: set_outcome 'accepted' locks the event row (FOR NO KEY UPDATE, after the quote and the link) before it writes the link; 'declined' takes no event lock (source ${oe}, accepted ${JSON.stringify(op.log)}, declined ${odp.r.e || JSON.stringify(odp.log)})`);
  // What it returned and wrote before (105): the outcome; the link as accepted
  // under the client's name; one timeline row with who recorded it.
  const o1l = await link(o1.Q);
  const o1a = (await q(`SELECT kind, body, version, actor_id FROM quote_activity WHERE quote_id = $1 AND kind IN ('accepted', 'declined')`, [o1.Q])).rows;
  const o1q = (await q(`SELECT status FROM quotes WHERE id = $1`, [o1.Q])).rows[0].status;
  const again = await outcome(o1.Q, 'declined', 'Changed their mind');
  const o2 = await quote();
  const dec2 = await outcome(o2.Q, 'Declined ', 'Went with a DJ');
  const o2l = await link(o2.Q);
  const o2a = (await q(`SELECT kind, body, actor_id FROM quote_activity WHERE quote_id = $1 AND kind = 'declined'`, [o2.Q])).rows;
  const same = await outcome(o2.Q, 'declined', 'Again');
  const flip = await outcome(o2.Q, 'accepted');
  const NOLINK = id(n++);
  await db.exec(`INSERT INTO quotes (id, band_id, client_name, status) VALUES ('${NOLINK}', '${BAND}', 'Emma Carter', 'draft')`);
  const none = await outcome(NOLINK, 'accepted');
  const bad = await outcome(o2.Q, 'maybe');
  const member = await outcome(o2.Q, 'accepted', null, asMember);
  const missing = await outcome(id(n++), 'accepted');
  const anonCall = await tryIt(asAnon(() => q(`SELECT public.bw_quote_link_set_outcome($1, 'accepted', NULL)`, [o2.Q])));
  ok(op.r.r === 'accepted' && o1l.status === 'accepted' && o1l.accepted_name === 'Emma Carter' && o1l.accepted_version === 1
     && JSON.stringify(o1l.accepted_snapshot) === JSON.stringify(o1l.snapshot) && o1l.responded_at !== null
     && o1a.length === 1 && o1a[0].kind === 'accepted' && o1a[0].body === 'Emma Carter' && o1a[0].actor_id === ADMIN && o1q !== 'accepted'
     && again.r === 'accepted' && (await link(o1.Q)).status === 'accepted',
    `round 12: set_outcome 'accepted' answers and writes as 105 did: the link accepted under the client's name, one timeline row by the admin, the quote row left to the app; an accepted link stays accepted (${op.r.e || op.r.r}, link ${o1l.status}, ${o1a.length} rows, then ${again.e || again.r})`);
  ok(dec2.r === 'declined' && o2l.status === 'declined' && o2l.decline_reason === 'Went with a DJ' && o2a.length === 1 && o2a[0].body === 'Went with a DJ' && o2a[0].actor_id === ADMIN
     && same.r === 'declined' && (await q(`SELECT count(*)::int c FROM quote_activity WHERE quote_id = $1 AND kind = 'declined'`, [o2.Q])).rows[0].c === 1
     && flip.r === 'accepted' && none.r === null && !none.e && bad.code === '22023' && member.code === '42501' && missing.code === '42501' && !!anonCall.e,
    `round 12: set_outcome 'declined' with its reason, the same answer again writes nothing, declined then accepted, no link gives NULL, a wrong outcome 22023, a member, an unknown quote and anon refused (${dec2.e || dec2.r}, ${same.r}, ${flip.e || flip.r}, ${none.e || none.r}, ${bad.code}, ${member.code}, ${missing.code}, anon ${anonCall.e ? 'refused' : 'allowed'})`);
  const osig = (await q(`SELECT pg_get_function_identity_arguments(p.oid) a, pg_get_function_result(p.oid) r, p.prosecdef d, p.proconfig::text cfg,
      has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
      (SELECT count(*)::int FROM pg_proc x WHERE x.proname = p.proname) n FROM pg_proc p WHERE p.proname = 'bw_quote_link_set_outcome'`)).rows[0];
  ok(osig.a === 'p_quote_id uuid, p_outcome text, p_reason text' && osig.r === 'text' && osig.d && /search_path=public/.test(osig.cfg) && !osig.anon && osig.auth && osig.n === 1,
    `round 12: set_outcome keeps its one signature (uuid, text, text) RETURNS text, definer, authenticated only (${JSON.stringify(osig)})`);

  // i. Known limit, as the page says ("Ask the band for a new quote"): the
  // same quote sent again after its gig was deleted is not a new offer (no
  // new version); a changed one is (section 10b).
  const u = await quote();
  await db.exec(`DELETE FROM events WHERE id = '${u.E}'; UPDATE quotes SET converted_to_event_id = NULL WHERE id = '${u.Q}'`);
  await asAdmin(() => q(`SELECT * FROM public.bw_quote_link_publish($1, $2::jsonb, 'en', NULL)`, [u.Q, snap(1000)]));
  await asAdmin(() => q(`SELECT public.bw_quote_link_mark_sent($1, 'sent', 'email')`, [u.Q]));
  const uv = await view(u.T);
  const ua = await answer(u.T, 'accept', uv?.version);
  ok(uv?.version === 1 && uv?.unavailable === true && ua.code === 'BWQ01',
    `round 12 (known limit): the unchanged quote sent again after its gig was deleted stays "no longer available" (version ${uv?.version}, ${uv?.unavailable}, ${ua.code || ua.e || ua.r?.status})`);
}

// ---------------------------------------------------------------- 13. round 12: a lineup save takes the events row FOR UPDATE before it writes
{
  const src = (fn) => q(`SELECT prosrc FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`, [fn])
    .then((r) => (r.rows[0]?.prosrc ?? '').replace(/--[^\n]*/g, ''));
  const rising = (a) => a.every((v, i) => v >= 0 && (i === 0 || v > a[i - 1]));
  // a. The source. The helper locks the quote's events FOR UPDATE in id
  // order; each save calls it after the quote's lock (bw_quote_lineup_current)
  // and before its first write.
  const hs = await src('bw_quote_lock_events');
  const sl = await src('bw_quote_save_lineup');
  const sw = await src('bw_quote_save_with_lineup');
  const o1 = [sl.indexOf('bw_quote_lineup_current('), sl.indexOf('bw_quote_lock_events('), sl.indexOf('bw_quote_save_musicians(')];
  const o2 = [sw.indexOf('bw_quote_lineup_current('), sw.indexOf('bw_quote_lock_events('), sw.indexOf('UPDATE public.quotes'), sw.indexOf('bw_quote_save_lineup(')];
  ok(/FROM\s+public\.events\s+e\b[^;]*\bORDER\s+BY\s+e\.id\s+FOR\s+UPDATE\s*;/i.test(hs) && /bw_quote_admin_band\(p_quote_id\)/.test(hs) && rising(o1) && rising(o2),
    `round 12: both lineup saves lock the quote's events rows FOR UPDATE (in id order) after the quote's lock and before they write (save_lineup ${JSON.stringify(o1)}, save_with_lineup ${JSON.stringify(o2)})`);

  // b. Lock probe: the events row is held FOR UPDATE by the transaction
  // when the lineup's rows go in, and when the quote's row is written.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS r13_log (tbl text, for_update boolean);
    -- FOR UPDATE, not FOR NO KEY UPDATE: the exclusive lock bit and HEAP_KEYS_UPDATED.
    CREATE OR REPLACE FUNCTION test_row_for_update(p_rel regclass, p_ctid tid, p_xmax xid) RETURNS boolean LANGUAGE plpgsql AS $f$
    DECLARE v_ctid point := p_ctid::text::point; v_mask int; v_mask2 int;
    BEGIN
      SELECT h.t_infomask, h.t_infomask2 INTO v_mask, v_mask2 FROM heap_page_items(get_raw_page(p_rel::text, v_ctid[0]::int)) h WHERE h.lp = v_ctid[1]::int;
      RETURN p_xmax::text = (txid_current() % 4294967296)::text AND (v_mask & 64) <> 0 AND (v_mask2 & 8192) <> 0;
    END $f$;
    CREATE OR REPLACE FUNCTION test_r13_probe() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $f$
    DECLARE v_quote uuid;
    BEGIN
      IF TG_TABLE_NAME = 'quotes' THEN v_quote := NEW.id; ELSE v_quote := NEW.quote_id; END IF;
      INSERT INTO r13_log SELECT TG_TABLE_NAME, test_row_for_update('public.events', x.ctid, x.xmax)
        FROM events x WHERE x.id = public.bw_quote_gig_id(v_quote);
      RETURN NEW;
    END $f$;
    CREATE TRIGGER test_r13_probe BEFORE INSERT ON quote_musicians FOR EACH ROW EXECUTE FUNCTION test_r13_probe();
    CREATE TRIGGER test_r13_probe BEFORE UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION test_r13_probe();`);
  const rows = [
    { user_id: MEMBER, name: 'Maya Brooks', instrument: 'Bass', fee: 350, is_external: false, is_available: true },
    { user_id: null, name: 'Leo Park', instrument: 'Drums', fee: 275, is_external: true, is_available: true },
  ];
  const logged = () => q(`SELECT tbl, for_update f FROM r13_log`).then((r) => r.rows);
  // With a tentative event: the lineup and the gig, as before.
  const t = await quote();
  await db.exec(`UPDATE events SET status = 'tentative' WHERE id = '${t.E}'; DELETE FROM r13_log;`);
  const r1 = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_save_lineup($1, $2::jsonb) r`, [t.Q, JSON.stringify(rows)]).then((x) => x.rows[0].r)));
  const l1 = await logged();
  const em1 = (await q(`SELECT user_id, status, fee::float fee, role FROM event_members WHERE event_id = $1`, [t.E])).rows;
  ok(!r1.e && l1.length === 2 && l1.every((x) => x.tbl === 'quote_musicians' && x.f),
    `round 12: save_lineup writes the lineup with the gig's row already locked FOR UPDATE (${r1.e || JSON.stringify(l1)})`);
  ok(!r1.e && r1.r.synced === true && r1.r.confirmed === false && r1.r.event_id === t.E && r1.r.musicians.length === 2
     && em1.length === 1 && em1[0].user_id === MEMBER && em1[0].status === 'pending' && em1[0].fee === 350 && em1[0].role === 'Bass',
    `round 12: save_lineup with a tentative event still saves the lineup and the gig's (${r1.e || JSON.stringify({ s: r1.r.synced, n: r1.r.musicians.length, em: em1.length })})`);
  // The quote and its lineup in one call: the row is locked before the quote is written.
  await db.exec(`DELETE FROM r13_log`);
  const r2 = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_save_with_lineup($1, $2::jsonb, $3::jsonb, NULL) r`,
    [t.Q, JSON.stringify({ client_phone: '+1 212 555 0142' }), JSON.stringify([rows[0]])]).then((x) => x.rows[0].r)));
  const l2 = await logged();
  ok(!r2.e && l2.some((x) => x.tbl === 'quotes') && l2.some((x) => x.tbl === 'quote_musicians') && l2.every((x) => x.f),
    `round 12: save_with_lineup writes the quote and the lineup with the gig's row already locked FOR UPDATE (${r2.e || JSON.stringify(l2)})`);
  ok(!r2.e && r2.r.quote?.client_phone === '+1 212 555 0142' && r2.r.lineup?.synced === true && r2.r.lineup?.event_id === t.E && r2.r.lineup?.musicians.length === 1
     && (await q(`SELECT count(*)::int c FROM quote_musicians WHERE quote_id = $1`, [t.Q])).rows[0].c === 1,
    `round 12: save_with_lineup with an event still returns {quote, lineup} and saves both (${r2.e || JSON.stringify({ p: r2.r.quote?.client_phone, s: r2.r.lineup?.synced })})`);
  await db.exec(`DROP TRIGGER test_r13_probe ON quote_musicians; DROP TRIGGER test_r13_probe ON quotes;`);
  // A confirmed gig: the quote's lineup is saved, the gig is left alone.
  await db.exec(`UPDATE events SET status = 'confirmed' WHERE id = '${t.E}'`);
  const r3 = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_save_lineup($1, $2::jsonb) r`, [t.Q, JSON.stringify(rows)]).then((x) => x.rows[0].r)));
  ok(!r3.e && r3.r.confirmed === true && r3.r.synced === false && r3.r.event_id === t.E && r3.r.musicians.length === 2
     && (await q(`SELECT count(*)::int c FROM event_members WHERE event_id = $1`, [t.E])).rows[0].c === 1,
    `round 12: save_lineup on a confirmed gig still saves the quote's lineup and leaves the gig (${r3.e || JSON.stringify({ c: r3.r.confirmed, s: r3.r.synced })})`);
  // No event at all: nothing to lock, both saves go through.
  const NOEV = id(n++);
  await db.exec(`INSERT INTO quotes (id, band_id, client_name, status) VALUES ('${NOEV}', '${BAND}', 'Emma Carter', 'draft')`);
  const r4 = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_save_lineup($1, $2::jsonb) r`, [NOEV, JSON.stringify(rows)]).then((x) => x.rows[0].r)));
  const r5 = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_save_with_lineup($1, $2::jsonb, $3::jsonb, NULL) r`,
    [NOEV, JSON.stringify({ client_phone: '+1 718 555 0199' }), JSON.stringify([rows[1]])]).then((x) => x.rows[0].r)));
  ok(!r4.e && r4.r.event_id === null && r4.r.synced === false && r4.r.confirmed === false && r4.r.musicians.length === 2
     && !r5.e && r5.r.quote?.client_phone === '+1 718 555 0199' && r5.r.lineup?.event_id === null && r5.r.lineup?.musicians.length === 1,
    `round 12: both saves work on a quote with no event (${r4.e || JSON.stringify({ e: r4.r.event_id, n: r4.r.musicians.length })}, ${r5.e || JSON.stringify({ e: r5.r.lineup?.event_id, n: r5.r.lineup?.musicians.length })})`);
  // A save that points the quote at another event of the band locks that one too; an unknown id is no error here.
  const NEWE = id(n++);
  await db.exec(`INSERT INTO events (id, band_id, status, payment_status) VALUES ('${NEWE}', '${BAND}', 'tentative', 'pending')`);
  const r6 = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_save_with_lineup($1, $2::jsonb, $3::jsonb, NULL) r`,
    [NOEV, JSON.stringify({ converted_to_event_id: NEWE }), JSON.stringify([rows[0]])]).then((x) => x.rows[0].r)));
  ok(!r6.e && r6.r.quote?.converted_to_event_id === NEWE && r6.r.lineup?.event_id === NEWE && r6.r.lineup?.synced === true,
    `round 12: a save that points the quote at an event saves the lineup on it (${r6.e || JSON.stringify({ e: r6.r.lineup?.event_id, s: r6.r.lineup?.synced })})`);
  // c. The helper: admins of the quote's band only, nothing returned; the saves keep their signatures and grants.
  const hm = await tryIt(asMember(() => q(`SELECT public.bw_quote_lock_events($1)`, [t.Q])));
  const ha = await tryIt(asAnon(() => q(`SELECT public.bw_quote_lock_events($1)`, [t.Q])));
  const hx = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_lock_events($1)`, [id(n++)])));
  const hok = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_lock_events($1) v`, [t.Q]).then((x) => x.rows[0].v)));
  const sigs = (await q(`SELECT p.proname n, pg_get_function_identity_arguments(p.oid) a, pg_get_function_result(p.oid) r, p.prosecdef d,
      has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth
      FROM pg_proc p WHERE p.proname IN ('bw_quote_save_lineup', 'bw_quote_save_with_lineup', 'bw_quote_lock_events') ORDER BY 1`)).rows;
  ok(/Not allowed|permission denied/.test(hm.e || '') && !!ha.e && /Not allowed/.test(hx.e || '') && !hok.e
     && JSON.stringify(sigs) === JSON.stringify([
       { n: 'bw_quote_lock_events', a: 'p_quote_id uuid, p_also uuid', r: 'void', d: true, anon: false, auth: true },
       { n: 'bw_quote_save_lineup', a: 'p_quote_id uuid, p_musicians jsonb, p_base jsonb', r: 'jsonb', d: true, anon: false, auth: true },
       { n: 'bw_quote_save_with_lineup', a: 'p_quote_id uuid, p_updates jsonb, p_musicians jsonb, p_base jsonb', r: 'jsonb', d: false, anon: false, auth: true }]),
    `round 12: bw_quote_lock_events is for the quote's admins only (member ${hm.e ? 'refused' : 'allowed'}, anon ${ha.e ? 'refused' : 'allowed'}, unknown quote ${hx.e ? 'refused' : 'allowed'}, admin ${hok.e || 'ok'}); the saves keep their signatures and grants (${JSON.stringify(sigs.map((x) => x.n + '(' + x.a + ') ' + x.r))})`);
}

// ---------------------------------------------------------------- 14. round 13: the balance publish locks the gig before it reads its status
{
  const code = (await q(`SELECT prosrc FROM pg_proc WHERE proname = 'bw_quote_balance_publish' AND pronamespace = 'public'::regnamespace`)).rows[0].prosrc.replace(/--[^\n]*/g, '');
  const at = (re) => code.search(re);
  // a. The source: the quote, the link, the gig's row (FOR NO KEY UPDATE), and only then its status and the refusal.
  const o = [at(/FROM\s+public\.quotes\s+q\s+WHERE\s+q\.id\s*=\s*p_quote_id\s+FOR\s+UPDATE\s*;/i),
             at(/FROM\s+public\.quote_links\s+l\b[^;]*\bFOR\s+UPDATE\s*;/i),
             at(/PERFORM\s+1\s+FROM\s+public\.events\s+e\b[^;]*\bFOR\s+NO\s+KEY\s+UPDATE\s*;/i),
             at(/SELECT\s+e\.status\s+INTO\s+v_gig_status\b/i),
             code.indexOf('The gig is cancelled'),
             code.indexOf('UPDATE public.quote_links')];
  ok(o.every((v, i) => v >= 0 && (i === 0 || v > o[i - 1])),
    `round 13: balance publish locks the quote, the link, then the gig's row (FOR NO KEY UPDATE), and reads the gig's status in a later statement, before any write (${JSON.stringify(o)})`);
  // b. Lock probe (section 12's): a quote accepted by phone, its link not yet
  // accepted: the publish writes the link as accepted with the gig's row held.
  await db.exec(`CREATE TRIGGER test_r12_probe BEFORE UPDATE ON quote_links FOR EACH ROW EXECUTE FUNCTION test_r12_probe();`);
  const p = await quote();
  await db.exec(`UPDATE quotes SET status = 'accepted' WHERE id = '${p.Q}'; DELETE FROM r12_log; SELECT set_config('test.fn', 'balance_publish', false);`);
  const pub = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb) v`, [p.Q, balance(1000)]).then((r) => r.rows[0].v)));
  const log = (await q(`SELECT quote_locked q, event_locked e FROM r12_log`)).rows;
  await db.exec(`DROP TRIGGER test_r12_probe ON quote_links`);
  const pl = await link(p.Q);
  ok(!pub.e && log.length >= 1 && log.every((x) => x.q && x.e),
    `round 13: balance publish writes the link (accepted by phone) with the quote and the gig's row locked by its transaction (${pub.e || JSON.stringify(log)})`);
  ok(!pub.e && pub.r?.changed === true && pub.r?.balance_version === pl.balance_version && pub.r?.token === p.T && Object.keys(pub.r).sort().join(',') === 'balance_version,changed,token'
     && pl.status === 'accepted' && pl.accepted_name === 'Emma Carter' && pl.balance?.amount === 1000,
    `round 13: balance publish answers and writes as before: {token, balance_version, changed}, the link accepted under the client's name (${pub.e || JSON.stringify(pub.r && { c: pub.r.changed, v: pub.r.balance_version })}, link ${pl.status})`);
  // c. A cancelled gig: still refused first, nothing written. No event: still published.
  const c = await quote();
  await db.exec(`UPDATE quotes SET status = 'accepted' WHERE id = '${c.Q}'; UPDATE events SET status = 'cancelled' WHERE id = '${c.E}'`);
  const before = JSON.stringify(await link(c.Q));
  const cp = await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb) v`, [c.Q, balance(1000)])).then(() => ({}), (e) => ({ e: e.message, code: e.code }));
  const NOLINK = id(n++), NLE = id(n++);
  await db.exec(`INSERT INTO events (id, band_id, status) VALUES ('${NLE}', '${BAND}', 'cancelled');
                 INSERT INTO quotes (id, band_id, client_name, status, converted_to_event_id) VALUES ('${NOLINK}', '${BAND}', 'Emma Carter', 'accepted', '${NLE}')`);
  const first = await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb) v`, [NOLINK, balance(1000)])).then(() => ({}), (e) => ({ e: e.message, code: e.code }));
  const ne = await quote({ accepted: true });
  await db.exec(`DELETE FROM events WHERE id = '${ne.E}'; UPDATE quotes SET converted_to_event_id = NULL WHERE id = '${ne.Q}'`);
  const np = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb) v`, [ne.Q, balance(800)]).then((r) => r.rows[0].v)));
  ok(cp.code === '22023' && /gig is cancelled/.test(cp.e || '') && JSON.stringify(await link(c.Q)) === before
     && first.code === '22023' && /gig is cancelled/.test(first.e || '') && !np.e && np.r?.changed === true,
    `round 13: a cancelled gig is still refused (22023, before "Publish the quote first"), the link as it was; a quote with no event still publishes (${cp.e || 'published'}; ${first.e || 'published'}; ${np.e || 'ok'})`);
  const sig = (await q(`SELECT pg_get_function_identity_arguments(p.oid) a, pg_get_function_result(p.oid) r, p.prosecdef d,
      has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
      (SELECT count(*)::int FROM pg_proc x WHERE x.proname = p.proname) n FROM pg_proc p WHERE p.proname = 'bw_quote_balance_publish'`)).rows[0];
  ok(sig.a === 'p_quote_id uuid, p_balance jsonb' && sig.r === 'jsonb' && sig.d && !sig.anon && sig.auth && sig.n === 1,
    `round 13: bw_quote_balance_publish keeps its one signature and grants (${JSON.stringify(sig)})`);

  // d. bw_quote_lock_events and another band (N3). Band B's quote: refused
  // (42501). Band B's event as p_also on band A's quote: not locked (only
  // the caller's band's events are), band A's own event is.
  const [BB, BADMIN, BE, BQ] = [id(n++), OTHER, id(n++), id(n++)];
  await db.exec(`INSERT INTO bands VALUES ('${BB}', 'The Hudson Horns');
                 INSERT INTO band_members VALUES ('${BB}', '${BADMIN}', 'admin', true);
                 INSERT INTO events (id, band_id, status) VALUES ('${BE}', '${BB}', 'tentative');
                 INSERT INTO quotes (id, band_id, client_name, status, converted_to_event_id) VALUES ('${BQ}', '${BB}', 'Jordan Lee', 'sent', '${BE}');`);
  const a = await quote();
  const held = async (sql) => {
    await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN}","role":"authenticated"}', true); SET LOCAL ROLE authenticated;`);
    let err = null;
    try { await db.exec(sql); } catch (e) { err = { code: e.code, e: e.message }; await db.exec('ROLLBACK'); return { err }; }
    await db.exec('RESET ROLE');
    const rows = (await q(`SELECT x.id, test_row_for_update('public.events', x.ctid, x.xmax) fu, x.xmax::text xmax FROM events x WHERE x.id IN ($1, $2)`, [a.E, BE])).rows;
    await db.exec('COMMIT');
    return { own: rows.find((x) => x.id === a.E), other: rows.find((x) => x.id === BE) };
  };
  const viaAlso = await held(`SELECT public.bw_quote_lock_events('${a.Q}', '${BE}')`);
  const viaQuote = await held(`SELECT public.bw_quote_lock_events('${BQ}')`);
  const viaQuoteAlso = await held(`SELECT public.bw_quote_lock_events('${BQ}', '${a.E}')`);
  const viaSave = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_save_with_lineup($1, $2::jsonb, '[]'::jsonb, NULL)`, [BQ, JSON.stringify({ client_phone: '+1 212 555 0100' })])));
  ok(!viaAlso.err && viaAlso.own?.fu === true && viaAlso.other?.fu === false && viaAlso.other?.xmax === '0'
     && viaQuote.err?.code === '42501' && viaQuoteAlso.err?.code === '42501' && !!viaSave.e,
    `round 13: an admin of one band never locks another band's event: as p_also it is left unlocked (own ${viaAlso.own?.fu}, other ${viaAlso.other?.fu}, xmax ${viaAlso.other?.xmax}, ${viaAlso.err?.e || 'no error'}); with the other band's quote: ${viaQuote.err?.code || 'allowed'}, ${viaQuoteAlso.err?.code || 'allowed'}; its save: ${viaSave.e ? 'refused' : 'allowed'}`);
}

// ---------------------------------------------------------------- 7. 187 is a superset of 183 (round 3)
{
  // 183's round 3 still holds with 187's bodies on top.
  // a. The receipt is in the quote's currency: a USD quote on a gig kept in EUR.
  const { Q, E, T } = await quote({ accepted: true });
  await db.exec(`UPDATE events SET currency = 'EUR' WHERE id = '${E}'`);
  const rec = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_deposit_received($1, 'transfer', 300, true)`, [Q])));
  const v = await view(T);
  ok(!rec.e && v?.deposit_paid_amount == 300 && v?.deposit_paid_currency === 'USD',
    `187 keeps 183: the deposit receipt is in the quote's currency (${rec.e || `${v?.deposit_paid_amount} ${v?.deposit_paid_currency}`})`);
  // Round 4: the receipt keeps the currency recorded with the payment, even
  // if the quote's changed some other way (183's trigger refuses it in the app).
  await db.exec(`ALTER TABLE quotes DISABLE TRIGGER bw_quote_currency_locked; UPDATE quotes SET currency = 'GBP' WHERE id = '${Q}'; ALTER TABLE quotes ENABLE TRIGGER bw_quote_currency_locked;`);
  const v4 = await view(T);
  ok(v4?.deposit_paid_currency === 'USD', `187 keeps 183 round 4: the receipt is in the currency recorded with the payment (${v4?.deposit_paid_currency})`);
  await db.exec(`ALTER TABLE quotes DISABLE TRIGGER bw_quote_currency_locked; UPDATE quotes SET currency = 'USD' WHERE id = '${Q}'; ALTER TABLE quotes ENABLE TRIGGER bw_quote_currency_locked;`);

  // b. deposit received: the quote, then the link, then the gig (pageinspect, as section 6).
  await db.exec(`
    CREATE TRIGGER test_lock_probe BEFORE UPDATE ON quote_links FOR EACH ROW EXECUTE FUNCTION test_lock_probe();
    CREATE TRIGGER test_lock_probe BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION test_lock_probe();
    DELETE FROM lock_log;`);
  const { Q: Q2 } = await quote({ accepted: true });
  await db.exec(`SELECT set_config('test.fn', 'deposit', false)`);
  const dep = await tryIt(asAdmin(() => q(`SELECT public.bw_quote_deposit_received($1, 'transfer', 250, true)`, [Q2])));
  const logged = (await q(`SELECT tbl, ok FROM lock_log`)).rows;
  ok(!dep.e && logged.some((x) => x.tbl === 'events') && logged.every((x) => x.ok),
    `187 keeps 183: deposit received locks the quote, then the link, then the gig (${dep.e || JSON.stringify(logged)})`);
  await db.exec(`DROP TRIGGER test_lock_probe ON quote_links; DROP TRIGGER test_lock_probe ON events;`);

  // c. The page shows this link's conversation only (183's link_id).
  await asAnon(() => q(`SELECT public.bw_quote_link_message($1, 'Is parking included?')`, [T]));
  await db.exec(`INSERT INTO quote_activity (quote_id, band_id, kind, body, version, link_id)
                 VALUES ('${Q}', '${BAND}', 'client_message', 'Written to the previous client', 1, gen_random_uuid())`);
  const msgs = ((await view(T))?.messages || []).map((m) => m.body);
  ok(msgs.includes('Is parking included?') && !msgs.includes('Written to the previous client'),
    `187 keeps 183: the page shows only this link's messages (${JSON.stringify(msgs)})`);
  const mine = (await q(`SELECT count(*)::int c FROM quote_activity WHERE quote_id = $1 AND body = 'Is parking included?' AND link_id = (SELECT id FROM quote_links WHERE quote_id = $1)`, [Q])).rows[0].c;
  ok(mine === 1, `187 keeps 183: a client's message is filed on its link (${mine})`);

  // d. "Requested on": when the balance shown was sent, not its last publish.
  await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb)`, [Q, balance(700)]));
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_sent($1, 'sent', 'email')`, [Q]));
  await db.exec(`UPDATE quote_activity SET created_at = '2099-01-10T12:00:00Z' WHERE quote_id = '${Q}' AND kind = 'balance_requested'`);
  await db.exec(`UPDATE quote_links SET balance_at = '2099-01-11T12:00:00Z' WHERE quote_id = '${Q}'`);
  // An older build's Preview: a publish of a trial amount, never sent.
  await asAdmin(() => q(`SELECT public.bw_quote_balance_publish($1, $2::jsonb)`, [Q, balance(650, 'trial')]));
  const b = await view(T);
  ok(b?.balance?.amount === 700 && new Date(b?.balance_at).toISOString() === '2099-01-10T12:00:00.000Z',
    `187: the page shows the balance sent and when it was sent (${b?.balance?.amount} at ${b?.balance_at})`);
  // A changed balance sent later: its own send time.
  await asAdmin(() => q(`SELECT public.bw_quote_balance_mark_sent($1, 'sent', 'email')`, [Q]));
  const b2 = await view(T);
  ok(b2?.balance?.amount === 650 && new Date(b2?.balance_at).getTime() > Date.now() - 60_000,
    `187: a changed balance, once sent, shows its own send time (${b2?.balance?.amount} at ${b2?.balance_at})`);

  // e. A new client: the old link opens nothing, and the client can neither accept nor write on it.
  const { Q: Q3, T: T3 } = await quote();
  await asAdmin(() => q(`UPDATE quotes SET client_name = 'Jordan Lee', client_email = 'jordan@brooklynevents.example' WHERE id = $1`, [Q3]));
  const old = await view(T3);
  const said = await tryIt(asAnon(() => q(`SELECT public.bw_quote_link_message($1, 'Still on?') v`, [T3]).then((r) => r.rows[0].v)));
  const took = await tryIt(asAnon(() => q(`SELECT public.bw_quote_link_respond($1, 'accept', 'Emma Carter', NULL, 1) v`, [T3]).then((r) => r.rows[0].v)));
  const fresh = await link(Q3);
  ok(old === null && !said.e && said.r === null && !took.e && took.r === null && fresh.token !== T3 && fresh.snapshot === null && fresh.status === 'draft',
    `187 keeps 183: a new client's quote: the old link opens nothing, takes no message or acceptance (${said.e || said.r}, ${took.e || took.r}, new link ${fresh.status})`);

  // f. 183 again after 187: refused (it would put back the page without balance_sent).
  const again = await tryIt(db.exec(mig('183_quote_page_fixes.sql')));
  await db.exec('ROLLBACK').catch(() => {});
  const stillSent = (await q(`SELECT prosrc LIKE '%balance_sent%' s FROM pg_proc WHERE proname = 'bw_quote_link_view'`)).rows[0].s;
  ok(!!again.e && /do not run 183 again/.test(again.e) && stillSent, `183 after 187 is refused, 187's page stays (${again.e})`);
}
{
  // g. 187 on a database without 183 or 185: refused at once.
  const bare = new PGlite();
  await bare.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE public.quote_links (id uuid, balance_sent jsonb); CREATE TABLE public.quote_activity (id uuid);`);
  const r = await bare.exec(mig('187_quote_page_lock_balance_sent.sql')).then(() => null, (e) => e.message);
  ok(!!r && /187 needs 183/.test(r), `187 without 183 first: refused (${r})`);
  const bare2 = new PGlite();
  await bare2.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE public.quote_links (id uuid, recipient_changed_at timestamptz, deposit_received_amount numeric); CREATE TABLE public.quote_activity (id uuid, link_id uuid);
    CREATE FUNCTION public.bw_quote_lock_for_token(text) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;`);
  const r2 = await bare2.exec(mig('187_quote_page_lock_balance_sent.sql')).then(() => null, (e) => e.message);
  ok(!!r2 && /187 needs 185/.test(r2), `187 without 185 first: refused (${r2})`);
}

console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
