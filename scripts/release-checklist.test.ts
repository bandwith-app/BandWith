/**
 * docs/release-checklist.md + supabase/checks/release_migrations.sql: what is
 * applied is read from the objects each migration creates, never from
 * supabase_migrations.schema_migrations (on prod it stops at 038; everything
 * since was applied by hand), and nothing runs db push against prod.
 */
import { describe, expect, it } from 'vitest';

const fs = (await import(/* @vite-ignore */ 'node:fs')) as {
  readFileSync: (p: string, e: 'utf8') => string;
  readdirSync: (p: string) => string[];
};
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
    const rows = [...checkSql.matchAll(/^\s*\('(\d{3})', (?!')/gm)].map((m) => m[1]);
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
    expect(checklist).toMatch(/1\.0\.14 → 41001400, 1\.0\.14\.1 → 41001401/);
    expect(checklist).toMatch(/never as 1\.0\.12\.x or 1\.0\.13\.x/);
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
    expect(sunset).toMatch(/Update the app to share quote PDFs\./);
    expect(checklist.split('## 6')[0]).not.toMatch(/Update the app to share quote PDFs/);
  });

  it('each new migration has its proof row', () => {
    expect(checkSql).toMatch(/\('195',[^)]*bw_publish_rehearsal_proposal/);
    expect(markers.some((k) => k.m === '196' && k.fn === 'bw_trg_rehearsal_session_guard')).toBe(true);
    expect(checkSql).toMatch(/\('197', to_regclass\('public\.song_file_adoptions'\)/);
  });
});

describe('edge functions that wait for, or go before, a migration (main, 11-22)', () => {
  const step1 = section(/^1\. \*\*Edge functions/m, /^2\. \*\*Additive migrations\*\*/m);
  const waits = section(/^\s+- \*\*Functions that wait for their migration\*\*/m, /^\s+- \*\*Not 172\*\*/m);

  it('member-calendar and deputy-calendar go in step 1, before 182, with a proof', () => {
    expect(step1).toMatch(/`deputy-calendar` and `member-calendar`[^\n]*before 182/);
    expect(step1).toMatch(/182's row is still `false`/);
  });

  it('delete-account and send-push are not deployed in step 1', () => {
    expect(step1).toMatch(/\*\*Not here\*\*: `delete-account` and `send-push`/);
    expect(checklist).not.toMatch(/deploying it in step 1 is safe/);
  });

  it('delete-account right after 180, send-push right after 194, each with its proof, in apply order', () => {
    const del = waits.indexOf('right after 180');
    const push = waits.indexOf('right after 194');
    expect(del).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(del);
    expect(waits.slice(del, push)).toMatch(/`delete-account`[\s\S]*180's row is `true`/);
    expect(waits.slice(push)).toMatch(/`send-push`[\s\S]*194's row is `true`/);
    expect(waits.slice(push)).toMatch(/emergency net/);
    expect(waits).toMatch(/supabase functions list/);
  });
});

// ── Codex round (review #278, 11-22) ────────────────────────────────────────
const MIGRATIONS = 'supabase/migrations';
const migrationFile = (n: string) => fs.readdirSync(`${process.cwd()}/${MIGRATIONS}`).find((f) => f.startsWith(`${n}_`));
const noComments = (sql: string) => sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
/** Body of the last CREATE [OR REPLACE] FUNCTION public.<fn>(...) in a migration file, or null. */
const fnBody = (sql: string, fn: string) => {
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fn}\\s*\\([\\s\\S]*?\\)\\s*RETURNS[\\s\\S]*?AS\\s+(\\$\\w*\\$)([\\s\\S]*?)\\1`, 'gi');
  let body: string | null = null;
  for (const m of noComments(sql).matchAll(re)) body = m[2];
  return body;
};
const definedFns = (sql: string) =>
  new Set([...noComments(sql).matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(/gi)].map((m) => m[1]));
const unquote = (s: string) => s.replace(/''/g, "'");
/** marker(m, fn, txt) rows of release_migrations.sql. */
const markers = [...checkSql.matchAll(/^\s*\('(\d{3})', '(\w+)', '((?:[^']|'')*)'\)/gm)].map((m) => ({ m: m[1], fn: m[2], txt: unquote(m[3]) }));
// The apply order of section 2 (173 and 170 first, then step 4).
const releaseOrder = () => {
  const line = applyStep.split('\n').find((l) => /^\s+4\. /.test(l)) ?? '';
  return ['173', '170', ...[...line.matchAll(/(?:^|\D)(1[789]\d)(?=\D|$)/g)].map((m) => m[1])];
};

describe('every proof takes a marker from the final body (Codex, review #278)', () => {
  it('each migration with a function is proven by at least one body marker, not by its objects alone', () => {
    // 172: already live. 173: one version only, its table. 177: no function (a bucket flag). 171: its trigger (below).
    const objectsOnly = new Set(['171', '172', '173', '177']);
    for (const n of releaseOrder().filter((x) => !objectsOnly.has(x))) {
      expect(markers.filter((k) => k.m === n).length, `${n} has a body marker`).toBeGreaterThan(0);
    }
    expect(checkSql).toMatch(/strpos\(/);
  });

  it('every marker is in that function in the migration file as it is now (checked once the file is on main)', () => {
    // main has the A2 copy of 170 (#269); #273 replaces it in place. Remove 170 here once #273 is merged.
    const replacedByOpenPr = new Set(['170']);
    for (const k of markers) {
      const f = migrationFile(k.m);
      if (!f || replacedByOpenPr.has(k.m)) continue; // the file is on its own branch until it merges
      const body = fnBody(read(`${MIGRATIONS}/${f}`), k.fn);
      expect(body, `${k.m} defines ${k.fn}`).not.toBeNull();
      expect(body ?? '', `${k.m} ${k.fn}: ${k.txt}`).toContain(k.txt);
    }
  });

  it('194 is proven by bw_write_chat_notices and a marker from its final body, not by the index', () => {
    const row = checkSql.split('\n').find((l) => /^\s*\('194', (?!')/.test(l)) ?? '';
    expect(row).not.toMatch(/notifications_chat_message_once/);
    expect(markers.some((k) => k.m === '194' && k.fn === 'bw_write_chat_notices' && /push_claimed_at/.test(k.txt))).toBe(true);
  });

  it('175 is proven by its final dropped_out rule, in a function no later migration redefines', () => {
    const k = markers.find((x) => x.m === '175' && /'dropped_out'/.test(x.txt));
    expect(k).toBeDefined();
    // 178 redefines bw_chat_scope_ok and get_user_chats (redefined_functions.sql), so 175's own body is not the live one there.
    expect(['bw_chat_scope_ok', 'get_user_chats']).not.toContain(k?.fn);
  });

  it('171 is proven by its final trigger (the live pack follows line_timing)', () => {
    const row = checkSql.split('\n').slice(checkSql.split('\n').findIndex((l) => /^\s*\('171', /.test(l))).slice(0, 4).join(' ');
    expect(row).toMatch(/pg_get_triggerdef/);
    expect(row).toMatch(/bw_live_pack_song/);
    expect(row).toMatch(/line_timing/);
  });

  it('the markers are matched as text (strpos), never with LIKE wildcards', () => {
    expect(checkSql).not.toMatch(/LIKE '%/);
  });
});

describe('functions redefined by more than one migration: post-apply check (main, 11-22)', () => {
  const redef = read('supabase/checks/redefined_functions.sql');
  const redefSql = noComments(redef);
  const rows = [...redefSql.matchAll(/^\s*\('public\.(\w+)\(([^)]*)\)', '(\d{3})', '([\d, ]+)', '((?:[^']|'')*)'\)/gm)].map((m) => ({
    fn: m[1],
    final: m[3],
    replaces: m[4].split(',').map((x) => x.trim()),
    mark: unquote(m[5]),
  }));

  it('is read only and compares pg_get_functiondef with a marker of the intended final body', () => {
    expect(redefSql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE)\b/i);
    expect(redefSql).toMatch(/pg_get_functiondef\(to_regprocedure\(/);
    expect(redefSql).toMatch(/strpos\(/);
  });

  it('lists the known groups with the right final migration', () => {
    const final = (fn: string) => rows.find((r) => r.fn === fn)?.final;
    expect(final('bw_withdraw_song_suggestion')).toBe('197');
    expect(final('bw_mark_chat_read')).toBe('180');
    expect(final('bw_mark_chats_delivered')).toBe('180');
    expect(final('bw_chat_scope_ok')).toBe('178');
    expect(final('get_user_chats')).toBe('178');
    for (const fn of ['bw_quote_link_view', 'bw_quote_link_respond', 'bw_quote_link_message']) expect(final(fn), fn).toBe('187');
    expect(final('bw_live_pack_window_events')).toBe('178');
    expect(final('bw_trg_dispatch_push')).toBe('178');
    expect(final('bw_stage_key')).toBe('191');
    expect(final('bw_stage_topic_allowed')).toBe('191');
    expect(redefSql).toMatch(/bw_live_pack_song[\s\S]*pg_get_triggerdef/);
  });

  it('each marker is in the final body and in none of the bodies it replaces (files on main)', () => {
    for (const r of rows) {
      const f = migrationFile(r.final);
      if (f) expect(fnBody(read(`${MIGRATIONS}/${f}`), r.fn) ?? '', `${r.final} ${r.fn}`).toContain(r.mark);
      for (const old of r.replaces) {
        const o = migrationFile(old);
        if (o) expect(fnBody(read(`${MIGRATIONS}/${o}`), r.fn) ?? '', `${old} ${r.fn}`).not.toContain(r.mark);
      }
    }
  });

  it('every function defined by two or more release migrations has a row, final = the last in the apply order', () => {
    const seen = new Map<string, string[]>();
    for (const n of releaseOrder()) {
      const f = migrationFile(n);
      if (!f) continue;
      for (const fn of definedFns(read(`${MIGRATIONS}/${f}`))) seen.set(fn, [...(seen.get(fn) ?? []), n]);
    }
    for (const [fn, migs] of seen) {
      if (migs.length < 2) continue;
      const r = rows.find((x) => x.fn === fn);
      expect(r, `${fn} (${migs.join(' → ')}) has a row`).toBeDefined();
      expect(r?.final, fn).toBe(migs[migs.length - 1]);
    }
  });

  it('the checklist runs it after the last migration, and every row must be ok', () => {
    expect(applyStep).toMatch(/supabase\/checks\/redefined_functions\.sql/);
    expect(applyStep).toMatch(/every row `ok = true`/);
  });
});

describe('checklist, Codex round (review #278)', () => {
  const rollback = section(/^### Android: stop it spreading/m, /^### iOS/m);
  const candidate = section(/^## 1 · Candidate ready/m, /^## 2 /m);

  it('the Android rollback moves latest with --fix-latest (highest stable release not withdrawn), never to a fixed version', () => {
    expect(rollback).toMatch(/scripts\/android-latest-flag\.sh --fix-latest/);
    expect(rollback).not.toMatch(/gh release edit android-v1\.0\.13 [^\n]*--latest/);
    expect(rollback).toMatch(/not withdrawn/);
  });

  it('177 waits for the strict check in its own header (#281): no live link of any status created or shared before :t', () => {
    expect(sunset).toMatch(/177_quotes_bucket_private\.sql/);
    expect(sunset).toMatch(/not revoked, not expired/);
    expect(sunset).toMatch(/every status, drafts included/);
    expect(sunset).toMatch(/created or shared before `:t`/);
  });

  it('a PGlite integration run on main is a prerequisite: every migration in release order, all security suites, green', () => {
    expect(candidate).toMatch(/PGlite integration run on `main`/);
    expect(candidate).toMatch(/every migration of the release, in the apply order/);
    expect(candidate).toMatch(/every `supabase\/tests\/\*\.pglite\.mjs` suite/);
    expect(candidate).toMatch(/Nothing goes to prod until it is green/);
  });
});
