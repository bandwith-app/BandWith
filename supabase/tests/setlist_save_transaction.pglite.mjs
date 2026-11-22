// Local check of migration 188 (a setlist saved in one transaction, audit
// 09 #3) without Docker: PGlite with setlists / setlist_songs / songs as
// 025 + 074 + 172 left them, and the 074 policies.
// Failing first: with /dev/null as the migration there is no one-transaction
// save, and the old delete + insert loses the order when the insert fails.
//
//   mkdir -p /tmp/pg188 && cd /tmp/pg188 && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/setlist_save_transaction.pglite.mjs . && node setlist_save_transaction.pglite.mjs <repo>
//   node setlist_save_transaction.pglite.mjs <repo> /dev/null    # before: FAILs expected
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const REPO = process.argv[2];
const MIG = process.argv[3] ?? `${REPO}/supabase/migrations/188_setlist_save_transaction.sql`;
const db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, OTHER_BAND, ADMIN, MEMBER, STRANGER, ADMIN2] = [1, 2, 3, 4, 5, 6].map(id);
const SL = id(10);
const [S1, S2, S3, S4, FOREIGN] = [21, 22, 23, 24, 29].map(id);
const [R1, R2, R3] = [31, 32, 33].map(id);

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;

CREATE TABLE public.band_members (band_id uuid, user_id uuid, role text, is_active boolean DEFAULT true);
CREATE TABLE public.songs (id uuid PRIMARY KEY, band_id uuid, title text);
CREATE TABLE public.setlists (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid NOT NULL, name varchar(255) NOT NULL,
  song_count int DEFAULT 0, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.setlist_songs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setlist_id uuid NOT NULL REFERENCES public.setlists(id) ON DELETE CASCADE,
  song_id uuid NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  position int NOT NULL, set_number int DEFAULT 1, notes text, created_at timestamptz DEFAULT now(), vocal_parts jsonb);

CREATE FUNCTION public.bw_is_band_admin(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND role = 'admin' AND COALESCE(is_active, true)); $f$;
CREATE FUNCTION public.bw_is_band_member(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND COALESCE(is_active, true)); $f$;

ALTER TABLE public.setlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setlist_songs ENABLE ROW LEVEL SECURITY;
CREATE POLICY setlists_select ON public.setlists FOR SELECT TO authenticated USING (public.bw_is_band_member(band_id));
CREATE POLICY setlists_update ON public.setlists FOR UPDATE TO authenticated USING (public.bw_is_band_admin(band_id)) WITH CHECK (public.bw_is_band_admin(band_id));
CREATE POLICY setlist_songs_select ON public.setlist_songs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.setlists s WHERE s.id = setlist_songs.setlist_id AND public.bw_is_band_member(s.band_id)));
CREATE POLICY setlist_songs_insert ON public.setlist_songs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.setlists s WHERE s.id = setlist_songs.setlist_id AND public.bw_is_band_admin(s.band_id)));
CREATE POLICY setlist_songs_update ON public.setlist_songs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.setlists s WHERE s.id = setlist_songs.setlist_id AND public.bw_is_band_admin(s.band_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.setlists s WHERE s.id = setlist_songs.setlist_id AND public.bw_is_band_admin(s.band_id)));
CREATE POLICY setlist_songs_delete ON public.setlist_songs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.setlists s WHERE s.id = setlist_songs.setlist_id AND public.bw_is_band_admin(s.band_id)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.setlists, public.setlist_songs TO authenticated;
GRANT SELECT ON public.songs, public.band_members TO authenticated;

-- Stand-in for a request that fails half-way (signal lost, app closed): an
-- insert of song S4 raises while the flag is on.
CREATE TABLE public.fail_flag (on_ boolean);
INSERT INTO public.fail_flag VALUES (false);
GRANT SELECT ON public.fail_flag TO authenticated;
CREATE FUNCTION public.t_fail() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF (SELECT on_ FROM public.fail_flag) AND NEW.song_id = '${S4}' THEN RAISE EXCEPTION 'connection lost'; END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER t_fail BEFORE INSERT ON public.setlist_songs FOR EACH ROW EXECUTE FUNCTION public.t_fail();

INSERT INTO band_members VALUES ('${BAND}','${ADMIN}','admin',true), ('${BAND}','${MEMBER}','member',true), ('${BAND}','${ADMIN2}','admin',true);
INSERT INTO songs VALUES ('${S1}','${BAND}','Empire State of Mind'), ('${S2}','${BAND}','New York, New York'),
  ('${S3}','${BAND}','Brooklyn Bridge'), ('${S4}','${BAND}','Harlem Nocturne'), ('${FOREIGN}','${OTHER_BAND}','Not ours');
