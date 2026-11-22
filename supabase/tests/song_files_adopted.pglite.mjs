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
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

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
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb,
  created_at timestamptz DEFAULT now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
CREATE POLICY read_all ON storage.objects FOR SELECT TO authenticated USING (true);
-- personal-files (109): the owner deletes their own; 197 must not touch it.
CREATE POLICY bw_personal_files_own_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'personal-files' AND owner = auth.uid());
CREATE TABLE public.bands (id uuid PRIMARY KEY);
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO authenticated;

CREATE TABLE public.band_members (band_id uuid, user_id uuid, role text, is_active boolean DEFAULT true);
CREATE TABLE public.songs (id uuid PRIMARY KEY, band_id uuid, title text, status text, audio_url text, chart_url text,
  notes text, lyrics text, chord_chart jsonb);
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.songs TO authenticated;
CREATE POLICY songs_write_any ON public.songs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY songs_update_any ON public.songs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY songs_read ON public.songs FOR SELECT TO authenticated
  USING (band_id::text = ANY (ARRAY(SELECT band_id::text FROM public.band_members WHERE user_id = auth.uid())));
GRANT SELECT ON public.band_members TO authenticated;
-- song_suggestions (108), the columns that can hold text.
CREATE TABLE public.song_suggestions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, song_id uuid, kind text,
  proposed jsonb NOT NULL DEFAULT '{}', original jsonb NOT NULL DEFAULT '{}', applied jsonb, message text, reason text,
  status text DEFAULT 'pending', created_by uuid, reviewed_by uuid, reviewed_at timestamptz);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text, reference_id uuid, read boolean);
