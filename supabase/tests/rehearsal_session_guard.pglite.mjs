// Local check of migration 196 (a saved rehearsal session is never started
// over, audit 06 #3/#4) without Docker: PGlite with the 131 table, policies
// and trigger. Failing first: with /dev/null as the migration a second
// admin's stale Start (an old build's upsert) erases the ended session.
//
//   cd <dir with @electric-sql/pglite@0.5.15> && cp <repo>/supabase/tests/rehearsal_session_guard.pglite.mjs .
//   node rehearsal_session_guard.pglite.mjs <repo>
//   node rehearsal_session_guard.pglite.mjs <repo> /dev/null    # before: FAILs expected
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const REPO = process.argv[2];
const MIG = process.argv[3] ?? `${REPO}/supabase/migrations/196_rehearsal_session_guard.sql`;
const db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, ADMIN_A, ADMIN_B, MEMBER, EVENT] = [1, 2, 3, 4, 10].map(id);
const DAY = '2026-11-19';

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
CREATE TABLE public.bands (id uuid PRIMARY KEY);
CREATE TABLE public.events (id uuid PRIMARY KEY, band_id uuid);
CREATE TABLE public.band_members (band_id uuid, user_id uuid, role text, is_active boolean DEFAULT true);
CREATE FUNCTION public.bw_is_band_admin(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND role = 'admin' AND COALESCE(is_active, true)); $f$;
CREATE FUNCTION public.bw_is_band_member(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND COALESCE(is_active, true)); $f$;
CREATE FUNCTION public.bw_event_band_id(p_event_id uuid) RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$ SELECT band_id FROM events WHERE id = p_event_id $f$;
INSERT INTO auth.users VALUES ('${ADMIN_A}'), ('${ADMIN_B}'), ('${MEMBER}');
INSERT INTO bands VALUES ('${BAND}');
INSERT INTO events VALUES ('${EVENT}', '${BAND}');
INSERT INTO band_members VALUES ('${BAND}','${ADMIN_A}','admin',true), ('${BAND}','${ADMIN_B}','admin',true), ('${BAND}','${MEMBER}','member',true);
`);
await db.exec(readFileSync(`${REPO}/supabase/migrations/131_rehearsal_sessions.sql`, 'utf8'));

async function as(user, fn) {
  await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true); SET LOCAL ROLE authenticated;`);
  try { const r = await fn(); await db.exec('COMMIT'); return r; } catch (e) { await db.exec('ROLLBACK'); throw e; }
}
const summary = (played) => JSON.stringify({ v: 1, durationS: 1500, played, total: 3 });
const PLAYED = [{ id: 's1', title: 'Paper Boats' }, { id: 's2', title: 'Superstition' }];
/** The upsert every build up to 383f15b sends (saveRehearsalSession). */
const upsert = (user, r) =>
  as(user, () => db.query(
    `INSERT INTO rehearsal_sessions (band_id, event_id, occurrence_date, started_at, paused_ms, paused_at, ended_at, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (event_id, occurrence_date) DO UPDATE SET started_at = EXCLUDED.started_at, paused_ms = EXCLUDED.paused_ms,
       paused_at = EXCLUDED.paused_at, ended_at = EXCLUDED.ended_at, summary = EXCLUDED.summary`,
    [BAND, EVENT, DAY, r.started_at, r.paused_ms ?? 0, r.paused_at ?? null, r.ended_at ?? null, r.summary ?? summary([])],
  )).then(() => ({ ok: true }), (e) => ({ error: e.message }));
const saved = async () => (await db.query(`SELECT started_at, ended_at, paused_at, summary, updated_at FROM rehearsal_sessions WHERE event_id = $1`, [EVENT])).rows[0];
const reset = () => db.exec(`DELETE FROM rehearsal_sessions`);

const A_START = '2026-11-19T19:00:00.000Z';
const A_END = '2026-11-19T19:25:00.000Z';
const B_START = '2026-11-19T19:30:00.000Z';

