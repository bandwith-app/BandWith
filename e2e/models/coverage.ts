/**
 * Coverage of the lifecycle models: for every model, its states and
 * transitions, how many the generated Playwright paths cover, the paths left
 * out as known app bugs (with their evidence) and what only a manual test
 * can check.
 *
 *   pnpm e2e:models:coverage          the report
 *   pnpm e2e:models:coverage --json   the same, as JSON
 *
 * Plain `node` (type stripping): no Playwright, no browser.
 */
import { MODELS } from './index.ts';
import { generatePaths, runnable, transitionsOf, type KnownBug, type Lifecycle, type ModelStep } from './lifecycle.ts';

export interface ModelCoverage {
  id: string;
  title: string;
  role: string;
  states: number;
  transitions: number;
  coveredStates: number;
  coveredTransitions: number;
  paths: number;
  /** Paths × variants × profiles: the Playwright runs. */
  tests: number;
  uncoveredStates: string[];
  uncoveredTransitions: string[];
  knownBugs: KnownBug[];
  tooDeep: string[];
  manual: string[];
}

const edge = (s: ModelStep) => `${s.from} --${s.event}--> ${s.to}`;

export function coverageOf(model: Lifecycle): ModelCoverage {
  const { paths, tooDeep } = generatePaths(model);
  const all = transitionsOf(model);
  const covered = new Set<string>();
  const seen = new Set<string>([model.initial as string]);
  let tests = 0;
  for (const p of paths) {
    // A Playwright test per profile it runs on (@laptop / @duo-book titles are separate tests).
    const on = p.profiles.filter((profile) => runnable(p, profile).length);
    if (!on.length) continue;
    tests += on.length;
    for (const s of p.steps) {
      covered.add(edge(s));
      seen.add(s.to);
    }
  }
  const states = Object.keys(model.states);
  return {
    id: model.id,
    title: model.title,
    role: model.role,
    states: states.length,
    transitions: all.length,
    coveredStates: states.filter((s) => seen.has(s)).length,
    coveredTransitions: all.filter((t) => covered.has(edge(t))).length,
    paths: paths.length,
    tests,
    uncoveredStates: states.filter((s) => !seen.has(s)),
    uncoveredTransitions: all.filter((t) => !covered.has(edge(t))).map(edge),
    knownBugs: model.knownBugs,
    tooDeep: tooDeep.map(edge),
    manual: model.manual ?? [],
  };
}

function print(rows: ModelCoverage[]) {
  const out: string[] = [];
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  out.push('Lifecycle model coverage (e2e/models, docs/lifecycles)\n');
  out.push(`${pad('model', 26)}${pad('role', 8)}${pad('states', 10)}${pad('transitions', 14)}${pad('paths', 7)}tests`);
  for (const r of rows) {
    out.push(
      `${pad(r.title, 26)}${pad(r.role, 8)}${pad(`${r.coveredStates}/${r.states}`, 10)}${pad(`${r.coveredTransitions}/${r.transitions}`, 14)}${pad(r.paths, 7)}${r.tests}`,
    );
  }
  const sum = (k: keyof ModelCoverage) => rows.reduce((a, r) => a + (r[k] as number), 0);
  out.push(
    `${pad('total', 26)}${pad('', 8)}${pad(`${sum('coveredStates')}/${sum('states')}`, 10)}${pad(`${sum('coveredTransitions')}/${sum('transitions')}`, 14)}${pad(sum('paths'), 7)}${sum('tests')}`,
  );

  for (const r of rows) {
    out.push(`\n## ${r.title} (${r.id})`);
    out.push(`states ${r.coveredStates}/${r.states} covered, transitions ${r.coveredTransitions}/${r.transitions} covered, ${r.paths} paths, ${r.tests} Playwright tests`);
    if (r.uncoveredStates.length) out.push(`  not covered (states): ${r.uncoveredStates.join(', ')}`);
    for (const t of r.uncoveredTransitions) out.push(`  not covered: ${t}`);
    for (const t of r.tooDeep) out.push(`  too deep (maxDepth): ${t}`);
    for (const b of r.knownBugs) {
      out.push(`  KNOWN BUG (not run${b.onlyOn ? ` on ${b.onlyOn.join(', ')}` : ''}): ${b.path}${b.variant ? ` [${b.variant}]` : ''}`);
      out.push(`    role ${b.role}, profile ${b.profile}${b.onlyOn ? ` (left out only on ${b.onlyOn.join(', ')})` : ''}`);
      out.push(`    actual:   ${b.actual}`);
      out.push(`    expected: ${b.expected}`);
      out.push(`    evidence: ${b.evidence}`);
    }
    for (const m of r.manual) out.push(`  manual: ${m}`);
  }
  console.log(out.join('\n'));
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const rows = MODELS.map(coverageOf);
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
  else print(rows);
}
