import fs from 'node:fs';
import path from 'node:path';
import { attachFindings } from './derive';
import { AREA_TITLES, ROLE_INFO, type Area, type CrawlRole, type Finding, type RunResult, type Severity, type StateRec } from './types';

/**
 * Merges every run (out/runs/<role>__<profile>.json) into:
 *
 * - out/map.json          states, actions (edges), back behaviour, health, axe, findings
 * - out/findings.md       sorted by severity, real bugs first, with repro steps
 * - out/mermaid/<profile>/<area>.<role>.mmd
 * - docs/screen-map/      the phone-portrait diagrams + README index (CRAWL_DOCS=1)
 *
 * Triage verdicts (real bug / crawler false positive) live in
 * e2e/crawl/triage.json, keyed by "<kind>|<role>|<title>", so they survive
 * the next crawl.
 */

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

interface Triage {
  verdict: 'real' | 'false-positive';
  note: string;
  test?: string;
}

/** Only privacy findings depend on the role; the rest are grouped across roles too. */
const triageKey = (f: Pick<Finding, 'kind' | 'role' | 'title'>) => `${f.kind}|${f.kind === 'privacy' ? f.role : '*'}|${f.title}`;

export function readRuns(outDir: string): RunResult[] {
  const dir = path.join(outDir, 'runs');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as RunResult)
    .sort((a, b) => `${a.role}${a.profile}`.localeCompare(`${b.role}${b.profile}`));
}

// ------------------------------------------------------------------ coverage

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!/^(__tests__|test|node_modules)$/.test(e.name)) walk(p, out);
    } else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
};

export interface Coverage {
  lazy: { module: string; chunk: string; loaded: boolean }[];
  screens: { file: string; reached: boolean | null; evidence: string | null }[];
}

/**
 * Best effort "exists in code but never reached":
 * - lazy screens (React.lazy / lazyLayer in src): was their chunk ever loaded?
 * - screen components (…Modal/Sheet/View/Wizard/Screen/Page/Dialog/Popup.tsx):
 *   did any text that only that file shows (its t('…') strings) ever appear
 *   on a crawled screen?
 */