// ---- the problem, before the migration: B's stale Start erases A's rehearsal
await upsert(ADMIN_A, { started_at: A_START });
await upsert(ADMIN_A, { started_at: A_START, ended_at: A_END, summary: summary(PLAYED) });
await upsert(ADMIN_B, { started_at: B_START });
console.log(`info: before 196, B's Start leaves A's end in place: ${(await saved()).ended_at !== null}`);

await db.exec(readFileSync(MIG, 'utf8'));
await db.exec(readFileSync(MIG, 'utf8')); // idempotent
ok(true, 'migration runs twice');

// A runs the rehearsal: start, pause, resume, end, songs played. All fine.
await reset();
ok((await upsert(ADMIN_A, { started_at: A_START })).ok, 'A starts it');
ok((await upsert(ADMIN_A, { started_at: A_START, paused_at: '2026-11-19T19:10:00.000Z' })).ok, 'A pauses');
ok((await upsert(ADMIN_A, { started_at: A_START, paused_ms: 60000 })).ok, 'A resumes');
ok((await upsert(ADMIN_A, { started_at: A_START, paused_ms: 60000, ended_at: A_END, summary: summary(PLAYED) })).ok, 'A ends it with the songs played');

// B (missed the end, or a fresh device that tapped Start early) starts over it: skipped, nothing changes.
const before = await saved();
const b = await upsert(ADMIN_B, { started_at: B_START });
const after = await saved();
ok(after.ended_at !== null && after.summary.played.length === 2, 'the ended rehearsal and its songs played are intact');
ok(String(after.started_at) === String(before.started_at), 'its start time is intact');
// Not an error: the builds in the field retry an error forever (PR #296 review).
ok(b.ok === true, `the old build's upsert gets no error, so it stops retrying (${b.error ?? 'ok'})`);

// The old build's whole loop (origin/main useRehearsalSession + saveRehearsalSession):
// dirty copy -> upsert -> no error -> copy clean -> next open reads the saved row.
{
  const device = { row: { started_at: B_START, ended_at: null }, dirty: true };
  let tries = 0;
  while (device.dirty && tries < 5) {
    tries++;
    const r = await upsert(ADMIN_B, device.row);
    if (!r.error) device.dirty = false; // `if (error) markUnsaved(true); else writeLocal(key, row, false)`
  }
  ok(!device.dirty && tries === 1, `old build: one try, then its copy is clean (tries: ${tries})`);
  // Next open: a clean copy loses to the saved row (pickSession).
  const shown = device.dirty ? device.row : await saved();
  ok(shown.ended_at !== null, 'old build: reopening shows the saved, ended rehearsal');
}

// The same through a plain UPDATE (what any client could send): 0 rows, nothing written.
const u = await as(ADMIN_B, () => db.query(`UPDATE rehearsal_sessions SET started_at = $1, ended_at = NULL WHERE event_id = $2 RETURNING id`, [B_START, EVENT]));
ok(u.rows.length === 0 && (await saved()).ended_at !== null, 'a plain update of started_at writes nothing (0 rows: a conflict for this build)');

// Resuming after the end keeps the start: still allowed.
ok((await upsert(ADMIN_A, { started_at: A_START, paused_ms: 120000, ended_at: null, summary: summary(PLAYED) })).ok, 'resume after the end is still allowed');

// The app's save on top of the revision it read: a stale revision updates nothing.
const rev = (await saved()).updated_at;
await upsert(ADMIN_A, { started_at: A_START, paused_ms: 120000, ended_at: '2026-11-19T19:50:00.000Z', summary: summary(PLAYED) });
const stale = await as(ADMIN_B, () => db.query(
  `UPDATE rehearsal_sessions SET paused_at = $1 WHERE event_id = $2 AND occurrence_date = $3 AND updated_at = $4 RETURNING updated_at`,
  ['2026-11-19T19:40:00.000Z', EVENT, DAY, rev],
));
ok(stale.rows.length === 0 && (await saved()).paused_at === null, 'a save on a stale revision writes nothing');

// A first save of a session that is already there: refused by the unique key.
const dup = await as(ADMIN_B, () => db.query(
  `INSERT INTO rehearsal_sessions (band_id, event_id, occurrence_date, started_at, summary) VALUES ($1, $2, $3, $4, '{}'::jsonb)`,
  [BAND, EVENT, DAY, B_START],
)).then(() => 'written', (e) => e.message);
ok(/duplicate key|rehearsal_sessions_occurrence_key/.test(dup), 'a first save over an existing one is refused (23505)');

