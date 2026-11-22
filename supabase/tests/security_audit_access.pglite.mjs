// Local check of migration 175 (security audit: invitations, chats, removed
// members, lineup notices, quotes) without Docker: PGlite (Postgres in
// WebAssembly) with stand-ins for Supabase's auth schema and the live tables,
// policies and functions involved (verify-db.json / verify-fn.txt of the
// 383f15b audit, plus the migrations that define them: 046, 067, 104, 111).
//
// Failing first: run it with /dev/null as the migration and every defect
// shows up as FAIL; with 175 they all pass.
//
//   mkdir -p /tmp/pg175 && cd /tmp/pg175 && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/security_audit_access.pglite.mjs . && node security_audit_access.pglite.mjs <repo>
//   node security_audit_access.pglite.mjs <repo> /dev/null     # before: FAILs expected
// chats.type is the chat_type enum here, as on a database built from 002.
// CHAT_TYPE=text runs it with a text column (to see the round-2 checks fail
// on the older 175, which could not even be created on the enum).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const REPO = process.argv[2];
const MIG = process.argv[3] ?? `${REPO}/supabase/migrations/175_security_audit_access.sql`;
// 181 (05 #2) builds on 175: `node … <repo> <175> /dev/null` shows its checks failing first.
const MIG181 = process.argv[4] ?? `${REPO}/supabase/migrations/181_event_chat_lineup.sql`;
const migFile = (n) => readFileSync(`${REPO}/supabase/migrations/${n}`, 'utf8');
const lines = (n, a, b) => migFile(n).split('\n').slice(a - 1, b).join('\n');

const db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, OTHERBAND, ADMIN, MEM, MEM2, LINE, INVITEE, OUT] = [1, 2, 3, 4, 5, 6, 7, 8].map(id);
const [BANDCHAT, GROUP, EVCHAT, FAKEDM] = [20, 21, 22, 23].map(id);
const [GIG, INV, QUOTE] = [30, 31, 32].map(id);
// Round 2: an active member, a former one, and their chats and gigs.
const [NEWM, EXM] = [9, 10].map(id);
const [GROUPB, EVCHAT3] = [24, 25].map(id);
const [GIG3, GIG4] = [33, 34].map(id);

// Run `sql` as `uid` (authenticated) in a transaction; returns rows or the error.
async function as(uid, sql) {
  try {
    await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, email: emails[uid], role: 'authenticated' })}', true);`);
    const r = await db.query(sql);
    await db.exec('COMMIT');
    return { rows: r.rows, n: r.affectedRows ?? r.rows.length };
  } catch (e) {
    await db.exec('ROLLBACK');
    return { error: e.message, rows: [], n: 0 };
  }
}
const emails = {
  [ADMIN]: 'admin@example.invalid', [MEM]: 'mem@example.invalid', [MEM2]: 'mem2@example.invalid',
  [LINE]: 'line@example.invalid', [INVITEE]: 'invitee@example.invalid', [OUT]: 'out@example.invalid',
  [NEWM]: 'newm@example.invalid', [EXM]: 'exm@example.invalid',
};
const CHAT_TYPE = process.env.CHAT_TYPE === 'text' ? 'text' : 'chat_type';

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt() TO authenticated, anon;
CREATE TYPE user_role AS ENUM ('admin', 'member');
CREATE TYPE chat_type AS ENUM ('direct', 'group', 'band', 'event');

CREATE TABLE public.profiles (id uuid PRIMARY KEY, email text, full_name text, instrument text, user_mode text, preferred_language text);
CREATE TABLE public.bands (id uuid PRIMARY KEY, name text);
CREATE TABLE public.band_members (band_id uuid, user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE, role user_role, is_active boolean DEFAULT true,
  left_at timestamptz, instrument text, UNIQUE (band_id, user_id));
CREATE TABLE public.band_invitations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, email text, role text,
  status text DEFAULT 'pending', token uuid DEFAULT gen_random_uuid(), invited_by uuid, expires_at timestamptz,
  accepted_at timestamptz, accepted_by uuid, created_at timestamptz DEFAULT now(), email_sent_at timestamptz,
  expiry_notified_at timestamptz, reminder_sent_at timestamptz);
CREATE TABLE public.chats (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type ${CHAT_TYPE}, name text, band_id uuid, event_id uuid,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.chat_participants (id uuid DEFAULT gen_random_uuid(), chat_id uuid,
  user_id uuid CONSTRAINT cp_user_fk REFERENCES public.profiles(id) ON DELETE CASCADE, cleared_at timestamptz,
  last_read_at timestamptz, last_delivered_at timestamptz, muted boolean DEFAULT false, joined_at timestamptz DEFAULT now(), UNIQUE (chat_id, user_id));
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chat_id uuid, sender_id uuid, content text,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, title text, status text, event_type text,
  quote_id uuid, created_by uuid, event_date date, start_time time, end_time time, load_in_time time, soundcheck_time time,
  venue_name text, venue_address text, venue_city text, setlist_id uuid);
CREATE TABLE public.event_members (event_id uuid, user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE, status text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, band_id uuid, type text,
  title text, body text, data jsonb, read boolean, reference_id uuid, reference_type text, created_at timestamptz DEFAULT now());
CREATE TABLE public.quotes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, created_by uuid, client_name text, total numeric);
CREATE TABLE public.setlists (id uuid PRIMARY KEY, band_id uuid, name text);

ALTER TABLE public.band_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.band_invitations, public.chats, public.chat_participants, public.messages,
  public.quotes TO authenticated;
GRANT SELECT ON public.band_members, public.events, public.event_members, public.notifications TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

CREATE FUNCTION public.bw_is_band_admin(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND role = 'admin' AND COALESCE(is_active, true)); $f$;
CREATE FUNCTION public.bw_is_band_member(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND COALESCE(is_active, true)); $f$;
CREATE FUNCTION public.bw_is_event_participant(p_event_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND (e.created_by = p_user_id
    OR (e.band_id IS NOT NULL AND public.bw_is_band_admin(e.band_id, p_user_id))
    OR EXISTS (SELECT 1 FROM event_members em WHERE em.event_id = e.id AND em.user_id = p_user_id AND COALESCE(em.status, '') <> 'declined'))); $f$;
CREATE FUNCTION public.bw_shares_band_with_admin(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
CREATE FUNCTION public.bw_shares_band(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
-- Live (073) chat reads: participation only.
CREATE FUNCTION public.bw_my_chat_ids() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT coalesce(array_agg(chat_id), '{}') FROM chat_participants WHERE user_id = auth.uid(); $f$;
`);

// Live notification helpers (046) and the functions the audit names.
await db.exec(lines('046_server_notifications_and_push.sql', 47, 101));
await db.exec(lines('046_server_notifications_and_push.sql', 128, 138));
await db.exec(lines('046_server_notifications_and_push.sql', 245, 315));
await db.exec(migFile('067_delete_chat_history.sql'));
await db.exec(migFile('104_direct_chat_two_people.sql'));
await db.exec(migFile('111_quote_events_private.sql'));
await db.exec(lines('044_band_invite_acceptance.sql', 252, 272));
await db.exec(lines('042_security_hardening.sql', 225, 273)); // get_user_chats as live
await db.exec(lines('049_chat_participants_and_receipts.sql', 35, 90)); // read / delivered receipts as live
await db.exec(lines('107_setlist_saved_summary_push.sql', 35, 110)); // setlist notice texts
// bw_accept_invitation as live (verify-fn.txt), and the 046 event triggers.
await db.exec(`
CREATE OR REPLACE FUNCTION public.bw_accept_invitation(p_token uuid DEFAULT NULL::uuid, p_invitation_id uuid DEFAULT NULL::uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); v_email text; v_inv band_invitations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;
  SELECT * INTO v_inv FROM band_invitations bi
  WHERE (p_token IS NOT NULL AND bi.token = p_token) OR (p_token IS NULL AND p_invitation_id IS NOT NULL AND bi.id = p_invitation_id) FOR UPDATE;
  IF NOT FOUND OR v_inv.status NOT IN ('pending', 'accepted') THEN RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_inv.email IS DISTINCT FROM v_email THEN RAISE EXCEPTION 'invite_email_mismatch' USING ERRCODE = '42501'; END IF;
  IF v_inv.status = 'accepted' AND v_inv.accepted_by = v_uid THEN RETURN v_inv.band_id;
  ELSIF v_inv.status = 'accepted' THEN RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO band_members (band_id, user_id, role, is_active, left_at, instrument)
  VALUES (v_inv.band_id, v_uid, COALESCE(v_inv.role, 'member')::user_role, true, NULL, NULL)
  ON CONFLICT (band_id, user_id) DO UPDATE SET is_active = true, left_at = NULL,
    role = CASE WHEN band_members.role = 'admin' THEN 'admin' ELSE EXCLUDED.role END;
  UPDATE band_invitations SET status = 'accepted', accepted_at = now(), accepted_by = v_uid WHERE id = v_inv.id;
  RETURN v_inv.band_id;
END; $function$;
GRANT EXECUTE ON FUNCTION public.bw_accept_invitation(uuid, uuid) TO authenticated;
CREATE TRIGGER bw_event_changed_notify AFTER UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.bw_trg_event_changed();

-- Live policies (verify-db.json).
CREATE POLICY "Band admins can manage invitations" ON public.band_invitations FOR ALL TO authenticated
  USING (bw_is_band_admin(band_id)) WITH CHECK (bw_is_band_admin(band_id));
CREATE POLICY "Users can accept own invitations" ON public.band_invitations FOR UPDATE
  USING (lower(email) = lower((auth.jwt() ->> 'email'::text)));
CREATE POLICY "Users can see their invitations" ON public.band_invitations FOR SELECT TO authenticated
  USING (email = lower((auth.jwt() ->> 'email'::text)));
CREATE POLICY chat_participants_insert ON public.chat_participants FOR INSERT TO authenticated WITH CHECK (bw_can_add_chat_participant(chat_id, user_id));
CREATE POLICY chat_participants_select_own ON public.chat_participants FOR SELECT USING (user_id = auth.uid());
CREATE POLICY chat_participants_select_same_chat ON public.chat_participants FOR SELECT TO authenticated USING (chat_id = ANY (bw_my_chat_ids()));
CREATE POLICY cp_update ON public.chat_participants FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY cp_delete ON public.chat_participants FOR DELETE USING (user_id = auth.uid());
CREATE POLICY "Users can update own chat participation" ON public.chat_participants FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own chat participation" ON public.chat_participants FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY chats_insert ON public.chats FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()) AND ((band_id IS NULL) OR bw_is_band_member(band_id)));
CREATE POLICY chats_select_creator ON public.chats FOR SELECT TO authenticated USING (created_by = auth.uid());
CREATE POLICY chats_select_participant ON public.chats FOR SELECT USING (id IN (SELECT chat_participants.chat_id FROM chat_participants WHERE chat_participants.user_id = auth.uid()));
CREATE POLICY chats_upd ON public.chats FOR UPDATE TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());
CREATE POLICY messages_insert_participant ON public.messages FOR INSERT TO authenticated WITH CHECK ((sender_id = auth.uid()) AND (chat_id = ANY (bw_my_chat_ids())));
CREATE POLICY messages_select_participant ON public.messages FOR SELECT TO authenticated USING (chat_id = ANY (bw_my_chat_ids()));
CREATE POLICY messages_delete_own ON public.messages FOR DELETE TO authenticated USING (sender_id = auth.uid());
CREATE POLICY messages_update_own ON public.messages FOR UPDATE TO authenticated USING (sender_id = auth.uid()) WITH CHECK ((sender_id = auth.uid()) AND (chat_id = ANY (bw_my_chat_ids())));
CREATE POLICY quotes_insert_admin ON public.quotes FOR INSERT TO authenticated WITH CHECK (bw_is_band_admin(band_id) AND (created_by = auth.uid()));
CREATE POLICY quotes_select_admin ON public.quotes FOR SELECT TO authenticated USING (bw_is_band_admin(band_id) OR (created_by = auth.uid()));
CREATE POLICY quotes_update_admin ON public.quotes FOR UPDATE TO authenticated USING (bw_is_band_admin(band_id)) WITH CHECK (bw_is_band_admin(band_id));
`);

// Seed (as the server).
await db.exec(`
INSERT INTO auth.users VALUES ${Object.entries(emails).map(([u, e]) => `('${u}','${e}')`).join(',')};
INSERT INTO profiles (id, email, full_name) SELECT id, email, split_part(email, '@', 1) FROM auth.users;
INSERT INTO bands VALUES ('${BAND}', 'Hudson Horns'), ('${OTHERBAND}', 'Other band');
INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${ADMIN}','admin'), ('${BAND}','${MEM}','member'),
  ('${BAND}','${MEM2}','member'), ('${BAND}','${LINE}','member'), ('${OTHERBAND}','${ADMIN}','admin');
INSERT INTO band_invitations (id, band_id, email, role, invited_by, expires_at)
  VALUES ('${INV}','${BAND}','invitee@example.invalid','member','${ADMIN}', now() + interval '5 days');
INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, venue_name)
  VALUES ('${GIG}','${BAND}','Rooftop Session','confirmed','gig','${ADMIN}', current_date + 10, 'The Loft, Brooklyn');