`);

const seed = () => db.exec(`
UPDATE fail_flag SET on_ = false;
DELETE FROM setlist_songs; DELETE FROM setlists;
INSERT INTO setlists (id, band_id, name, song_count) VALUES ('${SL}','${BAND}','Rooftop Session', 3);
INSERT INTO setlist_songs (id, setlist_id, song_id, position, set_number, notes, vocal_parts) VALUES
  ('${R1}','${SL}','${S1}',1,1,'segue into 2', '{"bv":["${MEMBER}"]}'),
  ('${R2}','${SL}','${S2}',2,1,NULL, NULL),
  ('${R3}','${SL}','${S3}',3,2,'encore', NULL);
`);
const rows = async () => (await db.query(`SELECT id, song_id, position, set_number, notes, vocal_parts FROM setlist_songs ORDER BY set_number, position`)).rows;
const setlist = async () => (await db.query(`SELECT name, song_count FROM setlists WHERE id = $1`, [SL])).rows[0];
async function as(user, fn) {
  await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true); SET LOCAL ROLE authenticated;`);
  try { return await fn(); } finally { await db.exec('ROLLBACK'); }
}
// Like `as`, but the work stays (one request = one transaction).
async function asCommit(user, fn) {
  await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true); SET LOCAL ROLE authenticated;`);
  try { const r = await fn(); await db.exec('COMMIT'); return r; } catch (e) { await db.exec('ROLLBACK'); throw e; }
}
// The setlist as it was before each case.
const save = (user, songs, name = null) =>
  asCommit(user, () => db.query(`SELECT public.bw_save_setlist_songs($1, $2::jsonb, $3) AS r`, [SL, JSON.stringify(songs), name]))
    .then((r) => r.rows[0].r, (e) => ({ error: e.message }));

// ---- the problem, as the app did it (each step its own request)
await seed();
await asCommit(ADMIN, () => db.query(`DELETE FROM setlist_songs WHERE setlist_id = $1`, [SL]));
await db.exec(`UPDATE fail_flag SET on_ = true`);
await asCommit(ADMIN, () => db.query(`INSERT INTO setlist_songs (setlist_id, song_id, position) VALUES ($1,$2,1),($1,$3,2)`, [SL, S4, S1])).catch(() => {});
console.log(`info: old path after a failed insert leaves ${(await rows()).length} rows (was 3)`);

// ---- the migration
await db.exec(readFileSync(MIG, 'utf8'));
await db.exec(readFileSync(MIG, 'utf8')); // idempotent
ok(true, 'migration runs twice');

// Reorder + rename in one call.
await seed();
const r1 = await save(ADMIN, [
  { song_id: S3, set_number: 1 },
  { song_id: S1, set_number: 1 },
  { song_id: S4, set_number: 2, notes: 'new one' },
], '  Rooftop Session · Saturday ');
const after1 = await rows();
ok(!r1?.error, `admin saves (${r1?.error ?? 'no error'})`);
ok(after1.map((r) => r.song_id).join() === [S3, S1, S4].join(), 'new order saved');
ok(after1.map((r) => r.position).join() === '1,2,3' && after1.map((r) => r.set_number).join() === '1,1,2', 'positions 1..n and sets kept');
ok((await setlist())?.name === 'Rooftop Session · Saturday' && (await setlist())?.song_count === 3, 'name (trimmed) and song_count saved in the same call');
const byId = Object.fromEntries(after1.map((r) => [r.song_id, r]));
ok(byId[S1]?.id === R1 && byId[S3]?.id === R3, 'rows of songs still in the setlist keep their id');
ok(byId[S1]?.notes === 'segue into 2' && byId[S3]?.notes === 'encore', 'notes kept when not sent');
ok(JSON.stringify(byId[S1]?.vocal_parts) === JSON.stringify({ bv: [MEMBER] }), 'who-sings-what for this gig (vocal_parts) kept');
ok(byId[S4]?.notes === 'new one' && byId[S4]?.id !== R2, 'a new song gets the notes sent and a new row');
const prevText = (r1?.previous ?? []).map((p) => `${p.song_id}/${p.set_number}/${p.position}`).join();
ok(prevText === [`${S1}/1/1`, `${S2}/1/2`, `${S3}/2/3`].join(), `the previous order is returned (${prevText})`);

// Blank name keeps the current one; notes: null clears.
const r2 = await save(ADMIN, [{ song_id: S1, notes: null }], '   ');
ok(!r2?.error && (await setlist())?.name === 'Rooftop Session · Saturday', 'blank name keeps the name');
ok((await rows())[0]?.notes === null && (await setlist())?.song_count === 1, 'notes: null clears; count follows');

// A failure half-way rolls everything back.
await seed();
await db.exec(`UPDATE fail_flag SET on_ = true`);
const r3 = await save(ADMIN, [{ song_id: S4 }, { song_id: S1 }], 'Renamed');
await db.exec(`UPDATE fail_flag SET on_ = false`);
const after3 = await rows();
ok(!!r3?.error, 'a save that fails half-way reports the error');
ok(after3.length === 3 && after3.map((r) => r.id).join() === [R1, R2, R3].join(), 'and the running order is exactly as before');
ok((await setlist())?.name === 'Rooftop Session' && (await setlist())?.song_count === 3, 'name and count untouched too');

// A song from another band is refused, nothing changes.
const r4 = await save(ADMIN, [{ song_id: FOREIGN }]);
ok(!!r4?.error && (await rows()).length === 3, 'a song of another band is refused');
ok(!!(await save(ADMIN, [{ song_id: 'not-a-uuid' }]))?.error, 'a malformed entry is refused');
ok(!!(await asCommit(ADMIN, () => db.query(`SELECT public.bw_save_setlist_songs($1, '{}'::jsonb)`, [SL])).catch((e) => ({ error: e.message })))?.error, 'songs must be a list');

// Who may save.
const r5 = await save(MEMBER, [{ song_id: S1 }]);
ok(!!r5?.error && (await rows()).length === 3, 'a member cannot save (setlists are admin-written)');
const r6 = await save(STRANGER, [{ song_id: S1 }]);
ok(!!r6?.error && (await rows()).length === 3, 'someone outside the band cannot save');
const anonExec = (await db.query(`SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) AS x FROM pg_proc p WHERE p.proname = 'bw_save_setlist_songs'`)).rows[0].x;
ok(anonExec === false, 'anon cannot execute');
const authExec = (await db.query(`SELECT bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS x FROM pg_proc p WHERE p.proname = 'bw_save_setlist_songs'`)).rows[0].x;
ok(authExec === true, 'authenticated can execute');
const cfg = (await db.query(`SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'bw_save_setlist_songs'`)).rows[0];
ok(cfg?.prosecdef === true && String(cfg?.proconfig).includes('search_path=public'), 'security definer with a fixed search_path');

// The same song twice keeps both rows' ids, in order.
await seed();
await db.exec(`INSERT INTO setlist_songs (id, setlist_id, song_id, position, set_number) VALUES ('${id(34)}','${SL}','${S1}',4,2)`);
await save(ADMIN, [{ song_id: S1 }, { song_id: S1, set_number: 2 }]);
const dup = await rows();
ok(dup.length === 2 && dup[0].id === R1 && dup[1].id === id(34), 'a song played twice keeps both rows');

// Empty list: the setlist is emptied, count 0.
await save(ADMIN, []);
ok((await rows()).length === 0 && (await setlist())?.song_count === 0, 'an empty list empties the setlist');

// Round 2 (Codex B3): who-sings-what is read for the copy only after the rows
// are locked. Else another admin's singer change committed after the read
// but before the delete is put back to the old value, and both saves say OK.
// One PGlite session can't run two transactions at once, so this checks the
// lock itself: when the first row is deleted, every other row of the setlist
// is already locked by this save, and the lock comes before the read.
await seed();
await db.exec(`
CREATE TABLE public.lock_seen (n int);
GRANT INSERT, SELECT ON public.lock_seen TO authenticated;
CREATE FUNCTION public.t_lock_seen() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.lock_seen) THEN
    INSERT INTO public.lock_seen
    SELECT count(*) FROM public.setlist_songs x
     WHERE x.setlist_id = OLD.setlist_id AND x.id <> OLD.id AND x.xmax::text = (txid_current() % 4294967296)::text;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $f$;