// #296 round 3: this build's merge keeps the EARLIER start (two copies started unread). It writes
// summary.pauses; an old build never does, so an old build's earlier start is still skipped.
{
  await upsert(ADMIN_A, { started_at: A_START, ended_at: null, summary: summary(PLAYED) });
  const EARLIER = '2026-11-19T18:55:00.000Z';
  const oldEarlier = await as(ADMIN_B, () => db.query(
    `UPDATE rehearsal_sessions SET started_at = $1 WHERE event_id = $2 RETURNING id`, [EARLIER, EVENT]));
  ok(oldEarlier.rows.length === 0, 'an earlier start without summary.pauses (an old build) writes nothing');
  const merged = JSON.stringify({ v: 1, durationS: 1800, played: PLAYED, total: 3, pauses: [] });
  const laterNew = await as(ADMIN_B, () => db.query(
    `UPDATE rehearsal_sessions SET started_at = $1, summary = $2::jsonb WHERE event_id = $3 RETURNING id`, [B_START, merged, EVENT]));
  ok(laterNew.rows.length === 0, 'a later start writes nothing, summary.pauses or not');
  const rev0 = (await saved()).updated_at;
  const earlierNew = await as(ADMIN_B, () => db.query(
    `UPDATE rehearsal_sessions SET started_at = $1, summary = $2::jsonb WHERE event_id = $3 AND occurrence_date = $4 AND updated_at = $5 RETURNING updated_at`,
    [EARLIER, merged, EVENT, DAY, rev0]));
  const now = await saved();
  ok(earlierNew.rows.length === 1 && new Date(now.started_at).toISOString() === EARLIER, "this build's merge moves the start earlier (on the revision it read)");
}

// #296 round 5: an old build's save (no summary.pauses) keeps the saved pause times; a new build's replaces them.
{
  const spans = [[Date.parse('2026-11-19T19:10:00Z'), Date.parse('2026-11-19T19:15:00Z')]];
  const withPauses = JSON.stringify({ v: 1, durationS: 900, played: PLAYED, total: 3, pauses: spans });
  await as(ADMIN_A, () => db.query(`UPDATE rehearsal_sessions SET summary = $1::jsonb, paused_ms = 300000 WHERE event_id = $2`, [withPauses, EVENT]));
  const start = (await saved()).started_at;
  const oldWrite = await upsert(ADMIN_B, { started_at: new Date(start).toISOString(), paused_ms: 420000, summary: summary(PLAYED) });
  const afterOld = await saved();
  ok(oldWrite.ok && JSON.stringify(afterOld.summary.pauses) === JSON.stringify(spans) && afterOld.summary.played.length === 2,
    "an old build's save keeps the saved pause times (and writes the rest)");
  const newer = JSON.stringify({ v: 1, durationS: 900, played: PLAYED, total: 3, pauses: [] });
  await as(ADMIN_A, () => db.query(`UPDATE rehearsal_sessions SET summary = $1::jsonb WHERE event_id = $2`, [newer, EVENT]));
  ok(JSON.stringify((await saved()).summary.pauses) === '[]', "a new build's save replaces the pause times");
}

