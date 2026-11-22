// Local check of migration 194 (chat notifications come from send-push only).
// PGlite with 073's bw_can_notify and notifications_insert policy.
// Failing first: `node … <repo> /dev/null` lets a member forge a chat notice.
//
//   cd <dir with @electric-sql/pglite@0.5.15> && node chat_notifications_server_only.pglite.mjs <repo> [/dev/null]
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const REPO = process.argv[2];
const MIG = process.argv[3] ?? `${REPO}/supabase/migrations/194_chat_notifications_server_only.sql`;
const db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [ADMIN, MEM, MEM2, DMFRIEND] = [1, 2, 3, 4].map(id);
const BAND = id(100);

const lines = (file, from, to) => readFileSync(`${REPO}/supabase/migrations/${file}`, 'utf8').split('\n').slice(from - 1, to).join('\n');

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
CREATE TABLE public.band_members (band_id uuid, user_id uuid, role text);
INSERT INTO band_members VALUES ('${BAND}','${ADMIN}','admin'),('${BAND}','${MEM}','member'),('${BAND}','${MEM2}','member');
CREATE FUNCTION public.bw_is_band_member(b uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public.band_members WHERE band_id = b AND user_id = u) $$;
CREATE FUNCTION public.bw_is_band_admin(b uuid, u uuid DEFAULT auth.uid()) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public.band_members WHERE band_id = b AND user_id = u AND role = 'admin') $$;
CREATE FUNCTION public.bw_shares_chat(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, band_id uuid, type text,
  title text, body text, data jsonb, read boolean DEFAULT false, action_url text, created_at timestamptz DEFAULT now());
CREATE TABLE public.messages (id uuid PRIMARY KEY, chat_id uuid, sender_id uuid, content text, deleted boolean DEFAULT false);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public.notifications TO authenticated, service_role;
`);
await db.exec(lines('073_baseline_live_policies.sql', 87, 129));
await db.exec(`CREATE POLICY notifications_insert ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (public.bw_can_notify(user_id, band_id, type));`);
// Round 4 (Codex #284 B2): duplicates from before (send-push deployed ahead
// of 194) must not stop the unique index: the oldest per recipient and
// message stays. Prod has none today.
const DUPMSG = id(700);
await db.exec(`INSERT INTO notifications (user_id, type, title, body, data, created_at) VALUES
  ('${MEM2}', 'chat_message', 'Mia', 'dup', '{"message_id":"${DUPMSG}","tag":"oldest"}', now() - interval '3 minutes'),
  ('${MEM2}', 'chat_message', 'Mia', 'dup', '{"message_id":"${DUPMSG}","tag":"newer"}', now() - interval '2 minutes'),
  ('${MEM2}', 'chat_mention', 'Mia', 'dup', '{"message_id":"${DUPMSG}","tag":"newest"}', now() - interval '1 minute'),
  ('${ADMIN}', 'chat_message', 'Mia', 'dup', '{"message_id":"${DUPMSG}","tag":"admin"}', now() - interval '1 minute'),
  ('${MEM2}', 'event_update', 'Gig', 'x', '{"message_id":"${DUPMSG}","tag":"other-type"}', now())`);
let migErr = null;
try {
  await db.exec(readFileSync(MIG, 'utf8'));
  await db.exec(readFileSync(MIG, 'utf8'));
} catch (e) {
  migErr = e.message;
  await db.exec('ROLLBACK').catch(() => {});
}
ok(!migErr, `migration runs twice, with duplicates from before (${migErr ?? 'ok'})`);
const kept = await db.query(`SELECT data->>'tag' AS tag FROM notifications WHERE data->>'message_id' = '${DUPMSG}' ORDER BY 1`).then((r) => r.rows.map((x) => x.tag));
ok(JSON.stringify(kept) === JSON.stringify(['admin', 'oldest', 'other-type']), `the oldest per recipient and message stays (${kept})`);
if (migErr) { console.log(`\n${fails} FAILED`); process.exit(1); }

const insertAs = async (actor, to, band, type) => {
  try {
    await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${actor}"}', true);`);
    await db.query(`INSERT INTO notifications (user_id, band_id, type, title, body) VALUES ($1, $2, $3, 'Admin', 'Pay me')`, [to, band, type]);
    await db.exec('COMMIT');
    return true;
  } catch {
    await db.exec('ROLLBACK');
    return false;
  }
};