INSERT INTO event_members VALUES ('${GIG}','${MEM}','confirmed'), ('${GIG}','${LINE}','confirmed');
INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES
  ('${BANDCHAT}','band','Hudson Horns','${BAND}',NULL,'${MEM}'),
  ('${GROUP}','group','Horn section',NULL,NULL,'${MEM}'),
  ('${EVCHAT}','event','Rooftop Session',NULL,'${GIG}','${ADMIN}'),
  ('${FAKEDM}','direct',NULL,NULL,NULL,'${MEM}');
INSERT INTO chat_participants (chat_id, user_id) VALUES
  ('${BANDCHAT}','${ADMIN}'),('${BANDCHAT}','${MEM}'),('${BANDCHAT}','${MEM2}'),('${BANDCHAT}','${LINE}'),('${BANDCHAT}','${OUT}'),
  ('${GROUP}','${MEM}'),('${GROUP}','${MEM2}'),('${GROUP}','${LINE}'),
  ('${EVCHAT}','${ADMIN}'),('${EVCHAT}','${MEM}'),('${EVCHAT}','${LINE}'),
  ('${FAKEDM}','${MEM}'),('${FAKEDM}','${MEM2}'),('${FAKEDM}','${LINE}');
INSERT INTO messages (chat_id, sender_id, content) VALUES
  ('${GROUP}','${MEM2}','from mem2'),('${GROUP}','${LINE}','from line'),('${GROUP}','${MEM}','from mem'),
  ('${FAKEDM}','${MEM2}','dm mem2'),('${FAKEDM}','${LINE}','dm line'),('${FAKEDM}','${MEM}','dm mem');
INSERT INTO quotes (id, band_id, created_by, client_name, total) VALUES ('${QUOTE}','${BAND}','${MEM2}','Client', 4200);
-- Round 2: NEWM is in the band; EXM left before 175 (no band_members row).
INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${NEWM}','member');
INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, venue_name) VALUES
  ('${GIG3}','${BAND}','Harbor Lights','confirmed','gig','${ADMIN}', current_date + 20, 'Pier 17, Manhattan'),
  ('${GIG4}','${BAND}','Garden Party','confirmed','gig','${ADMIN}', current_date + 30, 'Hoboken');
INSERT INTO event_members VALUES ('${GIG3}','${NEWM}','confirmed'), ('${GIG3}','${EXM}','confirmed'), ('${GIG4}','${EXM}','confirmed');
INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${GROUPB}','group','Horns (legacy)','${BAND}',NULL,'${ADMIN}');
INSERT INTO chat_participants (chat_id, user_id) VALUES ('${GROUPB}','${ADMIN}'),('${GROUPB}','${NEWM}'),('${GROUPB}','${EXM}');
INSERT INTO messages (chat_id, sender_id, content) VALUES ('${GROUPB}','${ADMIN}','legacy group');
`);
// (OUT: left the band earlier, still has a band chat row. MEM2 created a quote while admin.)

// get_user_chat_ids as it is on prod (no migration made it): SECURITY DEFINER,
// EXECUTE for PUBLIC, anon and authenticated. NO_GUCI=1: a database without it.
if (!process.env.NO_GUCI) {
  await db.exec(`CREATE FUNCTION public.get_user_chat_ids(user_uuid uuid) RETURNS SETOF uuid
    LANGUAGE sql SECURITY DEFINER AS $f$ SELECT chat_id FROM chat_participants WHERE user_id = user_uuid $f$;
    GRANT EXECUTE ON FUNCTION public.get_user_chat_ids(uuid) TO PUBLIC, anon, authenticated, service_role;`);
}
await db.exec(readFileSync(MIG, 'utf8'));
await db.exec(readFileSync(MIG, 'utf8')); // idempotent
// ── 6. get_user_chat_ids (prod only): revoked from PUBLIC, anon, authenticated.
async function asRole(role, sql) {
  try {
    await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
    const r = await db.query(sql);
    await db.exec('COMMIT');
    return { rows: r.rows };
  } catch (e) {
    await db.exec('ROLLBACK');
    return { error: e.message, code: e.code, rows: [] };
  }
}
if (process.env.NO_GUCI) {
  ok(!(await db.query(`SELECT to_regprocedure('public.get_user_chat_ids(uuid)') AS f`)).rows[0].f, 'without get_user_chat_ids, 175 applies cleanly (and twice)');
} else {
  const guci = `SELECT count(*)::int AS n FROM public.get_user_chat_ids('${id(4)}')`;
  for (const role of ['anon', 'authenticated']) {
    const g = await asRole(role, guci);
    ok(g.code === '42501', `get_user_chat_ids: ${role} gets 42501 (${g.code ?? 'ran'} ${g.error ?? ''})`);
  }
  const g = await asRole('service_role', guci);
  ok(!g.error, `get_user_chat_ids: service_role still runs it (${g.error ?? 'ok'})`);
  const pub = (await db.query(`SELECT has_function_privilege('public', 'public.get_user_chat_ids(uuid)', 'EXECUTE') AS p`)).rows[0].p;
  ok(pub === false, 'get_user_chat_ids: PUBLIC has no EXECUTE');
}
await db.exec(readFileSync(MIG181, 'utf8'));
await db.exec(readFileSync(MIG181, 'utf8'));
ok(true, 'migrations run twice');

// ── 1. Invitations
let r = await as(INVITEE, `UPDATE band_invitations SET role = 'admin', band_id = '${OTHERBAND}' WHERE id = '${INV}'`);
ok(r.n === 0, `invitee cannot rewrite own invitation (rows updated: ${r.n}${r.error ? ', ' + r.error : ''})`);
r = await as(INVITEE, `SELECT public.bw_accept_invitation(NULL, '${INV}') AS b`);
ok(r.rows[0]?.b === BAND, `accept RPC still works (${r.error ?? r.rows[0]?.b})`);
r = await as(INVITEE, `SELECT role::text, band_id FROM band_members WHERE user_id = '${INVITEE}'`);
ok(r.rows.length === 1 && r.rows[0].role === 'member' && r.rows[0].band_id === BAND, `joined as member of the inviting band only: ${JSON.stringify(r.rows)}`);
r = await as(INVITEE, `SELECT id FROM band_invitations WHERE id = '${INV}'`);
ok(r.rows.length === 1, 'invitee still sees their invitation');

// ── 2. Chat type and history wipe
r = await as(MEM, `UPDATE chats SET type = 'direct' WHERE id = '${GROUP}'`);
ok(!!r.error || r.n === 0, `creator cannot turn a group into a direct chat (${r.error ?? r.n})`);
r = await as(MEM, `UPDATE chats SET band_id = '${OTHERBAND}' WHERE id = '${BANDCHAT}'`);
ok(!!r.error || r.n === 0, `creator cannot move a chat to another band (${r.error ?? r.n})`);
r = await as(MEM, `UPDATE chats SET name = 'Horns', updated_at = now() WHERE id = '${GROUP}'`);
ok(!r.error && r.n === 1, `rename still works (${r.error ?? r.n})`);
r = await as(MEM, `SELECT public.bw_delete_chat_history('${GROUP}') AS n`);
let left = (await db.query(`SELECT sender_id FROM messages WHERE chat_id = '${GROUP}'`)).rows.map((x) => x.sender_id).sort();
ok(left.length === 2 && !left.includes(MEM), `group: only the caller's messages deleted (left ${left.length})`);
r = await as(MEM, `SELECT public.bw_delete_chat_history('${FAKEDM}') AS n`);
left = (await db.query(`SELECT sender_id FROM messages WHERE chat_id = '${FAKEDM}'`)).rows;
ok(left.length === 2, `"direct" chat with three people: others' messages kept (left ${left.length})`);