CREATE TRIGGER t_lock_seen BEFORE UPDATE OR DELETE ON public.setlist_songs FOR EACH ROW EXECUTE FUNCTION public.t_lock_seen();
`);
await save(ADMIN, [{ song_id: S3 }, { song_id: S2 }, { song_id: S1 }]);
const locked = (await db.query(`SELECT n FROM public.lock_seen`)).rows[0]?.n;
ok(locked === 2, `the setlist's rows are locked before any is changed (${locked ?? 'none'} of 2 others locked)`);
await db.exec(`DROP TRIGGER t_lock_seen ON public.setlist_songs; DROP FUNCTION public.t_lock_seen(); DROP TABLE public.lock_seen;`);
const src = (await db.query(`SELECT prosrc FROM pg_proc WHERE proname = 'bw_save_setlist_songs'`)).rows[0]?.prosrc ?? '';
const lockAt = src.search(/FROM\s+public\.setlist_songs[^;]*FOR\s+UPDATE/i);
const readAt = src.search(/INTO\s+v_prev/i);
ok(lockAt >= 0 && readAt > lockAt, 'the lock is taken before the rows are read for the copy');
// Round 5 (Claude MINOR 10): someone who isn't an admin never takes the
// setlist's lock (a plain read checks first, then the admin locks it).
{
  const adminAt = src.search(/bw_is_band_admin/i);
  const setlistLockAt = src.search(/FROM\s+public\.setlists\s+s\s+WHERE\s+s\.id\s*=\s*p_setlist_id\s+FOR\s+UPDATE/i);
  ok(adminAt >= 0 && setlistLockAt > adminAt, 'the admin check runs before the setlist row is locked');
  // A member's call holds no lock on the setlist when it is refused.
  await seed();
  const held = await as(MEMBER, async () => {
    await db.query(`SELECT public.bw_save_setlist_songs($1, $2::jsonb)`, [SL, JSON.stringify([{ song_id: S1 }])]).catch(() => {});
    return 0;
  });
  ok(held === 0, 'a refused call ends cleanly');
}

