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
const section = (from: RegExp, to: RegExp) => {
  const start = checklist.search(from);
  if (start < 0) return '';
  const body = checklist.indexOf('\n', start) + 1; // after the heading line
  const end = checklist.slice(body).search(to);
  return checklist.slice(start, end < 0 ? undefined : body + end);
};
const applyStep = section(/^2\. \*\*Additive migrations\*\*/m, /^3\. \*\*Builds for stage 1/m);
const stage3 = section(/^### Stage 3/m, /^## 4 /m);
const sunset = section(/^### Sunset list/m, /^## |(?![\s\S])/m);

describe('release migrations: checked by their objects', () => {
  it('the check file has a row for every migration of the release order', () => {
    const rows = [...checkSql.matchAll(/\('(\d{3})',/g)].map((m) => m[1]);
    // docs/release-checklist.md step 2 (no 179), and 177 (sunset list, expected false).
    const order = ['170', '171', '172', '173', '174', '175', '176', '177', '178', '180', '181', '182', '183', '184', '185', '186', '187', '188', '189', '190', '191', '192', '193', '194', '195', '196', '197'];
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
  it('never rolls 177 back: once it is in, the web is not rolled back past it, the fix goes forward', () => {
    expect(checklist).not.toMatch(/public = true/);
    expect(checklist).not.toMatch(/roll 177 back/);
    expect(sunset).toMatch(/Never roll the web back past 177/);
    expect(sunset).toMatch(/fix forward/);
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

describe('release order with 192–197, 177 out of this release (main, 11-22)', () => {
  const sequence = ['171', '174', '175', '176', '178', '180', '194', '192', '193', '181', '182', '183', '184', '185', '186', '187', '188', '189', '190', '191', '195', '196', '197'];

  it('the apply step lists every migration once, in an order that keeps the dependencies', () => {
    const line = applyStep.split('\n').find((l) => /^\s+4\. /.test(l)) ?? '';
    const listed = [...line.matchAll(/(?:^|\D)(1[789]\d)(?=\D|$)/g)].map((m) => m[1]);
    expect(listed).toEqual(sequence);
    const before = (a: string, b: string) => expect(listed.indexOf(a), `${a} before ${b}`).toBeLessThan(listed.indexOf(b));
    before('175', '178');
    before('178', '193');
    before('193', '181');
    before('194', '192');
    before('192', '193');
    before('183', '185');
    before('185', '186');
    before('186', '187');
  });

  it('177 is not applied in this release: not in the apply step nor in stage 3, but in the sunset list', () => {
    expect(applyStep).toMatch(/\*\*Not 177\*\*/);
    expect(applyStep).not.toMatch(/stage 3, after the web deploy/);
    expect(stage3).not.toMatch(/177/);
    expect(sunset).toMatch(/177/);
    expect(sunset).toMatch(/min_version/);
    expect(sunset).toMatch(/no live link relies on a public/);
    expect(sunset).toMatch(/Update the app to share quote PDFs\./);
    expect(checklist.split('## 6')[0]).not.toMatch(/Update the app to share quote PDFs/);
  });

  it('each new migration has its proof row', () => {
    expect(checkSql).toMatch(/\('194', to_regclass\('public\.notifications_chat_message_once'\)/);
    expect(checkSql).toMatch(/\('195',[^)]*bw_publish_rehearsal_proposal/);
    expect(checkSql).toMatch(/\('196', pg_get_functiondef\(to_regprocedure\('public\.bw_trg_rehearsal_session_guard\(\)'\)\) LIKE '%NEW\.started_at IS DISTINCT FROM OLD\.started_at%'/);
    expect(checkSql).toMatch(/\('197', to_regclass\('public\.song_file_adoptions'\)/);
  });
});