// ── 3. Removed members and band / event chats
// Round 4: rows are never deleted, the rule refuses them.
r = await db.query(`SELECT count(*)::int AS n FROM chat_participants WHERE user_id = '${OUT}'`);
ok(r.rows[0].n === 1, `stale band chat row of a former member kept, not deleted (${r.rows[0].n})`);
r = await db.query(`SELECT count(*)::int AS n FROM chat_participants_removed_175 WHERE user_id = '${OUT}'`).catch(() => ({ rows: [{ n: 0 }] }));
ok(r.rows[0].n === 1, 'and archived');
await db.exec(`INSERT INTO messages (chat_id, sender_id, content) VALUES ('${BANDCHAT}','${ADMIN}','before removal')`);
await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN}"}', true);
  DELETE FROM band_members WHERE band_id = '${BAND}' AND user_id = '${MEM}';
  UPDATE band_members SET is_active = false WHERE band_id = '${BAND}' AND user_id = '${MEM2}'; COMMIT;`);
await db.exec(`INSERT INTO messages (chat_id, sender_id, content) VALUES ('${BANDCHAT}','${ADMIN}','after removal'),('${EVCHAT}','${ADMIN}','event after')`);
for (const [who, label] of [[MEM, 'removed'], [MEM2, 'deactivated']]) {
  r = await as(who, `SELECT content FROM messages WHERE chat_id = '${BANDCHAT}'`);
  ok(r.rows.length === 0, `${label} member reads no band chat messages (${r.rows.length})`);
  r = await as(who, `INSERT INTO messages (chat_id, sender_id, content) VALUES ('${BANDCHAT}','${who}','still here?')`);
  ok(!!r.error, `${label} member cannot write in the band chat`);
  r = await as(who, `SELECT id FROM chats WHERE id = '${BANDCHAT}'`);
  ok(r.rows.length === 0, `${label} member cannot read the band chat row (even as its creator)`);
}
r = await as(MEM, `SELECT content FROM messages WHERE chat_id = '${EVCHAT}'`);
ok(r.rows.length === 0, `removed member reads no chat of the band's events (${r.rows.length})`);
r = await as(MEM, `SELECT user_id FROM chat_participants WHERE chat_id = '${BANDCHAT}' AND user_id <> '${MEM}'`);
ok(r.rows.length === 0, 'removed member no longer sees the band chat roster');
r = await as(LINE, `SELECT user_id FROM chat_participants WHERE chat_id = '${BANDCHAT}'`);
ok(r.rows.length > 0 && ![MEM, MEM2, OUT].some((u) => r.rows.some((x) => x.user_id === u)),
  `round 4: the band no longer lists them in the band chat (kept rows hidden: ${r.rows.length} listed)`);
r = await as(MEM, `SELECT content FROM messages WHERE chat_id = '${GROUP}'`);
ok(r.rows.length > 0, 'a group chat outside the band is not touched');
r = await as(LINE, `SELECT content FROM messages WHERE chat_id = '${BANDCHAT}'`);
ok(r.rows.length === 2, `active member still reads the band chat (${r.rows.length})`);
r = await db.query(`SELECT public.bw_chat_recipient_ids('${BANDCHAT}', '${ADMIN}') AS ids`).catch((e) => ({ rows: [{ ids: null, e }] }));
const ids = r.rows[0].ids ?? [];
ok(ids.includes(LINE) && !ids.includes(MEM) && !ids.includes(MEM2) && !ids.includes(ADMIN), `push recipients: active members only (${JSON.stringify(ids)})`);
r = await db.query(`SELECT public.bw_chat_recipient_ids('${BANDCHAT}', '${MEM}') AS ids`).catch(() => ({ rows: [{ ids: ['x'] }] }));
ok((r.rows[0].ids ?? []).length === 0, 'a removed member cannot push to the band chat');
// Back in the band: the kept row works again, the same chat (round 4).
await db.exec(`INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${MEM}','member')`);
r = await as(MEM, `SELECT id FROM chats WHERE type = 'band' AND band_id = '${BAND}'`);
ok(r.rows.length === 1 && r.rows[0].id === BANDCHAT, `back in the band: an app's lookup finds the same band chat (${r.rows.length})`);
r = await as(MEM, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${BANDCHAT}','${MEM}') ON CONFLICT (chat_id, user_id) DO NOTHING`);
ok(!r.error, `re-joined member's join (upsert) still works (${r.error ?? 'ok'})`);
r = await as(MEM, `SELECT content FROM messages WHERE chat_id = '${BANDCHAT}'`);
ok(r.rows.length >= 2, `and reads the band chat again (${r.rows.length})`);
ok((await db.query(`SELECT count(*)::int AS n FROM chats WHERE type::text = 'band' AND band_id = '${BAND}'`)).rows[0].n === 1, 'still one band chat');
await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN}"}', true);
  DELETE FROM band_members WHERE band_id = '${BAND}' AND user_id = '${MEM}'; COMMIT;`);

// ── 4. Lineup notices to former members
await db.exec(`DELETE FROM notifications; BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN}"}', true);
  UPDATE events SET event_date = event_date + 1 WHERE id = '${GIG}'; COMMIT;`);
const told = (await db.query(`SELECT user_id FROM notifications WHERE type = 'event_update'`)).rows.map((x) => x.user_id);
ok(told.includes(LINE), 'lineup member still told about the new date');
ok(!told.includes(MEM), `former member on the lineup not told (${told.length} notices)`);

// ── 5. Quotes after demotion
await db.exec(`UPDATE band_members SET role = 'admin' WHERE band_id = '${BAND}' AND user_id = '${LINE}'`);
r = await as(LINE, `SELECT id FROM quotes WHERE id = '${QUOTE}'`);
ok(r.rows.length === 1, 'active admin reads the quote');
r = await as(MEM2, `SELECT id FROM quotes WHERE id = '${QUOTE}'`);
ok(r.rows.length === 0, `quote creator no longer an admin cannot read it (${r.rows.length})`);

// ── 6. Taken off the gig (05 #2, migration 181)
await db.exec(`UPDATE band_members SET role = 'member' WHERE band_id = '${BAND}' AND user_id = '${LINE}';
  UPDATE band_members SET is_active = true WHERE band_id = '${BAND}' AND user_id = '${MEM2}';
  INSERT INTO event_members VALUES ('${GIG}','${MEM2}','confirmed');
  INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHAT}','${MEM2}');
  INSERT INTO messages (chat_id, sender_id, content) VALUES ('${EVCHAT}','${ADMIN}','load-in at 6');`);
r = await as(MEM2, `SELECT id FROM messages WHERE chat_id = '${EVCHAT}' AND content = 'load-in at 6'`);
ok(r.rows.length === 1, 'musician on the gig reads its chat');
await db.exec(`DELETE FROM event_members WHERE event_id = '${GIG}' AND user_id = '${MEM2}'`);
r = await as(MEM2, `SELECT id FROM messages WHERE chat_id = '${EVCHAT}' AND content = 'load-in at 6'`);
ok(r.rows.length === 0, `taken off the gig: no more gig chat messages (${r.rows.length})`);
const part = (await db.query(`SELECT 1 FROM chat_participants WHERE chat_id = '${EVCHAT}' AND user_id = '${MEM2}'`)).rows;
ok(part.length === 0, 'taken off the gig: out of the gig chat');
let rcpt = (await db.query(`SELECT public.bw_chat_recipient_ids('${EVCHAT}', '${ADMIN}') AS r`)).rows[0].r;
ok(!rcpt.includes(MEM2), `taken off the gig: no push of the next message (${rcpt.length})`);
r = await as(MEM2, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHAT}','${MEM2}')`);
r = await as(MEM2, `SELECT id FROM messages WHERE chat_id = '${EVCHAT}' AND content = 'load-in at 6'`);
ok(r.rows.length === 0, `re-adding themselves does not open it again (${r.rows.length})`);
await db.exec(`DELETE FROM chat_participants WHERE chat_id = '${EVCHAT}' AND user_id = '${MEM2}'`);

await db.exec(`UPDATE event_members SET status = 'declined' WHERE event_id = '${GIG}' AND user_id = '${LINE}'`);
r = await as(LINE, `SELECT id FROM messages WHERE chat_id = '${EVCHAT}' AND content = 'load-in at 6'`);
ok(r.rows.length === 0, `declined the gig: gig chat closed (${r.rows.length})`);
rcpt = (await db.query(`SELECT public.bw_chat_recipient_ids('${EVCHAT}', '${ADMIN}') AS r`)).rows[0].r;
ok(!rcpt.includes(LINE), 'declined the gig: no push');
await db.exec(`UPDATE event_members SET status = 'confirmed' WHERE event_id = '${GIG}' AND user_id = '${LINE}'`);
r = await as(LINE, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHAT}','${LINE}')`);
r = await as(LINE, `SELECT id FROM messages WHERE chat_id = '${EVCHAT}' AND content = 'load-in at 6'`);
ok(r.rows.length === 1, 'back on the gig: reads its chat again');
r = await as(ADMIN, `SELECT id FROM messages WHERE chat_id = '${EVCHAT}' AND content = 'load-in at 6'`);
ok(r.rows.length === 1, 'band admin, not on the lineup, still reads the gig chat');
const archived = (await db.query(`SELECT count(*)::int AS n FROM chat_participants_removed_175 WHERE chat_id = '${EVCHAT}'`)).rows[0].n;
ok(archived >= 2, `removed gig chat rows archived, not lost (${archived})`);

// ── 7. Review fixes (Codex #281)
// MEM left the band but is still on GIG's lineup (confirmed).
await db.exec(`DELETE FROM chat_participants WHERE chat_id = '${EVCHAT}' AND user_id = '${MEM}'`);
r = await as(MEM, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHAT}','${MEM}')`);
const back = (await db.query(`SELECT 1 FROM chat_participants WHERE chat_id = '${EVCHAT}' AND user_id = '${MEM}'`)).rows.length;
ok(back === 0, `former member kept on the lineup can't join the gig chat again (${r.error ? 'refused' : back ? 'joined' : 'skipped'})`);
await db.exec(`INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHAT}','${MEM}') ON CONFLICT DO NOTHING`);
r = await as(MEM, `SELECT public.get_user_chats('${MEM}') AS j`);
const listed = (r.rows[0]?.j ?? []).map((c) => c.id);
ok(!r.error && !listed.includes(EVCHAT) && !listed.includes(BANDCHAT), `chat list hides band and gig chats of a former member (${r.error ?? listed.length})`);
ok(listed.includes(GROUP), 'their own group chat is still listed');
// Worst cascade order for account deletion: the chat rows are still there
// when the band and lineup removal triggers run (prod's order isn't fixed).
await db.exec(`ALTER TABLE chat_participants DROP CONSTRAINT cp_user_fk`);
let delErr = null;
try { await db.exec(`DELETE FROM profiles WHERE id = '${MEM}'`); } catch (e) { delErr = e.message; }
ok(!delErr, `a person who created chats can delete their account (${delErr ?? 'ok'})`);
const orphan = (await db.query(`SELECT created_by FROM chats WHERE id = '${FAKEDM}'`)).rows[0];
ok(orphan && orphan.created_by === null, 'their chats stay, without author');
r = await as(LINE, `UPDATE chats SET created_by = NULL WHERE id = '${GROUP}'`);
ok(!!r.error || r.n === 0, 'a user still cannot change who created a chat');
await db.exec(`DELETE FROM profiles WHERE id = '${OUT}'`).catch(() => {});
const arch = (await db.query(`SELECT count(*)::int AS n FROM chat_participants_removed_175 WHERE user_id = '${OUT}'`)).rows[0].n;
ok(arch === 0, `archived chat rows go with the account (${arch})`);
// Deleting an account cascades through band_members / event_members, whose
// removal triggers archive chat rows: they must not archive for a profile
// that is going away (its FK would refuse the whole deletion).
await db.exec(`INSERT INTO event_members VALUES ('${GIG}','${LINE}','confirmed') ON CONFLICT DO NOTHING;
  INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHAT}','${LINE}'),('${BANDCHAT}','${LINE}') ON CONFLICT DO NOTHING`);
delErr = null;
try { await db.exec(`DELETE FROM profiles WHERE id = '${LINE}'`); } catch (e) { delErr = e.message; }
ok(!delErr, `an active member on a gig lineup can delete their account (${delErr ?? 'ok'})`);

