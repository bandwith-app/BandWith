// Local check of migration 197 (audit 09 #5) without Docker: PGlite with
// stand-ins for Supabase's auth / storage and the 108 song-files policies.
// Round 2: moving the files (copy, repoint, sweep) can never leave a song on
// a missing file: the claim, the locked conditional repoint, the sweep list
// that skips any path a song uses, and the record a failed delete leaves.
// Once a suggested song is accepted (status no longer 'suggested'), the
// member who suggested it can no longer replace or delete its files in
// <band>/suggestions/<them>/; while it waits they still can. Admins keep
// every right.
//
//   cp <repo>/supabase/tests/song_files_adopted.pglite.mjs <dir with @electric-sql/pglite 0.5.15>/
//   node song_files_adopted.pglite.mjs <repo> <repo>/supabase/migrations/197_song_files_adopted.sql
//   (with /dev/null as the migration the new checks FAIL)
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const [REPO, MIG] = process.argv.slice(2);
const db = new PGlite();
const q = (sql, p) => db.query(sql, p);
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth; CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA public, auth, storage TO authenticated, anon;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
CREATE POLICY read_all ON storage.objects FOR SELECT TO authenticated USING (true);
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO authenticated;

CREATE TABLE public.band_members (band_id uuid, user_id uuid, role text, is_active boolean DEFAULT true);
CREATE TABLE public.songs (id uuid PRIMARY KEY, band_id uuid, title text, status text, audio_url text, chart_url text);
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.songs TO authenticated;
CREATE POLICY songs_read ON public.songs FOR SELECT TO authenticated
  USING (band_id::text = ANY (ARRAY(SELECT band_id::text FROM public.band_members WHERE user_id = auth.uid())));
GRANT SELECT ON public.band_members TO authenticated;
CREATE FUNCTION public.bw_my_band_ids() RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(band_id::text), '{}') FROM band_members WHERE user_id = auth.uid() AND COALESCE(is_active, true) $$;
CREATE FUNCTION public.bw_my_admin_band_ids() RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(band_id::text), '{}') FROM band_members WHERE user_id = auth.uid() AND role = 'admin' AND COALESCE(is_active, true) $$;
GRANT EXECUTE ON FUNCTION public.bw_my_band_ids(), public.bw_my_admin_band_ids() TO authenticated;
CREATE FUNCTION public.bw_is_band_admin(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND role = 'admin' AND COALESCE(is_active, true)); $f$;
GRANT EXECUTE ON FUNCTION public.bw_is_band_admin(uuid, uuid) TO authenticated;
`);

// Baseline: the song-files write policies as 108 created them.
const m108 = readFileSync(`${REPO}/supabase/migrations/108_song_suggestions.sql`, 'utf8').split('\n');
const start = m108.findIndex((l) => l.includes('song-files storage --'));
const end = m108.findIndex((l, i) => i > start && l.includes('-- pushes --'));
await db.exec(m108.slice(start, end).join('\n'));

const mig = readFileSync(MIG, 'utf8');
await db.exec(mig);
await db.exec(mig);
ok(true, 'migration runs twice');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, OTHER_BAND, ADMIN, MEM, MEM2, STRANGER] = [1, 2, 3, 4, 5, 6].map(id);
const sug = (who, file) => `${BAND}/suggestions/${who}/${file}`;
const P = {
  waiting: sug(MEM, 'audio/a-waiting.mp3'),
  learning: sug(MEM, 'audio/b-learning.mp3'),
  readyChart: sug(MEM, 'chart/c-ready.pdf'),
  orphan: sug(MEM, 'audio/d-orphan.mp3'),
  other: sug(MEM2, 'audio/e-other.mp3'),
};
await db.exec(`
INSERT INTO band_members VALUES ('${BAND}','${ADMIN}','admin',true),('${BAND}','${MEM}','member',true),('${BAND}','${MEM2}','member',true),
  ('${OTHER_BAND}','${STRANGER}','admin',true);
INSERT INTO songs VALUES
  ('${id(10)}','${BAND}','Empire State of Mind','suggested','sb://song-files/${P.waiting}',NULL),
  ('${id(11)}','${BAND}','New York, New York','learning','sb://song-files/${P.learning}',NULL),
  ('${id(12)}','${BAND}','Brooklyn Bridge','ready',NULL,'sb://song-files/${P.readyChart}'),
  ('${id(13)}','${BAND}','Harlem Nocturne','suggested','sb://song-files/${P.other}',NULL);