CREATE FUNCTION public.bw_notify_song_suggestion_outcome(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.bw_notify_song_updated(uuid, text[]) RETURNS void LANGUAGE sql AS $$ SELECT $$;
ALTER TABLE public.song_suggestions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.song_suggestions TO authenticated;
CREATE POLICY sug_insert ON public.song_suggestions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY sug_read ON public.song_suggestions FOR SELECT TO authenticated USING (true);
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
// And its review / withdraw RPCs (197 redefines them).
const rpcStart = m108.findIndex((l) => l.includes('-- review RPC --'));
const rpcEnd = m108.findIndex((l, i) => i > rpcStart && l.includes('-- songs RLS --'));
await db.exec(m108.slice(rpcStart, rpcEnd).join('\n'));

// Apply order: 180 (fix/account-deletion, #282) runs before 197 and also
// redefines bw_withdraw_song_suggestion (NULL-safe author check, B1). Load
// its real function from that branch head (by name, not line numbers), so
// the check below proves 197 keeps 180's fix.
const M180 = 'supabase/migrations/180_account_deletion_safety.sql';
const src180 = (() => {
  // BW_180_FILE: a local 180 to check against (e.g. #282's next round before it is pushed).
  if (process.env.BW_180_FILE) return readFileSync(process.env.BW_180_FILE, 'utf8');
  try {
    return execFileSync('git', ['-C', REPO, 'show', `origin/fix/account-deletion:${M180}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return existsSync(`${REPO}/${M180}`) ? readFileSync(`${REPO}/${M180}`, 'utf8') : null; // merged: the file is on main
  }
})();
const fnFrom = (sql, name) => {
  const a = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (a < 0) return null;
  const body = sql.indexOf('$$', sql.indexOf('AS $$', a) + 5);
  const end = sql.indexOf(';', body);
  const grants = sql.slice(end + 1).match(new RegExp(`^(?:\\s*(?:REVOKE|GRANT)[^;]*public\\.${name}\\([^;]*;)+`))?.[0] ?? '';
  return sql.slice(a, end + 1) + grants;
};
const w180 = src180 && fnFrom(src180, 'bw_withdraw_song_suggestion');
if (!w180) {
  // No 180 here and no fix/account-deletion branch: the cross-PR guard can't run.
  console.warn('SKIP 180 guard: no 180_account_deletion_safety.sql (main or origin/fix/account-deletion)');
} else {
  ok(/created_by IS DISTINCT FROM v_uid/.test(w180), '180’s real bw_withdraw_song_suggestion loaded (NULL-safe author check)');
  await db.exec(w180);
}

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
INSERT INTO bands VALUES ('${BAND}'), ('${OTHER_BAND}');
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
ok((await del(MEM, P.waiting)) === 0, 'a linked file is never deleted, not even by its owner (197 delete policy)');
ok((await upd(MEM, P.waiting)) === 1, 'member replaces a file of their song still waiting');
ok((await del(MEM, P.orphan)) === 0, 'no delete without a claim, even of an own unused upload');
const claimEarly = (user, refs) => as(user, () => q(`SELECT public.bw_song_files_claim_delete($1) AS v`, [refs]).then((r) => r.rows[0].v, (e) => `error: ${e.message}`));
const delClaimed = (user, name) => as(user, async () => {
  await q(`SELECT public.bw_song_files_claim_delete($1)`, [[`sb://song-files/${name}`]]);
  return q(`DELETE FROM storage.objects WHERE bucket_id = 'song-files' AND name = $1`, [name]).then((r) => r.affectedRows);
}).catch((e) => `error: ${e.message}`);
ok((await delClaimed(MEM, P.orphan)) === 1, 'member deletes their own unused upload once claimed');
ok(JSON.stringify(await claimEarly(MEM2, [`sb://song-files/${P.orphan}`])) === '[]', 'another member cannot claim it');
ok((await ins(MEM, sug(MEM, 'audio/f-new.mp3'))) === 1, 'member uploads into their suggestions folder');
ok((await del(MEM2, P.waiting)) === 0, 'another member cannot delete it');

// Accepted (learning / ready): the band's file now.
ok((await del(MEM, P.learning)) === 0, 'member cannot delete the recording of their accepted song (learning)');
ok((await upd(MEM, P.learning)) === 0, 'member cannot replace the recording of their accepted song');
ok((await del(MEM, P.readyChart)) === 0, 'member cannot delete the chart of their accepted song (ready)');
ok((await upd(MEM, P.readyChart)) === 0, 'member cannot replace the chart of their accepted song');
ok((await del(ADMIN, P.learning)) === 0, 'an admin cannot delete it while a song links it');
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
// The app copies the file first; the repoint links that copy (197 needs it in Storage).
const stored = (name, owner = ADMIN) => q(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('song-files', $1, $2)`, [name, owner]);
await stored(DEST);
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
// ---- Round 3: each delete is claimed right before it, under a lock.
const claim = (user, path) => asCommit(user, `SELECT public.bw_song_file_sweep_claim($1, $2) AS v`, [BAND, path]);
const doneSweep = (user, paths) => asCommit(user, `SELECT public.bw_song_file_sweep_done($1, $2) AS v`, [BAND, paths]);
const state = async (path) => (await q(`SELECT state FROM song_file_adoptions WHERE from_path = $1`, [path])).rows[0]?.state;

// A song links the original between the list and the claim: no delete.
const LATE = id(15);
await db.exec(`INSERT INTO songs VALUES ('${LATE}','${BAND}','Late link','suggested','sb://song-files/${P.learning}',NULL)`);
const c0 = await claim(ADMIN, P.learning);
ok(c0 && c0.ok === false && c0.reason === 'referenced', `claim refused: a song links it now (${JSON.stringify(c0)})`);
ok((await state(P.learning)) === 'repointed', 'still pending, not deleting');
await db.exec(`DELETE FROM songs WHERE id = '${LATE}'`);

// Only a pending member suggestion links it (its ref as a JSON value): no delete either.
await db.exec(`INSERT INTO song_suggestions (band_id, song_id, kind, proposed) VALUES ('${BAND}','${id(11)}','note',
  jsonb_build_object('audio_url', 'sb://song-files/${P.learning}'))`);
const cS = await claim(ADMIN, P.learning);
ok(cS && cS.ok === false && cS.reason === 'referenced', `claim refused: a suggestion links it (${JSON.stringify(cS)})`);
ok(!(await sweep(ADMIN)).includes(P.learning), 'and the sweep does not list it');
await db.exec(`DELETE FROM song_suggestions`);
await db.exec(`INSERT INTO song_suggestions (band_id, song_id, kind, original) VALUES ('${BAND}','${id(11)}','note',
  jsonb_build_object('files', jsonb_build_array(jsonb_build_object('chart_url', 'sb://song-files/${P.learning}'))))`);
ok((await claim(ADMIN, P.learning)).reason === 'referenced', 'a chart_url in original (nested) counts too');
await db.exec(`DELETE FROM song_suggestions`);
// jsonb escapes quotes and backslashes: a hostile name is still found.
const HOSTILE = `${BAND}/suggestions/${MEM}/audio/q"u\\o.mp3`;
await q(`INSERT INTO song_suggestions (band_id, kind, proposed) VALUES ($1, 'note', jsonb_build_object('audio_url', $2::text))`, [BAND, `sb://song-files/${HOSTILE}`]);
ok((await q(`SELECT public.bw_song_file_in_use($1) AS v`, [HOSTILE])).rows[0].v === true, 'a name with quotes and backslashes is found in a suggestion');
await db.exec(`DELETE FROM song_suggestions`);

ok(String(await claim(MEM, P.learning)).startsWith('error'), 'members cannot claim a delete');
const c1 = await claim(ADMIN, P.learning);
ok(c1 && c1.ok === true, 'claim granted once no song links it');
ok((await state(P.learning)) === 'deleting', 'row marked deleting');
ok((await claim(ADMIN2, P.learning)).reason === 'busy', 'a second claim meanwhile: busy');
ok(!(await sweep(ADMIN)).includes(P.learning), 'while deleting it is not listed again');

// While deleting, no song may link it (insert or update).
const linkIns = await asCommit(MEM, `INSERT INTO songs VALUES ('${id(16)}','${BAND}','Relink','suggested','sb://song-files/${P.learning}',NULL) RETURNING 1 AS v`);
ok(String(linkIns).includes('BW_FILE_REMOVED'), `linking it on a new song is refused (${linkIns})`);
const linkUpd = await asCommit(ADMIN, `UPDATE songs SET chart_url = 'sb://song-files/${P.learning}' WHERE id = '${id(14)}' RETURNING 1 AS v`);
ok(String(linkUpd).includes('BW_FILE_REMOVED'), 'linking it on an existing song is refused');
ok((await asCommit(ADMIN, `UPDATE songs SET title = 'Coney Island' WHERE id = '${id(14)}' RETURNING 1 AS v`)) === 1, 'other song edits are unaffected');
const sugIns = await asCommit(MEM, `INSERT INTO song_suggestions (band_id, song_id, kind, proposed, created_by)
  VALUES ('${BAND}','${id(11)}','note', jsonb_build_object('audio_url', 'sb://song-files/${P.learning}'), '${MEM}') RETURNING 1 AS v`);
ok(String(sugIns).includes('BW_FILE_REMOVED'), `a suggestion linking it is refused while deleting (${sugIns})`);
ok((await asCommit(MEM, `INSERT INTO song_suggestions (band_id, song_id, kind, proposed, created_by)
  VALUES ('${BAND}','${id(11)}','note', '{"note":"louder chorus"}', '${MEM}') RETURNING 1 AS v`)) === 1, 'other suggestions are unaffected');
await db.exec(`DELETE FROM song_suggestions`);

// A failed delete (no done): after 10 minutes the claim lapses and it is pending again.
await db.exec(`UPDATE song_file_adoptions SET deleting_at = now() - interval '11 minutes' WHERE from_path = '${P.learning}'`);
ok((await sweep(ADMIN)).includes(P.learning), 'lapsed claim: listed for the sweep again');
const c2 = await claim(ADMIN2, P.learning);
ok(c2 && c2.ok === true, 'and can be claimed again');
ok((await doneSweep(ADMIN, [P.readyChart])) === 0, 'done only marks claimed deletes');
const done = await doneSweep(ADMIN2, [P.learning]); // the claimer (ADMIN2) closes it
ok(done === 1 && (await state(P.learning)) === 'cleaned' && !(await sweep(ADMIN)).includes(P.learning), 'marked done: no longer listed');

// The record is not readable or writable by app users.
ok((await as(ADMIN, () => q(`SELECT 1 FROM song_file_adoptions`).then(() => 'read', () => 'denied'))) === 'denied', 'adoption records: no direct access');
// A lost response: the commit happened; a re-read shows the copy, nothing to undo.
ok((await ref()) === `sb://song-files/${DEST}`, 'after the repoint the song keeps the copy');

// ---- Claude review of #295: a file another song uses is never removed.
const O = `${BAND}/audio/o-band-take.mp3`;
const U = `${BAND}/suggestions/${MEM}/audio/u-own.mp3`;
const S1 = id(20);
await stored(O);
await stored(U, MEM);
await stored(`${U}x`, MEM);
await db.exec(`INSERT INTO songs VALUES ('${S1}','${BAND}','Band song on O','ready','sb://song-files/${O}',NULL)`);
// A member can't point a song at a file another song uses.
const reuse = await asCommit(MEM, `INSERT INTO songs VALUES ('${id(21)}','${BAND}','Reuse O','suggested','sb://song-files/${O}',NULL) RETURNING 1 AS v`);
ok(String(reuse).includes('BW_FILE_IN_USE'), `a member's song reusing another song's file is refused (${reuse})`);
ok((await as(MEM, () => q(`INSERT INTO songs VALUES ('${id(22)}','${BAND}','Own upload','suggested','sb://song-files/${U}x',NULL)`).then(() => 1, (e) => e.message))) === 1,
  'a member links their own new upload');
ok((await as(ADMIN, () => q(`INSERT INTO songs VALUES ('${id(23)}','${BAND}','Admin copy','ready','sb://song-files/${O}',NULL)`).then(() => 1, (e) => e.message))) === 1,
  'an admin may still link a band file to two songs');
// Older builds' songs that already point at O (inserted before 197): reject / withdraw keep O.
const review = (user, g, d) => asCommit(user, `SELECT public.bw_review_song_suggestion($1, $2) AS v`, [g, d]);
const withdraw = (user, g) => asCommit(user, `SELECT public.bw_withdraw_song_suggestion($1) AS v`, [g]);
await db.exec(`ALTER TABLE songs DISABLE TRIGGER songs_file_not_removed`).catch(() => undefined);
await db.exec(`INSERT INTO songs VALUES ('${id(24)}','${BAND}','S2 on O','suggested','sb://song-files/${O}',NULL),
  ('${id(25)}','${BAND}','S3 on O','suggested',NULL,'sb://song-files/${O}'),
  ('${id(26)}','${BAND}','S4 own','suggested','sb://song-files/${U}',NULL);
  INSERT INTO song_suggestions (id, band_id, song_id, kind, created_by) VALUES
  ('${id(30)}','${BAND}','${id(24)}','new_song','${MEM}'), ('${id(31)}','${BAND}','${id(25)}','new_song','${MEM}'),
  ('${id(32)}','${BAND}','${id(26)}','new_song','${MEM}')`);
await db.exec(`ALTER TABLE songs ENABLE TRIGGER songs_file_not_removed`).catch(() => undefined);
const rej = await review(ADMIN, id(30), 'reject');
ok(rej && Array.isArray(rej.files) && rej.files.length === 0, `reject keeps a file another song uses (${JSON.stringify(rej?.files ?? rej)})`);
const wd = await withdraw(MEM, id(31));
ok(wd && Array.isArray(wd.files) && wd.files.length === 0, `withdraw keeps it too (${JSON.stringify(wd?.files ?? wd)})`);
const rej2 = await review(ADMIN, id(32), 'reject');
ok(rej2 && JSON.stringify(rej2.files) === JSON.stringify([`sb://song-files/${U}`]), `reject still returns a file only that song used (${JSON.stringify(rej2?.files ?? rej2)})`);
ok((await q(`SELECT count(*)::int AS n FROM songs WHERE id IN ('${id(24)}','${id(25)}','${id(26)}')`)).rows[0].n === 0, 'the rejected / withdrawn songs are gone');
// 180 (account deletion, B1): a former member's suggestion has created_by NULL.
// 180's real withdraw was loaded before 197; after 197 its fix must hold.
await db.exec(`INSERT INTO songs VALUES ('${id(27)}','${BAND}','Former member song','suggested',NULL,NULL);
  INSERT INTO song_suggestions (id, band_id, song_id, kind, created_by) VALUES ('${id(33)}','${BAND}','${id(27)}','new_song',NULL)`);
const wdNull = await withdraw(MEM2, id(33));
ok(String(wdNull).includes('Not your suggestion'), `nobody withdraws a former member's suggestion (${JSON.stringify(wdNull)})`);
ok((await q(`SELECT count(*)::int AS n FROM songs WHERE id = '${id(27)}'`)).rows[0].n === 1, 'and its song stays');
ok(String(await repoint(ADMIN, SONG, '', DEST)).includes('Bad source'), 'an empty source is refused (no NULL slip-through)');

// Reads that report a missing object as no rows (so a FAIL is counted, not a crash).
const qs = (sql, p) => q(sql, p).catch(() => ({ rows: [] }));
// What the app may remove (deleting a song, replacing a file): only through
// a claim (Codex review of 02405d5c, blocker 2). The old check-then-delete
// function is gone.
ok((await qs(`SELECT to_regprocedure('public.bw_song_files_unused(text[])') IS NULL AS v`)).rows[0].v === true, 'no check-only "unused" function');
const claimDel = (user, refs) => asCommit(user, `SELECT public.bw_song_files_claim_delete($1) AS v`, [refs]);
const removedDone = (user, refs) => asCommit(user, `SELECT public.bw_song_files_removed($1) AS v`, [refs]);
ok((rej2?.files ?? []).length === 1 && (await qs(`SELECT claimed_by FROM song_file_removals WHERE path = $1`, [U])).rows[0]?.claimed_by === ADMIN,
  'reject claims the files it returns (old builds delete them right after)');
const linkU = await asCommit(ADMIN, `INSERT INTO songs VALUES ('${id(40)}','${BAND}','Relink U','ready','sb://song-files/${U}',NULL) RETURNING 1 AS v`);
ok(String(linkU).includes('BW_FILE_REMOVED'), `a claimed file can't be linked meanwhile (${linkU})`);
const W = `${BAND}/audio/w-replaced.mp3`;
const ownMem = `${BAND}/suggestions/${MEM2}/audio/own.mp3`;
// (Round 10: only files in Storage are claimed.)
await q(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('song-files', $1, $2), ('song-files', $3, $4)`, [W, ADMIN, ownMem, MEM2]);
const c1d = await claimDel(ADMIN, [`sb://song-files/${O}`, `sb://song-files/${U}`, `sb://song-files/${W}`, `sb://song-files/${OTHER_BAND}/audio/z.mp3`, 'https://example.com/x.mp3']);
ok(Array.isArray(c1d) && c1d.length === 2 && c1d.includes(`sb://song-files/${U}`) && c1d.includes(`sb://song-files/${W}`) && !c1d.includes(`sb://song-files/${O}`),
  `claim: only files nothing uses, of the caller's band (${JSON.stringify(c1d)})`);
ok(JSON.stringify(await claimDel(ADMIN2, [`sb://song-files/${W}`])) === '[]', 'claim: another admin meanwhile gets nothing');
ok(JSON.stringify(await claimDel(STRANGER, [`sb://song-files/${U}`])) === '[]', 'claim: nothing of another band');
ok(JSON.stringify(await claimDel(MEM2, [`sb://song-files/${BAND}/audio/v.mp3`])) === '[]', 'claim: a member only for their own suggestion files');
ok(JSON.stringify(await claimDel(MEM2, [`sb://song-files/${ownMem}`])) === JSON.stringify([`sb://song-files/${ownMem}`]), 'claim: a member for their own suggestion file');
ok((await removedDone(ADMIN, [`sb://song-files/${W}`])) === 1 && (await qs(`SELECT 1 FROM song_file_removals WHERE path = $1`, [W])).rows.length === 0, 'removed: the claim is closed');
// A failed delete: the claim lapses after 10 minutes, links work again.
await db.exec(`UPDATE song_file_removals SET claimed_at = now() - interval '11 minutes' WHERE path = '${U}'`).catch(() => undefined);
ok(JSON.stringify(await claimDel(ADMIN2, [`sb://song-files/${U}`])) === JSON.stringify([`sb://song-files/${U}`]), 'a lapsed claim can be claimed again');
// After the link block (15 minutes, Codex review of f32a26e7): linkable again
// while the file is still in Storage; once really deleted, refused (Claude
// review of f32a26e7, MINOR 3).
await db.exec(`UPDATE song_file_removals SET claimed_at = now() - interval '16 minutes' WHERE path = '${U}'`).catch(() => undefined);
ok((await as(ADMIN, () => q(`INSERT INTO songs VALUES ('${id(41)}','${BAND}','Relink U later','ready','sb://song-files/${U}',NULL)`).then(() => 1, (e) => e.message))) === 1,
  'after the lapse the file, still in Storage, can be linked again');
// (Storage deleted it as the service would: the stand-in row goes, as superuser.)
await db.exec('BEGIN');
await q(`DELETE FROM storage.objects WHERE bucket_id = 'song-files' AND name = $1`, [U]);
await db.exec(`SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN}","role":"authenticated"}', true); SET LOCAL ROLE authenticated;`);
const relinkGone = await q(`INSERT INTO songs VALUES ('${id(42)}','${BAND}','Relink U deleted','ready','sb://song-files/${U}',NULL)`)
  .then(() => 'linked', (e) => e.code ?? e.message);
await db.exec('ROLLBACK');
ok(relinkGone === 'BWF02', `after the lapse a file really deleted is refused, BWF02 (${relinkGone})`);
await q(`INSERT INTO song_suggestions (band_id, kind, proposed) VALUES ($1, 'note', jsonb_build_object('audio_url', $2::text))`, [BAND, `sb://song-files/${U}`]);
ok(JSON.stringify(await claimDel(ADMIN, [`sb://song-files/${U}`])) === '[]', 'claim: a file a suggestion links is kept');
await db.exec(`DELETE FROM song_suggestions WHERE kind = 'note'`);

// ---- Round 5 (Codex review of 02405d5c)
// Blocker 1: a link and a claim on the same file are ordered by one lock:
// every link takes a shared transaction lock on the file's key, every claim
// (sweep or delete) the exclusive one on the same key. PGlite is a single
// connection, so the race is shown through pg_locks inside a transaction
// plus both sequential orders.
const def = async (sig) => (await qs(`SELECT pg_get_functiondef($1::regprocedure) AS v`, [sig])).rows[0].v;
const trgDef = await def('public.bw_trg_song_file_not_removed()').catch(() => '');
const sweepDef = await def('public.bw_song_file_sweep_claim(uuid, text)').catch(() => '');
const delDef = (await def('public.bw_song_files_claim_delete(text[])').catch(() => '')).includes('bw_song_files_claim_for(')
  ? (await def('public.bw_song_files_claim_for(text[], uuid, boolean, uuid)').catch(() => '')) || (await def('public.bw_song_files_claim_for(text[], uuid, boolean)').catch(() => ''))
  : '';
const SHARED = 'pg_advisory_xact_lock_shared(public.bw_song_file_lock_key(';
const EXCL = 'pg_advisory_xact_lock(public.bw_song_file_lock_key(';
ok(trgDef.includes(SHARED), 'the link trigger takes the shared lock on the file key');
ok(sweepDef.includes(EXCL) && delDef.includes(EXCL), 'the sweep claim and the delete claim take the exclusive lock on the same key');
// The key is computed up front (app users can't call the key function).
const keyOf = async (path) => (await qs(`SELECT public.bw_song_file_lock_key($1)::text AS k`, [path])).rows[0]?.k ?? null;
const keyHeld = (k, mode) => k == null ? Promise.resolve(-1) : q(`SELECT count(*)::int AS n FROM pg_locks l
  WHERE l.locktype = 'advisory' AND l.mode = $2 AND l.granted AND l.objsubid = 1
    AND l.classid = (($1::bigint >> 32) & 4294967295)::oid AND l.objid = ($1::bigint & 4294967295)::oid`, [k, mode]).then((r) => r.rows[0].n, () => -1);
const C = sug(MEM, 'audio/r5-copying.mp3');
await db.exec(`INSERT INTO songs VALUES ('${id(50)}','${BAND}','R5 accepted','learning','sb://song-files/${C}',NULL)`);
await stored(C, MEM);
// A transaction that links C holds the shared key until it ends, also while
// the adoption is still 'copying' (no record row to lock yet).
await asCommit(ADMIN, `SELECT public.bw_song_file_adopt_begin($1, 'audio_url') AS v`, [id(50)]);
ok((await qs(`SELECT state FROM song_file_adoptions WHERE from_path = $1`, [C])).rows[0]?.state === 'copying', 'adoption of C is copying');
const keyC = await keyOf(C);
const heldShared = await as(ADMIN, async () => {
  await q(`INSERT INTO songs VALUES ('${id(51)}','${BAND}','Links C while copying','suggested','sb://song-files/${C}',NULL)`).catch(() => undefined);
  return keyHeld(keyC, 'ShareLock');
}).catch(() => -1);
ok(heldShared === 1, `a link transaction holds the shared lock on C's key until commit (${heldShared})`);
const C2 = sug(MEM, 'audio/r5-free.mp3');
const keyC2 = await keyOf(C2);
const heldExcl = await as(ADMIN, async () => {
  await q(`SELECT public.bw_song_files_claim_delete($1)`, [[`sb://song-files/${C2}`]]).catch(() => undefined);
  return keyHeld(keyC2, 'ExclusiveLock');
}).catch(() => -1);
ok(heldExcl === 1, `a claim holds the exclusive lock on the same key (${heldExcl})`);
// Order 1: link (while copying) commits, then the adoption and the sweep claim: claim refused.
const DC = `${BAND}/audio/${id(50)}-r5-copying.mp3`;
ok((await asCommit(ADMIN, `INSERT INTO songs VALUES ('${id(52)}','${BAND}','Links C first','ready','sb://song-files/${C}',NULL) RETURNING 1 AS v`)) === 1, 'order 1: a song links C while copying');
await stored(DC);
await asCommit(ADMIN, `SELECT public.bw_song_file_adopt_repoint($1, 'audio_url', $2, $3) AS v`, [id(50), C, DC]);
ok((await claim(ADMIN, C)).reason === 'referenced', 'order 1: then the sweep claim is refused');
// Order 2: the claim first, then a link: link refused.
await db.exec(`DELETE FROM songs WHERE id = '${id(52)}'`);
ok((await claim(ADMIN, C)).ok === true, 'order 2: the sweep claims C');
ok(String(await asCommit(ADMIN, `INSERT INTO songs VALUES ('${id(53)}','${BAND}','Links C late','ready','sb://song-files/${C}',NULL) RETURNING 1 AS v`)).includes('BW_FILE_REMOVED'),
  'order 2: then the link is refused');
// Blocker 3: BW_FILE_IN_USE only within the caller's band; another band's
// file gets the generic permission error, used or not.
const XO = `${OTHER_BAND}/audio/x-used.mp3`;
await db.exec(`INSERT INTO songs VALUES ('${id(54)}','${OTHER_BAND}','Other band song','ready','sb://song-files/${XO}',NULL)`);
const crossUsed = await asCommit(MEM, `INSERT INTO songs VALUES ('${id(55)}','${BAND}','Cross used','suggested','sb://song-files/${XO}',NULL) RETURNING 1 AS v`);
const crossFree = await asCommit(MEM, `INSERT INTO songs VALUES ('${id(56)}','${BAND}','Cross free','suggested','sb://song-files/${OTHER_BAND}/audio/x-free.mp3',NULL) RETURNING 1 AS v`);
ok(String(crossUsed).startsWith('error') && !String(crossUsed).includes('BW_FILE_IN_USE'), `another band's used file: no BW_FILE_IN_USE (${crossUsed})`);
ok(String(crossUsed) === String(crossFree), 'used or not, the same answer');

// Claude review of 02405d5c: own SQLSTATEs (55000 is "already reviewed").
async function codeOf(user, sql) {
  await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true); SET LOCAL ROLE authenticated;`);
  try { await q(sql); return 'ok'; } catch (e) { return e.code; } finally { await db.exec('ROLLBACK'); }
}
ok((await codeOf(MEM, `INSERT INTO songs VALUES ('${id(60)}','${BAND}','Reuse O again','suggested','sb://song-files/${O}',NULL)`)) === 'BWF01', 'BW_FILE_IN_USE has SQLSTATE BWF01');
ok((await codeOf(ADMIN, `INSERT INTO songs VALUES ('${id(61)}','${BAND}','Link C late again','ready','sb://song-files/${C}',NULL)`)) === 'BWF02', 'BW_FILE_REMOVED has SQLSTATE BWF02');
// The suggestion scan reads only the file's band (no leak, no scan of every band).
const Y = `${BAND}/audio/y-mentioned.mp3`;
await q(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('song-files', $1, $2)`, [Y, ADMIN]);
await q(`INSERT INTO song_suggestions (band_id, kind, proposed) VALUES ($1, 'note', jsonb_build_object('audio_url', $2::text))`, [OTHER_BAND, `sb://song-files/${Y}`]);
ok(JSON.stringify(await claimDel(ADMIN, [`sb://song-files/${Y}`])) === JSON.stringify([`sb://song-files/${Y}`]), 'another band’s suggestion mentioning the path does not count');
await removedDone(ADMIN, [`sb://song-files/${Y}`]);
await q(`INSERT INTO song_suggestions (band_id, kind, proposed) VALUES ($1, 'note', jsonb_build_object('audio_url', $2::text))`, [BAND, `sb://song-files/${Y}`]);
ok(JSON.stringify(await claimDel(ADMIN, [`sb://song-files/${Y}`])) === '[]', 'its own band’s suggestion does');
await db.exec(`DELETE FROM song_suggestions WHERE kind = 'note'`);

// Apply order the other way (197, then 180's real withdraw): it must still
// filter files in use (180 calls bw_song_files_left_unused when it exists,
// #282 at d468b10b). Required; skipped only when no 180 is available.
if (!w180) {
  console.warn('SKIP 197→180 order: no 180 available (main or origin/fix/account-deletion)');
} else {
  ok(w180.includes('bw_song_files_left_unused'), '197→180: 180’s withdraw calls bw_song_files_left_unused');
  const def197 = (await q(`SELECT pg_get_functiondef('public.bw_withdraw_song_suggestion(uuid)'::regprocedure) AS d`)).rows[0].d;
  await db.exec(w180);
  const def180 = (await q(`SELECT pg_get_functiondef('public.bw_withdraw_song_suggestion(uuid)'::regprocedure) AS d`)).rows[0].d;
  ok(def197 === def180, '197’s withdraw is the same function as 180’s');
  await db.exec(`ALTER TABLE songs DISABLE TRIGGER songs_file_not_removed;
    INSERT INTO songs VALUES ('${id(62)}','${BAND}','S5 on O','suggested','sb://song-files/${O}',NULL);
    ALTER TABLE songs ENABLE TRIGGER songs_file_not_removed;
    INSERT INTO song_suggestions (id, band_id, song_id, kind, created_by) VALUES ('${id(63)}','${BAND}','${id(62)}','new_song','${MEM}')`);
  const wd180 = await withdraw(MEM, id(63));
  ok(wd180 && Array.isArray(wd180.files) && wd180.files.length === 0, `197→180: withdraw keeps a file another song uses (${JSON.stringify(wd180?.files ?? wd180)})`);
  ok(String(await withdraw(MEM2, id(33))).includes('Not your suggestion'), '197→180: and still refuses a former member’s suggestion');
}

// ---- Round 6 (Codex review of f32a26e7)
// Storage delete policy: RESTRICTIVE, only with the user's live claim and
// nothing linking the file; other buckets untouched.
const putObj = (name, bucket = 'song-files', owner = ADMIN) => q(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ($1, $2, $3)`, [bucket, name, owner]);
const delAs = (user, name, bucket = 'song-files') => as(user, () => q(`DELETE FROM storage.objects WHERE bucket_id = $2 AND name = $1`, [name, bucket]).then((r) => r.affectedRows, (e) => `error: ${e.message}`));
const pol = (await qs(`SELECT permissive FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'bw_song_files_delete_claimed'`)).rows[0];
ok(pol && pol.permissive === 'RESTRICTIVE', 'the claim policy is RESTRICTIVE (the permissive delete policy stays as is)');
const Z1 = `${BAND}/audio/r6-z1.mp3`, Z2 = `${BAND}/audio/r6-z2.mp3`, Z3 = `${BAND}/audio/r6-z3.mp3`;
for (const z of [Z1, Z2, Z3]) await putObj(z);
ok((await delAs(ADMIN, Z1)) === 0, 'an admin deleting without a claim is refused');
await claimDel(ADMIN, [`sb://song-files/${Z1}`]);
ok((await delAs(ADMIN, Z1)) === 1, 'a delete with the user’s live claim works');
await db.exec(`UPDATE song_file_removals SET claimed_at = now() - interval '11 minutes' WHERE path = '${Z1}'`).catch(() => undefined);
ok((await delAs(ADMIN, Z1)) === 0, 'a late delete after the claim lapsed is refused');
await claimDel(ADMIN, [`sb://song-files/${Z2}`]);
await db.exec(`ALTER TABLE songs DISABLE TRIGGER songs_file_not_removed;
  INSERT INTO songs VALUES ('${id(70)}','${BAND}','Linked again','ready','sb://song-files/${Z2}',NULL);
  ALTER TABLE songs ENABLE TRIGGER songs_file_not_removed`).catch(() => undefined);
ok((await delAs(ADMIN, Z2)) === 0, 'a file linked again is refused, even with a claim');
await claimDel(ADMIN2, [`sb://song-files/${Z3}`]);
ok((await delAs(ADMIN, Z3)) === 0, 'another user’s claim does not count');
ok((await delAs(ADMIN2, Z3)) === 1, 'the claimer may delete it');
await putObj(`${MEM}/notes/own.pdf`, 'personal-files', MEM);
ok((await delAs(MEM, `${MEM}/notes/own.pdf`, 'personal-files')) === 1, 'personal-files deletes work as before');
ok((await delAs(MEM2, `${MEM}/notes/own.pdf`, 'personal-files')) === 0, 'and only by their owner');
// The sweep's own claim (adoption 'deleting' by this admin) allows its delete; nobody else's.
const SW = sug(MEM, 'audio/r6-sweep.mp3');
await putObj(SW);
await db.exec(`INSERT INTO song_file_adoptions (band_id, song_id, field, from_path, to_path, state, deleting_by, deleting_at)
  VALUES ('${BAND}','${id(71)}','audio_url','${SW}','${BAND}/audio/${id(71)}-r6-sweep.mp3','deleting','${ADMIN}', now())`);
ok((await delAs(ADMIN2, SW)) === 0 && (await delAs(ADMIN, SW)) === 1, 'a sweep claim lets only its admin delete');
// Links stay refused a while past the delete window (15 vs 10 minutes), so a
// delete that started in time can't race a link.
const Z4 = `${BAND}/audio/r6-z4.mp3`;
await putObj(Z4);
await claimDel(ADMIN, [`sb://song-files/${Z4}`]);
await db.exec(`UPDATE song_file_removals SET claimed_at = now() - interval '12 minutes' WHERE path = '${Z4}'`).catch(() => undefined);
ok(String(await asCommit(ADMIN, `INSERT INTO songs VALUES ('${id(72)}','${BAND}','Z4 at 12 min','ready','sb://song-files/${Z4}',NULL) RETURNING 1 AS v`)).includes('BW_FILE_REMOVED'),
  'past the delete window, links are still refused for a while');
await db.exec(`UPDATE song_file_removals SET claimed_at = now() - interval '16 minutes' WHERE path = '${Z4}'`).catch(() => undefined);
ok((await asCommit(ADMIN, `INSERT INTO songs VALUES ('${id(73)}','${BAND}','Z4 at 16 min','ready','sb://song-files/${Z4}',NULL) RETURNING 1 AS v`)) === 1, 'then allowed');

// Blocker 1: someone not in the band learns nothing: 42501 before any file check.
const FORMER = id(8);
const formerUsed = await codeOf(FORMER, `INSERT INTO songs VALUES ('${id(74)}','${BAND}','Former used','suggested','sb://song-files/${O}',NULL)`);
const formerRemoved = await codeOf(FORMER, `INSERT INTO songs VALUES ('${id(75)}','${BAND}','Former removed','suggested','sb://song-files/${C}',NULL)`);
const formerFree = await codeOf(FORMER, `INSERT INTO songs VALUES ('${id(76)}','${BAND}','Former free','suggested','sb://song-files/${BAND}/audio/free.mp3',NULL)`);
ok(formerUsed === '42501' && formerRemoved === '42501' && formerFree === '42501', `a non-member gets 42501 whatever the file (${formerUsed}, ${formerRemoved}, ${formerFree})`);

// Minor: a band's records go with the band.
const B3 = id(9);
await db.exec(`INSERT INTO bands VALUES ('${B3}');
  INSERT INTO song_file_adoptions (band_id, song_id, field, from_path, state) VALUES ('${B3}','${id(77)}','audio_url','${B3}/suggestions/x/audio/y.mp3','repointed')`);
await db.exec(`INSERT INTO song_file_removals (path, band_id, claimed_by) VALUES ('${B3}/audio/z.mp3','${B3}','${ADMIN}')`).catch(() => undefined);
await db.exec(`DELETE FROM bands WHERE id = '${B3}'`).catch(() => undefined);
ok((await qs(`SELECT count(*)::int AS n FROM song_file_adoptions WHERE band_id = $1`, [B3])).rows[0]?.n === 0
  && (await qs(`SELECT count(*)::int AS n FROM song_file_removals WHERE band_id = $1`, [B3])).rows[0]?.n === 0, 'deleting a band deletes its file records');

// ---- Claude review of f32a26e7 (MINORs)
// 6: the folder check holds for admins too.
const XA = `${OTHER_BAND}/audio/x-admin.mp3`;
await putObj(XA, 'song-files', STRANGER);
const adminCross = await codeOf(ADMIN, `INSERT INTO songs VALUES ('${id(80)}','${BAND}','Admin cross','ready','sb://song-files/${XA}',NULL)`);
ok(adminCross === '42501', `an admin can't link another band's file either (${adminCross})`);
ok((await codeOf(ADMIN, `INSERT INTO songs VALUES ('${id(81)}','${BAND}','Admin own','ready','sb://song-files/${O}',NULL)`)) === 'ok', 'an admin still links a file of the band');

// 3: a file not in Storage can't be linked (never uploaded, or deleted).
ok((await codeOf(ADMIN, `INSERT INTO songs VALUES ('${id(82)}','${BAND}','Ghost','ready','sb://song-files/${BAND}/audio/never-uploaded.mp3',NULL)`)) === 'BWF02',
  'a file that is not in Storage is refused (BWF02)');

// 4: a lapsed delete claim nothing uses is swept, so nothing stays orphaned.
const R7 = `${BAND}/audio/r7-lapsed.mp3`;
const R7used = `${BAND}/audio/r7-lapsed-used.mp3`;
const R7fresh = `${BAND}/audio/r7-fresh.mp3`;
await putObj(R7); await putObj(R7used); await putObj(R7fresh);
await db.exec(`INSERT INTO songs VALUES ('${id(83)}','${BAND}','Uses R7used','ready','sb://song-files/${R7used}',NULL)`);
await db.exec(`INSERT INTO song_file_removals (path, band_id, claimed_by, claimed_at) VALUES
  ('${R7}','${BAND}','${MEM2}', now() - interval '11 minutes'),
  ('${R7used}','${BAND}','${MEM2}', now() - interval '11 minutes'),
  ('${R7fresh}','${BAND}','${MEM2}', now() - interval '2 minutes')`).catch(() => undefined);
const list7 = await sweep(ADMIN);
ok(Array.isArray(list7) && list7.includes(R7) && !list7.includes(R7used) && !list7.includes(R7fresh),
  `the sweep lists a lapsed delete claim nothing uses, not a used or fresh one (${Array.isArray(list7) ? list7.filter((p) => p.includes('r7')).length : list7})`);
const c7 = await claim(ADMIN, R7);
ok(c7 && c7.ok === true && (await qs(`SELECT claimed_by FROM song_file_removals WHERE path = $1`, [R7])).rows[0]?.claimed_by === ADMIN,
  `its sweep claim takes it over for this admin (${JSON.stringify(c7)})`);
ok((await claim(ADMIN2, R7fresh))?.ok !== true, 'a fresh claim of someone else is not taken over');
ok((await delAs(ADMIN, R7)) === 1, 'then its delete goes through');
ok((await doneSweep(ADMIN, [R7])) >= 1 && (await qs(`SELECT 1 FROM song_file_removals WHERE path = $1`, [R7])).rows.length === 0, 'and done closes the claim');

// 1: reject takes file keys first, then band keys (the suggestion's own file
// check comes after the claim). Keys logged in a rolled-back transaction.
const LO = `${BAND}/suggestions/${MEM}/audio/lock-order.mp3`;
await putObj(LO, 'song-files', MEM);
await db.exec(`ALTER TABLE songs DISABLE TRIGGER songs_file_not_removed;
  INSERT INTO songs VALUES ('${id(84)}','${BAND}','Lock order','suggested','sb://song-files/${LO}',NULL);
  ALTER TABLE songs ENABLE TRIGGER songs_file_not_removed;
  INSERT INTO song_suggestions (id, band_id, song_id, kind, created_by) VALUES ('${id(85)}','${BAND}','${id(84)}','new_song','${MEM}')`);
const keyLog = await (async () => {
  await db.exec(`BEGIN;
    CREATE TABLE public.key_log (seq serial, kind text);
    GRANT ALL ON public.key_log TO authenticated; GRANT USAGE ON SEQUENCE public.key_log_seq_seq TO authenticated;
    CREATE OR REPLACE FUNCTION public.bw_song_file_lock_key(p_path text) RETURNS bigint LANGUAGE plpgsql VOLATILE SET search_path TO 'public' AS $f$
      BEGIN INSERT INTO public.key_log (kind) VALUES ('file'); RETURN hashtextextended('bw:song-file:' || coalesce(p_path, ''), 0); END $f$;
    CREATE OR REPLACE FUNCTION public.bw_song_file_band_key(p_band_id uuid) RETURNS bigint LANGUAGE plpgsql VOLATILE SET search_path TO 'public' AS $f$
      BEGIN INSERT INTO public.key_log (kind) VALUES ('band'); RETURN hashtextextended('bw:song-file-band:' || coalesce(p_band_id::text, ''), 0); END $f$;
    SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN}","role":"authenticated"}', true); SET LOCAL ROLE authenticated;`);
  try {
    await q(`SELECT public.bw_review_song_suggestion($1, 'reject', $2)`, [id(85), `duplicate of ${BAND}/audio/o-band-take.mp3`]);
    await db.exec('RESET ROLE');
    return (await q(`SELECT kind FROM public.key_log ORDER BY seq`)).rows.map((r) => r.kind);
  } catch (e) { return `error: ${e.message}`; } finally { await db.exec('ROLLBACK'); }
})();
ok(Array.isArray(keyLog) && keyLog.includes('file') && keyLog.includes('band') && keyLog.lastIndexOf('file') < keyLog.indexOf('band'),
  `reject: all file keys before any band key (${Array.isArray(keyLog) ? keyLog.join(',') : keyLog})`);

// ---- Round 7: Codex and Claude reviews of 220767ca
const R = (p) => `sb://song-files/${p}`;
const commitSql = async (user, sql, params) => {
  await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true); SET LOCAL ROLE authenticated;`);
  try { const r = await q(sql, params); await db.exec('COMMIT'); return r.affectedRows ?? 0; } catch (e) { await db.exec('ROLLBACK'); return `error: ${e.code ?? e.message}`; }
};
await db.exec(`GRANT UPDATE, DELETE ON public.song_suggestions TO authenticated; GRANT DELETE ON public.songs TO authenticated;
  CREATE POLICY sug_update_any ON public.song_suggestions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY songs_delete_any ON public.songs FOR DELETE TO authenticated USING (true);`);

// Codex 1: outside the band, 42501 before any lookup, on suggestions too.
const Q7 = `${BAND}/audio/r7-claimed.mp3`;
await putObj(Q7);
await claimDel(ADMIN, [R(Q7)]);
const SUGR = id(100);
await db.exec(`INSERT INTO song_suggestions (id, band_id, kind, proposed, created_by) VALUES ('${SUGR}','${BAND}','note','{"note":"x"}','${MEM}')`);
const fIns = await codeOf(FORMER, `INSERT INTO song_suggestions (band_id, kind, proposed, created_by) VALUES ('${BAND}','note', jsonb_build_object('audio_url','${R(Q7)}'), '${FORMER}')`);
const fUpd = await codeOf(FORMER, `UPDATE song_suggestions SET proposed = jsonb_build_object('audio_url','${R(Q7)}') WHERE id = '${SUGR}'`);
const fSongUpd = await codeOf(FORMER, `UPDATE songs SET audio_url = '${R(Q7)}' WHERE id = '${S1}'`);
const fFree = await codeOf(FORMER, `INSERT INTO song_suggestions (band_id, kind, proposed, created_by) VALUES ('${BAND}','note','{"note":"hi"}','${FORMER}')`);
// (A song row outside your bands isn't visible to update at all: 0 rows, no trigger.)
ok(fIns === '42501' && fUpd === '42501' && (fSongUpd === '42501' || fSongUpd === 'ok') && fFree === '42501',
  `a non-member gets 42501 on suggestion insert / update (file or not), never BWF02 on songs (${fIns}, ${fUpd}, ${fSongUpd}, ${fFree})`);
ok((await codeOf(MEM, `INSERT INTO song_suggestions (band_id, kind, proposed, created_by) VALUES ('${BAND}','note', jsonb_build_object('audio_url','${R(Q7)}'), '${MEM}')`)) === 'BWF02',
  'a member gets BWF02 for a structured ref to a claimed file');

// Codex 3 + Claude M3: only structured refs count (a JSON value that is exactly
// a ref), never free text; and only pending suggestions keep a file.
ok((await codeOf(MEM, `INSERT INTO song_suggestions (band_id, kind, proposed, message, created_by) VALUES ('${BAND}','note',
  jsonb_build_object('note','the take is at ${R(Q7)}'), 'see ${Q7}', '${MEM}')`)) === 'ok', 'free text naming a claimed file is not refused');
const P7 = `${BAND}/audio/r7-pending.mp3`;
await db.exec(`DELETE FROM song_suggestions WHERE kind = 'note';
  INSERT INTO song_suggestions (band_id, kind, proposed, status) VALUES
    ('${BAND}','note', jsonb_build_object('note','text ${R(P7)}'), 'pending'),
    ('${BAND}','note', jsonb_build_object('audio_url','${R(P7)}x'), 'rejected')`);
const inUseQ = async (p) => (await qs(`SELECT public.bw_song_file_in_use($1) AS v`, [p])).rows[0]?.v;
ok((await inUseQ(P7)) === false && (await inUseQ(`${P7}x`)) === false, 'free text and non-pending suggestions do not keep a file');
await db.exec(`INSERT INTO song_suggestions (band_id, kind, proposed, status) VALUES ('${BAND}','note', jsonb_build_object('song', jsonb_build_object('audio_url','${R(P7)}')), 'pending')`);
ok((await inUseQ(P7)) === true, 'a pending suggestion with the ref under audio_url keeps it (any depth)');
await db.exec(`DELETE FROM song_suggestions WHERE kind = 'note'`);

// Claude M2: sweep_done marks only the caller's own sweep claims.
const M2P = sug(MEM, 'audio/r7-m2.mp3');
await db.exec(`INSERT INTO song_file_adoptions (band_id, song_id, field, from_path, to_path, state, deleting_by, deleting_at)
  VALUES ('${BAND}','${id(101)}','audio_url','${M2P}','${BAND}/audio/${id(101)}-r7-m2.mp3','deleting','${ADMIN}', now())`);
ok((await doneSweep(ADMIN2, [M2P])) === 0 && (await qs(`SELECT state FROM song_file_adoptions WHERE from_path = $1`, [M2P])).rows[0]?.state === 'deleting',
  'sweep_done does not close another admin’s claim');

// Claude M4: reject / withdraw claim only files of the song's band.
const XB = `${OTHER_BAND}/audio/r7-x.mp3`;
await putObj(XB, 'song-files', STRANGER);
await db.exec(`ALTER TABLE songs DISABLE TRIGGER songs_file_not_removed;
  INSERT INTO songs VALUES ('${id(102)}','${BAND}','Cross old','suggested','${R(XB)}',NULL);
  ALTER TABLE songs ENABLE TRIGGER songs_file_not_removed;
  INSERT INTO song_suggestions (id, band_id, song_id, kind, created_by) VALUES ('${id(103)}','${BAND}','${id(102)}','new_song','${MEM}')`);
await db.exec(`INSERT INTO band_members VALUES ('${OTHER_BAND}','${ADMIN}','admin',true)`);
const rejX = await review(ADMIN, id(103), 'reject');
await db.exec(`DELETE FROM band_members WHERE band_id = '${OTHER_BAND}' AND user_id = '${ADMIN}'`);
ok(rejX && JSON.stringify(rejX.files) === '[]' && (await qs(`SELECT 1 FROM song_file_removals WHERE path = $1`, [XB])).rows.length === 0,
  `reject claims no file of another band, even one the admin is in (${JSON.stringify(rejX?.files ?? rejX)})`);

// Claude B1: an old build deletes a song (or replaces its file) and its own
// Storage delete is refused: the file becomes a lapsed claim the sweep takes.
const OB = `${BAND}/audio/r7-oldbuild.mp3`;
const OB2 = `${BAND}/audio/r7-oldbuild-replaced.mp3`;
const OBN = `${BAND}/audio/r7-oldbuild-new.mp3`;
const OBS = `${BAND}/audio/r7-oldbuild-shared.mp3`;
for (const p of [OB, OB2, OBN, OBS]) await putObj(p);
await db.exec(`INSERT INTO songs VALUES ('${id(104)}','${BAND}','Old build delete','ready','${R(OB)}','${R(OBS)}'),
  ('${id(105)}','${BAND}','Old build replace','ready','${R(OB2)}',NULL), ('${id(106)}','${BAND}','Shares','ready','${R(OBS)}',NULL)`);
ok((await commitSql(ADMIN, `DELETE FROM songs WHERE id = '${id(104)}'`)) === 1, 'an old build deletes a song');
ok((await delAs(ADMIN, OB)) === 0, 'its own Storage delete (no claim) is refused');
ok((await commitSql(ADMIN, `UPDATE songs SET audio_url = '${R(OBN)}' WHERE id = '${id(105)}'`)) === 1, 'an old build replaces a file');
const listB1 = await sweep(ADMIN);
ok(Array.isArray(listB1) && listB1.includes(OB) && listB1.includes(OB2) && !listB1.includes(OBS) && !listB1.includes(OBN),
  `the files the songs no longer have (and nothing else uses) are listed for the sweep (${Array.isArray(listB1) ? listB1.filter((p) => p.includes('oldbuild')).join(' ') : listB1})`);
const cOB = await claim(ADMIN, OB);
const delObj = (user, name) => commitSql(user, `DELETE FROM storage.objects WHERE bucket_id = 'song-files' AND name = $1`, [name]);
ok(cOB?.ok === true && (await delObj(ADMIN, OB)) === 1 && (await doneSweep(ADMIN, [OB])) >= 1
  && (await qs(`SELECT 1 FROM storage.objects WHERE name = $1`, [OB])).rows.length === 0 && (await qs(`SELECT 1 FROM song_file_removals WHERE path = $1`, [OB])).rows.length === 0,
  `after the sweep the old build's file is gone (${JSON.stringify(cOB)})`);
await db.exec(`INSERT INTO songs VALUES ('${id(107)}','${id(999)}','No band row','ready','sb://song-files/${id(999)}/audio/x.mp3',NULL)`);
ok((await qs(`DELETE FROM songs WHERE id = '${id(107)}' RETURNING 1 AS v`)).rows.length === 1, 'a song whose band row is gone still deletes');

// Claude B1 backfill: old unused objects become lapsed claims (never deleted
// by the migration); referenced or recent ones don't.
// (Round 10: in a suggestions folder; an old object in a final folder only
// starts its 7-day grace, see below.)
const BF1 = sug(MEM, 'audio/r7-bf-old.mp3'), BF2 = `${BAND}/audio/r7-bf-used.mp3`, BF3 = `${BAND}/audio/r7-bf-new.mp3`;
const BF4 = `${BAND}/audio/r7-bf-final.mp3`;
await db.exec(`INSERT INTO storage.objects (bucket_id, name, owner, created_at) VALUES
  ('song-files','${BF1}','${ADMIN}', now() - interval '2 days'), ('song-files','${BF2}','${ADMIN}', now() - interval '2 days'),
  ('song-files','${BF3}','${ADMIN}', now()), ('song-files','${BF4}','${ADMIN}', now() - interval '2 days');
  INSERT INTO songs VALUES ('${id(108)}','${BAND}','Uses BF2','ready','${R(BF2)}',NULL)`);
await db.exec(mig);
const bf = async (p) => (await qs(`SELECT claimed_by, claimed_at < now() - interval '10 minutes' AS lapsed FROM song_file_removals WHERE path = $1`, [p])).rows[0];
ok((await bf(BF1))?.lapsed === true && (await bf(BF1))?.claimed_by === null && !(await bf(BF2)) && !(await bf(BF3))
  && (await qs(`SELECT 1 FROM storage.objects WHERE name = $1`, [BF1])).rows.length === 1,
  'backfill: an old unused object becomes a lapsed claim (not deleted); a used or recent one does not');
ok((await sweep(ADMIN)).includes(BF1), 'and the sweep lists it');
ok(!(await bf(BF4)) && (await qs(`SELECT 1 FROM song_file_orphan_seen WHERE path = $1`, [BF4])).rows.length === 1 && !(await sweep(ADMIN)).includes(BF4),
  'Round 10: backfill: an old unused object in a final folder only starts its grace (first seen, not listed)');

// Codex 5: a copy is registered before it is made; if the song goes before
// the repoint, the sweep deletes it.
const CPS = id(110);
const CPF = sug(MEM, 'audio/r7-copy.mp3');
const CPT = `${BAND}/audio/${CPS}-r7-copy.mp3`;
await putObj(CPF, 'song-files', MEM);
await db.exec(`INSERT INTO songs VALUES ('${CPS}','${BAND}','Copy then gone','learning','${R(CPF)}',NULL)`);
const reserve = (user, song, from, to) => asCommit(user, `SELECT public.bw_song_file_copy_reserve($1, 'audio_url', $2, $3) AS v`, [song, from, to]);
ok(String(await reserve(MEM, CPS, CPF, CPT)).startsWith('error'), 'a member cannot register a copy');
ok(String(await reserve(ADMIN, CPS, CPF, `${BAND}/audio/elsewhere.mp3`)).includes('Bad destination'), 'nor anyone a bad destination');
await asCommit(ADMIN, `SELECT public.bw_song_file_adopt_begin($1, 'audio_url') AS v`, [CPS]);
ok(!String(await reserve(ADMIN, CPS, CPF, CPT)).startsWith('error'), 'an admin registers the copy before making it');
await putObj(CPT);
await db.exec(`DELETE FROM songs WHERE id = '${CPS}'`);
ok(!(await sweep(ADMIN)).includes(CPT), 'a fresh copy is not swept yet');
await db.exec(`UPDATE song_file_copies SET made_at = now() - interval '11 minutes' WHERE path = '${CPT}'`).catch(() => undefined);
ok((await sweep(ADMIN)).includes(CPT), 'once stale, the unused copy is listed');
ok((await claim(ADMIN, CPT))?.ok === true && (await delObj(ADMIN, CPT)) === 1 && (await doneSweep(ADMIN, [CPT])) >= 1
  && (await qs(`SELECT 1 FROM song_file_copies WHERE path = $1`, [CPT])).rows.length === 0
  && (await qs(`SELECT 1 FROM storage.objects WHERE name = $1`, [CPT])).rows.length === 0, 'and the sweep deletes it');
// A copy the song links (repointed) is not a leftover.
const CPS2 = id(111), CPF2 = sug(MEM, 'audio/r7-copy2.mp3'), CPT2 = `${BAND}/audio/${CPS2}-r7-copy2.mp3`;
await putObj(CPF2, 'song-files', MEM);
await db.exec(`INSERT INTO songs VALUES ('${CPS2}','${BAND}','Copy kept','learning','${R(CPF2)}',NULL)`);
await asCommit(ADMIN, `SELECT public.bw_song_file_adopt_begin($1, 'audio_url') AS v`, [CPS2]);
await reserve(ADMIN, CPS2, CPF2, CPT2);
await putObj(CPT2);
await asCommit(ADMIN, `SELECT public.bw_song_file_adopt_repoint($1, 'audio_url', $2, $3) AS v`, [CPS2, CPF2, CPT2]);
ok((await qs(`SELECT 1 FROM song_file_copies WHERE path = $1`, [CPT2])).rows.length === 0, 'the repoint closes the copy’s registration');

// Codex 2 + 3: reject notifies the author once, with the reason, also when the
// reason names the song's file; and that file is still claimed.
const closeSrc = (src180 && fnFrom(src180, 'bw_trg_song_suggestion_close')) || fnFrom(readFileSync(`${REPO}/supabase/migrations/108_song_suggestions.sql`, 'utf8'), 'bw_trg_song_suggestion_close');
await db.exec(closeSrc);
await db.exec(`DROP TRIGGER IF EXISTS songs_suggestion_close_delete ON public.songs;
  CREATE TRIGGER songs_suggestion_close_delete BEFORE DELETE ON public.songs FOR EACH ROW EXECUTE FUNCTION public.bw_trg_song_suggestion_close();
  CREATE OR REPLACE FUNCTION public.bw_notify_song_suggestion_outcome(p uuid) RETURNS void LANGUAGE sql AS $f$
    INSERT INTO public.notifications (type, reference_id, read) SELECT 'outcome:' || coalesce(reason, ''), p, false FROM public.song_suggestions WHERE id = p $f$;`);
const NF = sug(MEM, 'audio/r7-notify.mp3');
await putObj(NF, 'song-files', MEM);
await db.exec(`INSERT INTO songs VALUES ('${id(112)}','${BAND}','Notify me','suggested','${R(NF)}',NULL);
  INSERT INTO song_suggestions (id, band_id, song_id, kind, created_by) VALUES ('${id(113)}','${BAND}','${id(112)}','new_song','${MEM}')`);
const reason = `same take as ${NF}`;
const rejN = await asCommit(ADMIN, `SELECT public.bw_review_song_suggestion($1, 'reject', $2) AS v`, [id(113), reason]);
const notes = (await qs(`SELECT type FROM notifications WHERE reference_id = $1`, [id(113)])).rows;
ok(rejN && !String(rejN).startsWith('error'), `a reason naming the song's file does not block the reject (${typeof rejN === 'string' ? rejN : 'ok'})`);
ok(notes.length === 1 && notes[0].type === `outcome:${reason}`, `the author gets exactly one notice, with the reason (${JSON.stringify(notes)})`);
ok(JSON.stringify(rejN?.files) === JSON.stringify([R(NF)]), `and the song's file is still claimed for deletion (${JSON.stringify(rejN?.files)})`);

// ---- Round 8: Claude review of ed7ec29f
// 1: bw_song_files_removed releases only the copies this call released (its
// own claims), of the caller's admin bands.
const RCS = id(120), RCF = sug(MEM, 'audio/r8-copy.mp3'), RCT = `${BAND}/audio/${RCS}-r8-copy.mp3`;
await putObj(RCF, 'song-files', MEM);
await db.exec(`INSERT INTO songs VALUES ('${RCS}','${BAND}','R8 copy','learning','${R(RCF)}',NULL)`);
await reserve(ADMIN, RCS, RCF, RCT);
await putObj(RCT);
await removedDone(STRANGER, [R(RCT)]);
await removedDone(ADMIN2, [R(RCT)]);
ok((await qs(`SELECT 1 FROM song_file_copies WHERE path = $1`, [RCT])).rows.length === 1,
  'removed() without its own claim (another band’s admin, or one of this band) leaves a registered copy for the sweep');
await claimDel(ADMIN, [R(RCT)]);
await removedDone(ADMIN, [R(RCT)]);
ok((await qs(`SELECT 1 FROM song_file_copies WHERE path = $1`, [RCT])).rows.length === 0, 'its own released claim closes the registration');

// 2: only file-holding keys (audio_url / chart_url) pin a file; the trigger
// and the in-use check agree.
const LX = `${BAND}/audio/r8-lyrics-ref.mp3`;
await putObj(LX);
await db.exec(`INSERT INTO song_suggestions (band_id, song_id, kind, proposed, status) VALUES ('${BAND}','${S1}','lyrics', jsonb_build_object('lyrics','${R(LX)}'), 'pending')`);
ok((await inUseQ(LX)) === false && JSON.stringify(await claimDel(ADMIN, [R(LX)])) === JSON.stringify([R(LX)]),
  'a lyrics correction whose text is exactly a ref does not pin the file');
await db.exec(`DELETE FROM song_suggestions WHERE kind = 'lyrics'`);
const NX = `${BAND}/audio/r8-notes-ref.mp3`;
await putObj(NX);
await claimDel(ADMIN, [R(NX)]);
await db.exec(`INSERT INTO song_suggestions (id, band_id, song_id, kind, proposed, created_by) VALUES ('${id(121)}','${BAND}','${S1}','note', '{"note":"x"}', '${MEM}')`);
const accN = await asCommit(ADMIN, `SELECT public.bw_review_song_suggestion($1, 'accept', NULL, $2::jsonb) AS v`, [id(121), JSON.stringify({ notes: R(NX) })]);
ok(accN && !String(accN).startsWith('error'), `accepting notes whose text is exactly a claimed ref works (${typeof accN === 'string' ? accN : 'ok'})`);
const LX2 = `${BAND}/chart/r8-chart-ref.pdf`;
await db.exec(`INSERT INTO song_suggestions (band_id, kind, proposed, status) VALUES ('${BAND}','note', jsonb_build_object('chart_url','${R(LX2)}'), 'pending')`);
ok((await inUseQ(LX2)) === true, 'a chart_url value still pins a file');
await db.exec(`DELETE FROM song_suggestions WHERE kind = 'note'`);

// 3: rolling backfill: old band objects that nothing uses and nothing
// records are swept too (older builds' refused rollback deletes).
const RB = sug(MEM, 'audio/r8-rollback.mp3'), RBU = `${BAND}/audio/r8-rollback-used.mp3`, RBN = `${BAND}/audio/r8-rollback-new.mp3`;
const RBC = `${BAND}/audio/${id(122)}-r8-recorded.mp3`;
await db.exec(`INSERT INTO storage.objects (bucket_id, name, owner, created_at) VALUES
  ('song-files','${RB}','${ADMIN}', now() - interval '2 days'), ('song-files','${RBU}','${ADMIN}', now() - interval '2 days'),
  ('song-files','${RBN}','${ADMIN}', now() - interval '1 hour'), ('song-files','${RBC}','${ADMIN}', now() - interval '2 days');
  INSERT INTO songs VALUES ('${id(123)}','${BAND}','Uses RBU','ready','${R(RBU)}',NULL);
  INSERT INTO song_file_copies (path, band_id, song_id, made_at) VALUES ('${RBC}','${BAND}','${id(122)}', now())`);
const list8 = await sweep(ADMIN);
ok(Array.isArray(list8) && list8.includes(RB) && !list8.includes(RBU) && !list8.includes(RBN) && !list8.includes(RBC),
  `the sweep lists an old object nothing uses or records; not a used, recent or recorded one (${Array.isArray(list8) ? list8.filter((p) => p.includes('r8-rollback') || p.includes('r8-recorded')).join(' ') : list8})`);
const cRB = await claim(ADMIN, RB);
ok(cRB?.ok === true && (await delObj(ADMIN, RB)) === 1 && (await doneSweep(ADMIN, [RB])) >= 1
  && (await qs(`SELECT 1 FROM storage.objects WHERE name = $1`, [RB])).rows.length === 0, `and deletes it (${JSON.stringify(cRB)})`);
ok((await claim(ADMIN, RBU))?.ok !== true, 'a used old object is not claimed');

// 4: a lapsed claim of a file another song uses is cleared on the sweep's visit.
const LU = `${BAND}/audio/r8-lapsed-used.mp3`;
await putObj(LU);
await db.exec(`INSERT INTO songs VALUES ('${id(124)}','${BAND}','Uses LU','ready','${R(LU)}',NULL);
  INSERT INTO song_file_removals (path, band_id, claimed_by, claimed_at) VALUES ('${LU}','${BAND}',NULL, now() - interval '16 minutes')`);
await sweep(ADMIN).catch(() => undefined);
await asCommit(ADMIN, `SELECT public.bw_song_file_sweep_list($1) AS v`, [BAND]);
ok((await qs(`SELECT 1 FROM song_file_removals WHERE path = $1`, [LU])).rows.length === 0, 'a lapsed claim of a used file is cleared');

// ---- Round 9: Codex review of ed7ec29f
// B1: bw_song_files_removed closes only the caller's own claims (an admin of
// the band, of another band or a member closes nothing of someone else's).
const OWN9 = `${BAND}/audio/r9-own-claim.mp3`;
await putObj(OWN9);
await claimDel(ADMIN, [R(OWN9)]);
const rmOther = [await removedDone(ADMIN2, [R(OWN9)]), await removedDone(STRANGER, [R(OWN9)]), await removedDone(MEM, [R(OWN9)])];
ok(rmOther.every((n) => n === 0) && (await qs(`SELECT claimed_by FROM song_file_removals WHERE path = $1`, [OWN9])).rows[0]?.claimed_by === ADMIN,
  `B1: removed() by anyone but the claimer closes nothing (${JSON.stringify(rmOther)})`);
ok((await removedDone(ADMIN, [R(OWN9)])) === 1, 'B1: the claimer closes it');

// B2: a withdraw claims only files under the suggestion's own band, also
// for a member of two bands whose song (an older build's) links the other.
await db.exec(`INSERT INTO band_members VALUES ('${OTHER_BAND}','${MEM}','member',true)`);
const XB9 = `${OTHER_BAND}/audio/r9-other-band.mp3`, OWN9W = sug(MEM, 'audio/r9-withdraw-own.mp3');
await putObj(XB9, 'song-files', STRANGER);
await putObj(OWN9W, 'song-files', MEM);
await db.exec(`ALTER TABLE songs DISABLE TRIGGER songs_file_not_removed;
  INSERT INTO songs VALUES ('${id(130)}','${BAND}','Cross-band ref','suggested','${R(XB9)}','${R(OWN9W)}');
  ALTER TABLE songs ENABLE TRIGGER songs_file_not_removed;
  INSERT INTO song_suggestions (id, band_id, song_id, kind, created_by) VALUES ('${id(131)}','${BAND}','${id(130)}','new_song','${MEM}')`);
const wd9 = await withdraw(MEM, id(131));
ok(JSON.stringify(wd9?.files) === JSON.stringify([R(OWN9W)]) && (await qs(`SELECT 1 FROM song_file_removals WHERE path = $1`, [XB9])).rows.length === 0,
  `B2: withdraw claims only files of the suggestion’s band (${JSON.stringify(wd9?.files ?? wd9)})`);
await db.exec(`DELETE FROM band_members WHERE band_id = '${OTHER_BAND}' AND user_id = '${MEM}'`);

// B3: a registered destination where an object already was (a name
// collision): the sweep never deletes that object.
const release = (user, song, to) => asCommit(user, `SELECT public.bw_song_file_copy_release($1, $2) AS v`, [song, to]);
const PS9 = id(132), PF9 = sug(MEM, 'audio/r9-pre.mp3'), PT9 = `${BAND}/audio/${PS9}-r9-pre.mp3`;
await putObj(PF9, 'song-files', MEM);
await db.exec(`INSERT INTO storage.objects (bucket_id, name, owner, created_at) VALUES ('song-files','${PT9}','${ADMIN}', now() - interval '1 hour');
  INSERT INTO songs VALUES ('${PS9}','${BAND}','Something already there','learning','${R(PF9)}',NULL)`);
const rv1 = await reserve(ADMIN, PS9, PF9, PT9);
const rv2 = await reserve(ADMIN, PS9, PF9, PT9);
ok(rv1?.registered === true && rv2?.registered === false && typeof rv1?.reserved_at === 'string' && rv1.reserved_at === rv2.reserved_at,
  `reserve says whether this call registered the path, and since when (${JSON.stringify(rv1)}, ${JSON.stringify(rv2)})`);
await db.exec(`UPDATE song_file_copies SET made_at = now() - interval '11 minutes' WHERE path = '${PT9}'`);
const list9 = await sweep(ADMIN);
ok(Array.isArray(list9) && !list9.includes(PT9), 'B3: a stale registration of an object older than it is not listed');
ok((await claim(ADMIN, PT9))?.ok !== true && (await qs(`SELECT 1 FROM storage.objects WHERE name = $1`, [PT9])).rows.length === 1,
  'B3: nor claimed; the object stays');
ok(String(await release(MEM, PS9, PT9)).startsWith('error'), 'a member cannot drop a registration');
ok((await release(ADMIN2, PS9, PT9)) === false && (await qs(`SELECT 1 FROM song_file_copies WHERE path = $1`, [PT9])).rows.length === 1,
  'another admin does not drop this admin’s registration');
ok((await release(ADMIN, PS9, PT9)) === true && (await qs(`SELECT 1 FROM song_file_copies WHERE path = $1`, [PT9])).rows.length === 0,
  'the admin who registered it drops the abandoned one');
// A second device registering the same copy again keeps the first time:
// the copy made in between is still this move's, and swept once unused.
const QS9 = id(133), QF9 = sug(MEM, 'audio/r9-again.mp3'), QT9 = `${BAND}/audio/${QS9}-r9-again.mp3`;
await putObj(QF9, 'song-files', MEM);
await db.exec(`INSERT INTO songs VALUES ('${QS9}','${BAND}','Registered twice','learning','${R(QF9)}',NULL)`);
await reserve(ADMIN, QS9, QF9, QT9);
await putObj(QT9);
await reserve(ADMIN, QS9, QF9, QT9);
await db.exec(`DELETE FROM songs WHERE id = '${QS9}'; UPDATE song_file_copies SET made_at = now() - interval '11 minutes' WHERE path = '${QT9}'`);
ok((await sweep(ADMIN)).includes(QT9), 'B3: a copy made after the first registration is still swept when unused');

// ---- Round 10: Claude and Codex reviews of 28cb3199
const sweepC = (user) => asCommit(user, `SELECT public.bw_song_file_sweep_list($1) AS v`, [BAND]);
// The app's sweep: list, then claim, delete and close each one.
const sweepRun = async (user) => {
  const l = await sweepC(user);
  for (const p of Array.isArray(l) ? l : []) {
    if ((await claim(user, p))?.ok === true) { await delObj(user, p); await doneSweep(user, [p]); }
  }
  return l;
};
const seen = async (p) => (await qs(`SELECT 1 FROM song_file_orphan_seen WHERE path = $1`, [p])).rows.length === 1;

// Claude B1: an old build (383f15b) accepts with a Storage move (a row
// UPDATE, created_at kept), then links the moved file in a separate update
// whose error it ignores. A new build's sweep in between must not take it.
const OLDB = id(140), OLDS = sug(MEM, 'audio/r10-oldmove.mp3'), OLDD = `${BAND}/audio/r10-oldmove.mp3`;
await db.exec(`INSERT INTO storage.objects (bucket_id, name, owner, created_at) VALUES ('song-files','${OLDS}','${MEM}', now() - interval '3 days');
  INSERT INTO songs VALUES ('${OLDB}','${BAND}','Old build accept','learning','${R(OLDS)}',NULL);
  UPDATE storage.objects SET name = '${OLDD}' WHERE bucket_id = 'song-files' AND name = '${OLDS}'`);
await sweepRun(ADMIN2);
const oldLink = await codeOf(ADMIN, `UPDATE songs SET audio_url = '${R(OLDD)}' WHERE id = '${OLDB}'`);
ok(oldLink === 'ok' && (await qs(`SELECT 1 FROM storage.objects WHERE name = $1`, [OLDD])).rows.length === 1
  && (await q(`SELECT audio_url FROM songs WHERE id = $1`, [OLDB])).rows[0].audio_url === R(OLDD),
  `Claude B1: an old build's move, a new build's sweep, then its link: the file stays and the link works (${oldLink})`);

// Repair: a song on a missing suggestion file, its moved copy unlinked at
// <band>/<kind>/<name>: the sweep repoints the song (never deletes the copy).
const RP = id(141), RPS = sug(MEM, 'chart/r10-repair.pdf'), RPD = `${BAND}/chart/r10-repair.pdf`;
await putObj(RPD);
await db.exec(`ALTER TABLE songs DISABLE TRIGGER songs_file_not_removed;
  INSERT INTO songs VALUES ('${RP}','${BAND}','Lost its link','ready',NULL,'${R(RPS)}');
  ALTER TABLE songs ENABLE TRIGGER songs_file_not_removed`);
// Two songs that would map to the same file: neither is repointed.
const AM1 = id(142), AM2 = id(143), AMD = `${BAND}/audio/r10-ambiguous.mp3`;
await putObj(AMD);
await db.exec(`ALTER TABLE songs DISABLE TRIGGER songs_file_not_removed;
  INSERT INTO songs VALUES ('${AM1}','${BAND}','Ambiguous 1','ready','${R(sug(MEM, 'audio/r10-ambiguous.mp3'))}',NULL),
    ('${AM2}','${BAND}','Ambiguous 2','ready','${R(sug(MEM2, 'audio/r10-ambiguous.mp3'))}',NULL);
  ALTER TABLE songs ENABLE TRIGGER songs_file_not_removed`);
await sweepRun(ADMIN);
const rpRow = (await q(`SELECT chart_url FROM songs WHERE id = $1`, [RP])).rows[0];
ok(rpRow.chart_url === R(RPD) && (await qs(`SELECT 1 FROM storage.objects WHERE name = $1`, [RPD])).rows.length === 1,
  `repair: the sweep repoints a song on a missing suggestion file to its moved copy (${rpRow.chart_url})`);
ok((await q(`SELECT count(*)::int AS n FROM songs WHERE id IN ('${AM1}','${AM2}') AND audio_url = '${R(AMD)}'`)).rows[0].n === 0,
  'repair: never when two songs would map to the same file');

// 7-day grace: an unlinked old object in a final folder is first recorded,
// and deleted only if still unlinked 7 days later.
const GR = `${BAND}/audio/r10-grace.mp3`;
await db.exec(`INSERT INTO storage.objects (bucket_id, name, owner, created_at) VALUES ('song-files','${GR}','${ADMIN}', now() - interval '3 days')`);
const gr1 = await sweepC(ADMIN);
ok(Array.isArray(gr1) && !gr1.includes(GR) && (await seen(GR)) && (await claim(ADMIN, GR))?.ok !== true,
  'grace: first seen, not listed, not claimable');
await db.exec(`UPDATE song_file_orphan_seen SET first_seen_at = now() - interval '6 days' WHERE path = '${GR}'`).catch(() => undefined);
ok(!(await sweepC(ADMIN)).includes(GR), 'grace: still kept after 6 days');
await db.exec(`UPDATE song_file_orphan_seen SET first_seen_at = now() - interval '8 days' WHERE path = '${GR}'`).catch(() => undefined);
await sweepRun(ADMIN);
ok((await qs(`SELECT 1 FROM storage.objects WHERE name = $1`, [GR])).rows.length === 0 && !(await seen(GR)),
  'grace: after 7 days still unlinked: deleted');
// Linked meanwhile: the record goes (a later unlink starts a new grace).
const GL = `${BAND}/audio/r10-grace-linked.mp3`;
await db.exec(`INSERT INTO storage.objects (bucket_id, name, owner, created_at) VALUES ('song-files','${GL}','${ADMIN}', now() - interval '3 days')`);
await sweepC(ADMIN);
ok(await seen(GL), 'grace: recorded');
ok((await commitSql(ADMIN, `INSERT INTO songs VALUES ('${id(144)}','${BAND}','Links GL','ready','${R(GL)}',NULL)`)) === 1 && !(await seen(GL)),
  'grace: a link forgets the first sighting');

// Codex B2: no claim for a file not in Storage; at most 200 open claims per member.
const GH = sug(MEM, 'audio/r10-ghost.mp3');
ok(JSON.stringify(await claimDel(MEM, [R(GH)])) === '[]' && (await qs(`SELECT 1 FROM song_file_removals WHERE path = $1`, [GH])).rows.length === 0,
  'Codex B2: a claim needs the file in Storage');
const MEM3 = id(146);
await db.exec(`INSERT INTO band_members VALUES ('${BAND}','${MEM3}','member',true);
  INSERT INTO storage.objects (bucket_id, name, owner)
  SELECT 'song-files', '${BAND}/suggestions/${MEM3}/audio/r10-cap-' || lpad(g::text, 3, '0') || '.mp3', '${MEM3}' FROM generate_series(1, 201) g`);
const capRefs = Array.from({ length: 201 }, (_, i) => R(`${BAND}/suggestions/${MEM3}/audio/r10-cap-${String(i + 1).padStart(3, '0')}.mp3`));
const capped = await claimDel(MEM3, capRefs);
ok(Array.isArray(capped) && capped.length === 200, `Codex B2: a member holds at most 200 open claims (${Array.isArray(capped) ? capped.length : capped})`);
ok(JSON.stringify(await claimDel(MEM3, [capRefs[0]])) === JSON.stringify([capRefs[0]]), 'one already held still counts as held');
await removedDone(MEM3, capRefs);
await db.exec(`DELETE FROM storage.objects WHERE name LIKE '${BAND}/suggestions/${MEM3}/audio/r10-cap-%'`);
const GH2 = `${BAND}/audio/r10-ghost-lapsed.mp3`;
await db.exec(`INSERT INTO song_file_removals (path, band_id, claimed_by, claimed_at) VALUES ('${GH2}','${BAND}',NULL, now() - interval '16 minutes')`);
await sweepC(ADMIN);
ok((await qs(`SELECT 1 FROM song_file_removals WHERE path = $1`, [GH2])).rows.length === 0, 'Codex B2: the sweep drops lapsed claims of missing files');

// NIT 3: a registration whose object was there before it, older than a day: the row goes, never the object.
const N3 = `${BAND}/audio/${id(145)}-r10-stale.mp3`;
await db.exec(`INSERT INTO storage.objects (bucket_id, name, owner, created_at) VALUES ('song-files','${N3}','${ADMIN}', now() - interval '3 days');
  INSERT INTO song_file_copies (path, band_id, song_id, made_at, reserved_at) VALUES ('${N3}','${BAND}','${id(145)}', now() - interval '2 days', now() - interval '2 days')`).catch(() => undefined);
await sweepC(ADMIN);
ok((await qs(`SELECT 1 FROM song_file_copies WHERE path = $1`, [N3])).rows.length === 0
  && (await qs(`SELECT 1 FROM storage.objects WHERE name = $1`, [N3])).rows.length === 1, 'NIT 3: a stale registration of an older object is dropped; the object stays');

// NIT 4: the delete check answers only for the caller's bands (a member who
// left keeps no delete right through an old claim).
const N4 = sug(MEM2, 'audio/r10-left.mp3');
await putObj(N4, 'song-files', MEM2);
await claimDel(MEM2, [R(N4)]);
await db.exec(`UPDATE band_members SET is_active = false WHERE band_id = '${BAND}' AND user_id = '${MEM2}'`);
const n4 = await rpc(MEM2, `SELECT public.bw_song_file_delete_allowed('song-files', $1) AS v`, [N4]);
await db.exec(`UPDATE band_members SET is_active = true WHERE band_id = '${BAND}' AND user_id = '${MEM2}'`);
ok(n4 === false, `NIT 4: outside the band, the delete check says no (${n4})`);
await removedDone(MEM2, [R(N4)]);

// NIT 5: the orphan scan reads the band's prefix with the C collation, and songs' refs are indexed.
const orphDef = (await qs(`SELECT pg_get_functiondef('public.bw_song_file_orphans(uuid, text)'::regprocedure) AS d`)).rows[0]?.d ?? '';
const idx = (await q(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'songs'`)).rows.map((r) => r.indexdef).join('\n');
ok(/COLLATE "C"/.test(orphDef) && /\(audio_url\)/.test(idx) && /\(chart_url\)/.test(idx), 'NIT 5: prefix scan with COLLATE "C", indexes on songs(audio_url) and songs(chart_url)');

// ---- Main (after the prod dry run of 220767ca): prod storage.objects has
// archived_at / is_delete_marker; an archived object or a delete marker is not
// a stored file. Without those columns (here so far) nothing changes, as
// every case above shows. Last case: it adds the columns and re-runs 197.
const storedDef = async () => (await qs(`SELECT pg_get_functiondef('public.bw_song_file_stored(text)'::regprocedure) AS d`)).rows[0]?.d ?? '';
ok((await storedDef()) !== '' && !/archived_at|is_delete_marker/.test(await storedDef()), 'without the columns the stored check is the plain one');
await db.exec(`ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS archived_at timestamptz, ADD COLUMN IF NOT EXISTS is_delete_marker boolean, ADD COLUMN IF NOT EXISTS version text`);
await db.exec(mig);
ok(/archived_at IS NULL/.test(await storedDef()) && /is_delete_marker/.test(await storedDef()), 'with the columns, 197 builds the check on them');
const AR = `${BAND}/audio/arch-archived.mp3`;
const DM = `${BAND}/audio/arch-marker.mp3`;
const LV = `${BAND}/audio/arch-live.mp3`;
await db.exec(`INSERT INTO storage.objects (bucket_id, name, owner, archived_at) VALUES ('song-files', '${AR}', '${ADMIN}', now());
  INSERT INTO storage.objects (bucket_id, name, owner, is_delete_marker) VALUES ('song-files', '${DM}', '${ADMIN}', true);
  INSERT INTO storage.objects (bucket_id, name, owner, is_delete_marker) VALUES ('song-files', '${LV}', '${ADMIN}', NULL)`);
const linkAR = await codeOf(ADMIN, `INSERT INTO songs VALUES ('${id(90)}','${BAND}','Archived','ready','sb://song-files/${AR}',NULL)`);
const linkDM = await codeOf(ADMIN, `INSERT INTO songs VALUES ('${id(91)}','${BAND}','Delete marker','ready','sb://song-files/${DM}',NULL)`);
const linkLV = await codeOf(ADMIN, `INSERT INTO songs VALUES ('${id(92)}','${BAND}','Live','ready','sb://song-files/${LV}',NULL)`);
ok(linkAR === 'BWF02' && linkDM === 'BWF02', `an archived object and a delete marker count as absent (${linkAR}, ${linkDM})`);
ok(linkLV === 'ok', `a live object (is_delete_marker NULL) still counts (${linkLV})`);

// ---- Round 10 (end: with prod's columns). Codex B1: versioned Storage keeps
// archived rows; age and "stored" read the same live row. Claude B1.1: age
// is the later of created_at and updated_at.
await db.exec(`ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS updated_at timestamptz`);
await db.exec(mig);
const VB = sug(MEM, 'audio/r10-versioned.mp3');
await db.exec(`INSERT INTO storage.objects (bucket_id, name, owner, created_at, archived_at) VALUES ('song-files','${VB}','${MEM}', now() - interval '3 days', now() - interval '1 hour');
  INSERT INTO storage.objects (bucket_id, name, owner, created_at) VALUES ('song-files','${VB}','${MEM}', now())`);
const UA = sug(MEM, 'audio/r10-touched.mp3'), UA2 = sug(MEM, 'audio/r10-untouched.mp3');
await db.exec(`INSERT INTO storage.objects (bucket_id, name, owner, created_at, updated_at) VALUES
  ('song-files','${UA}','${MEM}', now() - interval '3 days', now()), ('song-files','${UA2}','${MEM}', now() - interval '3 days', now() - interval '2 days')`);
const endList = await sweep(ADMIN);
ok(Array.isArray(endList) && !endList.includes(VB), 'Codex B1: an old archived version plus a fresh upload at the same path is never swept');
ok(Array.isArray(endList) && !endList.includes(UA) && endList.includes(UA2), 'Claude B1: age counts from the latest of created_at / updated_at');
const live180 = src180 && fnFrom(src180, 'bw_storage_live_filter');
if (!live180) {
  console.warn('SKIP 180 live-row predicate check: no bw_storage_live_filter in 180');
} else {
  await db.exec(live180);
  const pred = (await q(`SELECT public.bw_storage_live_filter() AS p`)).rows[0].p.trim();
  const od = (await qs(`SELECT pg_get_functiondef('public.bw_song_file_orphans(uuid, text)'::regprocedure) AS d`)).rows[0]?.d ?? '';
  ok(pred.length > 0 && (await storedDef()).includes(pred) && od.includes(pred),
    `197's live-row check is 180's bw_storage_live_filter predicate (${pred})`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
