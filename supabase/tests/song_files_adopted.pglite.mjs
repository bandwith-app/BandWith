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
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
CREATE POLICY read_all ON storage.objects FOR SELECT TO authenticated USING (true);
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

// Only a member suggestion mentions it (a note with the path): no delete either.
await db.exec(`INSERT INTO song_suggestions (band_id, song_id, kind, proposed) VALUES ('${BAND}','${id(11)}','note',
  jsonb_build_object('note', 'the take is at sb://song-files/${P.learning}'))`);
const cS = await claim(ADMIN, P.learning);
ok(cS && cS.ok === false && cS.reason === 'referenced', `claim refused: a suggestion mentions it (${JSON.stringify(cS)})`);
ok(!(await sweep(ADMIN)).includes(P.learning), 'and the sweep does not list it');
await db.exec(`DELETE FROM song_suggestions`);
await db.exec(`INSERT INTO song_suggestions (band_id, song_id, kind, message) VALUES ('${BAND}','${id(11)}','note','see ${P.learning}')`);
ok((await claim(ADMIN, P.learning)).reason === 'referenced', 'a suggestion message counts too');
await db.exec(`DELETE FROM song_suggestions`);
// jsonb escapes quotes and backslashes: a hostile name is still found.
const HOSTILE = `${BAND}/suggestions/${MEM}/audio/q"u\\o.mp3`;
await q(`INSERT INTO song_suggestions (band_id, kind, proposed) VALUES ($1, 'note', jsonb_build_object('note', $2::text))`, [BAND, `x ${HOSTILE} y`]);
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
  VALUES ('${BAND}','${id(11)}','note', jsonb_build_object('note', 'use ${P.learning}'), '${MEM}') RETURNING 1 AS v`);
ok(String(sugIns).includes('BW_FILE_REMOVED'), `a suggestion mentioning it is refused while deleting (${sugIns})`);
ok((await asCommit(MEM, `INSERT INTO song_suggestions (band_id, song_id, kind, proposed, created_by)
  VALUES ('${BAND}','${id(11)}','note', '{"note":"louder chorus"}', '${MEM}') RETURNING 1 AS v`)) === 1, 'other suggestions are unaffected');
await db.exec(`DELETE FROM song_suggestions`);

// A failed delete (no done): after 10 minutes the claim lapses and it is pending again.
await db.exec(`UPDATE song_file_adoptions SET deleting_at = now() - interval '11 minutes' WHERE from_path = '${P.learning}'`);
ok((await sweep(ADMIN)).includes(P.learning), 'lapsed claim: listed for the sweep again');
const c2 = await claim(ADMIN2, P.learning);
ok(c2 && c2.ok === true, 'and can be claimed again');
ok((await doneSweep(ADMIN, [P.readyChart])) === 0, 'done only marks claimed deletes');
const done = await doneSweep(ADMIN, [P.learning]);
ok(done === 1 && (await state(P.learning)) === 'cleaned' && !(await sweep(ADMIN)).includes(P.learning), 'marked done: no longer listed');

// The record is not readable or writable by app users.
ok((await as(ADMIN, () => q(`SELECT 1 FROM song_file_adoptions`).then(() => 'read', () => 'denied'))) === 'denied', 'adoption records: no direct access');
// A lost response: the commit happened; a re-read shows the copy, nothing to undo.
ok((await ref()) === `sb://song-files/${DEST}`, 'after the repoint the song keeps the copy');

// ---- Claude review of #295: a file another song uses is never removed.
const O = `${BAND}/audio/o-band-take.mp3`;
const U = `${BAND}/suggestions/${MEM}/audio/u-own.mp3`;
const S1 = id(20);
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
const c1d = await claimDel(ADMIN, [`sb://song-files/${O}`, `sb://song-files/${U}`, `sb://song-files/${W}`, `sb://song-files/${OTHER_BAND}/audio/z.mp3`, 'https://example.com/x.mp3']);
ok(Array.isArray(c1d) && c1d.length === 2 && c1d.includes(`sb://song-files/${U}`) && c1d.includes(`sb://song-files/${W}`) && !c1d.includes(`sb://song-files/${O}`),
  `claim: only files nothing uses, of the caller's band (${JSON.stringify(c1d)})`);