// #296 round 6: an old build that missed the End can't undo it with its running copy (same or
// less paused time, no summary.pauses); its real Resume after the End (more paused time) still goes.
{
  const start = new Date((await saved()).started_at).toISOString();
  const withPauses = JSON.stringify({ v: 1, durationS: 900, played: PLAYED, total: 3, pauses: [] });
  await as(ADMIN_A, () => db.query(
    `UPDATE rehearsal_sessions SET summary = $1::jsonb, paused_ms = 300000, paused_at = NULL, ended_at = $2 WHERE event_id = $3`,
    [withPauses, '2026-11-19T19:45:00.000Z', EVENT]));
  const stale = await upsert(ADMIN_B, { started_at: start, paused_ms: 300000, ended_at: null, summary: summary([...PLAYED, { id: 's3', title: 'Cissy Strut' }]) });
  const afterStale = await saved();
  ok(stale.ok && afterStale.ended_at !== null && afterStale.summary.played.length === 2,
    "an old build's running copy after the End (same paused time) is skipped: the End stays, no error");
  const less = await upsert(ADMIN_B, { started_at: start, paused_ms: 60000, ended_at: null, summary: summary(PLAYED) });
  ok(less.ok && (await saved()).ended_at !== null, "an old build's copy with less paused time is skipped too");
  const realResume = await upsert(ADMIN_B, { started_at: start, paused_ms: 360000, ended_at: null, summary: summary(PLAYED) });
  const afterResume = await saved();
  ok(realResume.ok && afterResume.ended_at === null && JSON.stringify(afterResume.summary.pauses) === '[]',
    "an old build's real Resume after the End (more paused time) goes through, pause times kept");
  await as(ADMIN_A, () => db.query(`UPDATE rehearsal_sessions SET ended_at = $1 WHERE event_id = $2`, ['2026-11-19T19:50:00.000Z', EVENT]));
  const newResume = await as(ADMIN_A, () => db.query(
    `UPDATE rehearsal_sessions SET ended_at = NULL, summary = $1::jsonb WHERE event_id = $2 RETURNING id`, [withPauses, EVENT]));
  ok(newResume.rows.length === 1 && (await saved()).ended_at === null, "this build's Resume after the End (summary.pauses) goes through");
}

// #296 round 7: an old leader's End over a row this build wrote keeps the songs it never heard
// (union by id, saved first); a write with summary.pauses (this build) replaces them as it says.
{
  await db.exec(`DELETE FROM rehearsal_sessions`);
  await upsert(ADMIN_A, { started_at: A_START });
  const newSongs = [{ id: 's1', title: 'Paper Boats', at: 1 }, { id: 's2', title: 'Superstition', at: 2 }];
  await as(ADMIN_A, () => db.query(`UPDATE rehearsal_sessions SET summary = $1::jsonb WHERE event_id = $2`,
    [JSON.stringify({ v: 1, durationS: 600, played: newSongs, total: 3, pauses: [] }), EVENT]));
  const oldEnd = await upsert(ADMIN_B, { started_at: A_START, ended_at: A_END,
    summary: summary([{ id: 's1', title: 'Paper Boats' }, { id: 's3', title: 'Cissy Strut' }]) });
  const afterEnd = await saved();
  ok(oldEnd.ok && afterEnd.ended_at !== null && JSON.stringify(afterEnd.summary.played.map((p) => p.id)) === '["s1","s2","s3"]'
    && afterEnd.summary.played[0].at === 1,
    `an old leader's End keeps the songs this build saved and adds its own (${afterEnd.summary.played.map((p) => p.id)})`);
  await as(ADMIN_A, () => db.query(`UPDATE rehearsal_sessions SET summary = $1::jsonb WHERE event_id = $2`,
    [JSON.stringify({ v: 1, durationS: 600, played: [newSongs[0]], total: 3, pauses: [] }), EVENT]));
  ok((await saved()).summary.played.length === 1, "this build's write (summary.pauses) sets the songs as it says");
}

// #296 round 7: an operator's write (no auth.uid(): SQL editor, service_role) is never skipped.
{
  const op = await db.query(`UPDATE rehearsal_sessions SET started_at = $1, ended_at = NULL, summary = $2::jsonb WHERE event_id = $3 RETURNING id`,
    [B_START, summary(PLAYED), EVENT]);
  const now = await saved();
  ok(op.rows.length === 1 && new Date(now.started_at).toISOString() === B_START && now.ended_at === null && now.summary.pauses === undefined,
    "an operator's write goes through as written (start moved, End cleared, summary as given)");
}

// Members still cannot write.
const m = await upsert(MEMBER, { started_at: A_START });
ok(!!m.error, 'a member cannot write');

// Delete and start again: a new row, allowed.
await as(ADMIN_A, () => db.query(`DELETE FROM rehearsal_sessions WHERE event_id = $1`, [EVENT]));
ok((await upsert(ADMIN_B, { started_at: B_START })).ok, 'after a delete a new session can start');

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
