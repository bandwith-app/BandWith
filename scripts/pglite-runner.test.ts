/**
 * supabase/tests/pglite-runner: how CI runs every supabase/tests/*.pglite.mjs
 * suite (main, 11-22). Arguments come from the suite's own usage line; a
 * suite that reads a release migration not merged yet (git show, or an
 * argument file not on the checkout) is "pending": its failure is a warning
 * until that branch is merged. Once every migration of
 * supabase/checks/release-sources.txt is on the checkout the run is strict:
 * pending, SKIP and failure all fail it.
 */
import { describe, expect, it } from 'vitest';
import { usageArgs, branchReads, verdict, isStrict } from '../supabase/tests/pglite-runner/lib.mjs';

describe('usage line → arguments', () => {
  it('takes the first plain usage line: not /dev/null, not one with env variables, drops [optional] and # comments', () => {
    const src = [
      '// Run:',
      '//   BW_LOCAL_REF=0437db39 node x.pglite.mjs <repo>   # before: FAILs',
      '//   node x.pglite.mjs <repo> /dev/null    # before: FAILs expected',
      '//   cd <dir with @electric-sql/pglite@0.5.15> && node x.pglite.mjs <repo> [193-file]   # after',
    ].join('\n');
    expect(usageArgs(src, 'x.pglite.mjs')).toEqual([{ kind: 'repo' }]);
  });

  it('an optional [/dev/null] does not rule a line out (chat_notifications_server_only)', () => {
    expect(usageArgs('//   cd <dir with @electric-sql/pglite@0.5.15> && node d.pglite.mjs <repo> [/dev/null]', 'd.pglite.mjs')).toEqual([{ kind: 'repo' }]);
  });

  it('reads <repo>/path, <NNN file> and <repo> placeholders', () => {
    expect(usageArgs('//   cp <repo>/supabase/tests/a.pglite.mjs . && node a.pglite.mjs <repo>/supabase/migrations/170_live_pack.sql', 'a.pglite.mjs')).toEqual([
      { kind: 'path', path: 'supabase/migrations/170_live_pack.sql' },
    ]);
    expect(usageArgs('//   node b.pglite.mjs <repo> <178 file>', 'b.pglite.mjs')).toEqual([{ kind: 'repo' }, { kind: 'migration', n: '178' }]);
  });

  it('refuses a placeholder it does not know, and a suite with no usage line', () => {
    expect(() => usageArgs('//   node c.pglite.mjs <dir>', 'c.pglite.mjs')).toThrow(/placeholder/);
    expect(() => usageArgs('// nothing here', 'c.pglite.mjs')).toThrow(/usage line/);
  });
});

describe('cross-branch reads', () => {
  it('finds git show reads of migrations by branch or commit, ignoring the suite name and comments', () => {
    const src = [
      "// reads 180 from its branch head (git show origin/fix/old:supabase/migrations/100_x.sql)",
      "const a = execSync('git show origin/fix/account-deletion:supabase/migrations/180_account_deletion_safety.sql');",
      "const b = sh(`git show ${ref}:supabase/migrations/175_security_audit_access.sql`);",
      "const c = sh('git show 0437db39:supabase/migrations/176_quote_pdf_gate.sql');",
    ].join('\n');
    expect(branchReads(src).sort()).toEqual(['175', '176', '180']);
  });
});

describe('verdict', () => {
  const run = (out: string, code = 0) => ({ code, out });
  it('fails on a non-zero exit or a FAIL / ERROR line, passes otherwise', () => {
    expect(verdict(run('ok  a\nok  b'), { pending: [], strict: false }).status).toBe('pass');
    expect(verdict(run('ok  a\nFAIL b'), { pending: [], strict: false }).status).toBe('fail');
    expect(verdict(run('ERROR boom', 2), { pending: [], strict: false }).status).toBe('fail');
    expect(verdict(run('', 1), { pending: [], strict: false }).status).toBe('fail');
  });

  it('a failure while a release migration it reads is not merged is a warning, not a failure, until strict', () => {
    expect(verdict(run('FAIL guard: 175 not reachable', 1), { pending: ['175'], strict: false }).status).toBe('warn');
    expect(verdict(run('FAIL guard', 1), { pending: ['175'], strict: true }).status).toBe('fail');
  });

  it('a suite can name the release migrations it read from a branch: PENDING lines count as pending', () => {
    expect(verdict(run('PENDING 175 184\nFAIL 175 row false', 1), { pending: [], strict: false }).status).toBe('warn');
    expect(verdict(run('PENDING 175\nok  all', 0), { pending: [], strict: true }).status).toBe('fail');
    expect(verdict(run('PENDING 175\nok  all', 0), { pending: [], strict: false }).status).toBe('pass');
  });

  it('SKIP lines warn; in strict mode they fail', () => {
    expect(verdict(run('SKIP (pending #294) every 182 check'), { pending: [], strict: false }).status).toBe('warn');
    expect(verdict(run('  SKIP 180 guard'), { pending: [], strict: true }).status).toBe('fail');
    expect(verdict(run('ok  no SKIP here, just the word'), { pending: [], strict: true }).status).toBe('pass');
  });
});

