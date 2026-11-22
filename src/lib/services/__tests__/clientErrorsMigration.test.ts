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
    expect(report).toMatch(/sha256\(v_secret \|\| convert_to\(v_uid::text, 'UTF8'\)\)/);
    expect(sql).not.toMatch(/client_error_quota[^;]*user_id/);
  });

  it('every minute a seal rewrites new reports and the counters, in a job of its own', () => {
    const seal = fnBody('bw_seal_client_errors');
    expect(seal).toMatch(/UPDATE public\.client_errors SET sealed = true WHERE NOT sealed/);
    expect(seal).toMatch(/DELETE FROM public\.client_error_quota[\s\S]*ORDER BY random\(\)/);
    expect(sql).toMatch(/cron\.schedule\('bw-seal-client-errors', '\* \* \* \* \*'/);
  });

  it('never calls the counter "unlinkable" (the live hour and the minute before a seal are not)', () => {
    expect(raw174).not.toMatch(/unlinkable/i);
    expect(raw174).toMatch(/What a reader with the service role can still link/);
  });
});