INSERT INTO storage.objects (bucket_id, name, owner) SELECT 'song-files', n, '${MEM}' FROM unnest(ARRAY['${P.waiting}','${P.learning}','${P.readyChart}','${P.orphan}']) n;
INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('song-files', '${P.other}', '${MEM2}');
`);

async function as(user, fn) {
  await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true); SET LOCAL ROLE authenticated;`);
  try { return await fn(); } finally { await db.exec('ROLLBACK'); }
}
const del = (user, name) => as(user, () => q(`DELETE FROM storage.objects WHERE bucket_id = 'song-files' AND name = $1`, [name]).then((r) => r.affectedRows, (e) => `error: ${e.message}`));
const upd = (user, name) => as(user, () => q(`UPDATE storage.objects SET metadata = '{"replaced":true}' WHERE bucket_id = 'song-files' AND name = $1`, [name]).then((r) => r.affectedRows, (e) => `error: ${e.message}`));
const ins = (user, name) => as(user, () => q(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('song-files', $1, $2)`, [name, user]).then(() => 1, () => 0));

// While the song waits for review, the member manages their own files.
ok((await del(MEM, P.waiting)) === 1, 'member deletes a file of their song still waiting');
ok((await upd(MEM, P.waiting)) === 1, 'member replaces a file of their song still waiting');
ok((await del(MEM, P.orphan)) === 1, 'member deletes their own unused upload');
ok((await ins(MEM, sug(MEM, 'audio/f-new.mp3'))) === 1, 'member uploads into their suggestions folder');
ok((await del(MEM2, P.waiting)) === 0, 'another member cannot delete it');

// Accepted (learning / ready): the band's file now.
ok((await del(MEM, P.learning)) === 0, 'member cannot delete the recording of their accepted song (learning)');
ok((await upd(MEM, P.learning)) === 0, 'member cannot replace the recording of their accepted song');
ok((await del(MEM, P.readyChart)) === 0, 'member cannot delete the chart of their accepted song (ready)');
ok((await upd(MEM, P.readyChart)) === 0, 'member cannot replace the chart of their accepted song');
ok((await del(ADMIN, P.learning)) === 1, 'admin still deletes it (moving it into the band folders)');
ok((await upd(ADMIN, P.readyChart)) === 1, 'admin still replaces it');

// The helper says nothing about other bands' files.
const probe = (user) => as(user, () => q(`SELECT public.bw_song_file_adopted($1) AS v`, [P.learning]).then((r) => r.rows[0].v, (e) => `error: ${e.message}`));
ok((await probe(MEM)) === true, 'helper: true for an accepted song’s file, to a member of the band');
ok((await probe(STRANGER)) === false, 'helper: false for another band’s file');
const anonCall = await db.exec(`BEGIN; SET LOCAL ROLE anon;`).then(() => q(`SELECT public.bw_song_file_adopted('x')`)).then(() => 'ran', () => 'denied');
await db.exec('ROLLBACK');
ok(anonCall === 'denied', 'anon cannot call the helper');

// ---- Round 2: adoption RPCs
const ADMIN2 = id(7);
await db.exec(`INSERT INTO band_members VALUES ('${BAND}','${ADMIN2}','admin',true)`);
const rpc = (user, sql, params) => as(user, () => q(sql, params).then((r) => r.rows[0].v, (e) => `error: ${e.message}`));
const begin = (user, song, field = 'audio_url') => rpc(user, `SELECT public.bw_song_file_adopt_begin($1, $2) AS v`, [song, field]);
const repoint = (user, song, from, to, field = 'audio_url') =>
  rpc(user, `SELECT public.bw_song_file_adopt_repoint($1, $2, $3, $4) AS v`, [song, field, from, to]);
const sweep = (user) => rpc(user, `SELECT public.bw_song_file_sweep_list($1) AS v`, [BAND]);
// Committed writes (not rolled back): the RPCs' effect persists between steps.
async function asCommit(user, sql, params) {
  await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true); SET LOCAL ROLE authenticated;`);
  try { const r = await q(sql, params); await db.exec('COMMIT'); return r.rows[0].v; } catch (e) { await db.exec('ROLLBACK'); return `error: ${e.message}`; }
}
const SONG = id(11); // learning, audio in MEM's suggestions folder
const DEST = `${BAND}/audio/${SONG}-b-learning.mp3`;
const ref = async () => (await q(`SELECT audio_url FROM songs WHERE id = $1`, [SONG])).rows[0].audio_url;