ok(!(await insertAs(MEM, MEM2, BAND, 'chat_message')), 'a member cannot write a chat notice for someone else');
ok(!(await insertAs(MEM, ADMIN, BAND, 'chat_mention')), 'nor a "mentioned you" notice');
ok(!(await insertAs(ADMIN, MEM, BAND, 'chat_message')), 'not even a band admin');
ok(!(await insertAs(MEM, DMFRIEND, null, 'chat_message')), 'nor to a direct-chat contact (no band)');
ok(await insertAs(MEM, MEM, BAND, 'chat_message'), 'own notices still allowed');
ok(await insertAs(MEM, ADMIN, BAND, 'event_update'), 'member → admin RSVP notices unchanged');
ok(await insertAs(MEM, MEM2, BAND, 'song_added'), 'member → band song notices unchanged');
ok(await insertAs(ADMIN, MEM, BAND, 'event_invite'), 'admin → member notices unchanged');
ok(!(await insertAs(MEM, MEM2, BAND, 'event_invite')), 'member → member invites still refused');
await db.exec(`SET ROLE service_role`);
await db.exec(`INSERT INTO notifications (user_id, band_id, type, title, body) VALUES ('${MEM2}', '${BAND}', 'chat_message', 'Bob', 'hi')`);
await db.exec('RESET ROLE');
ok(true, 'send-push (service role) still writes chat notices');

// Round 2: one notice per recipient per message (Claude review #284).
const MSG = id(500), MSG2 = id(501);
const serviceInsert = async (to, type, msg) => {
  try {
    await db.query(`INSERT INTO notifications (user_id, band_id, type, title, body, data) VALUES ($1, $2, $3, 'Bob', 'hi', $4)`,
      [to, BAND, type, JSON.stringify(msg ? { message_id: msg, chat_id: id(900) } : { chat_id: id(900) })]);
    return true;
  } catch (e) {
    return e.code ?? e.message;
  }
};
ok((await serviceInsert(MEM2, 'chat_message', MSG)) === true, 'first notice for a message is written');
ok((await serviceInsert(MEM2, 'chat_message', MSG)) === '23505', 'the same message again for the same person is refused (23505)');
ok((await serviceInsert(MEM2, 'chat_mention', MSG)) === '23505', 'also as a "mentioned you" notice');
ok((await serviceInsert(ADMIN, 'chat_message', MSG)) === true, 'the same message for someone else is fine');
ok((await serviceInsert(MEM2, 'chat_message', MSG2)) === true, 'another message for the same person is fine');
ok((await serviceInsert(MEM2, 'chat_message', null)) === true && (await serviceInsert(MEM2, 'chat_message', null)) === true,
  'rows without a message id (older ones) never collide');
ok((await serviceInsert(MEM2, 'event_update', MSG)) === true && (await serviceInsert(MEM2, 'event_update', MSG)) === true,
  'other types are not affected');

// Round 3 (Codex review #284): notices are written per recipient, only for
// a live message, and claimed for pushing until marked pushed.
const [ALICE, CAROL] = [10, 11].map(id);
const [LIVE, GONE, SOFT] = [600, 601, 602].map(id);
await db.exec(`INSERT INTO messages (id, chat_id, sender_id, content, deleted) VALUES
  ('${LIVE}', '${id(900)}', '${MEM}', 'see you at 8', false), ('${SOFT}', '${id(900)}', '${MEM}', 'oops', true)`);
const rowsFor = (...users) => JSON.stringify(users.map((u) => ({ user_id: u, type: 'chat_message', title: 'Mia', body: 'see you at 8',
  data: { chat_id: id(900), content: 'see you at 8', skip_push: true }, band_id: BAND, action_url: `/chat/${id(900)}` })));
