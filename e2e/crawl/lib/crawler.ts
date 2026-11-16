import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { readHealth } from '../../support/health';
import { readPageInBrowser, type ControlInfo, type PageRead } from './dom';
import { BACK_RE, terminalKind } from './classify';
import { ROOTS, type Root, type Session } from './session';
import type { Action, AxeSummary, BackResult, Finding, Health, RunResult, StateRec } from './types';

/**
 * The crawl: breadth first from every root of the role, one state at a
 * time. For each state it collects the controls that are on top, clicks
 * each one from a fresh copy of the state, and records where it led. New
 * states are recorded (screenshot, text, page health, axe) the moment they
 * are reached, then explored in turn, up to `maxDepth` clicks from a root.
 *
 * "Fresh copy": before every click the crawler checks that the screen
 * (state signature, controls and their values) and the demo database are
 * exactly as recorded; if not, it first tries one Escape (closes what the
 * last click opened) and otherwise restores the session's storage, reloads,
 * enters the root and replays the path. CRAWL_STRICT=1 reloads before every
 * click instead.
 */

export interface CrawlOptions {
  outDir: string;
  budgetMs: number;
  maxDepth: number;
  maxLayers: number;
  maxClicksPerState: number;
  strict: boolean;
  resume: boolean;
  foldBand: { top: number; bottom: number } | null;
  log: (msg: string) => void;
}

const ROOT_STEPS: Record<string, string> = {
  home: 'Home tab',
  calendar: 'Calendar tab',
  chat: 'Chat tab',
  hub: 'Settings tab (Account hub)',
  create: 'Create (+)',
  inbox: 'Notifications bell on Home',
  gig: 'Calendar → "Rooftop Session" (gig today)',
  rehearsal: 'Calendar → "Weekly rehearsal"',
  quote: 'Calendar → "Jazz Club Night" (gig still a quote)',
  'quote-draft': 'Calendar → "40th birthday party" (quote draft)',
  personal: 'Calendar → "Vocal lesson" (personal gig)',
  draft: 'Home → Drafts → "Spring showcase" (saved wizard draft)',
  urgent: 'Launch: the urgent pop-up (unanswered invitation)',
  'deputy-home': 'Launch: "Deputy gigs" home',
  'no-band': 'Launch: signed in, no band',
  'sign-in': 'Launch signed out',
};

/** Digits vary (counts, dates in a picker): the same screen either way. */
export const normSig = (sig: string) => sig.replace(/\d+/g, '#');

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 6);
};
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'screen';

interface Probe {
  r: PageRead;
  db: string;
  toasts: number;
  outward: number;
  invalid: number;
  requests: number;
  loads: number;
  dialogs: number;
  downloads: number;
  popups: number;
  files: number;
  errors: number;
}

