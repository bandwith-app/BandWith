/**
 * docs/release-checklist.md + supabase/checks/release_migrations.sql: what is
 * applied is read from the objects each migration creates, never from
 * supabase_migrations.schema_migrations (on prod it stops at 038; everything
 * since was applied by hand), and nothing runs db push against prod.
 */
import { describe, expect, it } from 'vitest';
import { definedFunctions } from './sql-functions.mjs';

const fs = (await import(/* @vite-ignore */ 'node:fs')) as {
  readFileSync: (p: string, e: 'utf8') => string;
  readdirSync: (p: string) => string[];
  existsSync: (p: string) => boolean;
};
const { process } = globalThis as unknown as { process: { cwd(): string } };
const read = (p: string) => fs.readFileSync(`${process.cwd()}/${p}`, 'utf8');
const existsSync = (p: string) => fs.existsSync(`${process.cwd()}/${p}`);
const readdirSync = (p: string) => fs.readdirSync(`${process.cwd()}/${p}`);
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
    const order = ['170', '198', '171', '172', '173', '174', '175', '176', '177', '178', '180', '181', '182', '183', '184', '185', '186', '187', '188', '189', '190', '191', '192', '193', '194', '195', '196', '197'];
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
    for (const l of lines) expect(l).toMatch(/Local only|Don't test the release with `supabase db reset` on a local database/);
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

  it('170 is frozen (main\'s file, one version): its objects; this round (partial, newer-only guard, keep) is 198 (Codex round 2)', () => {
    const rowOf = (n: string) => {
      const lines = checkSql.split('\n');
      const i = lines.findIndex((l) => new RegExp(`^\\s*\\('${n}', (?!')`).test(l));
      return lines.slice(i, i + 4).join(' ');
    };
    expect(rowOf('170')).toMatch(/live_pack_status/);
    expect(rowOf('170')).toMatch(/bw_live_pack_queue/);
    expect(rowOf('170')).not.toMatch(/partial/);
    expect(rowOf('198')).toMatch(/c = 'partial'/);
    expect(rowOf('198')).toMatch(/bw_live_pack_status_newer_only/);
    expect(rowOf('198')).toMatch(/bw_live_pack_keep/);
    expect(markers.filter((k) => k.m === '170')).toEqual([]);
    expect(markers.filter((k) => k.m === '198').map((k) => k.fn)).toEqual(expect.arrayContaining(['bw_live_pack_can_hold', 'bw_live_pack_refresh_flush', 'bw_live_pack_on', 'bw_live_pack_keep']));
  });
});