const write = async (msg, ...users) => {
  try {
    const r = await db.query(`SELECT user_id FROM public.bw_write_chat_notices($1, $2::jsonb)`, [msg, rowsFor(...users)]);
    return r.rows.map((x) => x.user_id).sort();
  } catch (e) {
    return 'ERROR ' + e.message;
  }
};
const w1 = await write(LIVE, ALICE, MEM2);
ok(JSON.stringify(w1) === JSON.stringify([MEM2, ALICE].sort()), `first call writes and claims Alice and Bob (${w1})`);
const w2 = await write(LIVE, MEM2, CAROL);
ok(JSON.stringify(w2) === JSON.stringify([CAROL]), `overlapping call [Bob, Carol]: Carol still gets hers, Bob not twice (${w2})`);
ok(await db.query(`SELECT count(*)::int AS n FROM notifications WHERE data->>'message_id' = '${LIVE}'`).then((r) => r.rows[0].n) === 3,
  'one notice each for Alice, Bob, Carol');
ok(JSON.stringify(await write(GONE, ALICE)) === '[]', 'a message deleted after verification: nothing written or pushed');
ok(JSON.stringify(await write(SOFT, ALICE)) === '[]', 'nor for a message marked deleted');
ok(await db.query(`SELECT count(*)::int AS n FROM notifications WHERE data->>'message_id' IN ('${GONE}', '${SOFT}')`).then((r) => r.rows[0].n) === 0,
  'no inbox row for them');
// The token lookup failed after the insert: once the claim is old, a retry pushes again.
ok(JSON.stringify(await write(LIVE, ALICE)) === '[]', 'a retry right away does not push twice (claimed)');
// Claude review r4: a call can run up to 400 s; a 5-minute-old claim still holds.
await db.exec(`UPDATE notifications SET data = data || jsonb_build_object('push_claimed_at', now() - interval '5 minutes') WHERE user_id = '${ALICE}'`);
ok(JSON.stringify(await write(LIVE, ALICE)) === '[]', 'a claim still holds while a long call may be running (5 min)');
await db.exec(`UPDATE notifications SET data = data || jsonb_build_object('push_claimed_at', now() - interval '11 minutes') WHERE user_id = '${ALICE}'`);
ok(JSON.stringify(await write(LIVE, ALICE)) === JSON.stringify([ALICE]), 'a retry after a lost push pushes again');
const ids = await db.query(`SELECT id FROM notifications WHERE data->>'message_id' = '${LIVE}'`).then((r) => r.rows.map((x) => x.id));
await db.query(`SELECT public.bw_mark_chat_notices_pushed($1::uuid[])`, [ids]).catch((e) => console.log('ERROR', e.message));
await db.exec(`UPDATE notifications SET data = data || jsonb_build_object('push_claimed_at', now() - interval '11 minutes')`);
ok(JSON.stringify(await write(LIVE, ALICE, MEM2, CAROL)) === '[]', 'once pushed, never again');
ok(await db.query(`SELECT count(*)::int AS n FROM notifications WHERE data->>'message_id' = '${LIVE}' AND data ? 'pushed_at' AND data->>'message_id' IS NOT NULL`).then((r) => r.rows[0].n) === 3,
  'marked pushed');
// Codex r3: push_claimed_at is in data the recipient can write. A bad value
// must count as unclaimed and never abort the batch.
const MSG3 = id(603);
await db.exec(`INSERT INTO messages (id, chat_id, sender_id, content) VALUES ('${MSG3}', '${id(900)}', '${MEM}', 'third')`);
await write(MSG3, ALICE, CAROL);
await db.exec(`UPDATE notifications SET data = data || '{"push_claimed_at":"not a date"}'::jsonb WHERE user_id = '${ALICE}' AND data->>'message_id' = '${MSG3}'`);
await db.exec(`UPDATE notifications SET data = data || '{"push_claimed_at":"2026-13-45T99:00:00Z"}'::jsonb WHERE user_id = '${CAROL}' AND data->>'message_id' = '${MSG3}'`);
const w3 = await write(MSG3, ALICE, CAROL, MEM2);
ok(JSON.stringify(w3) === JSON.stringify([MEM2, ALICE, CAROL].sort()), `malformed claims count as unclaimed, nothing aborts (${w3})`);

// Round 4 (Codex #284): the token lookup failed after the claim: the claim
// is released so a retry right away delivers.
const MSG4 = id(604);
await db.exec(`INSERT INTO messages (id, chat_id, sender_id, content) VALUES ('${MSG4}', '${id(900)}', '${MEM}', 'fourth')`);
const w4 = await db.query(`SELECT id, user_id FROM public.bw_write_chat_notices($1, $2::jsonb)`, [MSG4, rowsFor(ALICE, CAROL)]).then((r) => r.rows, (e) => 'ERROR ' + e.message);
const rel = await db.query(`SELECT public.bw_release_chat_notice_claims($1::uuid[])`, [Array.isArray(w4) ? w4.filter((x) => x.user_id === ALICE).map((x) => x.id) : []])
  .then(() => 'ok', (e) => e.message);