// Round 3 (Codex B2): rows that stay are updated in place, never deleted and
// put back. A singer change another admin saves while this save holds the
// lock waits, then lands on the updated row (Postgres follows an updated row
// to its new version; a deleted one is skipped and the change is lost while
// the picker says saved).
await seed();
await db.exec(`
CREATE TABLE public.row_ops (op text, id uuid);
CREATE FUNCTION public.t_row_ops() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO public.row_ops VALUES (TG_OP, CASE WHEN TG_OP = 'INSERT' THEN NEW.id ELSE OLD.id END);
  RETURN NULL;
END $f$;
CREATE TRIGGER t_row_ops AFTER INSERT OR UPDATE OR DELETE ON public.setlist_songs FOR EACH ROW EXECUTE FUNCTION public.t_row_ops();
`);
const opsOf = async () => (await db.query(`SELECT op, id FROM public.row_ops`)).rows;
const rr = await save(ADMIN, [{ song_id: S3, set_number: 1 }, { song_id: S1 }, { song_id: S2 }]);
const reorderOps = await opsOf();
ok(!rr?.error && reorderOps.length > 0 && reorderOps.every((o) => o.op === 'UPDATE') && new Set(reorderOps.map((o) => o.id)).size === 3,
  `a reorder updates the rows in place (${reorderOps.map((o) => o.op).join(',') || 'nothing'})`);
const reordered = await rows();
ok(reordered.map((r) => r.id).join() === [R3, R1, R2].join() && reordered.map((r) => r.position).join() === '1,2,3', 'same ids, new positions');
ok(JSON.stringify(reordered[1].vocal_parts) === JSON.stringify({ bv: [MEMBER] }) && reordered[0].notes === 'encore', 'notes and who sings what untouched');
await db.exec(`DELETE FROM public.row_ops`);
await save(ADMIN, [{ song_id: S1 }, { song_id: S4 }, { song_id: S3 }]);
const swapOps = await opsOf();
const byOp = (op) => swapOps.filter((o) => o.op === op).map((o) => o.id);
ok(byOp('DELETE').join() === R2 && byOp('INSERT').length === 1 && !byOp('UPDATE').includes(R2),
  `only the removed row is deleted, only the new one inserted (${swapOps.map((o) => o.op).join(',')})`);
await db.exec(`DELETE FROM public.row_ops`);
await save(ADMIN, [{ song_id: S1 }, { song_id: S4 }, { song_id: S3 }]);
ok((await opsOf()).length === 0, 'saving the same order again writes nothing');
await db.exec(`DROP TRIGGER t_row_ops ON public.setlist_songs; DROP FUNCTION public.t_row_ops(); DROP TABLE public.row_ops;`);

