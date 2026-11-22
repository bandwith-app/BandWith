/**
 * docs/release-checklist.md + supabase/checks/release_migrations.sql: what is
 * applied is read from the objects each migration creates, never from
 * supabase_migrations.schema_migrations (on prod it stops at 038; everything
 * since was applied by hand), and nothing runs db push against prod.
 */
import { describe, expect, it } from 'vitest';

const fs = (await import(/* @vite-ignore */ 'node:fs')) as { readFileSync: (p: string, e: 'utf8') => string };
const { process } = globalThis as unknown as { process: { cwd(): string } };
const read = (p: string) => fs.readFileSync(`${process.cwd()}/${p}`, 'utf8');
const checklist = read('docs/release-checklist.md');
const check = read('supabase/checks/release_migrations.sql');
const checkSql = check.replace(/--.*$/gm, '');

describe('release migrations: checked by their objects', () => {
  it('the check file has a row for every migration of the release order', () => {
    const rows = [...checkSql.matchAll(/\('(\d{3})',/g)].map((m) => m[1]);
    // docs/release-checklist.md step 2 (no 179) and 177 in stage 3.
    const order = ['170', '171', '172', '173', '174', '175', '176', '177', '178', '180', '181', '182', '183', '184', '185', '186', '187', '188', '189', '190', '191'];
    for (const n of order) expect(rows, n).toContain(n);
    expect(new Set(rows).size).toBe(rows.length);
  });

  it('no row is decided by schema_migrations', () => {
    expect(checkSql).not.toMatch(/schema_migrations/);
  });

  it('the checklist never records into or reads schema_migrations as the truth, and warns off db push', () => {
    expect(checklist).not.toMatch(/INSERT INTO supabase_migrations\.schema_migrations/);
    expect(checklist).not.toMatch(/FROM supabase_migrations\.schema_migrations/);
    expect(checklist).toMatch(/Never `supabase db push`, `supabase migration list` or `supabase migration repair` against prod/);
    expect(checklist).toMatch(/supabase\/checks\/release_migrations\.sql/);
    // The only db push / migration list mentions are the warning.
    const mentions = checklist.split('\n').filter((l) => /db push|migration list|migration repair/.test(l));
    expect(mentions.every((l) => /Never/.test(l))).toBe(true);
  });
});