ok(JSON.stringify(await claimDel(ADMIN2, [`sb://song-files/${W}`])) === '[]', 'claim: another admin meanwhile gets nothing');
ok(JSON.stringify(await claimDel(STRANGER, [`sb://song-files/${U}`])) === '[]', 'claim: nothing of another band');
ok(JSON.stringify(await claimDel(MEM2, [`sb://song-files/${BAND}/audio/v.mp3`])) === '[]', 'claim: a member only for their own suggestion files');
const ownMem = `${BAND}/suggestions/${MEM2}/audio/own.mp3`;
ok(JSON.stringify(await claimDel(MEM2, [`sb://song-files/${ownMem}`])) === JSON.stringify([`sb://song-files/${ownMem}`]), 'claim: a member for their own suggestion file');
ok((await removedDone(ADMIN, [`sb://song-files/${W}`])) === 1 && (await qs(`SELECT 1 FROM song_file_removals WHERE path = $1`, [W])).rows.length === 0, 'removed: the claim is closed');
// A failed delete: the claim lapses after 10 minutes, links work again.
await db.exec(`UPDATE song_file_removals SET claimed_at = now() - interval '11 minutes' WHERE path = '${U}'`).catch(() => undefined);
ok(JSON.stringify(await claimDel(ADMIN2, [`sb://song-files/${U}`])) === JSON.stringify([`sb://song-files/${U}`]), 'a lapsed claim can be claimed again');
await db.exec(`UPDATE song_file_removals SET claimed_at = now() - interval '11 minutes' WHERE path = '${U}'`).catch(() => undefined);
ok((await as(ADMIN, () => q(`INSERT INTO songs VALUES ('${id(41)}','${BAND}','Relink U later','ready','sb://song-files/${U}',NULL)`).then(() => 1, (e) => e.message))) === 1,
  'after the lapse the file can be linked again');
await q(`INSERT INTO song_suggestions (band_id, kind, proposed) VALUES ($1, 'note', jsonb_build_object('note', $2::text))`, [BAND, `sb://song-files/${U}`]);
ok(JSON.stringify(await claimDel(ADMIN, [`sb://song-files/${U}`])) === '[]', 'claim: a file a suggestion mentions is kept');
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
  ? await def('public.bw_song_files_claim_for(text[], uuid, boolean)').catch(() => '')
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
await q(`INSERT INTO song_suggestions (band_id, kind, proposed) VALUES ($1, 'note', jsonb_build_object('note', $2::text))`, [OTHER_BAND, `sb://song-files/${Y}`]);
ok(JSON.stringify(await claimDel(ADMIN, [`sb://song-files/${Y}`])) === JSON.stringify([`sb://song-files/${Y}`]), 'another band’s suggestion mentioning the path does not count');
await removedDone(ADMIN, [`sb://song-files/${Y}`]);
await q(`INSERT INTO song_suggestions (band_id, kind, proposed) VALUES ($1, 'note', jsonb_build_object('note', $2::text))`, [BAND, `sb://song-files/${Y}`]);
ok(JSON.stringify(await claimDel(ADMIN, [`sb://song-files/${Y}`])) === '[]', 'its own band’s suggestion does');
await db.exec(`DELETE FROM song_suggestions WHERE kind = 'note'`);

// Apply order the other way (197, then 180's real withdraw): it must still
// filter files in use. #282 is making 180 call bw_song_files_left_unused when
// it exists; until it pushes that, this case is pending.
if (!w180) {
  console.warn('SKIP 197→180 order: no 180 available');
} else if (!w180.includes('bw_song_files_left_unused')) {
  console.warn('SKIP (pending #282) 197→180 order: 180’s withdraw does not call bw_song_files_left_unused yet');
} else {
  await db.exec(w180);
  await db.exec(`ALTER TABLE songs DISABLE TRIGGER songs_file_not_removed;
    INSERT INTO songs VALUES ('${id(62)}','${BAND}','S5 on O','suggested','sb://song-files/${O}',NULL);
    ALTER TABLE songs ENABLE TRIGGER songs_file_not_removed;
    INSERT INTO song_suggestions (id, band_id, song_id, kind, created_by) VALUES ('${id(63)}','${BAND}','${id(62)}','new_song','${MEM}')`);
  const wd180 = await withdraw(MEM, id(63));
  ok(wd180 && Array.isArray(wd180.files) && wd180.files.length === 0, `197→180: withdraw keeps a file another song uses (${JSON.stringify(wd180?.files ?? wd180)})`);
  ok(String(await withdraw(MEM2, id(33))).includes('Not your suggestion'), '197→180: and still refuses a former member’s suggestion');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