// Round 3 (Claude M5): two admins on the same setlist. A save carrying the
// setlist as its editor loaded it is written only while it is still that;
// otherwise nothing changes and the save says what is stored now.
await seed();
const loaded = { name: 'Rooftop Session', songs: [{ song_id: S1, set_number: 1 }, { song_id: S2, set_number: 1 }, { song_id: S3, set_number: 2 }] };
const saveExp = (songs, name, expected) =>
  asCommit(ADMIN, () => db.query(`SELECT public.bw_save_setlist_songs($1, $2::jsonb, $3, $4::jsonb) AS r`, [SL, JSON.stringify(songs), name, JSON.stringify(expected)]))
    .then((r) => r.rows[0].r, (e) => ({ error: e.message }));
// Admin B adds a song first.
await save(ADMIN, [{ song_id: S1 }, { song_id: S2 }, { song_id: S3, set_number: 2 }, { song_id: S4, set_number: 2 }]);
const stale = await saveExp([{ song_id: S2 }, { song_id: S1 }], 'Rooftop · A', loaded);
const afterStale = await rows();
ok(stale?.conflict === true && stale?.saved === false, `a save over a changed setlist is a conflict (${JSON.stringify(stale)?.slice(0, 80)})`);
ok(afterStale.length === 4 && afterStale.some((r) => r.song_id === S4) && (await setlist())?.name === 'Rooftop Session', 'and B’s song and the name stay');
ok(JSON.stringify(stale?.current?.songs?.map((x) => x.song_id)) === JSON.stringify([S1, S2, S3, S4]) && stale?.current?.name === 'Rooftop Session', 'the conflict carries what is stored now');
const mine = await saveExp([{ song_id: S2 }, { song_id: S1 }], 'Rooftop · A', stale?.current);
ok(!mine?.error && mine?.saved === true && (await rows()).map((r) => r.song_id).join() === [S2, S1].join(), '"save mine instead" (expected = what is stored now) writes');
await seed();
const renamedMeanwhile = await (async () => {
  await asCommit(ADMIN, () => db.query(`UPDATE setlists SET name = 'Renamed by B' WHERE id = $1`, [SL]));
  return saveExp([{ song_id: S1 }, { song_id: S2 }, { song_id: S3, set_number: 2 }], 'Rooftop Session', loaded);
})();
ok(renamedMeanwhile?.conflict === true && (await setlist())?.name === 'Renamed by B', 'a rename meanwhile is a conflict too');
const overloads = (await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'bw_save_setlist_songs'`)).rows[0].n;
ok(overloads === 1, `one bw_save_setlist_songs only (no PostgREST overload ambiguity): ${overloads}`);

// Round 4 (Codex): databases built from 002 have UNIQUE(setlist_id, position)
// (prod doesn't). Swapping songs in place must not trip it.
await seed();
await db.exec(`ALTER TABLE public.setlist_songs ADD CONSTRAINT t_pos_unique UNIQUE (setlist_id, position)`);
const sw = await save(ADMIN, [{ song_id: S2 }, { song_id: S1 }, { song_id: S3, set_number: 2 }]);
ok(!sw?.error && (await rows()).map((r) => r.id).join() === [R2, R1, R3].join(), `a swap works with UNIQUE(setlist_id, position) (${sw?.error ?? 'ok'})`);
const rot = await save(ADMIN, [{ song_id: S3 }, { song_id: S2 }, { song_id: S4 }, { song_id: S1 }]);
ok(!rot?.error && (await rows()).map((r) => r.song_id).join() === [S3, S2, S4, S1].join() && (await rows()).map((r) => r.position).join() === '1,2,3,4',
  `a rotation with a new song too (${rot?.error ?? 'ok'})`);
await db.exec(`ALTER TABLE public.setlist_songs DROP CONSTRAINT t_pos_unique`);

// Round 5 (Codex B4): the same song twice, each row with its own singers.
// Stage swaps them: the rows (and their vocal_parts) move by their id, never
// matched again by song. Entries without an id still match by song.
{
  await seed();
  const R4 = id(35);
  await db.exec(`INSERT INTO setlist_songs (id, setlist_id, song_id, position, set_number, vocal_parts) VALUES ('${R4}','${SL}','${S1}',4,2,'{"lead":["${ADMIN}"]}')`);
  // Now: R1 (S1, bv MEMBER) set 1 pos 1, R2 set 1, R3 set 2, R4 (S1, lead ADMIN) set 2 pos 4.
  const sw2 = await save(ADMIN, [
    { id: R4, song_id: S1, set_number: 1 }, { id: R2, song_id: S2, set_number: 1 },
    { id: R3, song_id: S3, set_number: 2 }, { id: R1, song_id: S1, set_number: 2 },
  ]);
  const after = await rows();
  ok(!sw2?.error && after.map((r) => r.id).join() === [R4, R2, R3, R1].join(),
    `same song twice, swapped by row id: the rows move (${sw2?.error ?? after.map((r) => r.id).join()})`);
  ok(JSON.stringify(after[0].vocal_parts) === JSON.stringify({ lead: [ADMIN] }) && JSON.stringify(after[3].vocal_parts) === JSON.stringify({ bv: [MEMBER] }),
    'and each keeps its own singers');
  // An id that isn't this setlist's row for that song: matched by song as before.
  const odd = await save(ADMIN, [{ id: FOREIGN, song_id: S1 }, { song_id: S2 }, { song_id: S3, set_number: 2 }, { song_id: S1, set_number: 2 }]);
  const after2 = await rows();
  ok(!odd?.error && after2.map((r) => r.id).join() === [R4, R2, R3, R1].join(), `an unknown id is ignored, the song matches its row (${odd?.error ?? after2.map((r) => r.id).join()})`);
}

// Round 7 (Codex r6 B6): the conflict check compares rows, not only songs:
// the same song twice swapped (row ids), or who sings it changed, is a
// change. Expected entries without id / vocal_parts are checked as before.
{
  await seed();
  const R4 = id(35);
  await db.exec(`INSERT INTO setlist_songs (id, setlist_id, song_id, position, set_number, vocal_parts) VALUES ('${R4}','${SL}','${S1}',4,2,'{"lead":["${ADMIN}"]}')`);
  const saveExp = (user, songs, expected) =>
    asCommit(user, () => db.query(`SELECT public.bw_save_setlist_songs($1, $2::jsonb, NULL, $3::jsonb) AS r`, [SL, JSON.stringify(songs), JSON.stringify(expected)]))
      .then((r) => r.rows[0].r, (e) => ({ error: e.message }));
  const loadedRows = (await rows()).map((r) => ({ id: r.id, song_id: r.song_id, set_number: r.set_number, vocal_parts: r.vocal_parts }));
  // Admin B swaps the two performances of S1 (by row id): same songs, same sets.
  await save(ADMIN2, [{ id: R4, song_id: S1, set_number: 1 }, { id: R2, song_id: S2 }, { id: R3, song_id: S3, set_number: 2 }, { id: R1, song_id: S1, set_number: 2 }]);
  const plain = loadedRows.map(({ song_id, set_number }) => ({ song_id, set_number }));
  const swapped = await saveExp(ADMIN, [{ song_id: S2 }, { song_id: S1 }], { songs: loadedRows });
  ok(swapped?.conflict === true && (await rows()).length === 4, `two performances of a song swapped meanwhile is a conflict (${JSON.stringify(swapped)?.slice(0, 60)})`);
  ok(Array.isArray(swapped?.current?.songs) && swapped.current.songs[0]?.id === R4, 'the conflict carries the rows (ids) stored now');
  // Who sings it changed meanwhile.
  await seed();
  await db.exec(`INSERT INTO setlist_songs (id, setlist_id, song_id, position, set_number, vocal_parts) VALUES ('${R4}','${SL}','${S1}',4,2,'{"lead":["${ADMIN}"]}')`);
  const loaded2 = (await rows()).map((r) => ({ id: r.id, song_id: r.song_id, set_number: r.set_number, vocal_parts: r.vocal_parts }));
  await asCommit(ADMIN2, () => db.query(`UPDATE setlist_songs SET vocal_parts = '{"lead":["${MEMBER}"]}' WHERE id = $1`, [R4]));
  const sung = await saveExp(ADMIN, [{ song_id: S2 }], { songs: loaded2 });
  ok(sung?.conflict === true, 'who sings a song changed meanwhile is a conflict');
  // The old shape (songs and sets only) still checks as before.
  const old = await saveExp(ADMIN, [{ id: R1, song_id: S1 }, { id: R2, song_id: S2 }, { id: R3, song_id: S3, set_number: 2 }, { id: R4, song_id: S1, set_number: 2 }], { songs: plain });
  ok(!old?.error && old?.saved === true, `expected without ids is checked by song and set, as before (${old?.error ?? JSON.stringify(old)?.slice(0, 60)})`);
  const same = await saveExp(ADMIN, [{ id: R1, song_id: S1 }, { id: R2, song_id: S2 }, { id: R3, song_id: S3, set_number: 2 }, { id: R4, song_id: S1, set_number: 2 }],
    { songs: (await rows()).map((r) => ({ id: r.id, song_id: r.song_id, set_number: r.set_number, vocal_parts: r.vocal_parts })) });
  ok(!same?.error && same?.saved === true, 'expected with the same rows and singers saves');
}

// Round 7 (Claude r6 Regia): a save returns the rows in play order with
// their ids, new rows included (the Regia jumps to the song it added).
{
  await seed();
  const res = await save(ADMIN, [{ id: R1, song_id: S1 }, { song_id: S4 }, { id: R2, song_id: S2 }, { id: R3, song_id: S3, set_number: 2 }]);
  const now = await rows();
  ok(Array.isArray(res?.rows) && res.rows.map((r) => r.id).join() === now.map((r) => r.id).join(), `the save returns the rows with their ids (${JSON.stringify(res?.rows)?.slice(0, 60)})`);
  ok(res?.rows?.[1]?.song_id === S4 && res.rows[1].id && ![R1, R2, R3].includes(res.rows[1].id), 'the new row’s id is among them, in its place');
}

// Round 7 (main): an old build's Stage order (383f15b: upsert onConflict id)
// can't bring back a row another admin deleted. Deleted ids are remembered
// (tombstones) and an insert with one is skipped; an upsert on a live id is
// an update and goes through. The deleting admin putting the rows back right
// away (an old build's failed save restoring them) still works.
{
  await seed();
  // Admin B removes S2 (row R2) with a save; the old phone still shows it.
  await save(ADMIN2, [{ id: R1, song_id: S1 }, { id: R3, song_id: S3, set_number: 2 }]);
  // supabase-js upsert({ onConflict }) sends Prefer: resolution=merge-duplicates.
  const upsert383 = (user, list) =>
    asCommit(user, async () => {
      await db.query(`SELECT set_config('request.headers', $1, true)`, [JSON.stringify({ prefer: 'resolution=merge-duplicates,return=representation' })]);
      return db.query(
        `INSERT INTO setlist_songs (id, setlist_id, song_id, position, set_number)
         SELECT x.id, x.setlist_id, x.song_id, x.position, x.set_number
           FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, setlist_id uuid, song_id uuid, position int, set_number int)
         ON CONFLICT (id) DO UPDATE SET setlist_id = EXCLUDED.setlist_id, song_id = EXCLUDED.song_id,
                                       position = EXCLUDED.position, set_number = EXCLUDED.set_number
         RETURNING id`,
        [JSON.stringify(list)],
      );
    }).then((r) => r.rows, (e) => ({ error: e.message }));
  const back = await upsert383(ADMIN, [
    { id: R3, setlist_id: SL, song_id: S3, position: 1, set_number: 1 },
    { id: R2, setlist_id: SL, song_id: S2, position: 2, set_number: 1 },
    { id: R1, setlist_id: SL, song_id: S1, position: 3, set_number: 1 },
  ]);
  const afterOld = await rows();
  ok(!back?.error && !afterOld.some((r) => r.id === R2), `an old build's upsert doesn't bring back a deleted row (${back?.error ?? afterOld.map((r) => r.id).join()})`);
  ok(afterOld.map((r) => r.id).join() === [R3, R1].join() && Array.isArray(back) && back.length === 2, 'the live rows are updated (the upsert of a live id is an update), 2 of 3 returned');
  // Deleted by a plain DELETE too (older builds' editor).
  await seed();
  await asCommit(ADMIN2, () => db.query(`DELETE FROM setlist_songs WHERE id = $1`, [R3]));
  const back2 = await upsert383(ADMIN, [{ id: R3, setlist_id: SL, song_id: S3, position: 3, set_number: 2 }]);
  ok(!back2?.error && !(await rows()).some((r) => r.id === R3), 'a row deleted by a plain DELETE is not brought back either');
  // Older builds' failed save: the same admin puts the rows back right away.
  await seed();
  await asCommit(ADMIN, async () => {
    await db.query(`DELETE FROM setlist_songs WHERE setlist_id = $1`, [SL]);
    await db.query(`INSERT INTO setlist_songs (id, setlist_id, song_id, position, set_number) VALUES ($2,$1,$3,1,1),($4,$1,$5,2,1),($6,$1,$7,3,2)`, [SL, R1, S1, R2, S2, R3, S3]);
  });
  ok((await rows()).map((r) => r.id).join() === [R1, R2, R3].join(), 'the deleting admin restoring the rows at once (old build) still works');
  // Round 7 r7 (nit 4): the window is for a plain insert only: the same
  // admin's older Stage order (an upsert) within the 2 minutes is skipped.
  await seed();
  await asCommit(ADMIN, () => db.query(`DELETE FROM setlist_songs WHERE id = $1`, [R2]));
  const mine = await upsert383(ADMIN, [{ id: R2, setlist_id: SL, song_id: S2, position: 2, set_number: 1 }]);
  ok(!mine?.error && !(await rows()).some((r) => r.id === R2), `the deleting admin's own old Stage upsert right after doesn't bring it back (${mine?.error ?? ''})`);
  // Round 7 r7 (nit 5): "never skipped" goes by the role, not a missing user
  // id: an app request without a user id is skipped; service_role is let in.
  await seed();
  await asCommit(ADMIN2, () => db.query(`DELETE FROM setlist_songs WHERE id = $1`, [R3]));
  await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);`);
  await db.query(`INSERT INTO setlist_songs (id, setlist_id, song_id, position, set_number) VALUES ($1,$2,$3,3,2)`, [R3, SL, S3]);
  await db.exec('COMMIT');
  ok(!(await rows()).some((r) => r.id === R3), 'an app request with no user id is not let in');
  await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);`);
  await db.query(`INSERT INTO setlist_songs (id, setlist_id, song_id, position, set_number) VALUES ($1,$2,$3,3,2)`, [R3, SL, S3]);
  await db.exec('COMMIT');
  ok((await rows()).some((r) => r.id === R3), 'a service_role request (a restore by hand) is let in');
  // The tombstones: nobody reads or writes them directly; older than 30 days are pruned.
  const priv = (await db.query(`SELECT has_table_privilege('authenticated', 'public.setlist_song_tombstones', 'SELECT') OR has_table_privilege('authenticated', 'public.setlist_song_tombstones', 'INSERT') OR has_table_privilege('anon', 'public.setlist_song_tombstones', 'SELECT') AS x`)).rows[0].x;
  ok(priv === false, 'no grants on the tombstones (definer and triggers only)');
  await db.exec(`INSERT INTO public.setlist_song_tombstones (id, setlist_id, deleted_at) VALUES ('${id(77)}','${SL}', now() - interval '31 days') ON CONFLICT DO NOTHING`);
  await asCommit(ADMIN, () => db.query(`DELETE FROM setlist_songs WHERE id = $1`, [R2]));
  const old31 = (await db.query(`SELECT count(*)::int AS n FROM public.setlist_song_tombstones WHERE id = $1`, [id(77)])).rows[0].n;
  ok(old31 === 0, 'tombstones older than 30 days are pruned');
}

// Older builds: their own delete + insert keeps working for admins, not for members.
await seed();
await asCommit(ADMIN, async () => {
  await db.query(`DELETE FROM setlist_songs WHERE setlist_id = $1`, [SL]);
  await db.query(`INSERT INTO setlist_songs (setlist_id, song_id, position, set_number) VALUES ($1,$2,1,1),($1,$3,2,1)`, [SL, S2, S1]);
  await db.query(`UPDATE setlists SET song_count = 2 WHERE id = $1`, [SL]);
});
ok((await rows()).map((r) => r.song_id).join() === [S2, S1].join(), 'old builds: admin delete + insert still works');
await seed();
const memberOld = await as(MEMBER, async () => {
  const d = await db.query(`DELETE FROM setlist_songs WHERE setlist_id = $1 RETURNING id`, [SL]);
  return d.rows.length;
});
ok(memberOld === 0, 'old builds: a member still cannot delete rows (074)');

// Round 2: on a database without 172 the migration stops with a clear
// message, instead of a function that fails on every save (42703).
{
  const bare = new PGlite();
  await bare.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE TABLE public.songs (id uuid PRIMARY KEY, band_id uuid, title text);
CREATE TABLE public.setlists (id uuid PRIMARY KEY, band_id uuid NOT NULL, name text NOT NULL, song_count int DEFAULT 0, updated_at timestamptz);
CREATE TABLE public.setlist_songs (id uuid PRIMARY KEY, setlist_id uuid, song_id uuid, position int, set_number int, notes text);
CREATE FUNCTION public.bw_is_band_admin(p_band_id uuid, p_user_id uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql AS $f$ SELECT false $f$;
`);
  let refused = null;
  try { await bare.exec(readFileSync(MIG, 'utf8')); } catch (e) { refused = e.message; }
  ok(!!refused && /172/.test(refused), `without 172 (setlist_songs.vocal_parts) the migration stops and says so (${refused ?? 'it ran'})`);
  if (refused) await bare.exec('ROLLBACK');
  const made = (await bare.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'bw_save_setlist_songs'`)).rows[0].n;
  ok(made === 0, 'and leaves no function behind');
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