export function coverage(srcDir: string, runs: RunResult[]): Coverage {
  const files = walk(srcDir);
  const chunks = new Set(runs.flatMap((r) => r.chunks));
  const lazy: Coverage['lazy'] = [];
  const LAZY = /(?:lazy|lazyLayer)\(\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']/g;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(LAZY)) {
      const mod = m[1];
      const chunk = path.basename(mod).replace(/\.(tsx?|jsx?)$/, '');
      if (lazy.some((l) => l.module === mod)) continue;
      lazy.push({ module: mod, chunk, loaded: chunks.has(chunk) });
    }
  }
  const T = /\bt\(\s*(['"])((?:\\.|(?!\1).){6,140})\1/g;
  const stringsOf = new Map<string, Set<string>>();
  const owners = new Map<string, Set<string>>();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const set = new Set<string>();
    for (const m of src.matchAll(T)) set.add(m[2].replace(/\\(.)/g, '$1'));
    stringsOf.set(f, set);
    for (const s of set) {
      if (!owners.has(s)) owners.set(s, new Set());
      owners.get(s)!.add(f);
    }
  }
  const text = runs
    .flatMap((r) => Object.values(r.texts))
    .join('\n')
    .toLowerCase();
  const SCREEN = /(Modal|Sheet|View|Wizard|Screen|Page|Dialog|Popup|Home|Composer|Builder|Editor)\.tsx$/;
  const screens: Coverage['screens'] = [];
  for (const f of files.filter((x) => SCREEN.test(x) && /src\/app\//.test(x))) {
    const unique = [...(stringsOf.get(f) ?? [])].filter((s) => owners.get(s)!.size === 1);
    // The longest literal part of each string ({vars} vary).
    const probes = unique
      .map((s) => s.split(/\{\w+\}/).sort((a, b) => b.length - a.length)[0].trim())
      .filter((s) => s.length >= 8);
    const hit = probes.find((p) => text.includes(p.toLowerCase())) ?? null;
    screens.push({ file: path.relative(path.dirname(srcDir), f), reached: probes.length ? !!hit : null, evidence: hit });
  }
  return { lazy, screens };
}

// ------------------------------------------------------------------ mermaid

const esc = (s: string) =>
  s
    .replace(/"/g, '#quot;')
    .replace(/[[\]{}()<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const short = (s: string, n = 28) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function mermaid(states: StateRec[], area: Area, all: Map<string, StateRec>): string | null {
  const inArea = states.filter((s) => s.area === area);
  if (!inArea.length) return null;
  const ids = new Map<string, string>();
  const node = (id: string) => {
    if (!ids.has(id)) ids.set(id, `s${ids.size}`);
    return ids.get(id)!;
  };
  const lines: string[] = ['flowchart LR'];
  for (const st of inArea) {
    const layer = st.layers.length ? st.layers.map((l) => short(l.name, 18)).join(' › ') : (st.tab ?? st.title);
    const label = `${esc(short(st.title))}${st.depth === 0 ? ' ⌂' : ''}<br/><small>${esc(short(layer, 40))}</small>`;
    lines.push(`  ${node(st.id)}["${label}"]`);
  }
  const stubs = new Map<string, string>();
  const edges = new Map<string, string[]>();
  for (const st of inArea) {
    for (const a of st.actions) {
      if (a.kind !== 'navigate' || !a.to || a.to === st.id) continue;
      const dest = all.get(a.to);
      let to: string;
      if (dest && dest.area === area) to = node(dest.id);
      else {
        const other = dest ? AREA_TITLES[dest.area] : 'elsewhere';
        if (!stubs.has(other)) stubs.set(other, `x${stubs.size}`);
        to = stubs.get(other)!;
      }
      const k = `${node(st.id)}-->${to}`;
      edges.set(k, [...(edges.get(k) ?? []), a.label]);
    }
    for (const [mode, b] of [
      ['Back', st.back.system],
      ['Esc', st.back.escape],
    ] as const) {
      if (!b || b.kind !== 'navigate' || !b.to) continue;
      const dest = all.get(b.to);
      if (!dest || dest.area !== area) continue;
      const k = `${node(st.id)}-.->${node(dest.id)}`;
      edges.set(k, [...(edges.get(k) ?? []), mode]);
    }
  }
  for (const [title, id] of stubs) lines.push(`  ${id}(["→ ${esc(title)}"])`);
  for (const [k, labels] of edges) {
    const uniq = [...new Set(labels)];
    const text = esc(short(uniq.slice(0, 2).map((l) => short(l, 22)).join(' / ') + (uniq.length > 2 ? ` +${uniq.length - 2}` : ''), 48));
    const [from, arrow, to] = k.split(/(-->|-\.->)/);
    lines.push(`  ${from} ${arrow}|"${text}"| ${to}`);
  }
  const withFindings = inArea.filter((s) => s.findings.length).map((s) => node(s.id));
  const roots = inArea.filter((s) => s.depth === 0).map((s) => node(s.id));
  lines.push('  classDef root stroke-width:3px');
  lines.push('  classDef flagged stroke:#d33,stroke-width:2px');
  lines.push('  classDef stub fill:none,stroke-dasharray: 3 3');
  if (roots.length) lines.push(`  class ${roots.join(',')} root`);
  if (withFindings.length) lines.push(`  class ${withFindings.join(',')} flagged`);
  if (stubs.size) lines.push(`  class ${[...stubs.values()].join(',')} stub`);
  return lines.join('\n') + '\n';
}

// ------------------------------------------------------------------ findings

interface Grouped {
  key: string;
  first: Finding;
  profiles: string[];
  roles: string[];
  states: string[];
  verdict: 'real' | 'false-positive' | 'unverified';
  note: string;
  test: string;
}

function suggestTest(f: Finding, all: Map<string, StateRec>): string {
  const st = f.state ? all.get(f.state) : null;
  const where = st?.title ?? 'the screen';
  switch (f.kind) {
    case 'dead-control':
      return `test('"${f.control}" on ${where} does something', …): reach it (${f.steps.slice(0, -1).join(' → ')}), click it, expect a new layer, a content change or a toast.`;
    case 'back-mismatch':
      return `test('system Back on ${where} goes where "${f.control}" goes', …): systemBack(app) and the visible control must land on the same screen.`;
    case 'no-exit':
      return `test('${where} closes with Back and with Escape', …) in layers-back.spec.ts.`;
    case 'privacy':
      return `test('@smoke member never sees ${f.detail.split(':')[0]} on ${where}', …): expectNever(app, [...]) as in member-readonly.spec.ts.`;
    case 'broken-state':
    case 'empty-state':
    case 'layout':
      return `test('${where} renders cleanly', …): reach it and app.check('${where}').`;
    case 'js-error':
      return `test('${f.steps.join(' → ')} throws no JS error', …): app.check() fails on uncaught errors.`;
    case 'axe':
      return `test('${where} has no ${f.control} violation', …) with @axe-core/playwright, scoped to the top layer.`;
    default:
      return '';
  }
}

export function groupFindings(runs: RunResult[], all: Map<string, StateRec>, triage: Record<string, Triage>): Grouped[] {
  const groups = new Map<string, Grouped>();
  for (const r of runs)
    for (const f of r.findings) {
      const key = triageKey(f);
      const g = groups.get(key);
      if (g) {
        if (!g.profiles.includes(f.profile)) g.profiles.push(f.profile);
        if (!g.roles.includes(f.role)) g.roles.push(f.role);
        if (f.state && !g.states.includes(f.state)) g.states.push(f.state);
        continue;
      }
      const t = triage[key];
      groups.set(key, {
        key,
        first: f,
        profiles: [f.profile],
        roles: [f.role],
        states: f.state ? [f.state] : [],
        // A replay finding is about the crawler, not the app.
        verdict: t?.verdict ?? (f.kind === 'replay' ? 'false-positive' : 'unverified'),
        note: t?.note ?? (f.kind === 'replay' ? 'crawler diagnostic: the state depends on timing (it could not be reached again by replaying the clicks)' : ''),
        test: t?.test ?? suggestTest(f, all),
      });
    }
  const vOrder = { real: 0, unverified: 1, 'false-positive': 2 } as const;
  return [...groups.values()].sort(
    (a, b) =>
      SEVERITIES.indexOf(a.first.severity) - SEVERITIES.indexOf(b.first.severity) ||
      vOrder[a.verdict] - vOrder[b.verdict] ||
      a.first.kind.localeCompare(b.first.kind) ||
      a.first.title.localeCompare(b.first.title),
  );
}

function findingsMd(groups: Grouped[], runs: RunResult[], cov: Coverage, all: Map<string, StateRec>): string {
  const out: string[] = ['# Screen-map findings', ''];
  const count = (v: string) => groups.filter((g) => g.verdict === v).length;
  out.push(
    `Generated ${new Date().toISOString()} from ${runs.length} crawl run(s). ${groups.length} distinct findings: ` +
      `${count('real')} real, ${count('false-positive')} crawler false positives, ${count('unverified')} not triaged yet.`,
    '',
    'A finding is grouped across device profiles (and roles, except privacy). Verdicts come from `e2e/crawl/triage.json` (checked against the screenshots).',
    '',
    '| Severity | Real | Unverified | False positive |',
    '| --- | --- | --- | --- |',
    ...SEVERITIES.map((s) => {
      const g = groups.filter((x) => x.first.severity === s);
      return `| ${s} | ${g.filter((x) => x.verdict === 'real').length} | ${g.filter((x) => x.verdict === 'unverified').length} | ${g.filter((x) => x.verdict === 'false-positive').length} |`;
    }),
    '',
  );
  for (const sev of SEVERITIES) {
    const list = groups.filter((g) => g.first.severity === sev && g.verdict !== 'false-positive');
    if (!list.length) continue;
    out.push(`## ${sev[0].toUpperCase()}${sev.slice(1)}`, '');
    for (const g of list) {
      const f = g.first;
      out.push(`### ${g.verdict === 'real' ? '🐞 ' : ''}${f.title}`, '');
      out.push(`- **Kind:** ${f.kind} · **Verdict:** ${g.verdict}${g.note ? ` (${g.note})` : ''}`);
      out.push(`- **Role:** ${g.roles.join(', ')} · **Profiles:** ${g.profiles.join(', ')}`);
      out.push(`- **What:** ${f.detail}`);
      const titles = [...new Set(g.states.map((id) => all.get(id)?.title ?? id))];
      if (titles.length > 1) out.push(`- **Screens (${titles.length}):** ${titles.slice(0, 8).map((t) => `"${t}"`).join(', ')}${titles.length > 8 ? ', …' : ''}`);
      if (f.screenshot) out.push(`- **Screenshot:** \`${f.screenshot}\``);
      if (f.steps.length) out.push('- **Steps:**', ...f.steps.map((s, i) => `  ${i + 1}. ${s}`));
      if (g.test) out.push(`- **Suggested failing test:** ${g.test}`);
      out.push('');
    }
  }
  const fps = groups.filter((g) => g.verdict === 'false-positive');
  if (fps.length) {
    out.push('## Crawler false positives', '', 'Flagged by the crawler, checked against the screenshot, not a bug:', '');
    for (const g of fps) out.push(`- **${g.first.title}** (${g.first.kind}, ${g.roles.join(', ')}, ${g.profiles.join(', ')}): ${g.note}`);
    out.push('');
  }
  const notLoaded = cov.lazy.filter((l) => !l.loaded);
  const notReached = cov.screens.filter((s) => s.reached === false);
  out.push('## Not reached (best effort)', '');
  out.push(`Lazy screens whose code was never loaded: ${notLoaded.length ? notLoaded.map((l) => `\`${l.chunk}\``).join(', ') : 'none'}.`, '');
  out.push(
    `Screen components none of whose own texts appeared on a crawled screen (${notReached.length} of ${cov.screens.length}; ` +
      'many are reached only past the depth/time budget or by actions the crawler never performs):',
    '',
    ...notReached.map((s) => `- \`${s.file}\``),
    '',
  );
  return out.join('\n');
}

// ------------------------------------------------------------------ main

export function writeReport(outDir: string, opts: { docsDir?: string; srcDir: string; triageFile: string }) {
  const runs = readRuns(outDir);
  if (!runs.length) return null;
  for (const r of runs) attachFindings(r);
  const triage: Record<string, Triage> = fs.existsSync(opts.triageFile) ? JSON.parse(fs.readFileSync(opts.triageFile, 'utf8')) : {};
  const all = new Map<string, StateRec>();
  for (const r of runs) for (const s of r.states) all.set(s.id, s);
  const cov = coverage(opts.srcDir, runs);
  const groups = groupFindings(runs, all, triage);
  const verdictOf = new Map(groups.map((g) => [g.key, g]));

  // Unreachable lazy screens are findings of their own (role "*").
  const unreachable: Finding[] = cov.lazy
    .filter((l) => !l.loaded)
    .map((l) => ({
      id: `unreachable.${l.chunk}`,
      kind: 'unreachable',
      severity: 'low',
      role: '*',
      profile: '*',
      state: null,
      title: `Lazy screen ${l.chunk} never opened`,
      detail: `${l.module} is code-split (lazy) but no crawl loaded it.`,
      steps: [],
      screenshot: null,
    }));

  const map = {
    generatedAt: new Date().toISOString(),
    about:
      'BandWith screen map, generated by the crawler in e2e/crawl from the demo build. A state is a screen as the user sees it: ' +
      'page path + active tab (or screen heading) + the stack of open layers (kind:name) + the selected tab inside the top layer. ' +
      'Digits are normalised in the signature. Each action is one control that was on top: kind navigate (to = state id), ' +
      'inplace (content changed, same state), toast, db (only the demo database changed), scroll, dead (nothing happened), ' +
      'terminal (destructive/outward: never clicked, "to" says why), field (text input, not clicked), sampled (one of many identical rows), ' +
      'skipped (cap/budget), leaves (loaded another page), error (click failed). back.escape / back.system (browser Back = Android Back) ' +
      'say where Escape and system Back go; back.visible is the Back/Close control. health = page-health check of e2e/support/health.ts; ' +
      'axe = axe-core violations by impact (wcag2a/aa) scoped to the top layer. screenshot paths are relative to this file.',
    roles: ROLE_INFO,
    areas: AREA_TITLES,
    runs: runs.map((r) => ({
      role: r.role,
      profile: r.profile,
      states: r.states.length,
      explored: r.states.filter((s) => s.explored).length,
      actions: r.states.reduce((n, s) => n + s.actions.length, 0),
      edges: r.states.reduce((n, s) => n + s.actions.filter((a) => a.kind === 'navigate').length, 0),
      clicks: r.clicks,
      reloads: r.resets,
      elapsedSeconds: Math.round(r.elapsedMs / 1000),
      complete: r.complete,
      budgetMinutes: Math.round(r.budgetMs / 60000),
      maxDepth: r.maxDepth,
    })),
    states: [...all.values()].map((s) => ({
      id: s.id,
      role: s.role,
      profile: s.profile,
      area: s.area,
      root: s.root,
      depth: s.depth,
      title: s.title,
      text: s.text,
      tab: s.tab,
      layers: s.layers,
      url: s.url,
      sig: s.sig,
      screenshot: s.screenshot,
      steps: s.steps,
      actions: s.actions.map((a) => ({ label: a.label, kind: a.kind, to: a.to, role: a.role, ...(a.toast ? { toast: a.toast } : {}), ...(a.note ? { note: a.note } : {}), ...(a.effects?.length ? { effects: a.effects } : {}), ...(a.inferred ? { inferred: true } : {}) })),
      back: s.back,
      health: s.health,
      axe: s.axe,
      findings: s.findings,
      explored: s.explored,
    })),
    findings: [
      ...runs.flatMap((r) =>
        r.findings.map((f) => {
          const g = verdictOf.get(triageKey(f));
          return { ...f, verdict: g?.verdict ?? 'unverified', verdictNote: g?.note ?? '', suggestedTest: g?.test ?? '' };
        }),
      ),
      ...unreachable.map((f) => ({ ...f, verdict: 'unverified', verdictNote: '', suggestedTest: '' })),
    ],
    coverage: cov,
  };
  fs.writeFileSync(path.join(outDir, 'map.json'), JSON.stringify(map, null, 1));
  fs.writeFileSync(path.join(outDir, 'findings.md'), findingsMd(groups, runs, cov, all));

  // Mermaid per profile / area / role.
  const written: { profile: string; area: Area; role: CrawlRole; file: string; states: number }[] = [];
  for (const r of runs) {
    for (const area of Object.keys(AREA_TITLES) as Area[]) {
      const mmd = mermaid(r.states, area, all);
      if (!mmd) continue;
      const dir = path.join(outDir, 'mermaid', r.profile);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${area}.${r.role}.mmd`);
      fs.writeFileSync(file, mmd);
      written.push({ profile: r.profile, area, role: r.role, file, states: r.states.filter((s) => s.area === area).length });
    }
  }
  if (opts.docsDir) {
    writeDocs(opts.docsDir, written, runs, groups);
    writeSample(outDir, map);
  }
  return { runs, states: all.size, groups };
}

/** out/sample/map.sample.json: a small committed excerpt (Home and its first layers, admin and member, phone). */
function writeSample(outDir: string, map: { states: { id: string; role: string; profile: string; depth: number; root: string; findings: string[] }[]; findings: { id: string }[] } & Record<string, unknown>) {
  const pick = map.states.filter((s) => s.profile === 'phone-portrait' && (s.role === 'admin' || s.role === 'member') && s.depth <= 1 && s.root === 'home').slice(0, 24);
  const ids = new Set(pick.flatMap((s) => s.findings));
  const sample = { ...map, states: pick, findings: map.findings.filter((f) => ids.has(f.id)), coverage: undefined, note: 'Excerpt; the full map is the crawl artifact.' };
  fs.mkdirSync(path.join(outDir, 'sample'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'sample', 'map.sample.json'), JSON.stringify(sample, null, 1));
}

function writeDocs(
  docsDir: string,
  written: { profile: string; area: Area; role: CrawlRole; file: string; states: number }[],
  runs: RunResult[],
  groups: Grouped[],
) {
  const PROFILE = 'phone-portrait';
  fs.rmSync(docsDir, { recursive: true, force: true });
  fs.mkdirSync(docsDir, { recursive: true });
  const index: string[] = [
    '# Screen map',
    '',
    'Generated from the running demo app by the crawler in [`e2e/crawl`](../../e2e/crawl/README.md) (`pnpm e2e:crawl`, nightly in CI).',
    'Do not edit by hand: re-run the crawl with `CRAWL_DOCS=1`.',
    '',
    `Diagrams: **${PROFILE}**. Nodes are screens (⌂ = where the crawl starts; red = has findings), solid arrows are taps (labelled with the control),`,
    'dotted arrows are system Back / Escape, rounded nodes lead to another area. The full map for every profile (states, texts, screenshots,',
    'findings) is `map.json` in the crawl artifact.',
    '',
    `Run: ${runs
      .filter((r) => r.profile === PROFILE)
      .map((r) => `${r.role} ${r.states.length} states`)
      .join(', ')}. Open findings: ${groups.filter((g) => g.verdict === 'real').length} confirmed by triage, ${groups.filter((g) => g.verdict === 'unverified').length} not triaged (\`findings.md\` in the crawl artifact).`,
    '',
    '| Area | Roles |',
    '| --- | --- |',
  ];
  for (const area of Object.keys(AREA_TITLES) as Area[]) {
    const mine = written.filter((w) => w.profile === PROFILE && w.area === area);
    if (!mine.length) continue;
    const md: string[] = [`# ${AREA_TITLES[area]}`, '', `[← Screen map](README.md) · profile ${PROFILE}`, ''];
    for (const w of mine) {
      const name = `${area}.${w.role}.mmd`;
      fs.copyFileSync(w.file, path.join(docsDir, name));
      md.push(`## ${w.role} (${w.states} screens)`, '', `_${ROLE_INFO[w.role]}_ · source: [${name}](${name})`, '', '```mermaid', fs.readFileSync(w.file, 'utf8').trim(), '```', '');
    }
    fs.writeFileSync(path.join(docsDir, `${area}.md`), md.join('\n'));
    index.push(`| [${AREA_TITLES[area]}](${area}.md) | ${mine.map((w) => `${w.role} (${w.states})`).join(', ')} |`);
  }
  index.push('');
  fs.writeFileSync(path.join(docsDir, 'README.md'), index.join('\n'));
}
