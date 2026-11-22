import { describe, it, expect } from 'vitest';
import raw174 from '../../../../supabase/migrations/174_client_errors.sql?raw';

/**
 * Static guards on 174 (behaviour: supabase/tests/client_errors.sql on the
 * database, PGlite locally).
 */
const sql = raw174.replace(/--.*$/gm, '');
const fnBody = (name: string) => {
  const from = sql.indexOf(`FUNCTION public.${name}(`);
  return sql.slice(from, sql.indexOf('$$;', sql.indexOf('AS $$', from)));
};

describe('174 client errors', () => {
  it('says to strip its own BEGIN/COMMIT before a rollback dry run', () => {
    const header = raw174.slice(0, raw174.indexOf('\nBEGIN;'));
    for (const word of [/dry run/i, /strip/i, /BEGIN;/, /COMMIT;/]) expect(header).toMatch(word);
  });

  it('the prune locks the row counter before it counts (a report committing meanwhile is not lost)', () => {
    const prune = fnBody('bw_prune_client_errors');
    const lock = prune.search(/WHERE bucket = 'rows'\s+FOR UPDATE/);
    const count = prune.search(/count\(\*\) FROM public\.client_errors/);
    expect(lock).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(lock);
  });

  it('10 an hour per person, counted under a key that is not the user id', () => {
    const report = fnBody('bw_report_client_error');
    expect(report).toMatch(/IF v_n > 10 THEN/);
    expect(report).toMatch(/sha256\(convert_to\(v_uid::text, 'UTF8'\) \|\| v_secret\)/);
    expect(sql).not.toMatch(/client_error_quota[^;]*user_id/);
  });

  it('no seal job: one hourly prune deletes the counters and the hour secrets', () => {
    expect([...sql.matchAll(/cron\.schedule\('([\w-]+)'/g)].map((m) => m[1])).toEqual(['bw-prune-client-errors']);
    const prune = fnBody('bw_prune_client_errors');
    expect(prune).toMatch(/DELETE FROM public\.client_error_quota WHERE window_start < date_trunc\('hour', now\(\)\)/);
    expect(prune).toMatch(/DELETE FROM public\.client_error_keys WHERE hour < date_trunc\('hour', now\(\)\)/);
  });

  it('the hourly prune clears its own old cron run history (review #277)', () => {
    const prune = fnBody('bw_prune_client_errors');
    expect(prune).toMatch(/to_regclass\('cron\.job_run_details'\)/);
    expect(prune).toMatch(/DELETE FROM cron\.job_run_details[\s\S]*jobname = 'bw-prune-client-errors'/);
  });

  it('the header says no database has an earlier 174 (review #277)', () => {
    expect(raw174.slice(0, raw174.indexOf('\nBEGIN;'))).toMatch(/no database has an earlier 174/);
  });

  it('says plainly: linkable during the live hour, nothing stored links a report to a user once pruned', () => {
    expect(raw174).not.toMatch(/unlinkable/i);
    expect(raw174).toMatch(/During the live hour, the counter row can be linked to that hour's/);
    expect(raw174).toMatch(/nothing\s*\n?--\s*stored links a report to a user/);
  });
});
