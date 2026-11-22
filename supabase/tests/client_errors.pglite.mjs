// Local check of migration 174 (crash reports) without Docker: PGlite with
// stand-ins for auth and cron. Every statement is its own transaction here
// (unlike supabase/tests/client_errors.sql), so it can check what a reader
// with the service role could join: xmin across tables.
//
//   mkdir -p /tmp/pg174 && cd /tmp/pg174 && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/client_errors.pglite.mjs . && node client_errors.pglite.mjs <repo>/supabase/migrations/174_client_errors.sql
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = new PGlite();
const q = (sql, p) => db.query(sql, p);
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE SCHEMA auth; CREATE SCHEMA cron; GRANT USAGE ON SCHEMA auth TO authenticated, anon;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE TABLE cron.job_run_details (runid bigserial PRIMARY KEY, jobid bigint, status text, end_time timestamptz);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING 1::bigint $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
`);
const mig = readFileSync(process.argv[2], 'utf8');
await db.exec(mig);
await db.exec(mig);
ok(true, 'migration runs twice');

const U = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const report = async (user, msg) => {
  await db.exec(`SELECT set_config('request.jwt.claims', '{"sub":"${user}"}', false)`);
  return (await q(`SELECT public.bw_report_client_error('error', $1) AS r`, [msg])).rows[0].r;
};

// ---- one person can't take more than the app sends (10 a session), but
// the server keeps no per-person count: only the global caps refuse
for (let i = 0; i < 14; i++) await report(U(1), `one ${i}`);
for (const [u, n] of [[U(2), 2], [U(3), 1]]) for (let i = 0; i < n; i++) await report(u, `other ${u.slice(0, 1)} ${i}`);
ok((await q(`SELECT count(*)::int n FROM public.client_errors`)).rows[0].n === 17, 'no per-person limit stored: all 17 kept under the global caps');

// ---- unlinkable: the report's transaction writes only the report and the
// global counters (shared by everyone), nothing made from the user id
const tables = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`)).rows.map((r) => r.table_name);
ok(tables.join() === 'client_error_counters,client_errors', `only reports and global counters: ${tables.join(', ')}`);
const buckets = (await q(`SELECT bucket FROM public.client_error_counters`)).rows.map((r) => String(r.bucket));
ok(buckets.length > 0 && buckets.every((b) => /^(h:\d{4}-\d\d-\d\dT\d\d|d:\d{4}-\d\d-\d\d|rows)$/.test(b)), `counters are global buckets only: ${buckets.join(', ')}`);
const sameTx = (await q(`SELECT count(*)::int n FROM public.client_errors e JOIN public.client_error_counters c ON e.xmin = c.xmin`)).rows[0].n;
ok(sameTx <= 3, `a report shares its transaction only with the 3 global counters (${sameTx})`);
ok((await q(`SELECT count(*)::int n FROM public.client_errors WHERE created_at <> date_trunc('minute', created_at)`)).rows[0].n === 0, 'report times kept to the minute');
await db.exec(`SELECT set_config('request.jwt.claims', '', false)`);
ok((await q(`SELECT public.bw_report_client_error('error', 'signed out') AS r`)).rows[0].r === false, 'signed out: refused');

// ---- global caps: 300 an hour
await db.exec(`UPDATE public.client_error_counters SET n = 300 WHERE bucket LIKE 'h:%'`);
ok((await report(U(4), 'over the hour cap')) === false, 'global hourly cap refuses');

// ---- the prune: past counters go, the row counter is set to the truth
await db.exec(`UPDATE public.client_error_counters SET bucket = 'h:2000-01-01T00' WHERE bucket LIKE 'h:%'`);
await q(`SELECT public.bw_prune_client_errors()`);
ok((await q(`SELECT count(*)::int n FROM public.client_error_counters WHERE bucket LIKE 'h:%'`)).rows[0].n === 0, 'past hour counter deleted');
ok((await q(`SELECT n FROM public.client_error_counters WHERE bucket = 'rows'`)).rows[0].n === (await q(`SELECT count(*)::int n FROM public.client_errors`)).rows[0].n, 'row counter set to the truth');

// ---- cron
const jobs = (await q(`SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'bw-%' ORDER BY jobname`)).rows.map((r) => `${r.jobname} ${r.schedule}`);
ok(jobs.join() === 'bw-prune-client-errors 7 * * * *', `one cron job, hourly prune: ${jobs.join('; ')}`);

// ---- the prune clears its own old run history, nothing else
await db.exec(`
INSERT INTO cron.job (jobname, schedule, command) VALUES ('someone-else', '0 * * * *', 'SELECT 1');
INSERT INTO cron.job_run_details (jobid, status, end_time)
SELECT j.jobid, 'succeeded', t FROM cron.job j, (VALUES (now() - interval '3 days'), (now() - interval '2 hours')) v(t);
`);
await q(`SELECT public.bw_prune_client_errors()`);
const runs = (await q(`SELECT j.jobname, (d.end_time < now() - interval '1 day') AS old FROM cron.job_run_details d JOIN cron.job j USING (jobid) ORDER BY 1, 2`)).rows.map((r) => `${r.jobname}:${r.old ? 'old' : 'new'}`);
ok(runs.join(',') === 'bw-prune-client-errors:new,someone-else:new,someone-else:old', `run history: ${runs.join(', ')}`);

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