ok(rel === 'ok', `claims can be released (${rel})`);
ok(JSON.stringify(await write(MSG4, ALICE, CAROL)) === JSON.stringify([ALICE]), 'a retry right away delivers the released one (Carol still claimed)');
const pushedIds = await db.query(`SELECT id FROM notifications WHERE data->>'message_id' = '${MSG4}'`).then((r) => r.rows.map((x) => x.id));
await db.query(`SELECT public.bw_mark_chat_notices_pushed($1::uuid[])`, [pushedIds]);
await db.query(`SELECT public.bw_release_chat_notice_claims($1::uuid[])`, [pushedIds]).catch(() => {});
ok(JSON.stringify(await write(MSG4, ALICE, CAROL)) === '[]', 'releasing never un-pushes');
const relAsUser = await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT public.bw_release_chat_notice_claims('{}'::uuid[]); COMMIT;`).then(() => 'ran', async (e) => { await db.exec('ROLLBACK'); return e.message; });
ok(relAsUser !== 'ran', `app users cannot release claims (${relAsUser})`);

// Claude review: one lock order for overlapping calls (no 40P01).
const def = await db.query(`SELECT pg_get_functiondef('public.bw_write_chat_notices(uuid, jsonb)'::regprocedure) AS d`).then((r) => r.rows[0].d, () => '');
ok(/ORDER BY r\.user_id/.test(def) && /ORDER BY n2\.user_id[\s\S]*FOR UPDATE/.test(def), 'inserts and claims lock rows in user order');
const asUser = await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT public.bw_write_chat_notices('${LIVE}', '[]'::jsonb); COMMIT;`).then(() => 'ran', async (e) => { await db.exec('ROLLBACK'); return e.message; });
ok(asUser !== 'ran', `app users cannot call it (${asUser})`);

// Codex review #284 r5: a push-only call (no inbox row) is recorded per
// message and recipient: a retry after a lost reply never rings twice.
const MSG5 = id(905);
await db.exec(`INSERT INTO messages (id, chat_id, sender_id, content) VALUES ('${MSG5}', '${id(900)}', '${MEM}', 'push only')`);
const claimPO = (...users) => db.query(`SELECT u::text AS u FROM public.bw_claim_chat_push_only('${MSG5}', $1::uuid[]) u ORDER BY 1`, [users])
  .then((r) => r.rows.map((x) => x.u), (e) => `error: ${e.message}`);
ok(JSON.stringify(await claimPO(ALICE, CAROL)) === JSON.stringify([ALICE, CAROL].sort()), 'push only: the first call claims both');
ok(JSON.stringify(await claimPO(ALICE, CAROL)) === '[]', 'push only: a retry right away rings nobody (claimed)');
await db.query(`SELECT public.bw_settle_chat_push_only('${MSG5}', $1::uuid[], $2::uuid[])`, [[ALICE], [CAROL]]).catch(() => {});
ok(JSON.stringify(await claimPO(ALICE, CAROL)) === JSON.stringify([CAROL]), 'push only: pushed stays pushed, a released one is retried at once');
ok(await db.query(`SELECT count(*)::int AS n FROM notifications WHERE data->>'message_id' = '${MSG5}'`).then((r) => r.rows[0].n) === 0,
  'push only: no inbox row');
await db.exec(`UPDATE messages SET deleted = true WHERE id = '${MSG5}'`);
await db.query(`SELECT public.bw_settle_chat_push_only('${MSG5}', '{}'::uuid[], $1::uuid[])`, [[CAROL]]).catch(() => {});
ok(JSON.stringify(await claimPO(CAROL)) === '[]', 'push only: nothing for a deleted message');
const poAsUser = await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT public.bw_claim_chat_push_only('${MSG5}', '{}'::uuid[]); COMMIT;`).then(() => 'ran', async (e) => { await db.exec('ROLLBACK'); return e.message; });
ok(poAsUser !== 'ran', `app users cannot claim push-only (${poAsUser})`);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