ok(String(await begin(MEM, SONG)).startsWith('error'), 'a member cannot start moving files');
ok(String(await begin(STRANGER, SONG)).startsWith('error'), 'an admin of another band cannot either');
ok((await begin(ADMIN, id(10))).reason === 'waiting', 'a song still waiting for review is not moved');
const b1 = await asCommit(ADMIN, `SELECT public.bw_song_file_adopt_begin($1, 'audio_url') AS v`, [SONG]);
ok(b1.won === true && b1.from === P.learning && b1.to === DEST, `claim: from the suggestion, to a name with the song id (${b1.to})`);
ok((await begin(ADMIN2, SONG)).reason === 'busy', 'another admin meanwhile: busy');
ok((await begin(ADMIN, SONG)).won === true, 'the same admin on another device may run too (safe by the repoint)');

// Bad destinations are refused: another song's name, another folder, a sub-path.
ok(String(await repoint(ADMIN, SONG, P.learning, `${BAND}/audio/b-learning.mp3`)).includes('Bad destination'), 'no destination without the song id');
ok(String(await repoint(ADMIN, SONG, P.learning, `${BAND}/audio/${id(12)}-x.mp3`)).includes('Bad destination'), 'no destination named for another song');
ok(String(await repoint(ADMIN, SONG, P.learning, `${BAND}/audio/${SONG}-x/y.mp3`)).includes('Bad destination'), 'no sub-folder');
ok(String(await repoint(ADMIN, SONG, `${OTHER_BAND}/suggestions/x/audio/y.mp3`, DEST)).includes('Bad source'), 'no source from another band');
ok(String(await repoint(MEM, SONG, P.learning, DEST)).startsWith('error'), 'a member cannot repoint');

// Two runs: the first repoint wins, the second sees the new reference.
const r1 = await asCommit(ADMIN, `SELECT public.bw_song_file_adopt_repoint($1, 'audio_url', $2, $3) AS v`, [SONG, P.learning, DEST]);
ok(r1.won === true && r1.ref === `sb://song-files/${DEST}`, 'first repoint wins');
ok((await ref()) === `sb://song-files/${DEST}`, 'the song points at the copy');
const r2 = await repoint(ADMIN2, SONG, P.learning, DEST);
ok(r2.won === false && r2.ref === `sb://song-files/${DEST}` && r2.to_referenced === true, 'second run loses and is told the song uses that file');
const rec = (await q(`SELECT state FROM song_file_adoptions WHERE song_id = $1`, [SONG])).rows;
ok(rec.length === 1 && rec[0].state === 'repointed', 'the original is recorded for the sweep with the repoint');

// Sweep: originals no song uses; never one still referenced.
await db.exec(`INSERT INTO songs VALUES ('${id(14)}','${BAND}','Coney Island Baby','ready',NULL,'sb://song-files/${P.readyChart}')`);
await db.exec(`INSERT INTO song_file_adoptions (band_id, song_id, field, from_path, to_path, state)
  VALUES ('${BAND}','${id(12)}','chart_url','${P.readyChart}','${BAND}/chart/${id(12)}-c-ready.pdf','repointed')`);
const list = await sweep(ADMIN);
ok(Array.isArray(list) && list.includes(P.learning), 'sweep lists the moved original');
ok(!list.includes(P.readyChart), 'sweep skips a path another song still uses');
ok(String(await sweep(MEM)).startsWith('error'), 'members cannot sweep');
// A failed delete: not marked done, so the next sweep lists it again.
ok((await sweep(ADMIN)).includes(P.learning), 'until marked done it stays listed (a failed delete is retried)');
const done = await asCommit(ADMIN, `SELECT public.bw_song_file_sweep_done($1, $2) AS v`, [BAND, [P.learning, P.readyChart]]);
ok(done === 2 && !(await sweep(ADMIN)).includes(P.learning), 'marked done: no longer listed');

// The record is not readable or writable by app users.
ok((await as(ADMIN, () => q(`SELECT 1 FROM song_file_adoptions`).then(() => 'read', () => 'denied'))) === 'denied', 'adoption records: no direct access');
// A lost response: the commit happened; a re-read shows the copy, nothing to undo.
ok((await ref()) === `sb://song-files/${DEST}`, 'after the repoint the song keeps the copy');

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
