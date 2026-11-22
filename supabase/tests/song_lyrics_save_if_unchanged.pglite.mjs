// Local check of migration 189 (chords saved only over the lyrics they were
// placed on, audit 09 #6) without Docker: PGlite with songs and the 108/118
// policies (admins write, members read).
// Failing first: with /dev/null as the migration there is no conditional
// save, and the editor's plain update erases a bandmate's new verse.
//
//   mkdir -p /tmp/pg189 && cd /tmp/pg189 && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/song_lyrics_save_if_unchanged.pglite.mjs . && node song_lyrics_save_if_unchanged.pglite.mjs <repo>
//   node song_lyrics_save_if_unchanged.pglite.mjs <repo> /dev/null    # before: FAILs expected
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const REPO = process.argv[2];
const MIG = process.argv[3] ?? `${REPO}/supabase/migrations/189_song_lyrics_save_if_unchanged.sql`;
const db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, ADMIN_A, ADMIN_B, MEMBER, STRANGER, SONG] = [1, 2, 3, 4, 5, 20].map(id);

const LOADED = '# Verse 1\n[C]Hello again';
const B_SAVED = '# Verse 1\n[C]Hello again\n\n# Verse 2\nUptown lights';
const A_DRAFT = '# Verse 1\n[F]Hello again';

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
CREATE TABLE public.band_members (band_id uuid, user_id uuid, role text, is_active boolean DEFAULT true);
CREATE TABLE public.songs (id uuid PRIMARY KEY, band_id uuid, title text, lyrics text, status text);
CREATE FUNCTION public.bw_is_band_admin(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND role = 'admin' AND COALESCE(is_active, true)); $f$;
CREATE FUNCTION public.bw_is_band_member(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND COALESCE(is_active, true)); $f$;
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Band members can view songs" ON public.songs FOR SELECT TO authenticated USING (public.bw_is_band_member(band_id));
CREATE POLICY songs_admin_update ON public.songs FOR UPDATE TO authenticated
  USING (public.bw_is_band_admin(band_id)) WITH CHECK (public.bw_is_band_admin(band_id));
GRANT SELECT, UPDATE ON public.songs TO authenticated;
GRANT SELECT ON public.band_members TO authenticated;
INSERT INTO band_members VALUES ('${BAND}','${ADMIN_A}','admin',true), ('${BAND}','${ADMIN_B}','admin',true), ('${BAND}','${MEMBER}','member',true);
`);

const seed = async (lyrics = LOADED) => {
  await db.exec(`DELETE FROM songs`);
  await db.query(`INSERT INTO songs VALUES ($1, $2, 'Hudson Line', $3, 'ready')`, [SONG, BAND, lyrics]);
};
const stored = async () => (await db.query(`SELECT lyrics FROM songs WHERE id = $1`, [SONG])).rows[0]?.lyrics;
async function as(user, fn) {
  await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true); SET LOCAL ROLE authenticated;`);
  try { const r = await fn(); await db.exec('COMMIT'); return r; } catch (e) { await db.exec('ROLLBACK'); throw e; }
}
const saveIf = (user, lyrics, expected) =>
  as(user, () => db.query(`SELECT public.bw_save_song_lyrics($1, $2, $3) AS r`, [SONG, lyrics, expected]))
    .then((r) => r.rows[0].r, (e) => ({ error: e.message }));

// ---- the problem: A's plain update after B's save
await seed();
await as(ADMIN_B, () => db.query(`UPDATE songs SET lyrics = $1 WHERE id = $2`, [B_SAVED, SONG]));
await as(ADMIN_A, () => db.query(`UPDATE songs SET lyrics = $1 WHERE id = $2`, [A_DRAFT, SONG]));
console.log(`info: plain update keeps B's verse: ${(await stored()).includes('Uptown lights')}`);

await db.exec(readFileSync(MIG, 'utf8'));
await db.exec(readFileSync(MIG, 'utf8')); // idempotent
ok(true, 'migration runs twice');

// A saves over what A loaded: fine.
await seed();
const r1 = await saveIf(ADMIN_A, A_DRAFT, LOADED);
ok(r1?.saved === true && (await stored()) === A_DRAFT, `A saves when nothing changed meanwhile (${JSON.stringify(r1)})`);

// B saved meanwhile: A's save writes nothing and gets B's text back.
await seed();
await as(ADMIN_B, () => db.query(`UPDATE songs SET lyrics = $1 WHERE id = $2`, [B_SAVED, SONG]));
const r2 = await saveIf(ADMIN_A, A_DRAFT, LOADED);
ok(r2?.saved === false, 'A is told the lyrics changed');
ok(r2?.lyrics === B_SAVED, 'and gets what is stored now');
ok((await stored()) === B_SAVED, "B's new verse is still there");

// A chooses to save on top of B's version (expected = what is stored now).
const r3 = await saveIf(ADMIN_A, A_DRAFT, B_SAVED);
ok(r3?.saved === true && (await stored()) === A_DRAFT, 'A can then save on top of the latest version');

// Empty lyrics loaded (NULL) compare correctly.
await seed(null);
ok((await saveIf(ADMIN_A, '[C]Hi', null))?.saved === true, 'lyrics that were empty (NULL) save');
ok((await saveIf(ADMIN_A, '[D]Hi', null))?.saved === false, 'and a second stale save from NULL is refused');

// Who may write: the songs policies, as before.
await seed();
const r4 = await saveIf(MEMBER, A_DRAFT, LOADED);
ok(!!r4?.error && (await stored()) === LOADED, 'a member cannot write lyrics');
const r5 = await saveIf(STRANGER, A_DRAFT, LOADED);
ok(!!r5?.error && (await stored()) === LOADED, 'someone outside the band cannot write lyrics');
const priv = async (role) => (await db.query(`SELECT bool_or(has_function_privilege('${role}', p.oid, 'EXECUTE')) AS x FROM pg_proc p WHERE p.proname = 'bw_save_song_lyrics'`)).rows[0].x;
ok((await priv('anon')) === false, 'anon cannot execute');
ok((await priv('authenticated')) === true, 'authenticated can execute');
const cfg = (await db.query(`SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'bw_save_song_lyrics'`)).rows[0];
ok(cfg?.prosecdef === false && String(cfg?.proconfig).includes('search_path=public'), 'security invoker (RLS applies) with a fixed search_path');

// Older builds: the direct update still works for admins.
await seed();
await as(ADMIN_A, () => db.query(`UPDATE songs SET lyrics = $1 WHERE id = $2`, [A_DRAFT, SONG]));
ok((await stored()) === A_DRAFT, 'old builds: an admin updates lyrics directly as before');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
