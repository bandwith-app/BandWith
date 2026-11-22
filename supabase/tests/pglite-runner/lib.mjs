// The rules of the PGlite runner (run.mjs), kept apart so
// scripts/pglite-runner.test.ts can check them without PGlite.

/** Arguments of a suite, from the first plain usage line in its comments. */
export function usageArgs(src, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = src
    .split('\n')
    .filter((l) => /^\s*\/\//.test(l))
    .map((l) => l.replace(/^\s*\/\/\s?/, '').replace(/\s+#.*$/, ''))
    .map((l) => l.match(new RegExp(`(?:^|&&\\s*|\\s)node\\s+${esc}((?:\\s+\\S.*)?)$`)))
    .find((m) => m && !/\/dev\/null/.test(m[1].replace(/\[[^\]]*\]/g, '')) && !new RegExp(`[A-Z_]+=\\S+\\s+node\\s+${esc}`).test(m.input));
  if (!line) throw new Error(`${name}: no usage line ("node ${name} <repo> …") in its comments`);
  const tokens = [...line[1].matchAll(/<[^>]*>\S*|\[[^\]]*\]|\S+/g)].map((m) => m[0]);
  return tokens
    .filter((t) => !t.startsWith('['))
    .map((t) => {
      if (t === '<repo>') return { kind: 'repo' };
      let m = t.match(/^<repo>\/(\S+)$/);
      if (m) return { kind: 'path', path: m[1] };
      m = t.match(/^<(\d{3})(?:[ -]file)?>$/);
      if (m) return { kind: 'migration', n: m[1] };
      throw new Error(`${name}: unknown placeholder ${t} in its usage line`);
    });
}

/** Migrations a suite reads from another ref (git show <ref>:supabase/migrations/NNN_…). */
export function branchReads(src) {
  const code = src
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  return [...new Set([...code.matchAll(/[\w./${}-]+:supabase\/migrations\/(\d{3})_/g)].map((m) => m[1]))];
}

/**
 * pass | warn | fail for one suite's run.
 * pending: release migrations it reads that the checkout doesn't have yet
 * (found by the runner, or named by the suite in a PENDING line).
 */
export function verdict({ code, out }, { pending, strict }) {
  // A suite that reads release migrations itself names them: "PENDING 175 184".
  const named = [...out.matchAll(/^PENDING ((?:\d{3}\s*)+)$/gm)].flatMap((m) => m[1].trim().split(/\s+/));
  // Read at an exact commit (frozen heads: BW_RELEASE_HEADS=<pr>=<sha> or
  // BW_RELEASE_AT=verified): "PINNED 175 184". It only takes back what the
  // suite itself named PENDING; a read the runner found stays pending.
  const pinned = new Set([...out.matchAll(/^PINNED ((?:\d{3}\s*)+)$/gm)].flatMap((m) => m[1].trim().split(/\s+/)));
  pending = [...new Set([...pending, ...named.filter((n) => !pinned.has(n))])];
  // A head whose file differs from the SHA its proofs were checked at.
  // Or whose verified SHA is gone (force-push): its proofs were not compared.
  const drifted = [...out.matchAll(/^WARN (\d{3}): (?:.* differs from |its verified SHA \S+ is not reachable)/gm)].map((m) => m[1]);
  const failed = code !== 0 || /^\s*(FAIL|ERROR)\b/m.test(out);
  const skipped = /^\s*SKIP\b/m.test(out);
  if (failed) {
    if (pending.length && !strict) return { status: 'warn', why: `failed while ${pending.join(', ')} is not merged (read from its branch)` };
    return { status: 'fail', why: code !== 0 ? `exit ${code}` : 'FAIL/ERROR line' };
  }
  if (drifted.length && strict) return { status: 'fail', why: `${drifted.join(', ')} differs from its verified SHA, or that SHA is gone, in a strict run (refresh column 4 of release-sources.txt)` };
  if (skipped) return strict ? { status: 'fail', why: 'SKIP in a strict run' } : { status: 'warn', why: 'SKIP lines' };
  if (pending.length && strict) return { status: 'fail', why: `reads ${pending.join(', ')} from a branch in a strict run` };
  return { status: 'pass', why: '' };
}

/** Strict once every release migration is on the checkout; BW_PGLITE_STRICT=1/0 overrides. */
export function isStrict(releaseNumbers, onCheckout, env) {
  if (env.BW_PGLITE_STRICT === '1') return true;
  if (env.BW_PGLITE_STRICT === '0') return false;
  const have = new Set(onCheckout);
  return releaseNumbers.every((n) => have.has(n));
}