describe('strict once everything is on main', () => {
  it('is strict when every release migration has its file, unless the environment says otherwise', () => {
    const sources = ['173', '170', '175'];
    expect(isStrict(sources, ['170', '173', '175'], {})).toBe(true);
    expect(isStrict(sources, ['170', '173'], {})).toBe(false);
    expect(isStrict(sources, ['170', '173'], { BW_PGLITE_STRICT: '1' })).toBe(true);
    expect(isStrict(sources, ['170', '173', '175'], { BW_PGLITE_STRICT: '0' })).toBe(false);
  });
});

describe('CI runs it on main and on PRs', () => {
  const fs = (globalThis as unknown as { process: { cwd(): string } }).process;
  it('has a pglite job that checks out every branch and runs the runner', async () => {
    const { readFileSync } = (await import(/* @vite-ignore */ 'node:fs')) as { readFileSync: (p: string, e: 'utf8') => string };
    const ci = readFileSync(`${fs.cwd()}/.github/workflows/ci.yml`, 'utf8');
    const job = ci.slice(ci.indexOf('\n  pglite:'));
    expect(job.length).toBeGreaterThan(20);
    expect(job).toMatch(/fetch-depth: 0/);
    expect(job).toMatch(/npm ci --prefix supabase\/tests\/pglite-runner/);
    expect(job).toMatch(/node supabase\/tests\/pglite-runner\/run\.mjs/);
    expect(ci).toMatch(/pull_request:/);
    expect(ci).toMatch(/push:\s*\n\s*branches: \[main\]/);
    const pkg = JSON.parse(readFileSync(`${fs.cwd()}/supabase/tests/pglite-runner/package.json`, 'utf8'));
    expect(pkg.dependencies['@electric-sql/pglite']).toBe('0.5.15');
  });
});

// Claude review of 8a83933e (11-22): strict mode with frozen heads.
describe('strict mode accepts reads pinned to an exact commit (PINNED)', () => {
  const out = (s: string, code = 0) => ({ code, out: s });
  it('PINNED numbers are not pending: a strict run with frozen heads can pass', () => {
    expect(verdict(out('PINNED 175 184\nok  a\nALL OK'), { pending: [], strict: true }).status).toBe('pass');
    // PINNED only takes back what the suite itself named PENDING: a read the
    // runner found on a moving tip stays pending (Claude delta review of 9c2a90bc).
    expect(verdict(out('PINNED 175\nok  a\nALL OK'), { pending: ['175'], strict: true }).status).toBe('fail');
    // A branch head (moving) still fails a strict run.
    expect(verdict(out('PENDING 175\nPINNED 184\nok  a'), { pending: [], strict: true })).toMatchObject({ status: 'fail', why: expect.stringContaining('175') });
    // A failure is a failure, pinned or not.
    expect(verdict(out('PINNED 175\nFAIL a', 1), { pending: [], strict: true }).status).toBe('fail');
  });
  it('strict: a head that differs from its verified SHA fails (refresh column 4 at freeze)', () => {
    const warn = 'PINNED 175\nWARN 175: 1a2b3c4d differs from 5e6f7a8b, where its proofs were checked\nok  a\nALL OK';
    expect(verdict(out(warn), { pending: [], strict: true })).toMatchObject({ status: 'fail', why: expect.stringContaining('175') });
    expect(verdict(out(warn), { pending: [], strict: false }).status).toBe('pass');
    // A verified SHA that is gone (force-push): the proofs were not compared, so strict fails too.
    const gone = 'PINNED 175\nWARN 175: its verified SHA 5e6f7a8b is not reachable here; its proofs were checked on a file not compared\nALL OK';
    expect(verdict(out(gone), { pending: [], strict: true })).toMatchObject({ status: 'fail', why: expect.stringContaining('175') });
    expect(verdict(out(gone), { pending: [], strict: false }).status).toBe('pass');
  });
  it('the release run prints PINNED for an exact SHA (BW_RELEASE_HEADS or BW_RELEASE_AT=verified), PENDING for a branch', async () => {
    const proc = (globalThis as unknown as { process: { cwd(): string } }).process;
    const { readFileSync } = (await import(/* @vite-ignore */ 'node:fs')) as { readFileSync: (p: string, e: 'utf8') => string };
    const chain = readFileSync(`${proc.cwd()}/supabase/tests/integration-chain.pglite.mjs`, 'utf8');
    expect(chain).toMatch(/console\.log\(`PINNED \$\{pinned\.join\(' '\)\}`\)/);
    expect(chain).toMatch(/const isPin = /);
  });
});