describe('release order with 192–197, 177 out of this release (main, 11-22)', () => {
  // 194 and 184 before 175 (main, 11-22): send-push goes out once, right
  // after 175, with both of them already in, so neither fallback runs.
  const sequence = ['171', '174', '194', '184', '175', '176', '178', '180', '192', '193', '181', '182', '183', '185', '186', '187', '188', '189', '190', '191', '195', '196', '197'];

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
    before('178', '182');
    before('175', '193');
    before('180', '197');
    before('178', '191');
    before('194', '175');
    before('184', '175');
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

  // Every function that imports _shared/auth.ts: #281's auth.ts sends to
  // nobody without 175's bw_chat_recipient_ids, and the released one reads
  // the roster 175 keeps for people who left. So they go right after 175.
  const authUsers = () =>
    fs
      .readdirSync(`${process.cwd()}/supabase/functions`)
      .filter((d) => !d.startsWith('_'))
      .filter((d) => {
        try {
          return /_shared\/auth\.ts/.test(read(`supabase/functions/${d}/index.ts`));
        } catch {
          return false;
        }
      });
  const after = (n: string) => {
    const at = waits.search(new RegExp(`right after ${n}\\b`));
    if (at < 0) return '';
    const next = waits.slice(at + 1).search(/\n\s+- right after \d{3}/);
    return waits.slice(at, next < 0 ? undefined : at + 1 + next);
  };

  it('right after 175: send-push and every other function that imports _shared/auth.ts, with its proof and the ex-member push test', () => {
    const step = after('175');
    expect(step).toMatch(/rows of \*\*194, 184 and 175\*\* are all `true`/);
    expect(step).toMatch(/`send-push`/);
    for (const fn of authUsers().filter((f) => f !== 'delete-account' && f !== 'quote-pdf')) expect(step, fn).toContain(`\`${fn}\``);
    expect(step).toMatch(/_shared\/auth\.ts/);
    expect(step).toMatch(/ex-member[\s\S]*must not reach/);
    expect(step).toMatch(/only with \*\*194 and 184 already in\*\*/);
    expect(waits).not.toMatch(/right after 194/);
  });

  it('delete-account after 180 (its 503 guard), quote-pdf after 176 (its RPC): the auth.ts users that wait longer', () => {
    expect(after('176')).toMatch(/`quote-pdf`[\s\S]*176's row is `true`/);
    const del = after('180');
    expect(del).toMatch(/`delete-account`/);
    expect(del).toMatch(/--no-verify-jwt/);
    expect(del).toMatch(/clean worktree/);
    expect(del).toMatch(/180's row is `true`/);
    expect(del).toMatch(/cron\.job[\s\S]*bw-finish-account-deletions/);
    expect(waits.indexOf('right after 175')).toBeLessThan(waits.indexOf('right after 176'));
    expect(waits.indexOf('right after 176')).toBeLessThan(waits.indexOf('right after 180'));
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
/** The same body with its comments: what pg_get_functiondef shows, so where markers are looked for (B5). */
const markerBody = (sql: string, fn: string) => {
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fn}\\s*\\([\\s\\S]*?\\)\\s*RETURNS[\\s\\S]*?AS\\s+(\\$\\w*\\$)([\\s\\S]*?)\\1`, 'gi');
  let body: string | null = null;
  for (const m of sql.matchAll(re)) body = m[2];
  return body;
};
/** What a migration defines, EXECUTE / DO definitions included (scripts/sql-functions.mjs). */
const definedFns = (sql: string) => definedFunctions(sql) as Map<string, { how: string; conditional: boolean }>;
const unquote = (s: string) => s.replace(/''/g, "'");
/** marker(m, fn, txt) rows of release_migrations.sql. */
const markers = [...checkSql.matchAll(/^\s*\('(\d{3})', '(\w+)', '((?:[^']|'')*)'\)/gm)].map((m) => ({ m: m[1], fn: m[2], txt: unquote(m[3]) }));
// The apply order of section 2 (173, then 170 + 198, then step 4).
const releaseOrder = () => {
  const line = applyStep.split('\n').find((l) => /^\s+4\. /.test(l)) ?? '';
  return ['173', '170', '198', ...[...line.matchAll(/(?:^|\D)(1[789]\d)(?=\D|$)/g)].map((m) => m[1])];
};

describe('every proof takes a marker from the final body (Codex, review #278)', () => {
  it('each migration with a function is proven by at least one body marker, not by its objects alone', () => {
    // 172: already live. 173 and 170 (frozen on main): one version only, their tables. 177: no function (a bucket flag). 171: its trigger (below).
    const objectsOnly = new Set(['170', '171', '172', '173', '177']);
    for (const n of releaseOrder().filter((x) => !objectsOnly.has(x))) {
      expect(markers.filter((k) => k.m === n).length, `${n} has a body marker`).toBeGreaterThan(0);
    }
    expect(checkSql).toMatch(/strpos\(/);
  });

  it('every marker is in that function in the migration file as it is now (checked once the file is on main)', () => {
    // 170 is frozen: main's file is the release's (#273 round 8).
    const replacedByOpenPr = new Set<string>();
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
    const row = checkSql.split('\n').slice(checkSql.split('\n').findIndex((l) => /^\s*\('171', (?!')/.test(l))).slice(0, 4).join(' ');
    expect(row).toMatch(/pg_get_triggerdef/);
    expect(row).toMatch(/bw_live_pack_song/);
    expect(row).toMatch(/line_timing/);
  });

  it('the markers are matched as text (strpos), never with LIKE wildcards', () => {
    expect(checkSql).not.toMatch(/LIKE '%/);
  });
});

/** Re-declared unchanged by a later migration of the release (identical live bodies on the 11-22 heads). */
const SAME_BODY = new Set(['bw_band_free_slots', 'bw_chat_preview', 'bw_js_left']);
const squash = (b: string | null) => (b ?? '').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
describe('functions redefined by more than one migration: post-apply check (main, 11-22)', () => {
  const redef = read('supabase/checks/redefined_functions.sql');
  const redefSql = noComments(redef);
  const rows = [...redefSql.matchAll(/^\s*\('(\w+)', '(\d{3})', '([\d, ]+)', '((?:[^']|'')*)'\)/gm)].map((m) => ({
    fn: m[1],
    final: m[2],
    replaces: m[3].split(',').map((x) => x.trim()),
    mark: unquote(m[4]),
  }));

  it('is read only and compares pg_get_functiondef with a marker of the intended final body', () => {
    expect(redefSql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE)\b/i);
    expect(redefSql).toMatch(/pg_get_functiondef\(p\.oid\)/);
    expect(redefSql).toMatch(/strpos\(/);
    expect(rows.length).toBeGreaterThanOrEqual(12);
  });

  it('matches by name over every overload, never by a signature that may still change (main, 11-22)', () => {
    expect(redefSql).toMatch(/p\.proname = v\.fn/);
    expect(redefSql).toMatch(/bool_and\(/);
    // Outside the markers' text (a marker may quote a signature the body contains).
    const code = redefSql.replace(/'(?:[^']|'')*'/g, "''");
    expect(code).not.toMatch(/to_regprocedure\(/);
    expect(redefSql).not.toMatch(/\('public\.\w+\(/);
  });

  it('bw_chat_scope_ok: 175\'s stamp and its lineup rule (Claude review #278)', () => {
    const marks = rows.filter((r) => r.fn === 'bw_chat_scope_ok').map((r) => r.mark);
    expect(marks).toEqual(expect.arrayContaining(['bw:175-r4', 'bw_is_event_participant']));
    expect(rows.filter((r) => r.fn === 'bw_chat_scope_ok').every((r) => r.final === '175' && r.replaces.includes('178'))).toBe(true);
  });

  it('a definition inside a DO block that returns first counts as conditional (the exception below)', () => {
    const sql = `DO $do$ BEGIN
  IF strpos(pg_get_functiondef('public.bw_x(text)'::regprocedure), 'bw:175-r4') > 0 THEN RETURN; END IF;
  EXECUTE $f$CREATE OR REPLACE FUNCTION public.bw_x(p text) RETURNS boolean LANGUAGE sql AS $b$ SELECT public.bw_is_event_participant() $b$$f$;
END $do$;`;
    expect(definedFns(sql).get('bw_x')?.conditional).toBe(true);
  });

  it('the overlaps of the 11-22 evening heads have rows: 182 over 178, and three identical copies (fn-redefinitions --check)', () => {
    const final = (fn: string) => rows.find((r) => r.fn === fn)?.final;
    expect(final('bw_deputy_feed')).toBe('182');
    expect(final('bw_deputy_request_view')).toBe('182');
    expect(final('bw_band_free_slots')).toBe('195');
    expect(final('bw_chat_preview')).toBe('192');
    expect(final('bw_js_left')).toBe('192');
  });

  it('lists the known groups with the right final migration', () => {
    const final = (fn: string) => rows.find((r) => r.fn === fn)?.final;
    expect(final('bw_withdraw_song_suggestion')).toBe('197');
    expect(final('bw_mark_chat_read')).toBe('180');
    expect(final('bw_mark_chats_delivered')).toBe('180');
    // 178 keeps a live 175 body (its DO block returns), so 175's must be live.
    expect(final('bw_chat_scope_ok')).toBe('175');
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
      if (f) expect(markerBody(read(`${MIGRATIONS}/${f}`), r.fn) ?? '', `${r.final} ${r.fn}`).toContain(r.mark);
      for (const old of r.replaces) {
        const o = migrationFile(old);
        if (!o) continue;
        // A DO block that defines it only when the final body isn't live (178
        // keeps 175's bw_chat_scope_ok; its fallback is a copy of 175's, #294)
        // may hold the same text: the live body decides, not the file.
        if (definedFns(read(`${MIGRATIONS}/${o}`)).get(r.fn)?.conditional) continue;
        // A later migration that re-declares the same body (a copy): either one
        // being live is right; the two must then really be the same.
        if (SAME_BODY.has(r.fn)) {
          if (f) expect(squash(fnBody(read(`${MIGRATIONS}/${f}`), r.fn)), `${r.fn}: ${r.final} = ${old}`).toBe(squash(fnBody(read(`${MIGRATIONS}/${o}`), r.fn)));
          continue;
        }
        expect(markerBody(read(`${MIGRATIONS}/${o}`), r.fn) ?? '', `${old} ${r.fn}`).not.toContain(r.mark);
      }
    }
  });

  it('every function defined by two or more release migrations has a row, final = the last in the apply order', () => {
    const seen = new Map<string, Array<{ n: string; conditional: boolean }>>();
    for (const n of releaseOrder()) {
      const f = migrationFile(n);
      if (!f) continue;
      for (const [fn, d] of definedFns(read(`${MIGRATIONS}/${f}`))) seen.set(fn, [...(seen.get(fn) ?? []), { n, conditional: d.conditional }]);
    }
    for (const [fn, migs] of seen) {
      if (migs.length < 2) continue;
      const r = rows.find((x) => x.fn === fn);
      expect(r, `${fn} (${migs.map((m) => m.n).join(' → ')}) has a row`).toBeDefined();
      // The last definition, unless every later one can be skipped (a live body kept).
      const at = migs.findIndex((m) => m.n === r?.final);
      expect(at, `${fn}: ${r?.final} defines it`).toBeGreaterThanOrEqual(0);
      for (const later of migs.slice(at + 1)) expect(later.conditional, `${fn}: ${later.n} redefines it after ${r?.final} for sure`).toBe(true);
    }
  });

  it('178 keeps a live 175 bw_chat_scope_ok, and that body carries the bw:175-r4 marker 181 looks for (once on main)', () => {
    const f178 = migrationFile('178');
    if (f178) {
      const d = definedFns(read(`${MIGRATIONS}/${f178}`)).get('bw_chat_scope_ok');
      expect(d?.conditional).toBe(true);
    }
    const f175 = migrationFile('175');
    if (f175) expect(read(`${MIGRATIONS}/${f175}`)).toMatch(/-- bw:175-r4/);
    expect(rows.find((r) => r.fn === 'bw_chat_scope_ok')?.mark).toBe('bw:175-r4');
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

  it('the run is the CI job PGlite suites, green means strict, and is a required check (main, 11-22)', () => {
    expect(candidate).toMatch(/CI job \*\*PGlite suites\*\*/);
    expect(candidate).toMatch(/ends in `\(strict\)`/);
    expect(candidate).toMatch(/\*\*required check\*\* on `main`/);
  });

  it('the release run is integration-chain: one database, 001 → latest, then the release, both checks true (Codex, #278)', () => {
    expect(candidate).toMatch(/supabase\/tests\/integration-chain\.pglite\.mjs/);
    expect(candidate).toMatch(/from `001`/);
    expect(candidate).toMatch(/replay-bridge\.sql/);
    expect(candidate).toMatch(/BW_RELEASE_HEADS/);
    expect(candidate).toMatch(/BW_CHAIN_PICK=1/);
    expect(candidate).not.toMatch(/release_integration|base_schema/);
    expect(existsSync('supabase/tests/integration-chain.pglite.mjs')).toBe(true);
    expect(existsSync('supabase/tests/release_integration.pglite.mjs')).toBe(false);
  });

  it('no local-reset procedure: main\'s files alone don\'t rebuild prod; the replay is the chain runner (Codex MINOR)', () => {
    expect(checklist).not.toMatch(/`supabase db reset` rebuilds/);
    expect(candidate).toMatch(/Don't test the release with `supabase db reset`/);
  });
});

describe('170 + 198: one transaction, so 170 never runs without the switch (Codex round 2, #273)', () => {
  it('step 3 applies 170 and 198 together, their own BEGIN/COMMIT replaced by one', () => {
    expect(applyStep).toMatch(/3\. `170_live_pack` and `198_live_pack_flags`, in \*\*one transaction\*\*/);
    expect(applyStep).toMatch(/sed '\/\^BEGIN;\$\/d; \/\^COMMIT;\$\/d' supabase\/migrations\/170_live_pack\.sql supabase\/migrations\/198_live_pack_flags\.sql/);
    expect(applyStep).not.toMatch(/170 reads the switch itself/);
    expect(applyStep).toMatch(/198 reads the switch/);
  });

  it('the integration run applies them the same way', () => {
    const suite = read('supabase/tests/integration-chain.pglite.mjs');
    expect(suite).toMatch(/oneTransaction\(/);
  });
});

describe('send-push after 175, with 194 and 184 in (Claude review #278)', () => {
  it('the rule in full, and the proofs of the rows it depends on', () => {
    expect(applyStep).toMatch(/`send-push` goes out \*\*right after 175\*\*, and only with \*\*194 and 184 already in\*\*/);
    expect(applyStep).toMatch(/Proof: the rows of \*\*194, 184 and 175\*\* are all `true` before the deploy/);
  });
});

describe('the replay bridge names real files and real text (supabase/tests/fixtures/replay-bridge.sql)', () => {
  const bridge = read('supabase/tests/fixtures/replay-bridge.sql');
  const files = new Set(readdirSync(MIGRATIONS));
  it('every file it orders, skips, patches or prefixes is on the checkout', () => {
    const named = [
      ...(bridge.match(/^-- @order (.+)$/m)?.[1] ?? '').split(/\s+/),
      ...[...bridge.matchAll(/^-- @(?:skip|sub|before) (\S+)/gm)].map((m) => m[1]),
    ].filter(Boolean);
    expect(named.length).toBeGreaterThan(5);
    for (const f of named) expect(files.has(f), f).toBe(true);
  });
  it('each @sub replaces text that is in its file exactly once', () => {
    for (const m of bridge.matchAll(/^-- @sub (\S+) (.+?) => (.+)$/gm)) {
      expect(read(`${MIGRATIONS}/${m[1]}`).split(m[2]).length - 1, `${m[1]}: ${m[2]}`).toBe(1);
    }
  });
  it('every block says why (a comment line right after the directive)', () => {
    for (const m of bridge.matchAll(/^-- @(?:before|skip) \S+(.*)\n(.*)$/gm)) expect(m[1].trim() || m[2], m[0]).toMatch(/\S/);
    for (const m of bridge.matchAll(/^-- @before \S+\n(.*)$/gm)) expect(m[1], m[0]).toMatch(/^-- /);
  });
});

describe('release sources: the PR and branch behind each migration (main, 11-22)', () => {
  const sources = read('supabase/checks/release-sources.txt')
    .split('\n')
    .filter((l) => /^\d{3}\s/.test(l))
    .map((l) => l.trim().split(/\s+/));

  it('lists every migration of the apply order, in that order, each with its PR and branch', () => {
    expect(sources.map((x) => x[0])).toEqual(releaseOrder());
    for (const [n, pr, branch, verified] of sources) {
      expect(pr, n).toMatch(/^#\d+$/);
      expect(branch, n).toMatch(/^[\w./-]+$/);
      // The branch head the proofs were checked at: fn-redefinitions.mjs says
      // when the migration changed on its branch since (heads keep moving).
      expect(verified, n).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it('every proof of release_migrations.sql names its source', () => {
    const named = new Map([...check.matchAll(/^\s*\('(\d{3})', '(#\d+)'\)/gm)].map((m) => [m[1], m[2]]));
    for (const [n, pr] of sources) expect(named.get(n), n).toBe(pr);
  });
});


describe('constraints: stated once, kept by the order and by the SQL checks (main, 11-22)', () => {
  const constraints = section(/^### Constraints/m, /^## |^### /m);
  const pairs = [...constraints.matchAll(/^\s*- \*\*(hard)?\*?\*?\s*([\d →]+)\*\*/gm)];
  const chains = constraints
    .split('\n')
    .filter((l) => /^\s*- /.test(l))
    .map((l) => [...l.replace(/\(.*?\)/g, '').matchAll(/\b(1\d\d)\b/g)].map((m) => m[1]))
    .filter((c) => c.length >= 2);

  const HARD = ['178 → 182', '175 → 193', '175 → 181', '193 → 181', '183 → 187', '185 → 187', '175 → 192', '194 → 192', '170 → 198'];
  it('lists every order the release depends on, the hard ones marked as such', () => {
    expect(constraints).not.toBe('');
    for (const want of ['178 → 182', '175 → 193', '180 → 197', '194 → 192 → 193', '183 → 185 → 186 → 187', '175 → 178 → 193 → 181', '178 → 191'])
      expect(constraints, want).toContain(want);
    // Hard = the later migration raises without the earlier one (Claude review
    // of 8a83933e: 178 → 191 and 180 → 197 don't raise, they are soft).
    for (const hard of HARD) expect(constraints, hard).toMatch(new RegExp(`\\*\\*${hard}\\*\\*, \\*\\*hard\\*\\*`));
    for (const soft of ['180 → 197', '178 → 191']) expect(constraints, soft).not.toMatch(new RegExp(`${soft}[^\\n]*hard`));
    expect(pairs).toBeDefined();
  });

  it('the apply order keeps every constraint listed', () => {
    const order = releaseOrder();
    for (const c of chains) for (let i = 1; i < c.length; i++) expect(order.indexOf(c[i - 1]), c.join('→')).toBeLessThan(order.indexOf(c[i]));
  });

  it('the function checks state the hard constraints too', () => {
    const redef = read('supabase/checks/redefined_functions.sql');
    for (const sql of [check, redef]) {
      const hardLine = sql.match(/^-- Hard[^:]*:([\s\S]*?)(?=\n-- [A-Z]|\n[A-Z])/m)?.[1] ?? '';
      for (const c of HARD) expect(hardLine, c).toContain(c);
      for (const soft of ['180 → 197', '178 → 191']) expect(hardLine, soft).not.toContain(soft);
      // No hard pair hides in a chain on the Soft line (Claude delta review of 9c2a90bc).
      const softLine = sql.match(/^-- Soft[^:]*:([\s\S]*?)(?=\n-- [A-Z]|\n[A-Z])/m)?.[1] ?? '';
      for (const chain of softLine.split(/[,(]/)) {
        const ns = [...chain.matchAll(/\b(1\d\d)\b/g)].map((m) => m[1]);
        for (let i = 1; i < ns.length; i++) expect(HARD, `soft line has ${ns[i - 1]} → ${ns[i]}`).not.toContain(`${ns[i - 1]} → ${ns[i]}`);
      }
    }
  });

  it('the deploy waits are in the constraints: calendars before 182, auth.ts users after 175, delete-account after 180', () => {
    expect(constraints).toMatch(/`member-calendar` and `deputy-calendar` → 182/);
    expect(constraints).toMatch(/175 → `send-push`/);
    expect(constraints).toMatch(/180 → `delete-account`/);
  });
});

// ── Codex review of 72ce8148 (11-22) ────────────────────────────────────────
describe('Codex review of 72ce8148', () => {
  const doc = read('docs/release-checklist.md');
  const section = (title: string) => {
    const from = doc.indexOf(title);
    const next = doc.slice(from + title.length).search(/\n#{2,3} /);
    return from < 0 ? '' : doc.slice(from, next < 0 ? undefined : from + title.length + next);
  };

  it('B1: rolling send-push back after 175 goes to a post-175 build (bw_chat_recipient_ids), never a pre-175 one', () => {
    const fn = section('### Edge function: redeploy the previous version');
    expect(fn).toMatch(/`send-push`[\s\S]*after 175/);
    expect(fn).toMatch(/bw_chat_recipient_ids/);
    expect(fn).toMatch(/never[^\n]*before 175/i);
    // 383f15b is the release on prod today: its send-push reads chat_participants
    // directly, so a former member would get chat previews again.
    expect(fn).not.toMatch(/383f15b/);
  });

  it('B2: the local release run is strict (BW_PGLITE_STRICT=1): a missing piece fails it', () => {
    expect(section('## 1 · Candidate ready')).toMatch(/BW_PGLITE_STRICT=1 [^\n`]*integration-chain\.pglite\.mjs/);
  });

  it('B4: the release run has a combined RLS pass on its one database, which must fail right before the release', () => {
    const chain = read('supabase/tests/integration-chain.pglite.mjs');
    expect(chain).toMatch(/export const rlsPass = async/);
    expect(chain).toMatch(/const preRelease = await db\.clone\(\)/);
    expect(chain).toMatch(/await rlsPass\(preRelease\)/);
    for (const area of ['former member', 'push recipients', 'RESTRICTIVE', 'quote', 'hold']) expect(chain, area).toMatch(new RegExp(`check\\(true, '[^']*${area}`));
    expect(section('## 1 · Candidate ready')).toMatch(/combined RLS pass/);
  });

  it('B5: a marker in a comment line of the body counts (pg_get_functiondef keeps comments)', () => {
    const sql = `CREATE OR REPLACE FUNCTION public.bw_x(p text) RETURNS boolean LANGUAGE plpgsql AS $$\nBEGIN\n  -- bw:175-r4\n  RETURN true;\nEND;\n$$;`;
    expect(markerBody(sql, 'bw_x')).toContain('bw:175-r4');
    // The body comparison of identical copies still ignores comments.
    expect(squash(fnBody(sql, 'bw_x'))).not.toContain('bw:175-r4');
  });
});