// ── 8. Round 2 (Codex #281 r2, Claude r2)
// A legacy 'group' chat tied to the band follows the band rule.
r = await as(EXM, `SELECT id FROM messages WHERE chat_id = '${GROUPB}'`);
ok(r.rows.length === 0, `former member reads no legacy band group chat (${r.rows.length})`);
r = await as(NEWM, `SELECT id FROM messages WHERE chat_id = '${GROUPB}'`);
ok(r.rows.length === 1, `active member still reads it (${r.rows.length})`);
// One insert with the whole lineup, a former member in it (createChat,
// sendMessage and older builds all do this).
await as(ADMIN, `INSERT INTO chats (id, type, name, band_id, event_id, created_by)
  VALUES ('${EVCHAT3}','event','Harbor Lights','${BAND}','${GIG3}','${ADMIN}')`);
r = await as(ADMIN, `INSERT INTO chat_participants (chat_id, user_id, cleared_at)
  VALUES ('${EVCHAT3}','${ADMIN}',NULL),('${EVCHAT3}','${NEWM}',NULL),('${EVCHAT3}','${EXM}',NULL)`);
let inChat = (await db.query(`SELECT user_id FROM chat_participants WHERE chat_id = '${EVCHAT3}'`)).rows.map((x) => x.user_id);
ok(!r.error && inChat.includes(ADMIN) && inChat.includes(NEWM) && !inChat.includes(EXM),
  `new gig chat: the batch joins everyone still in the band, skips the former member (${r.error ?? JSON.stringify(inChat.length)})`);
await db.exec(`DELETE FROM chat_participants WHERE chat_id = '${EVCHAT3}' AND user_id = '${NEWM}'`);
r = await as(ADMIN, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHAT3}','${EXM}'),('${EVCHAT3}','${NEWM}')
  ON CONFLICT (chat_id, user_id) DO NOTHING`);
inChat = (await db.query(`SELECT user_id FROM chat_participants WHERE chat_id = '${EVCHAT3}'`)).rows.map((x) => x.user_id);
ok(!r.error && inChat.includes(NEWM) && !inChat.includes(EXM), `sendMessage's lineup upsert still adds the new musician (${r.error ?? 'ok'})`);
r = await as(NEWM, `INSERT INTO messages (chat_id, sender_id, content) VALUES ('${EVCHAT3}','${NEWM}','see you at 6')`);
ok(!r.error, `and they can post in it (${r.error ?? 'ok'})`);
// A gig whose whole lineup left the band: nobody else is told.
await db.exec(`DELETE FROM notifications; BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN}"}', true);
  UPDATE events SET event_date = event_date + 1 WHERE id = '${GIG4}'; COMMIT;`);
const told4 = (await db.query(`SELECT user_id FROM notifications WHERE type = 'event_update'`)).rows.map((x) => x.user_id);
ok(told4.length === 0, `lineup of former members only: the rest of the band is not told (${told4.length} notices)`);
// Round 3: 175 holds the one rule (181 no longer redefines it), and it is the
// one 178 keeps on a re-run (it calls bw_is_event_participant). Re-running
// 175 after an older definition puts the lineup rule back.
await db.exec(`CREATE OR REPLACE FUNCTION public.bw_chat_scope_ok(p_type text, p_band_id uuid, p_event_id uuid, p_user_id uuid)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$ SELECT true $f$`);
await db.exec(readFileSync(MIG, 'utf8'));
const def = (await db.query(`SELECT pg_get_functiondef('public.bw_chat_scope_ok(text,uuid,uuid,uuid)'::regprocedure) AS d`)).rows[0].d;
ok(def.includes('bw_is_event_participant') && def.includes('dropped_out'),
  're-running 175 puts the lineup rule back (and 178 keeps it: it calls bw_is_event_participant)');

