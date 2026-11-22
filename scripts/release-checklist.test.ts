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

describe('release checklist, round 6 (review #278)', () => {
  it('never rolls 177 back: the web is not rolled back past 177, the fix goes forward', () => {
    expect(checklist).not.toMatch(/public = true/);
    expect(checklist).not.toMatch(/roll 177 back/);
    expect(checklist).toMatch(/Never roll the web back past 177/);
    expect(checklist).toMatch(/fix forward/);
  });

  it('supabase db reset only on the local database, never as a prod step', () => {
    const lines = checklist.split('\n').filter((l) => /db reset/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/Local only/);
    expect(checklist).toMatch(/never reset or drop anything on prod/);
  });

  it('one Android publisher at a time, and latest is re-checked after publishing', () => {
    expect(checklist).toMatch(/One publisher at a time/);
    expect(checklist).toMatch(/android-latest-flag\.sh --fix-latest/);
  });

  it('the Android code encodes the version (no minute-based codes for new releases)', () => {
    expect(checklist).toMatch(/1\.0\.14 → 41001400, 1\.0\.13\.1 → 41001301/);
    expect(checklist).not.toMatch(/The code is minute-based/);
  });

  it('170 is "in" only in the current version: partial column and the newer-only status guard', () => {
    const row = checkSql.split('\n').filter((l, i, all) => /\('170'/.test(l) || /\('170'/.test(all[i - 1] ?? '') || /\('170'/.test(all[i - 2] ?? '')).join(' ');
    expect(row).toMatch(/c = 'partial'/);
    expect(row).toMatch(/bw_live_pack_status_newer_only/);
  });
});