describe('old builds (383f15b): what the release notes and the Academy must say', () => {
  it('names the stale Stage Bluetooth key and the quote "Update BandWith"', () => {
    const after = read('docs/release-checklist.md').split('## 6 · After')[1]?.split('### Sunset list')[0] ?? '';
    expect(after).toMatch(/383f15b[\s\S]*Stage Bluetooth key[\s\S]*until[^\n]*(updates|update)[^\n]*sign(s)? out/);
    expect(after).toMatch(/without a PDF[^\n]*"Update BandWith"/);
    expect(after).toMatch(/release notes[\s\S]*Academy/);
  });
});

describe('send-email waits for 187 (Claude review of 8a83933e)', () => {
  const doc = read('docs/release-checklist.md');
  it('is deployed right after 187, not with the 175 group, and the order is a constraint', () => {
    const after175 = doc.split('\n').find((l) => /^\s+- right after 175: deploy/.test(l)) ?? '';
    const deployed = after175.match(/deploy (.*?): every function/)?.[1] ?? '';
    expect(deployed).toMatch(/`send-push`/);
    expect(deployed).not.toMatch(/`send-email`/);
    expect(after175).toMatch(/`send-email` \(after 187\)/);
    expect(doc).toMatch(/^\s+- right after 187: deploy `send-email`[^\n]*recipient_email[^\n]*balance_version/m);
    expect(doc).toMatch(/^- 187 → `send-email`/m);
  });
});

describe('history check: versions told apart like the markers are (Claude review of 8a83933e, NIT 6)', () => {
  it('dedups on the raw body (comments kept), skips a comment-only change unless it drops a comment marker', () => {
    const chain = read('supabase/tests/integration-chain.pglite.mjs');
    const fn = chain.slice(chain.indexOf('const earlierVersions = '), chain.indexOf('};', chain.indexOf('const earlierVersions = ')));
    expect(fn).toMatch(/rawKey\(/);
    expect(fn).not.toMatch(/const k = code\(/);
    expect(fn).toMatch(/commentMarkers/);
  });
});
