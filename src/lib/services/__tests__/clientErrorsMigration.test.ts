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

  it('unlinkable: no per-person table, the user id is only checked (review #277 r4)', () => {
    expect(sql).not.toMatch(/client_error_quota|client_error_keys/);
    const report = fnBody('bw_report_client_error');
    expect(report).toMatch(/IF auth\.uid\(\) IS NULL/);
    expect(report.match(/auth\.uid\(\)/g)).toHaveLength(1);
    expect(report).not.toMatch(/sha256|v_uid/);
  });

  it('one cron job, the hourly prune', () => {
    expect([...sql.matchAll(/cron\.schedule\('([\w-]+)'/g)].map((m) => m[1])).toEqual(['bw-prune-client-errors']);
  });

  it('the hourly prune clears its own old cron run history (review #277)', () => {
    const prune = fnBody('bw_prune_client_errors');
    expect(prune).toMatch(/to_regclass\('cron\.job_run_details'\)/);
    expect(prune).toMatch(/DELETE FROM cron\.job_run_details[\s\S]*jobname = 'bw-prune-client-errors'/);
  });

  it('the header says no database has an earlier 174 (review #277)', () => {
    expect(raw174.slice(0, raw174.indexOf('\nBEGIN;'))).toMatch(/no database has an earlier 174/);
  });

  it('says plainly what is unlinkable and what is not (Supabase request logs)', () => {
    const header = raw174.slice(0, raw174.indexOf('\nBEGIN;'));
    expect(header).toMatch(/Unlinkable in the database/);
    expect(header).toMatch(/no stored row, and no\s*\n?--\s*transaction id \(xmin\), ties a report to a person/);
    expect(header).toMatch(/request logs/);
  });
});