// ── 9. With 193 (#291: one chat per band / gig, bw_open_group_chat), when
// M193=<path to 193_one_chat_per_gig.sql> is set. A member who left has no
// participant row any more; back in the band, the app must find the same
// band chat, not make a second one (Codex #281 r2, 175:289).
// M178=<path to 178_date_on_hold.sql> (needed with M193) loads 178's bw_is_event_participant
// first (dropped out / removed are off the gig there too), as on apply day:
// 175 -> 178 -> 193 -> 181. 193's bw_chat_joinable builds on it.
// One definition out of a migration file (by name, so line moves don't matter).
const fnDef = (f, name, kind = 'OR REPLACE FUNCTION public.', end = '$$;') => {
  const src = readFileSync(f, 'utf8');
  const a = src.indexOf(`CREATE ${kind}${name}`);
  if (a < 0) throw new Error(`${name} not found in ${f}`);
  return src.slice(a, src.indexOf(end, a) + end.length);
};
if (process.env.M193) {
  if (process.env.M178) {
    await db.exec(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS converted_to_event_id uuid, ADD COLUMN IF NOT EXISTS status text;`);
    await db.exec(fnDef(process.env.M178, 'event_date_holds', 'TABLE IF NOT EXISTS public.', ');'));
    await db.exec(`ALTER TABLE public.event_date_holds ADD COLUMN IF NOT EXISTS answers_carried_at timestamptz,
      ADD COLUMN IF NOT EXISTS confirmed_once_at timestamptz;`);
    for (const f of ['bw_event_quote_private', 'bw_event_quote_hidden', 'bw_is_event_participant']) await db.exec(fnDef(process.env.M178, f));
  }
  await db.exec(readFileSync(process.env.M193, 'utf8'));
  if (process.env.M178) {
    // 175 re-run after 178: the quote rule is written into bw_chat_scope_ok
    // too, so it doesn't depend on bw_is_event_participant carrying it.
    await db.exec(readFileSync(MIG, 'utf8'));
    const d178 = (await db.query(`SELECT pg_get_functiondef('public.bw_chat_scope_ok(text,uuid,uuid,uuid)'::regprocedure) AS d`)).rows[0].d;
    ok(d178.includes('bw_event_quote_hidden') && d178.includes('dropped_out'), '175 after 178: lineup rule and quote rule both in bw_chat_scope_ok');
  }
  await db.exec(`UPDATE band_members SET is_active = true WHERE band_id = '${BAND}' AND user_id = '${MEM2}'`);
  r = await as(MEM2, `SELECT id FROM chats WHERE type = 'band' AND band_id = '${BAND}'`);
  ok(r.rows.length === 1 && r.rows[0].id === BANDCHAT, `193: back in the band, an old build's lookup finds the band chat (${r.rows.length})`);
  r = await as(MEM2, `SELECT public.bw_open_group_chat('band', '${BAND}', NULL, 'Hudson Horns') AS j`);
  ok(!r.error && r.rows[0]?.j?.id === BANDCHAT && r.rows[0]?.j?.created === false, `193: bw_open_group_chat rejoins the same chat (${r.error ?? r.rows[0]?.j?.id})`);
  r = await as(MEM2, `SELECT id FROM messages WHERE chat_id = '${BANDCHAT}'`);
  ok(r.rows.length > 0, `193: and reads it again (${r.rows.length})`);
  r = await as(MEM2, `INSERT INTO chats (type, name, band_id, created_by) VALUES ('band','Hudson Horns','${BAND}','${MEM2}')`);
  ok(!!r.error, '193: a second band chat is refused');
  r = await as(EXM, `SELECT public.bw_open_group_chat('event', NULL, '${GIG3}', NULL) AS j`);
  inChat = (await db.query(`SELECT user_id FROM chat_participants WHERE chat_id = '${EVCHAT3}'`)).rows.map((x) => x.user_id);
  ok(!!r.error && !inChat.includes(EXM), `193: a former member on the lineup can't open the gig chat (${r.error ? 'refused' : 'opened'})`);
}

// ── 10. Stale participant rows (main's check): someone who left the band or
// was deactivated keeps a chat_participants row that no trigger removed
// (inserted here with triggers off). Every read path must still be closed:
// SELECT on messages (also what Realtime postgres_changes applies, as the
// subscriber), the chat row, the roster, get_user_chats, and the read /
// delivered RPCs (they answer "is there something new").
// The roster helpers below are reused by #289 (181) for lineup statuses.
const staleUsers = { LEFT: id(40), DEACT: id(41) };
async function staleChecks(uid, label, chatIds, opts = {}) {
  for (const chat of chatIds) {
    let x = await as(uid, `SELECT id FROM messages WHERE chat_id = '${chat}'`);
    ok(!x.error && x.rows.length === 0, `${label}, stale row: SELECT messages of ${chat.slice(-2)} sees nothing (${x.error ?? x.rows.length})`);
    x = await as(uid, `SELECT id FROM chats WHERE id = '${chat}'`);
    if (opts.knownChatRow && x.rows.length) console.log('KNOWN', `${label}: chat row ${chat.slice(-2)} visible: ${opts.knownChatRow}`);
    else ok(x.rows.length === 0, `${label}, stale row: chat row ${chat.slice(-2)} hidden (${x.rows.length})`);
    x = await as(uid, `SELECT user_id FROM chat_participants WHERE chat_id = '${chat}' AND user_id <> '${uid}'`);
    ok(x.rows.length === 0, `${label}, stale row: roster of ${chat.slice(-2)} hidden (${x.rows.length})`);
    x = await as(uid, `SELECT public.bw_mark_chat_read('${chat}') AS b`);
    ok(!x.error && x.rows[0]?.b === false, `${label}, stale row: bw_mark_chat_read on ${chat.slice(-2)} says nothing new (${x.error ?? x.rows[0]?.b})`);
  }
  let x = await as(uid, `SELECT public.get_user_chats('${uid}') AS j`);
  const listed = (x.rows[0]?.j ?? []).map((c) => c.id);
  ok(!x.error && chatIds.every((c) => !listed.includes(c)), `${label}, stale row: get_user_chats lists none of them (${x.error ?? listed.length})`);
  x = await as(uid, `SELECT public.bw_mark_chats_delivered() AS n`);
  ok(!x.error && x.rows[0]?.n === 0, `${label}, stale row: bw_mark_chats_delivered touches nothing (${x.error ?? x.rows[0]?.n})`);
}
async function staleRow(chat, uid) {
  await db.exec(`SET session_replication_role = replica;
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${chat}','${uid}') ON CONFLICT DO NOTHING;
    SET session_replication_role = origin;`);
}
await db.exec(`INSERT INTO auth.users VALUES ('${staleUsers.LEFT}','left@example.invalid'), ('${staleUsers.DEACT}','deact@example.invalid');
  INSERT INTO profiles (id, email) VALUES ('${staleUsers.LEFT}','left@example.invalid'), ('${staleUsers.DEACT}','deact@example.invalid');
  INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${staleUsers.LEFT}','member'), ('${BAND}','${staleUsers.DEACT}','member');
  INSERT INTO event_members VALUES ('${GIG3}','${staleUsers.LEFT}','confirmed'), ('${GIG3}','${staleUsers.DEACT}','confirmed');
  DELETE FROM band_members WHERE band_id = '${BAND}' AND user_id = '${staleUsers.LEFT}';
  UPDATE band_members SET is_active = false WHERE band_id = '${BAND}' AND user_id = '${staleUsers.DEACT}';`);
for (const u of Object.values(staleUsers)) for (const c of [BANDCHAT, EVCHAT3]) await staleRow(c, u);
await db.exec(`INSERT INTO messages (chat_id, sender_id, content) VALUES ('${BANDCHAT}','${ADMIN}','stale check'), ('${EVCHAT3}','${ADMIN}','stale check')`);
ok((await db.query(`SELECT count(*)::int AS n FROM chat_participants WHERE user_id IN ('${staleUsers.LEFT}','${staleUsers.DEACT}')`)).rows[0].n === 4, 'stale rows are in place');
await staleChecks(staleUsers.LEFT, 'left the band', [BANDCHAT, EVCHAT3]);
await staleChecks(staleUsers.DEACT, 'deactivated', [BANDCHAT, EVCHAT3]);
r = await as(NEWM, `SELECT public.bw_mark_chat_read('${EVCHAT3}') AS b`);
ok(r.rows[0]?.b === true, `an active member's read receipt still works (${r.error ?? r.rows[0]?.b})`);

// ── 11. Round 3 (Codex #281 r3, #289 r3)
const [DEMOTED, DECL, DROP, REMOVED, RET] = [42, 43, 44, 45, 46].map(id);
const GIG5 = id(35);
const EVCHAT5 = id(26);
await db.exec(`INSERT INTO auth.users VALUES ${[DEMOTED, DECL, DROP, REMOVED, RET].map((u) => `('${u}','u${u.slice(-2)}@example.invalid')`).join(',')};
  INSERT INTO profiles (id, email) SELECT id, email FROM auth.users WHERE id IN ('${DEMOTED}','${DECL}','${DROP}','${REMOVED}','${RET}');
  INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${DEMOTED}','admin'), ('${BAND}','${DECL}','member'),
    ('${BAND}','${DROP}','member'), ('${BAND}','${REMOVED}','member'), ('${BAND}','${RET}','member');
  INSERT INTO event_members VALUES ('${GIG3}','${DECL}','declined'), ('${GIG3}','${DROP}','dropped_out'), ('${GIG3}','${REMOVED}','removed');`);
// B1 (#281): an admin in a gig chat they are not booked on, then demoted.
r = await as(DEMOTED, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHAT3}','${DEMOTED}')`);
ok(!r.error && (await db.query(`SELECT 1 FROM chat_participants WHERE chat_id = '${EVCHAT3}' AND user_id = '${DEMOTED}'`)).rows.length === 1,
  `an admin joins a gig chat they run (${r.error ?? 'ok'})`);
await db.exec(`UPDATE band_members SET role = 'member' WHERE band_id = '${BAND}' AND user_id = '${DEMOTED}'`);
let still = (await db.query(`SELECT 1 FROM chat_participants WHERE chat_id = '${EVCHAT3}' AND user_id = '${DEMOTED}'`)).rows.length;
const archived = (await db.query(`SELECT count(*)::int AS n FROM chat_participants_removed_175 WHERE chat_id = '${EVCHAT3}' AND user_id = '${DEMOTED}'`)).rows[0].n;
ok(still === 1 && archived === 1, `demoted admin off the lineup: row kept and archived, the rule refuses it (row ${still}, archived ${archived})`);
await staleChecks(DEMOTED, 'demoted admin, not on the lineup', [EVCHAT3]);
// Declined / dropped out / removed, still in the band (181's trigger is not
// in #281: the rule alone must close it).
for (const [u, label] of [[DECL, 'declined'], [DROP, 'dropped out'], [REMOVED, 'removed from the lineup']]) {
  await staleRow(EVCHAT3, u);
  await staleChecks(u, label, [EVCHAT3]);
}
if (process.env.M193) {
  // With 193 (after 178, which takes dropped out / removed off the gig in
  // bw_is_event_participant): they can't open the gig chat either. Without
  // 178 first, 193's bw_chat_joinable still lets them see the chat row:
  // that is why the order is 175 -> 178 -> 193 -> 181.
  r = await as(DROP, `SELECT public.bw_open_group_chat('event', NULL, '${GIG3}', NULL) AS j`);
  ok(!!r.error, `193: a dropped-out musician can't open the gig chat (${r.error ? 'refused' : 'opened'})`);
}
// B1 (#289): the gig's creator deleted their account (created_by NULL).
await db.exec(`INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, venue_name)
    VALUES ('${GIG5}','${BAND}','Brunch Set','confirmed','gig',NULL, current_date + 40, 'Jersey City');
  INSERT INTO event_members VALUES ('${GIG5}','${DROP}','dropped_out'), ('${GIG5}','${REMOVED}','removed'), ('${GIG5}','${NEWM}','confirmed');
  INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${EVCHAT5}','event','Brunch Set','${BAND}','${GIG5}',NULL);
  INSERT INTO messages (chat_id, sender_id, content) VALUES ('${EVCHAT5}','${ADMIN}','brunch at 11');`);
for (const [u, label] of [[DROP, 'dropped out, gig without creator'], [REMOVED, 'removed, gig without creator']]) {
  await staleRow(EVCHAT5, u);
  await staleChecks(u, label, [EVCHAT5]);
}
r = await as(NEWM, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHAT5}','${NEWM}')`);
r = await as(NEWM, `SELECT content FROM messages WHERE chat_id = '${EVCHAT5}'`);
ok(r.rows.length === 1, `a booked musician still reads a gig without creator (${r.error ?? r.rows.length})`);
// No coalesce to "yes": no user, a band chat without band, a gig chat without gig.
r = await db.query(`SELECT public.bw_chat_scope_ok('band', '${BAND}', NULL, NULL) AS a,
  public.bw_chat_scope_ok('band', NULL, NULL, '${NEWM}') AS b,
  public.bw_chat_scope_ok('event', '${BAND}', NULL, '${NEWM}') AS c,
  public.bw_chat_scope_ok('event', NULL, '${id(99)}', '${NEWM}') AS d`);
ok(Object.values(r.rows[0]).every((v) => v === false), `no user / no band / no gig: false (${JSON.stringify(r.rows[0])})`);
// The roster in get_user_chats leaves out the stale rows above.
r = await as(NEWM, `SELECT public.get_user_chats('${NEWM}') AS j`);
const roster = ((r.rows[0]?.j ?? []).find((c) => c.id === EVCHAT3)?.participants ?? []).map((p) => p.user_id);
ok(roster.includes(NEWM) && ![DEMOTED, DECL, DROP, REMOVED, staleUsers.LEFT, staleUsers.DEACT].some((u) => roster.includes(u)),
  `get_user_chats roster: only people who can read it (${roster.length})`);
// Main / #282 (180): a message whose sender deleted their account
// (sender_id NULL) is someone else's message: unread and undelivered.
await as(NEWM, `SELECT public.bw_mark_chat_read('${EVCHAT3}')`);
await as(NEWM, `SELECT public.bw_mark_chats_delivered()`);
await db.exec(`INSERT INTO messages (chat_id, sender_id, content, created_at) VALUES ('${EVCHAT3}', NULL, 'from a deleted account', now() + interval '1 minute')`);
r = await as(NEWM, `SELECT public.bw_mark_chats_delivered() AS n`);
ok(!r.error && r.rows[0]?.n === 1, `NULL sender: delivered receipt moves (${r.error ?? r.rows[0]?.n})`);
r = await as(NEWM, `SELECT public.bw_mark_chat_read('${EVCHAT3}') AS b`);
ok(!r.error && r.rows[0]?.b === true, `NULL sender: counts as unread (${r.error ?? r.rows[0]?.b})`);
// Claude r3 (175:535): a setlist save on a gig tells the lineup as every
// other gig notice does (not declined, dropped out or removed).
const SET3 = id(36);
await db.exec(`INSERT INTO setlists VALUES ('${SET3}','${BAND}','Harbor set'); UPDATE events SET setlist_id = '${SET3}' WHERE id = '${GIG3}'; DELETE FROM notifications;`);
r = await as(ADMIN, `SELECT public.bw_notify_setlist_saved('${SET3}', '${GIG3}', 1, 0, 0, false) AS n`);
const toldSet = (await db.query(`SELECT user_id FROM notifications`)).rows.map((x) => x.user_id);
ok(!r.error && toldSet.includes(NEWM) && ![DECL, DROP, REMOVED].some((u) => toldSet.includes(u)),
  `setlist saved: the booked musician is told, declined / dropped out / removed are not (${r.error ?? toldSet.length})`);
// MINOR: leaving and coming back keeps their cleared history cleared.
await db.exec(`INSERT INTO chat_participants (chat_id, user_id, cleared_at, last_read_at, muted)
  VALUES ('${BANDCHAT}','${RET}','2026-11-01T10:00:00Z','2026-11-02T10:00:00Z', true)`);
await db.exec(`DELETE FROM band_members WHERE band_id = '${BAND}' AND user_id = '${RET}'`);
ok((await db.query(`SELECT 1 FROM chat_participants WHERE chat_id = '${BANDCHAT}' AND user_id = '${RET}'`)).rows.length === 1, 'left: row kept (round 4)');
r = await as(RET, `SELECT id FROM messages WHERE chat_id = '${BANDCHAT}'`);
ok(r.rows.length === 0, `left: reads nothing (${r.rows.length})`);
await db.exec(`INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${RET}','member')`);
r = await as(RET, `SELECT id FROM chats WHERE type = 'band' AND band_id = '${BAND}'`);
ok(r.rows.length === 1 && r.rows[0].id === BANDCHAT, `round 4: back in the band, an old build's lookup finds the same band chat, no second one (${r.rows.length})`);
r = await as(RET, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${BANDCHAT}','${RET}') ON CONFLICT (chat_id, user_id) DO NOTHING`);
const backRow = (await db.query(`SELECT cleared_at, last_read_at, muted FROM chat_participants WHERE chat_id = '${BANDCHAT}' AND user_id = '${RET}'`)).rows[0];
ok(!r.error && backRow && backRow.cleared_at?.toISOString() === '2026-11-01T10:00:00.000Z' && backRow.last_read_at?.toISOString() === '2026-11-02T10:00:00.000Z' && backRow.muted === true,
  `back in the band: cleared_at, last read and mute come back (${r.error ?? JSON.stringify(backRow)})`);

// ── R4. Round 4 (Codex + Claude on 7eea78bb / 44cf49fc)
const [QADMIN, MIXD, TRAIL] = [47, 48, 49].map(id);
const [GIGQ, GIGD, GIGN] = [37, 38, 39].map(id);
const [SETQ, EVCHATN] = [id(50), id(27)];
await db.exec(`INSERT INTO auth.users VALUES ('${QADMIN}','qadmin@example.invalid'), ('${MIXD}','mixd@example.invalid'), ('${TRAIL}','trail@example.invalid');
  INSERT INTO profiles (id, email) VALUES ('${QADMIN}','qadmin@example.invalid'), ('${MIXD}','mixd@example.invalid'), ('${TRAIL}','trail@example.invalid');
  INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${QADMIN}','admin'), ('${BAND}','${MIXD}','member'), ('${BAND}','${TRAIL}','member');
  INSERT INTO setlists VALUES ('${SETQ}','${BAND}','Wedding set');
  INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, venue_name, setlist_id) VALUES
    ('${GIGQ}','${BAND}','Private wedding (quote)','tentative','gig','${ADMIN}', current_date + 50, 'Montclair', '${SETQ}'),
    ('${GIGD}','${BAND}','Street fair','confirmed','gig','${RET}', current_date + 60, 'Astoria', NULL),
    ('${GIGN}','${BAND}','Jazz brunch','confirmed','gig','${ADMIN}', current_date + 70, 'Hoboken', NULL);
  INSERT INTO event_members VALUES ('${GIG3}','${MIXD}','Declined'), ('${GIG3}','${TRAIL}','Dropped_Out '), ('${GIGD}','${DECL}','declined'), ('${GIGD}','${DROP}','dropped_out'),
    ('${GIGN}','${NEWM}','confirmed'), ('${GIGN}','${RET}','confirmed');
  DELETE FROM notifications;`);
// BLOCKER 175:657: a setlist on a private quote with no lineup tells its admins only.
r = await as(ADMIN, `SELECT public.bw_notify_setlist_saved('${SETQ}', '${GIGQ}', 0, 2, 0, false) AS n`);
const toldQ = (await db.query(`SELECT user_id FROM notifications WHERE type = 'setlist_updated'`)).rows.map((x) => x.user_id);
ok(!r.error && toldQ.includes(QADMIN) && ![NEWM, RET, MIXD, DECL].some((u) => toldQ.includes(u)),
  `setlist on a quote with no lineup: admins only, members get nothing (${r.error ?? JSON.stringify(toldQ.length)})`);
// MINOR 175:550: a lineup that all said no is still a lineup: admins and creator.
await db.exec(`DELETE FROM notifications; BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN}"}', true);
  UPDATE events SET event_date = event_date + 1 WHERE id = '${GIGD}'; COMMIT;`);
const toldD = (await db.query(`SELECT user_id FROM notifications WHERE type = 'event_update'`)).rows.map((x) => x.user_id);
ok(toldD.includes(QADMIN) && toldD.includes(RET) && ![NEWM, DECL, DROP, MIXD].some((u) => toldD.includes(u)),
  `all-declined lineup: its admins and creator, not the band nor the decliners (${JSON.stringify(toldD.length)})`);
// MINOR lower(): 'Declined' is declined, in the chat rule and the notices.
await staleRow(EVCHAT3, MIXD);
// (With 193, chats_select_joinable goes through 178's bw_is_event_participant,
// which still compares the status raw: reported to #294.)
const raw178 = process.env.M193 && process.env.M178 && !/lower\(coalesce\(em\.status/.test(fnDef(process.env.M178, 'bw_is_event_participant'));
await staleChecks(MIXD, "'Declined' (mixed case)", [EVCHAT3], raw178 ? { knownChatRow: "178's bw_is_event_participant compares em.status raw (#294)" } : {});
// #294 (main): 'Dropped_Out ' with a trailing space is dropped out too (lower(btrim())).
await staleRow(EVCHAT3, TRAIL);
const untrimmed178 = process.env.M193 && process.env.M178 && !/lower\(btrim\(coalesce\(em\.status/.test(fnDef(process.env.M178, 'bw_is_event_participant'));
await staleChecks(TRAIL, "'Dropped_Out ' (trailing space)", [EVCHAT3], untrimmed178 ? { knownChatRow: "178's bw_is_event_participant doesn't btrim em.status (#294)" } : {});
await db.exec(`DELETE FROM notifications; BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN}"}', true);
  UPDATE events SET event_date = event_date + 1 WHERE id = '${GIG3}'; COMMIT;`);
const told3 = (await db.query(`SELECT user_id FROM notifications WHERE type = 'event_update'`)).rows.map((x) => x.user_id);
ok(told3.includes(NEWM) && !told3.includes(MIXD), `'Declined' on the lineup is not told about the gig (${told3.length})`);
ok(!told3.includes(TRAIL), `'Dropped_Out ' on the lineup is not told about the gig either (${told3.length})`);
// MINOR 175:199/253: about someone else only for a caller the rule lets in.
r = await as(NEWM, `SELECT public.bw_chat_scope_ok('band', '${OTHERBAND}', NULL, '${ADMIN}') AS a,
  public.bw_chat_scope_ok_for('${BANDCHAT}', '${ADMIN}') AS b, public.bw_chat_scope_ok_for('${BANDCHAT}', '${NEWM}') AS c`);
ok(r.rows[0]?.a === false && r.rows[0]?.b === true && r.rows[0]?.c === true,
  `scope check: a member can't ask about another band's chat, can about their own (${r.error ?? JSON.stringify(r.rows[0])})`);
r = await as(EXM, `SELECT public.bw_chat_scope_ok_for('${BANDCHAT}', '${NEWM}') AS a, public.bw_chat_scope_ok_for('${EVCHAT3}', '${NEWM}') AS b`);
ok(r.rows[0]?.a === false && r.rows[0]?.b === false, `scope check: an outsider gets false about a member (${r.error ?? JSON.stringify(r.rows[0])})`);
// Internal callers still answer about others: the roster, a non-admin
// musician opening a gig chat with the lineup, push (no auth.uid()).
r = await as(NEWM, `SELECT public.get_user_chats('${NEWM}') AS j`);
const rosterB = ((r.rows[0]?.j ?? []).find((c) => c.id === EVCHAT3)?.participants ?? []).map((p) => p.user_id);
ok(rosterB.includes(ADMIN) && rosterB.includes(NEWM), `get_user_chats roster still lists the other members (${rosterB.length})`);
await as(NEWM, `INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${EVCHATN}','event','Jazz brunch','${BAND}','${GIGN}','${NEWM}')`);
r = await as(NEWM, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHATN}','${NEWM}'),('${EVCHATN}','${RET}')`);
inChat = (await db.query(`SELECT user_id FROM chat_participants WHERE chat_id = '${EVCHATN}'`)).rows.map((x) => x.user_id);
ok(!r.error && inChat.includes(NEWM) && inChat.includes(RET), `a booked musician (not an admin) adds the lineup to the gig chat (${r.error ?? inChat.length})`);
r = await db.query(`SELECT public.bw_chat_recipient_ids('${EVCHATN}', '${NEWM}') AS ids`);
ok((r.rows[0].ids ?? []).includes(RET), 'push (server, no user) still gets the recipients');
// BLOCKER 175:474 (a): kept rows don't share a chat, can't wipe history.
await db.exec(`INSERT INTO messages (chat_id, sender_id, content) VALUES ('${BANDCHAT}','${staleUsers.LEFT}','old message from left')`);
r = await as(staleUsers.LEFT, `SELECT public.bw_delete_chat_history('${BANDCHAT}') AS n`);
const leftMsgs = (await db.query(`SELECT count(*)::int AS n FROM messages WHERE chat_id = '${BANDCHAT}' AND sender_id = '${staleUsers.LEFT}'`)).rows[0].n;
ok(!!r.error && leftMsgs === 1, `a kept row that the rule refuses can't "delete chat" (${r.error ? 'refused' : 'ran'}, ${leftMsgs} left)`);
r = await as(staleUsers.LEFT, `SELECT public.bw_shares_chat('${NEWM}') AS a`);
ok(r.rows[0]?.a === false, `a kept row no longer "shares a chat" with the band (${r.error ?? r.rows[0]?.a})`);
r = await as(NEWM, `SELECT public.bw_shares_chat('${ADMIN}') AS a`);
ok(r.rows[0]?.a === true, `members still share the band chat (${r.error ?? r.rows[0]?.a})`);
r = await as(NEWM, `SELECT user_id FROM chat_participants WHERE chat_id = '${EVCHAT3}'`);
ok(r.rows.length > 0 && ![staleUsers.LEFT, staleUsers.DEACT, DEMOTED, DECL, DROP, REMOVED, MIXD].some((u) => r.rows.some((x) => x.user_id === u)),
  `roster (chat_participants policy) leaves out kept rows the rule refuses (${r.rows.length})`);
// A kept row is not even listed to its owner (app chat lists, unread counts, badges).
r = await as(staleUsers.LEFT, `SELECT chat_id FROM chat_participants WHERE user_id = '${staleUsers.LEFT}'`);
ok(!r.error && ![BANDCHAT, EVCHAT3].some((c) => r.rows.some((x) => x.chat_id === c)), `a kept row is hidden from its owner too (${r.error ?? r.rows.length})`);
r = await as(NEWM, `SELECT chat_id FROM chat_participants WHERE user_id = '${NEWM}'`);
ok(r.rows.some((x) => x.chat_id === EVCHAT3), `an active member still lists their own rows (${r.rows.length})`);
// BLOCKER (b): the app's fallback asks before creating a band / gig chat.
r = await as(NEWM, `SELECT public.bw_group_chat_exists('band', '${BAND}', NULL) AS a, public.bw_group_chat_exists('event', NULL, '${GIG3}') AS b,
  public.bw_group_chat_exists('event', NULL, '${GIGQ}') AS c`);
ok(!r.error && r.rows[0]?.a === true && r.rows[0]?.b === true && r.rows[0]?.c === false,
  `bw_group_chat_exists: the band chat and a gig chat exist, a gig without chat not (${r.error ?? JSON.stringify(r.rows[0])})`);
r = await as(EXM, `SELECT public.bw_group_chat_exists('band', '${BAND}', NULL) AS a`);
ok(!r.error && r.rows[0]?.a === false, `bw_group_chat_exists: nothing for someone outside the band (${r.error ?? r.rows[0]?.a})`);
// ── R4b. Central guard (main, after 11229d9c): kept rows are hidden by one
// RESTRICTIVE policy, whatever permissive read policy an old build hits.
const cpPolicies = async () => (await db.query(`SELECT policyname, cmd, permissive, roles::text AS roles, qual
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'chat_participants' ORDER BY policyname`)).rows;
let pols = await cpPolicies();
const polNames = pols.map((x) => `${x.policyname}:${x.cmd}:${x.permissive}`).sort();
const wantPols = ['Users can delete own chat participation:DELETE:PERMISSIVE', 'Users can update own chat participation:UPDATE:PERMISSIVE',
  'chat_participants_delete_guard:DELETE:RESTRICTIVE', 'chat_participants_update_guard:UPDATE:RESTRICTIVE',
  'chat_participants_insert:INSERT:PERMISSIVE', 'chat_participants_scope_guard:SELECT:RESTRICTIVE',
  'chat_participants_select_own:SELECT:PERMISSIVE', 'chat_participants_select_same_chat:SELECT:PERMISSIVE'].sort();
ok(JSON.stringify(polNames) === JSON.stringify(wantPols), `chat_participants policies after 175: ${polNames.join(', ')}`);
ok(pols.filter((x) => x.cmd === 'SELECT').every((x) => x.roles === '{authenticated}' || /^\(user_id = auth\.uid\(\)\)$/.test(x.qual)),
  'every read policy on chat_participants is for authenticated (where the guard applies the rule), or own rows only (nothing without a user)');
// Cost: bw_my_chat_ids() checks the rule per chat now, so policies call it
// once per query (InitPlan), never per row.
const perRow = (await db.query(`SELECT tablename || '.' || policyname AS p FROM pg_policies WHERE schemaname = 'public'
  AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'bw_my_chat_ids\\(\\)'
  AND (coalesce(qual, '') || coalesce(with_check, '')) !~ '\\(\\s*SELECT\\s+bw_my_chat_ids\\(\\)'`)).rows.map((x) => x.p);
ok(perRow.length === 0, `no policy calls bw_my_chat_ids() once per row (${perRow.join(', ') || 'none'})`);
r = (await db.query(`SELECT proname, prosecdef FROM pg_proc WHERE proname IN ('bw_chat_row_ok','bw_chat_rule_ungated','bw_chat_scope_ok','bw_my_chat_ids') AND pronamespace = 'public'::regnamespace`)).rows;
ok(r.length === 4 && r.every((x) => x.prosecdef), `the guard's functions are SECURITY DEFINER: no RLS inside, no recursion (${JSON.stringify(r)})`);
// Any other permissive read policy (hand-made on prod, a later migration) is ANDed with the guard.
await db.exec(`CREATE POLICY zz_handmade_read_all ON public.chat_participants FOR SELECT USING (true)`);
r = await as(staleUsers.LEFT, `SELECT chat_id FROM chat_participants WHERE user_id = '${staleUsers.LEFT}'`);
ok(!r.error && r.rows.length === 0, `with another permissive read policy, a kept row stays hidden from its owner (${r.error ?? r.rows.length})`);
r = await as(NEWM, `SELECT count(*)::int AS n, count(*) FILTER (WHERE user_id IN ('${staleUsers.LEFT}','${staleUsers.DEACT}'))::int AS gone
  FROM chat_participants WHERE chat_id IN ('${BANDCHAT}','${EVCHAT3}')`);
ok(!r.error && r.rows[0].n > 0 && r.rows[0].gone === 0, `... and from the band's roster and counts (${r.error ?? JSON.stringify(r.rows[0])})`);
await db.exec(`DROP POLICY zz_handmade_read_all ON public.chat_participants`);
// Old builds (383f15b) with their own row hidden: every path ends without an
// error UI it can't show, and without a second row or chat.
const keptRow = async (c, u) => (await db.query(`SELECT count(*)::int AS n, max(cleared_at) AS c, max(last_read_at) AS r
  FROM chat_participants WHERE chat_id = '${c}' AND user_id = '${u}'`)).rows[0];
const k0 = await keptRow(BANDCHAT, staleUsers.LEFT);
// createChat / sendMessage "ensure I'm in it" and "delete chat" (upsert, DO UPDATE).
r = await as(staleUsers.LEFT, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${BANDCHAT}','${staleUsers.LEFT}')
  ON CONFLICT (chat_id, user_id) DO UPDATE SET chat_id = excluded.chat_id, user_id = excluded.user_id`);
const r2 = await as(staleUsers.LEFT, `INSERT INTO chat_participants (chat_id, user_id, cleared_at) VALUES ('${BANDCHAT}','${staleUsers.LEFT}', now())
  ON CONFLICT (chat_id, user_id) DO UPDATE SET cleared_at = excluded.cleared_at`);
let k1 = await keptRow(BANDCHAT, staleUsers.LEFT);
ok(!r.error && !r2.error && k1.n === 1 && String(k1.c) === String(k0.c), `old build upserts its hidden row: no error, no second row, nothing changed (${r.error ?? r2.error ?? JSON.stringify(k1)})`);
// markChatAsRead fallback (direct update) and leaving (delete): no row matches.
r = await as(staleUsers.LEFT, `UPDATE chat_participants SET last_read_at = now() WHERE chat_id = '${BANDCHAT}' AND user_id = '${staleUsers.LEFT}'`);
const r3 = await as(staleUsers.LEFT, `DELETE FROM chat_participants WHERE chat_id = '${BANDCHAT}' AND user_id = '${staleUsers.LEFT}'`);
k1 = await keptRow(BANDCHAT, staleUsers.LEFT);
ok(!r.error && !r3.error && r.n === 0 && r3.n === 0 && k1.n === 1 && String(k1.r) === String(k0.r),
  `old build updates or deletes its hidden row: 0 rows, the kept row stays as it was (${r.error ?? r3.error ?? JSON.stringify(k1)})`);
// sendMessage "restore missing participants" (whole lineup, ignoreDuplicates) by a booked musician.
r = await as(NEWM, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHAT5}','${DROP}'), ('${EVCHAT5}','${REMOVED}'), ('${EVCHAT5}','${NEWM}')
  ON CONFLICT (chat_id, user_id) DO NOTHING`);
const dupes = (await db.query(`SELECT count(*)::int AS n FROM chat_participants WHERE chat_id = '${EVCHAT5}' GROUP BY user_id HAVING count(*) > 1`)).rows.length;
const r4 = await as(NEWM, `SELECT user_id FROM chat_participants WHERE chat_id = '${EVCHAT5}'`);
ok(!r.error && dupes === 0 && !r4.rows.some((x) => [DROP, REMOVED].includes(x.user_id)), `old build restores the lineup: no error, no duplicate, kept rows still hidden (${r.error ?? r4.rows.length})`);
// getChats / getMessages (own rows, cleared_at): the chat isn't listed.
r = await as(DROP, `SELECT chat_id FROM chat_participants WHERE user_id = '${DROP}'`);
ok(!r.error && !r.rows.some((x) => x.chat_id === EVCHAT5), `dropped out: the gig chat isn't in their own rows (${r.error ?? r.rows.length})`);

// ── R5. Round 5 (Claude on cc542575 / 657b943d)
const priv = async (role, fn) => db.query(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') AS p`).then((x) => x.rows[0].p, () => null);
const fnDefOf = async (sig) => db.query(`SELECT pg_get_functiondef('${sig}'::regprocedure) AS d`).then((x) => x.rows[0].d, () => '');
// 1. bw_shares_chat: anon had EXECUTE through PUBLIC; a caller could ask about two other people.
for (const role of ['public', 'anon']) ok(await priv(role, 'public.bw_shares_chat(uuid,uuid)') === false, `bw_shares_chat: ${role} has no EXECUTE`);
ok(await priv('authenticated', 'public.bw_shares_chat(uuid,uuid)') === true, 'bw_shares_chat: authenticated keeps EXECUTE (profiles policy, bw_can_notify)');
for (const role of ['public', 'anon']) ok(await priv(role, 'public.bw_can_add_chat_participant(uuid,uuid)') === false, `bw_can_add_chat_participant: ${role} has no EXECUTE`);
ok(await priv('authenticated', 'public.bw_can_add_chat_participant(uuid,uuid)') === true, 'bw_can_add_chat_participant: authenticated keeps EXECUTE (insert policy)');
for (const role of ['public', 'anon', 'authenticated']) ok(await priv(role, 'public.bw_chats_immutable_keys()') === false, `bw_chats_immutable_keys (trigger): no EXECUTE for ${role}`);
r = await asRole('anon', `SELECT public.bw_shares_chat('${MEM2}', '${MEM}') AS a`);
ok(r.code === '42501', `bw_shares_chat: anon is refused (${r.code ?? 'ran'} ${r.error ?? JSON.stringify(r.rows[0])})`);
r = await as(EXM, `SELECT public.bw_shares_chat('${MEM2}', '${MEM}') AS a`);
ok(!r.error && r.rows[0]?.a === false, `bw_shares_chat: a stranger can't ask whether two others share a direct chat (${r.error ?? r.rows[0]?.a})`);
r = await as(MEM, `SELECT public.bw_shares_chat('${MEM2}') AS a`);
ok(!r.error && r.rows[0]?.a === true, `bw_shares_chat: asked about themselves it still answers (${r.error ?? r.rows[0]?.a})`);
r = await db.query(`SELECT public.bw_shares_chat('${MEM2}', '${MEM}') AS a`);
ok(r.rows[0].a === true, 'bw_shares_chat: the server (no user) still asks about anyone');
// 2. UPDATE / DELETE with no WHERE skip the read policies (and so the guard).
const CHATL = id(61);
await db.exec(`INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${CHATL}','group','Other band horns','${OTHERBAND}',NULL,'${staleUsers.LEFT}')`);
await staleRow(CHATL, staleUsers.LEFT);
const leftRows = async () => (await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE muted)::int AS m FROM chat_participants WHERE user_id = '${staleUsers.LEFT}'`)).rows[0];
const lr0 = await leftRows();
r = await as(staleUsers.LEFT, `UPDATE chat_participants SET muted = true`);
let lr1 = await leftRows();
ok(!r.error && lr1.m === lr0.m, `UPDATE with no WHERE: a kept row is not changed (${r.error ?? `${lr1.m} muted`})`);
r = await as(staleUsers.LEFT, `DELETE FROM chat_participants`);
lr1 = await leftRows();
ok(!r.error && lr1.n === lr0.n, `DELETE with no WHERE: a kept row is not removed (${r.error ?? `${lr0.n} -> ${lr1.n}`})`);
r = await as(staleUsers.LEFT, `UPDATE chats SET name = 'renamed by a former member'`);
const nameL = (await db.query(`SELECT name FROM chats WHERE id = '${CHATL}'`)).rows[0].name;
ok(!r.error && nameL === 'Other band horns', `a former member who created a band chat can't rename it (no WHERE) (${r.error ?? nameL})`);
r = await as(ADMIN, `UPDATE chats SET name = 'Horns (legacy, renamed)' WHERE id = '${GROUPB}'`);
ok(!r.error && r.n === 1, `the creator still renames a chat they can use (${r.error ?? r.n})`);
r = await as(NEWM, `UPDATE chat_participants SET muted = muted`);
const newmRows = (await db.query(`SELECT count(*)::int AS n FROM chat_participants WHERE user_id = '${NEWM}'`)).rows[0].n;
ok(!r.error && r.n > 0 && r.n <= newmRows, `an active member's own rows still update (no WHERE: ${r.error ?? r.n} of ${newmRows})`);
r = await as(NEWM, `INSERT INTO chat_participants (chat_id, user_id, cleared_at) VALUES ('${EVCHAT3}','${NEWM}', now())
  ON CONFLICT (chat_id, user_id) DO UPDATE SET cleared_at = excluded.cleared_at`);
ok(!r.error, `an active member's upsert (DO UPDATE) still works (${r.error ?? 'ok'})`);
// 3. The roster guard: own rows or rows of my chats, then the rule once per row.
pols = await cpPolicies();
const guardQ = pols.find((x) => x.policyname === 'chat_participants_scope_guard')?.qual ?? '';
ok(/bw_chat_row_ok\(chat_id, user_id\)/.test(guardQ) && /SELECT bw_my_chat_ids\(\)/.test(guardQ) && /user_id = auth\.uid\(\)/.test(guardQ)
  && !/bw_chat_scope_ok_for/.test(guardQ), `guard: (own row or my chats) and bw_chat_row_ok (${guardQ})`);
for (const [name, cmd] of [['chat_participants_update_guard', 'UPDATE'], ['chat_participants_delete_guard', 'DELETE']]) {
  const g = pols.find((x) => x.policyname === name);
  ok(g && g.cmd === cmd && g.permissive === 'RESTRICTIVE' && g.qual === guardQ, `${name}: RESTRICTIVE ${cmd} with the read guard's rule`);
}
const ownQ = pols.find((x) => x.policyname === 'chat_participants_select_own')?.qual;
ok(ownQ === '(user_id = auth.uid())', `select_own no longer repeats the rule (${ownQ})`);
for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
  ok(await priv(role, 'public.bw_chat_rule_ungated(text,uuid,uuid,uuid)') === false, `bw_chat_rule_ungated: exists, no EXECUTE for ${role}`);
}
r = await as(NEWM, `SELECT public.bw_chat_rule_ungated('band', '${BAND}', NULL, '${ADMIN}') AS a`);
ok(/permission denied/.test(r.error ?? ''), `bw_chat_rule_ungated: a user can't call it (${r.error ?? 'ran'})`);
const caseOf = (d, re) => (d.match(re) ?? [])[1];
const defUng = await fnDefOf('public.bw_chat_rule_ungated(text,uuid,uuid,uuid)');
const defScope = await fnDefOf('public.bw_chat_scope_ok(text,uuid,uuid,uuid)');
const cS = caseOf(defScope, /NOT coalesce\((CASE[\s\S]*END), false\)\);/);
ok(!!cS && caseOf(defUng, /SELECT (CASE[\s\S]*END) FROM \(VALUES/) === cS, 'bw_chat_rule_ungated has the very rule of bw_chat_scope_ok');
r = await as(NEWM, `SELECT public.bw_chat_row_ok('${GROUPB}', '${ADMIN}') AS a, public.bw_chat_row_ok('${GROUPB}', '${EXM}') AS b,
  public.bw_chat_row_ok('${GROUPB}', '${NEWM}') AS c`);
ok(!r.error && r.rows[0].a === true && r.rows[0].b === false && r.rows[0].c === true, `bw_chat_row_ok: a member gets the rule per row (${r.error ?? JSON.stringify(r.rows[0])})`);
r = await as(staleUsers.LEFT, `SELECT public.bw_chat_row_ok('${BANDCHAT}', '${NEWM}') AS a, public.bw_chat_row_ok('${EVCHAT3}', '${NEWM}') AS b`);
ok(!r.error && r.rows[0].a === false && r.rows[0].b === false, `bw_chat_row_ok: a kept row can't ask about the others (${r.error ?? JSON.stringify(r.rows[0])})`);
r = await as(EXM, `SELECT public.bw_chat_row_ok('${BANDCHAT}', '${NEWM}') AS a`);
ok(!r.error && r.rows[0].a === false, `bw_chat_row_ok: an outsider gets false (${r.error ?? r.rows[0].a})`);
ok(await priv('anon', 'public.bw_chat_row_ok(uuid,uuid)') === false, 'bw_chat_row_ok: anon has no EXECUTE');
// 4. messages: a RESTRICTIVE read guard as well.
const msgG = (await db.query(`SELECT permissive, cmd, roles::text AS roles, qual FROM pg_policies WHERE tablename = 'messages' AND policyname = 'messages_scope_guard'`)).rows[0];
ok(msgG?.permissive === 'RESTRICTIVE' && msgG?.cmd === 'SELECT' && msgG?.roles === '{authenticated}' && /SELECT bw_my_chat_ids\(\)/.test(msgG?.qual ?? ''),
  `messages_scope_guard: RESTRICTIVE SELECT for authenticated, once per query (${JSON.stringify(msgG)})`);
await db.exec(`CREATE POLICY zz_handmade_msgs_all ON public.messages FOR SELECT USING (true)`);
r = await as(staleUsers.LEFT, `SELECT count(*)::int AS n FROM messages WHERE chat_id IN ('${BANDCHAT}','${EVCHAT3}')`);
ok(!r.error && r.rows[0].n === 0, `with another permissive read policy on messages, a kept row still reads nothing (${r.error ?? r.rows[0].n})`);
r = await as(NEWM, `SELECT count(*)::int AS n FROM messages WHERE chat_id = '${GROUPB}'`);
ok(!r.error && r.rows[0].n > 0, `... and members still read their chat (${r.error ?? r.rows[0].n})`);
await db.exec(`DROP POLICY zz_handmade_msgs_all ON public.messages`);
// Round 5b (Claude r5): an unfiltered DELETE on messages, as a former member.
const leftMsgsN = async () => (await db.query(`SELECT count(*)::int AS n FROM messages WHERE sender_id = '${staleUsers.LEFT}'`)).rows[0].n;
const lm0 = await leftMsgsN();
r = await as(staleUsers.LEFT, `DELETE FROM messages`);
ok(!r.error && lm0 > 0 && r.n === 0 && (await leftMsgsN()) === lm0, `DELETE on messages with no WHERE: a former member deletes none of their old band / gig messages (${r.error ?? `${r.n} deleted, ${lm0} kept`})`);
await db.exec(`INSERT INTO messages (chat_id, sender_id, content) VALUES ('${GROUPB}','${NEWM}','typo, deleting')`);
r = await as(NEWM, `DELETE FROM messages WHERE sender_id = '${NEWM}' AND content = 'typo, deleting'`);
ok(!r.error && r.n === 1, `a member still deletes their own message in a chat they use (${r.error ?? r.n})`);
const mg2 = (await db.query(`SELECT permissive, cmd, roles::text AS roles, qual FROM pg_policies WHERE tablename = 'messages' AND policyname = 'messages_delete_guard'`)).rows[0];
ok(mg2?.permissive === 'RESTRICTIVE' && mg2?.cmd === 'DELETE' && mg2?.roles === '{authenticated}' && /SELECT bw_my_chat_ids\(\)/.test(mg2?.qual ?? ''),
  `messages_delete_guard: RESTRICTIVE DELETE for authenticated, my chats once per query (${JSON.stringify(mg2)})`);
// A server purge (SECURITY DEFINER, as 180's account deletion) runs as the owner: no RLS, still deletes.
await db.exec(`CREATE OR REPLACE FUNCTION public.zz_purge_dm_messages(p_uid uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
  DECLARE n integer; BEGIN
    DELETE FROM messages m WHERE m.sender_id = p_uid AND EXISTS (SELECT 1 FROM chats c WHERE c.id = m.chat_id AND c.type::text = 'direct');
    GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $f$;
  GRANT EXECUTE ON FUNCTION public.zz_purge_dm_messages(uuid) TO service_role;`);
const dmBefore = (await db.query(`SELECT count(*)::int AS n FROM messages m JOIN chats c ON c.id = m.chat_id WHERE c.type::text = 'direct' AND m.sender_id = '${MEM2}'`)).rows[0].n;
r = await asRole('service_role', `SELECT public.zz_purge_dm_messages('${MEM2}') AS n`);
ok(!r.error && dmBefore > 0 && r.rows[0]?.n === dmBefore, `a definer purge of a user's direct messages still deletes them (${r.error ?? `${r.rows[0]?.n} of ${dmBefore}`})`);
await db.exec(`DROP FUNCTION public.zz_purge_dm_messages(uuid)`);
// And the real one: a member's "Delete chat" in a two-person direct chat
// (bw_delete_chat_history, SECURITY DEFINER) still wipes it under the guard.
const DM2 = id(88);
await db.exec(`INSERT INTO chats (id, type, name, created_by) VALUES ('${DM2}','direct',NULL,'${NEWM}');
  INSERT INTO chat_participants (chat_id, user_id) VALUES ('${DM2}','${NEWM}'),('${DM2}','${ADMIN}');
  INSERT INTO messages (chat_id, sender_id, content) VALUES ('${DM2}','${NEWM}','dm to admin'),('${DM2}','${ADMIN}','dm back');`);
r = await as(NEWM, `SELECT public.bw_delete_chat_history('${DM2}') AS n`);
const dm2Left = (await db.query(`SELECT count(*)::int AS n FROM messages WHERE chat_id = '${DM2}'`)).rows[0].n;
ok(!r.error && r.rows[0]?.n > 0 && dm2Left === 0, `bw_delete_chat_history on a two-person direct chat, as a member: deletes both sides (${r.error ?? `${r.rows[0]?.n} deleted, ${dm2Left} left`})`);
// 5. One set-based recipients call (send-push), server only.
const srv = (sql) => db.query(sql).catch((e) => ({ rows: [{}], error: e.message }));
r = await srv(`SELECT public.bw_chat_recipients_shared('${ADMIN}', ARRAY['${NEWM}','${staleUsers.LEFT}','${EXM}','${ADMIN}']::uuid[]) AS ids`);
const shared = r.rows[0].ids ?? [];
ok(shared.includes(NEWM) && ![staleUsers.LEFT, EXM, ADMIN].some((u) => shared.includes(u)), `bw_chat_recipients_shared: chat mates the rule lets in, not kept rows or self (${JSON.stringify(shared.length)})`);
r = await srv(`SELECT public.bw_chat_recipients_shared('${staleUsers.LEFT}', ARRAY['${NEWM}','${ADMIN}']::uuid[]) AS ids`);
ok(!r.error && (r.rows[0].ids ?? []).length === 0, `bw_chat_recipients_shared: a sender with only kept rows reaches nobody (${r.error ?? 'ok'})`);
for (const role of ['public', 'anon', 'authenticated']) ok(await priv(role, 'public.bw_chat_recipients_shared(uuid,uuid[])') === false, `bw_chat_recipients_shared: no EXECUTE for ${role}`);
ok(await priv('service_role', 'public.bw_chat_recipients_shared(uuid,uuid[])') === true, 'bw_chat_recipients_shared: service_role has EXECUTE');
// 5b. Chat keys: the server (service role) may change them (193's hand merge), nobody else.
const CHATK = id(62);
await db.exec(`INSERT INTO chats (id, type, name, created_by) VALUES ('${CHATK}','direct',NULL,'${ADMIN}')`);
let kx;
try { await db.exec(`UPDATE chats SET created_at = created_at - interval '1 day' WHERE id = '${CHATK}'`); kx = null; } catch (e) { kx = e.message; }
ok(/cannot change/.test(kx ?? ''), `chat keys: still refused outside the service role (${kx ?? 'changed'})`);
r = await asRole('service_role', `UPDATE chats SET created_at = created_at - interval '1 day' WHERE id = '${CHATK}'`);
ok(!r.error, `chat keys: the service role may change them, no DISABLE TRIGGER (${r.error ?? 'ok'})`);

// Marker for later migrations that keep a live definition (178, 181).
const defR4 = (await db.query(`SELECT pg_get_functiondef('public.bw_chat_scope_ok(text,uuid,uuid,uuid)'::regprocedure) AS d`)).rows[0].d;
ok(defR4.includes('-- bw:175-r4'), 'bw_chat_scope_ok carries the marker bw:175-r4');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
