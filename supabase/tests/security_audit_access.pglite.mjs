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
  last_read_at timestamptz, muted boolean DEFAULT false, joined_at timestamptz DEFAULT now(), UNIQUE (chat_id, user_id));
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
CREATE POLICY chats_insert ON public.chats FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()) AND ((band_id IS NULL) OR bw_is_band_member(band_id)));
CREATE POLICY chats_select_creator ON public.chats FOR SELECT TO authenticated USING (created_by = auth.uid());
CREATE POLICY chats_select_participant ON public.chats FOR SELECT USING (id IN (SELECT chat_participants.chat_id FROM chat_participants WHERE chat_participants.user_id = auth.uid()));
CREATE POLICY chats_upd ON public.chats FOR UPDATE TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());
CREATE POLICY messages_insert_participant ON public.messages FOR INSERT TO authenticated WITH CHECK ((sender_id = auth.uid()) AND (chat_id = ANY (bw_my_chat_ids())));
CREATE POLICY messages_select_participant ON public.messages FOR SELECT TO authenticated USING (chat_id = ANY (bw_my_chat_ids()));
CREATE POLICY messages_delete_own ON public.messages FOR DELETE TO authenticated USING (sender_id = auth.uid());
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

await db.exec(readFileSync(MIG, 'utf8'));
await db.exec(readFileSync(MIG, 'utf8')); // idempotent
ok(true, 'migration runs twice');

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
r = await db.query(`SELECT count(*)::int AS n FROM chat_participants WHERE user_id = '${OUT}'`);
ok(r.rows[0].n === 0, 'stale band chat row of a former member removed');
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
r = await as(MEM, `SELECT user_id FROM chat_participants WHERE chat_id = '${BANDCHAT}'`);
ok(r.rows.length === 0, 'removed member no longer listed in the band chat');
r = await as(MEM, `SELECT content FROM messages WHERE chat_id = '${GROUP}'`);
ok(r.rows.length > 0, 'a group chat outside the band is not touched');
r = await as(LINE, `SELECT content FROM messages WHERE chat_id = '${BANDCHAT}'`);
ok(r.rows.length === 2, `active member still reads the band chat (${r.rows.length})`);
r = await db.query(`SELECT public.bw_chat_recipient_ids('${BANDCHAT}', '${ADMIN}') AS ids`).catch((e) => ({ rows: [{ ids: null, e }] }));
const ids = r.rows[0].ids ?? [];
ok(ids.includes(LINE) && !ids.includes(MEM) && !ids.includes(MEM2) && !ids.includes(ADMIN), `push recipients: active members only (${JSON.stringify(ids)})`);
r = await db.query(`SELECT public.bw_chat_recipient_ids('${BANDCHAT}', '${MEM}') AS ids`).catch(() => ({ rows: [{ ids: ['x'] }] }));
ok((r.rows[0].ids ?? []).length === 0, 'a removed member cannot push to the band chat');
// Re-joining works through the normal insert path.
await db.exec(`INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${MEM}','member')`);
r = await as(MEM, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${BANDCHAT}','${MEM}')`);
ok(!r.error, `re-joined member can join the band chat again (${r.error ?? 'ok'})`);
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
// Re-running 175 after a stricter rule went live (181 / 178) keeps it.
await db.exec(`CREATE OR REPLACE FUNCTION public.bw_chat_scope_ok(p_type text, p_band_id uuid, p_event_id uuid, p_user_id uuid)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT CASE WHEN p_type = 'event' THEN public.bw_is_event_participant(p_event_id, p_user_id) ELSE true END $f$`);
await db.exec(readFileSync(MIG, 'utf8'));
const def = (await db.query(`SELECT pg_get_functiondef('public.bw_chat_scope_ok(text,uuid,uuid,uuid)'::regprocedure) AS d`)).rows[0].d;
ok(def.includes('bw_is_event_participant'), 're-running 175 keeps a stricter bw_chat_scope_ok already live');

// ── 9. With 193 (#291: one chat per band / gig, bw_open_group_chat), when
// M193=<path to 193_one_chat_per_gig.sql> is set. A member who left has no
// participant row any more; back in the band, the app must find the same
// band chat, not make a second one (Codex #281 r2, 175:289).
if (process.env.M193) {
  await db.exec(readFileSync(process.env.M193, 'utf8'));
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

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