export async function crawl(s: Session, opts: CrawlOptions): Promise<RunResult> {
  const { page } = s;
  const started = Date.now();
  const runFile = path.join(opts.outDir, 'runs', `${s.role}__${s.profile}.json`);
  const screensDir = path.join(opts.outDir, 'screens');
  fs.mkdirSync(path.dirname(runFile), { recursive: true });
  fs.mkdirSync(screensDir, { recursive: true });

  let run: RunResult = {
    role: s.role,
    profile: s.profile,
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
    complete: false,
    budgetMs: opts.budgetMs,
    maxDepth: opts.maxDepth,
    states: [],
    findings: [],
    chunks: [],
    texts: {},
    clicks: 0,
    resets: 0,
    queue: [],
  };
  let previousElapsed = 0;
  if (opts.resume && fs.existsSync(runFile)) {
    const old = JSON.parse(fs.readFileSync(runFile, 'utf8')) as RunResult;
    if (!old.complete) {
      run = { ...old, budgetMs: opts.budgetMs };
      previousElapsed = old.elapsedMs;
      opts.log(`resuming: ${old.states.length} states, ${old.queue.length} queued`);
    }
  }
  const states = new Map(run.states.map((x) => [x.id, x]));
  const bySig = new Map(run.states.map((x) => [x.sig, x.id]));
  const queue: string[] = run.queue;
  /**
   * The same control (role, name, markup) on the same layer, met again on
   * another state (the poll card on Home and on the Calendar, an event card
   * in two lists, the tab bar): its outcome is reused instead of clicked again.
   * Keyed by the whole layer stack under the control (or the base screen), so
   * a control whose outcome depends on where the layer was opened from is
   * clicked again; Back / Close controls are never reused.
   */
  const memo = new Map<string, Action>();
  const memoKey = (c: ControlInfo, st: StateRec) =>
    `${c.role}|${c.name}|${c.group}|${
      c.layer >= 0 ? st.layers.slice(0, c.layer + 1).map((l) => `${l.kind}:${l.name}`).join(' > ') : `(base ${st.tab ?? st.title})`
    }`;
  const roots = ROOTS[s.role];
  const rootById = (id: string) => roots.find((r) => r.id === id) as Root;
  const timeUp = () => Date.now() - started > opts.budgetMs;
  let nonce = 0;

  const save = (complete = false) => {
    run.states = [...states.values()];
    run.queue = queue;
    run.elapsedMs = previousElapsed + (Date.now() - started);
    run.complete = complete;
    run.chunks = [...new Set([...run.chunks, ...s.chunks])].sort();
    run.resets += s.resets;
    s.resets = 0;
    fs.writeFileSync(runFile, JSON.stringify(run, null, 1));
  };

  const read = (): Promise<PageRead> => page.evaluate(readPageInBrowser, { nonce: String(++nonce), collect: true });

  const probe = async (r?: PageRead): Promise<Probe> => {
    const rr = r ?? (await read());
    const log = await s.crawlLog();
    return {
      r: rr,
      db: await s.dbHash(),
      toasts: log.toasts.length,
      outward: log.outward.length,
      invalid: log.invalid,
      requests: s.requests,
      loads: s.loads,
      dialogs: s.dialogs.length,
      downloads: s.downloads.length,
      popups: s.popups.length,
      files: s.fileChoosers.length,
      errors: s.pageErrors.length,
    };
  };

  const finding = (f: Omit<Finding, 'id' | 'role' | 'profile'>) => {
    const id = `${s.role}.${s.profile}.${f.kind}.${hash(`${f.state}|${f.title}|${f.control ?? ''}`)}`;
    if (run.findings.some((x) => x.id === id)) return id;
    run.findings.push({ id, role: s.role, profile: s.profile, ...f });
    if (f.state) states.get(f.state)?.findings.push(id);
    return id;
  };

  const axeScan = async (hasLayer: boolean): Promise<AxeSummary | null> => {
    try {
      await page.evaluate(() => document.querySelectorAll('[data-crawl-id]').forEach((e) => e.removeAttribute('data-crawl-id')));
      let b = new AxeBuilder({ page }).setLegacyMode(true).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
      if (hasLayer) b = b.include('[data-crawl-layer="top"]');
      const res = await b.analyze();
      const out: AxeSummary = { critical: 0, serious: 0, moderate: 0, minor: 0, violations: [] };
      for (const v of res.violations) {
        const impact = (v.impact ?? 'minor') as keyof Omit<AxeSummary, 'violations'>;
        out[impact] = (out[impact] ?? 0) + 1;
        out.violations.push({
          id: v.id,
          impact,
          help: v.help,
          nodes: v.nodes.length,
          targets: v.nodes.slice(0, 3).map((n) => String(n.target.join(' ')).slice(0, 120)),
        });
      }
      return out;
    } catch (e) {
      opts.log(`axe failed: ${(e as Error).message.split('\n')[0]}`);
      return null;
    }
  };

  /** A state seen for the first time: everything we record about it. */
  const record = async (r: PageRead, root: Root, depth: number, keys: string[], steps: string[]): Promise<StateRec> => {
    const sig = normSig(r.sig);
    const id = `${s.role}.${s.profile}.${slug(r.title)}.${hash(sig)}`;
    const file = `${id}.png`;
    await page.screenshot({ path: path.join(screensDir, file) }).catch(() => {});
    const h = await readHealth(page, { foldBand: opts.foldBand }).catch(() => null);
    const health: Health | null = h
      ? { docOverflow: h.docOverflow, offscreen: h.offscreen, badText: h.badText, rawKeys: h.rawKeys, errors: h.errors, onFold: h.onFold, empty: r.empty }
      : null;
    const axe = await axeScan(r.layers.length > 0);
    // The poll and proposal flows live under Home and Create; they get their own diagram.
    const area = /\b(poll|vote|propos)/i.test(`${r.title} ${r.layers.map((l) => l.name).join(' ')}`) ? 'polls' : root.area;
    const st: StateRec = {
      id,
      role: s.role,
      profile: s.profile,
      root: root.id,
      area,
      depth,
      path: keys,
      steps,
      sig,
      url: r.path,
      tab: r.tab,
      layers: r.layers,
      title: r.title,
      text: r.text,
      screenshot: `screens/${file}`,
      actions: [],
      back: {},
      health,
      axe,
      findings: [],
      explored: false,
      inApp: r.inApp,
      fp: r.fp,
      freshFp: r.fp,
      db: await s.dbHash(),
    };
    states.set(id, st);
    bySig.set(sig, id);
    run.texts[id] = r.fullText;
    opts.log(`+ ${id} (depth ${depth}, ${r.controls.length} controls)`);
    return st;
  };

  const clickLocator = async (c: ControlInfo) => {
    const loc = page.locator(`[data-crawl-id="${nonce}-${c.cid}"]`);
    try {
      await loc.click({ timeout: 3000 });
    } catch (e) {
      // Covered for Playwright (a transparent overlay) but on top for the
      // user: click where the user would.
      const box = await loc.boundingBox().catch(() => null);
      if (!box) throw e;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
  };

  /** Reload + root + replay. True when the page shows the state again. */
  const escape = async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('Escape');
    await s.settle();
  };

  /** Root, then the recorded clicks. */
  const replay = async (st: StateRec): Promise<PageRead | null> => {
    for (const key of st.path) {
      if (key === '<escape-back>' || key === '<system-back>') {
        if (key === '<escape-back>') await escape();
        else {
          await page.evaluate(() => history.back());
          await page.waitForTimeout(400);
          await s.settle();
        }
        continue;
      }
      const r = await read();
      const c = r.controls.find((x) => x.key === key);
      if (!c) return null;
      await clickLocator(c);
      await page.waitForTimeout(150);
      await s.settle();
    }
    const r = await read();
    return normSig(r.sig) === st.sig ? r : null;
  };

  /** Reload with the session's storage, root, replay. */
  const goTo = async (st: StateRec): Promise<PageRead | null> => {
    await s.resetTo(rootById(st.root));
    return replay(st);
  };

  const isFresh = (r: PageRead, db: string, st: StateRec) => normSig(r.sig) === st.sig && r.fp === st.freshFp && db === st.db;

  /**
   * The page shows `st` exactly as recorded (or null when it can't). Cheapest
   * first: already there; Escape out of what the last click opened; with the
   * demo database untouched, close the layers and enter the root again
   * without reloading; else reload with the session's storage.
   */
  const ensureFresh = async (st: StateRec): Promise<PageRead | null> => {
    const root = rootById(st.root);
    if (!opts.strict && page.url().startsWith(s.baseOrigin)) {
      try {
        let r = await read();
        let db = await s.dbHash();
        if (isFresh(r, db, st)) return r;
        if (db === st.db && r.layers.length > st.layers.length) {
          await escape();
          r = await read();
          db = await s.dbHash();
          if (isFresh(r, db, st)) return r;
        }
        if (db === st.db && !root.keepPopup && !root.url) {
          for (let i = 0; i < 4 && r.layers.length; i++) {
            await escape();
            r = await read();
          }
          await root.enter(s);
          await s.settle();
          const back = await replay(st);
          if (back && isFresh(back, await s.dbHash(), st)) {
            s.softResets++;
            return back;
          }
        }
      } catch {
        /* fall through to a reload */
      }
    }
    const r = await goTo(st);
    if (!r) return null;
    st.freshFp = r.fp;
    st.db = await s.dbHash();
    return r;
  };

  const destination = async (st: StateRec, after: Probe, key: string, label: string) => {
    const sig = normSig(after.r.sig);
    let id = bySig.get(sig);
    if (!id) {
      const rec = await record(after.r, rootById(st.root), st.depth + 1, [...st.path, key], [...st.steps, label]);
      id = rec.id;
      if (rec.depth < opts.maxDepth && rec.layers.length <= opts.maxLayers) queue.push(id);
    }
    return id;
  };

  const tryControl = async (st: StateRec, c: ControlInfo, label: string): Promise<Action> => {
    const base = { label, role: c.role, key: c.key };
    const fresh = await ensureFresh(st);
    if (!fresh) return { ...base, kind: 'error', to: null, note: 'could not come back to this state' };
    let c2 = fresh.controls.find((x) => x.key === c.key);
    if (!c2) return { ...base, kind: 'error', to: null, note: 'control not found on a fresh copy' };
    await page
      .locator(`[data-crawl-id="${nonce}-${c2.cid}"]`)
      .scrollIntoViewIfNeeded({ timeout: 2000 })
      .catch(() => {});
    const before = await probe();
    const stem = c.key.replace(/\|\d+$/, '|');
    c2 = before.r.controls.find((x) => x.key === c.key) ?? before.r.controls.find((x) => x.key.startsWith(stem));
    if (!c2) return { ...base, kind: 'error', to: null, note: 'control moved away when scrolled to' };
    run.clicks++;
    try {
      await clickLocator(c2);
    } catch (e) {
      return { ...base, kind: 'error', to: null, note: `click failed: ${(e as Error).message.split('\n')[0].slice(0, 120)}` };
    }
    await page.waitForTimeout(200);
    await s.settle();
    if (s.loads > before.loads || !page.url().startsWith(s.baseOrigin)) {
      await page.waitForLoadState().catch(() => {});
      const url = page.url();
      return { ...base, kind: 'leaves', to: url, note: 'the click loaded another page' };
    }
    const after = await probe();
    const log = await s.crawlLog();
    const effects: string[] = [];
    const outward = log.outward.slice(before.outward);
    const toasts = log.toasts.slice(before.toasts);
    if (toasts.length) effects.push(...toasts.map((t) => `toast: ${t}`));
    if (after.db !== before.db) effects.push('demo database changed');
    if (after.dialogs > before.dialogs) effects.push(...s.dialogs.slice(before.dialogs).map((d) => `native ${d}`));
    if (after.downloads > before.downloads) effects.push(...s.downloads.slice(before.downloads).map((d) => `download ${d}`));
    if (after.popups > before.popups) effects.push(...s.popups.slice(before.popups).map((p) => `new window ${p}`));
    if (after.files > before.files) effects.push('file picker');
    if (after.invalid > before.invalid) effects.push('browser form validation (required fields empty)');
    if (after.requests > before.requests) effects.push(`${after.requests - before.requests} request(s)`);
    const errors = s.pageErrors.slice(before.errors);
    if (errors.length) effects.push(...errors.map((e) => `JS error: ${e}`));
    const toast = toasts.length ? toasts.join(' / ') : undefined;
    if (outward.length || after.downloads > before.downloads || after.popups > before.popups || after.files > before.files) {
      const what = [...outward, ...effects.filter((e) => /^(download|new window|file picker)/.test(e))].join('; ');
      return { ...base, kind: 'terminal', to: `swallowed: ${what}`, effects, toast, note: 'outward action caught after the click (not performed)' };
    }
    const sig = normSig(after.r.sig);
    if (sig !== st.sig) {
      const to = await destination(st, after, c.key, label);
      return { ...base, kind: 'navigate', to, effects, toast };
    }
    if (after.r.fp !== before.r.fp || after.r.textHash !== before.r.textHash)
      return { ...base, kind: 'inplace', to: st.id, effects, toast };
    if (toasts.length) return { ...base, kind: 'toast', to: st.id, effects, toast };
    if (after.db !== before.db) return { ...base, kind: 'db', to: st.id, effects };
    if (after.r.scroll !== before.r.scroll) return { ...base, kind: 'scroll', to: st.id, effects };
    if (effects.length) return { ...base, kind: 'inplace', to: st.id, effects, note: 'only side effects' };
    return { ...base, kind: 'dead', to: st.id, effects };
  };

  const backResult = (st: StateRec, before: Probe, after: Probe, id: string | null): BackResult => {
    if (after.loads > before.loads) return { to: null, kind: 'leaves', note: 'left the page (the browser went to the previous page)' };
    if (normSig(after.r.sig) !== st.sig) return { to: id, kind: 'navigate' };
    if (after.r.fp !== before.r.fp || after.r.textHash !== before.r.textHash) return { to: st.id, kind: 'inplace' };
    return { to: null, kind: 'none' };
  };

  const backChecks = async (st: StateRec) => {
    for (const mode of ['escape', 'system'] as const) {
      if (timeUp()) return;
      const fresh = await ensureFresh(st);
      if (!fresh) return;
      const before = await probe(fresh);
      if (mode === 'escape') {
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
        await page.keyboard.press('Escape');
      } else {
        // The browser's Back: the web build's system Back (popstate → the
        // app's back chain, src/app/AuthenticatedApp.tsx).
        await page.evaluate(() => history.back());
      }
      await page.waitForTimeout(400);
      if (s.loads > before.loads) await page.waitForLoadState().catch(() => {});
      await s.settle();
      let after: Probe;
      try {
        after = await probe();
      } catch {
        st.back[mode] = { to: null, kind: 'leaves', note: 'left the page' };
        continue;
      }
      let id: string | null = null;
      if (after.loads === before.loads && normSig(after.r.sig) !== st.sig) {
        id = bySig.get(normSig(after.r.sig)) ?? null;
        if (!id) id = await destination(st, after, mode === 'escape' ? '<escape-back>' : '<system-back>', mode === 'escape' ? 'Escape' : 'system Back');
      }
      st.back[mode] = backResult(st, before, after, id);
    }
  };

  /** The visible Back / Close of the state (findings are derived later, lib/derive.ts). */
  const flag = (st: StateRec) => {
    const closers = st.actions.filter((a) => BACK_RE.test(a.label.trim()));
    const visible = closers.find((a) => a.kind === 'navigate' || a.kind === 'leaves') ?? closers[0];
    if (visible) st.back.visible = { label: visible.label, to: visible.to, kind: visible.kind };
  };

  const explore = async (st: StateRec) => {
    const fresh = await ensureFresh(st);
    if (!fresh) {
      finding({
        kind: 'replay',
        severity: 'low',
        title: `Crawler could not come back to "${st.title}"`,
        detail: 'Replaying the recorded clicks from a fresh start led somewhere else (the state depends on timing or on something the replay does not repeat).',
        state: st.id,
        steps: st.steps,
        screenshot: st.screenshot,
      });
      st.explored = true;
      return;
    }
    const groups = new Map<string, number>();
    for (const c of fresh.controls) groups.set(c.group, (groups.get(c.group) ?? 0) + 1);
    const groupSeen = new Map<string, string[]>();
    let clicks = 0;
    for (const c of fresh.controls) {
      const label = c.name || `(unnamed ${c.role})`;
      const base = { label, role: c.role, key: c.key };
      if (c.field) {
        st.actions.push({ ...base, kind: 'field', to: null });
        continue;
      }
      const tk = terminalKind(c, s.baseOrigin);
      if (tk) {
        st.actions.push({ ...base, kind: 'terminal', to: `terminal: ${tk}`, note: c.href ?? undefined });
        continue;
      }
      if ((groups.get(c.group) ?? 0) >= 4) {
        const seen = groupSeen.get(c.group) ?? [];
        if (seen.length >= 2) {
          st.actions.push({ ...base, kind: 'sampled', to: null, note: `same kind of control as "${seen[0]}"` });
          continue;
        }
        groupSeen.set(c.group, [...seen, label]);
      }
      const already = c.checked === 'true' || c.checked === 'page';
      const mk = BACK_RE.test(label.trim()) ? null : memoKey(c, st);
      const m = mk ? memo.get(mk) : undefined;
      if (m && m.kind !== 'error') {
        const to = m.kind === 'navigate' || m.kind === 'terminal' || m.kind === 'leaves' ? m.to : st.id;
        st.actions.push({ ...base, kind: m.kind, to, toast: m.toast, inferred: true, note: 'same control as on another screen (not clicked again)' });
        continue;
      }
      if (clicks >= opts.maxClicksPerState || timeUp()) {
        st.actions.push({ ...base, kind: 'skipped', to: null, note: timeUp() ? 'time budget' : 'per-state click cap' });
        continue;
      }
      clicks++;
      let a: Action;
      const t0 = Date.now();
      try {
        a = await tryControl(st, c, label);
      } catch (e) {
        a = { ...base, kind: 'error', to: null, note: (e as Error).message.split('\n')[0].slice(0, 160) };
      }
      if (a.kind === 'dead' && (already || (c.inNav && st.tab && c.name.startsWith(st.tab))))
        a = { ...a, kind: 'inplace', note: 'already selected' };
      if (mk && a.kind !== 'error' && a.kind !== 'skipped') memo.set(mk, a);
      opts.log(`  ${a.kind.padEnd(8)} ${label.slice(0, 40)} ${a.to && a.kind === 'navigate' ? `→ ${a.to}` : ''} (${Date.now() - t0}ms)`);
      st.actions.push(a);
      if (page.isClosed()) throw new Error('page closed');
    }
    await backChecks(st);
    flag(st);
    st.explored = true;
  };

  // ---------------------------------------------------------------- roots
  if (!states.size) {
    for (const root of roots) {
      if (timeUp()) break;
      try {
        await s.resetTo(root);
        const r = await read();
        const sig = normSig(r.sig);
        if (bySig.has(sig)) {
          opts.log(`root ${root.id} = ${bySig.get(sig)}`);
          continue;
        }
        const st = await record(r, root, 0, [], [ROOT_STEPS[root.id] ?? root.id]);
        queue.push(st.id);
      } catch (e) {
        opts.log(`root ${root.id} failed: ${(e as Error).message.split('\n')[0]}`);
        finding({
          kind: 'replay',
          severity: 'low',
          title: `Crawler could not open root "${root.id}"`,
          detail: (e as Error).message.split('\n')[0],
          state: null,
          steps: [ROOT_STEPS[root.id] ?? root.id],
          screenshot: null,
        });
      }
    }
    save();
  }

  // ---------------------------------------------------------------- BFS
  while (queue.length && !timeUp()) {
    queue.sort((a, b) => (states.get(a)?.depth ?? 0) - (states.get(b)?.depth ?? 0));
    const id = queue.shift()!;
    const st = states.get(id);
    if (!st || st.explored) continue;
    opts.log(`explore ${id} (${queue.length} left, ${Math.round((Date.now() - started) / 1000)}s, reloads ${s.resetCount} / ${Math.round(s.resetMs / 1000)}s, soft ${s.softResets}, ${JSON.stringify(s.phases)})`);
    try {
      await explore(st);
    } catch (e) {
      opts.log(`explore ${id} failed: ${(e as Error).message.split('\n')[0]}`);
      st.explored = true;
      if (page.isClosed()) break;
    }
    save();
  }
  save(!queue.length);
  return run;
}
