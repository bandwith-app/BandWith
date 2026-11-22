// Local check of migration 174 (crash reports) without Docker: PGlite with
// stand-ins for auth and cron. Every statement is its own transaction here
// (unlike supabase/tests/client_errors.sql), so it can check what a reader
// with the service role could join: xmin and keys, during and after the hour.
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
CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job VALUES (n, s, c) ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING 1::bigint $$;
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

// ---- per person: 10 an hour (the device sends at most 10 a session)
let accepted = 0;
for (let i = 0; i < 14; i++) if (await report(U(1), `one ${i}`)) accepted++;
ok(accepted === 10, `10 an hour per person, got ${accepted}`);
for (const [u, n] of [[U(2), 2], [U(3), 1]]) for (let i = 0; i < n; i++) await report(u, `other ${u.slice(0, 1)} ${i}`);

// ---- nothing stored names the person
const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'client_error_quota'`)).rows.map((r) => r.column_name);
ok(!cols.some((c) => /user/.test(c)), `quota has no user column: ${cols.join(', ')}`);
const keys = (await q(`SELECT key FROM public.client_error_quota`)).rows.map((r) => String(r.key));
ok(keys.length === 3 && keys.every((k) => ![U(1), U(2), U(3)].some((u) => k.includes(u) || k.includes(u.replace(/-/g, '')))), 'quota keys are not the user ids');

// ---- during the live hour the counter row can be linked to that hour's
// reports (one transaction: same xmin); once pruned, nothing stored links them
const joinable = async () => (await q(`SELECT count(*)::int n FROM public.client_errors e JOIN public.client_error_quota k ON e.xmin = k.xmin`)).rows[0].n;
ok((await joinable()) > 0, 'live hour: the counter row can be linked to its reports (the documented residual)');
ok((await q(`SELECT count(*)::int n FROM public.client_errors WHERE created_at <> date_trunc('minute', created_at)`)).rows[0].n === 0, 'report times kept to the minute');
ok((await q(`SELECT n FROM public.client_error_quota ORDER BY n DESC LIMIT 1`)).rows[0].n === 14, 'rejected reports still count');
await report(U(3), 'later the same hour');
ok((await q(`SELECT n FROM public.client_error_quota ORDER BY n LIMIT 1`)).rows[0].n === 2, 'the same person keeps the same key within the hour');
const k1 = (await q(`SELECT encode(sha256(convert_to($1, 'UTF8') || secret), 'hex') k FROM public.client_error_keys`, [U(1)])).rows[0].k;
ok(keys.includes(k1), 'key = sha256(user id || hour secret)');

// ---- the next hour: a new secret, the old rows and secret gone at the prune
await db.exec(`UPDATE public.client_error_keys SET hour = hour - interval '1 hour'; UPDATE public.client_error_quota SET window_start = window_start - interval '1 hour';`);
await q(`SELECT public.bw_prune_client_errors()`);
ok((await q(`SELECT count(*)::int n FROM public.client_error_keys`)).rows[0].n === 0, 'past hour secrets deleted');
ok((await q(`SELECT count(*)::int n FROM public.client_error_quota`)).rows[0].n === 0, 'past hour quota rows deleted');
ok((await q(`SELECT n FROM public.client_error_counters WHERE bucket = 'rows'`)).rows[0].n === (await q(`SELECT count(*)::int n FROM public.client_errors`)).rows[0].n, 'row counter set to the truth');
ok((await joinable()) === 0 && (await q(`SELECT count(*)::int n FROM public.client_errors`)).rows[0].n > 0, 'after the prune: reports kept, nothing stored links them to a person');

// ---- cron
const jobs = (await q(`SELECT jobname, schedule FROM cron.job ORDER BY jobname`)).rows.map((r) => `${r.jobname} ${r.schedule}`);
ok(jobs.join() === 'bw-prune-client-errors 7 * * * *', `one cron job, hourly prune: ${jobs.join('; ')}`);

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
