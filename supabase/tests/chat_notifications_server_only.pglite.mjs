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
  title text, body text, data jsonb);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public.notifications TO authenticated, service_role;
`);
await db.exec(lines('073_baseline_live_policies.sql', 87, 129));
await db.exec(`CREATE POLICY notifications_insert ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (public.bw_can_notify(user_id, band_id, type));`);
await db.exec(readFileSync(MIG, 'utf8'));
await db.exec(readFileSync(MIG, 'utf8'));
ok(true, 'migration runs twice');

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

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
