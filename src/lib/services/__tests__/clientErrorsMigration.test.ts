import { describe, it, expect } from 'vitest';
import raw174 from '../../../../supabase/migrations/174_client_errors.sql?raw';

/**
 * Static guards on 174 (behaviour: supabase/tests/client_errors.sql on the
 * database, PGlite locally).
 */
const NODE_FS = 'node:fs'; // a variable: the app's tsconfig has no Node types
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

  it('no stored link: no per-person table, the user id is only checked (review #277 r4)', () => {
    expect(sql).not.toMatch(/client_error_quota|client_error_keys/);
    const report = fnBody('bw_report_client_error');
    expect(report).toMatch(/IF auth\.uid\(\) IS NULL/);
    expect(report.match(/auth\.uid\(\)/g)).toHaveLength(1);
    expect(report).not.toMatch(/sha256|v_uid/);
  });

  it('the insert path scrubs again before it cuts, and nobody can call the scrub directly (review #277, Claude 9)', () => {
    const report = fnBody('bw_report_client_error');
    for (const field of ['p_message', 'p_stack', 'p_route']) {
      expect(report, field).toMatch(new RegExp(`left\\(public\\.bw_client_error_scrub\\(left\\(${field}, \\d+\\)\\), \\d+\\)`));
    }
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.bw_client_error_scrub\(text\) FROM PUBLIC, anon, authenticated;/);
    expect(raw174.slice(0, raw174.indexOf('\nBEGIN;'))).toMatch(/scrubs again, as defense in depth/);
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

  it('says plainly what links a report to a person and what does not (review #277, Claude)', () => {
    const header = raw174.slice(0, raw174.indexOf('\nBEGIN;')).replace(/\n--\s*/g, ' ');
    // No stored link, but not "unlinkable": ordering metadata and tiny cohorts exist.
    expect(header).not.toMatch(/Unlinkable/i);
    expect(header).not.toMatch(/no transaction id/i);
    expect(header).toMatch(/No stored link/);
    expect(header).toMatch(/xmin/);
    expect(header).toMatch(/identity order/);
    expect(header).toMatch(/app_version and platform/);
    expect(header).toMatch(/service role is trusted not to correlate/);
    expect(header).toMatch(/request logs/);
  });

  it('docs/crash-reports.md says the same', async () => {
    const fs = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync: (p: string, e: 'utf8') => string };
    const { process } = globalThis as unknown as { process: { cwd(): string } };
    const doc = fs.readFileSync(`${process.cwd()}/docs/crash-reports.md`, 'utf8');
    expect(doc).not.toMatch(/Unlinkable/i);
    expect(doc).not.toMatch(/no transaction id/i);
    expect(doc).toMatch(/No stored link/);
    expect(doc).toMatch(/service role is trusted not to correlate/);
  });

  it('docs/crash-reports.md names the accepted limits (review #277, Claude r5)', async () => {
    const fs = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync: (p: string, e: 'utf8') => string };
    const { process } = globalThis as unknown as { process: { cwd(): string } };
    const doc = fs.readFileSync(`${process.cwd()}/docs/crash-reports.md`, 'utf8');
    expect(doc).toMatch(/\*\*Unquoted free text\*\* is not caught/);
    expect(doc).toMatch(/a name in an error message always goes between quotes/);
    expect(doc).toMatch(/\*\*Accepted risk: one account can use up the global caps\*\*/);
  });
});
