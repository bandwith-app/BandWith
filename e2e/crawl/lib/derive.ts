import { BACK_RE, privacyLeaks } from './classify';
import type { Finding, RunResult, StateRec } from './types';

/**
 * Findings, derived from what the crawl recorded (so the rules can change
 * without crawling again). The crawler itself only adds "replay" findings.
 */

const DRAG_RE = /^(reorder|drag|move)\b/i;

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 6);
};

export function deriveFindings(run: RunResult): Finding[] {
  const states = new Map(run.states.map((s) => [s.id, s]));
  const out: Finding[] = [];
  const add = (f: Omit<Finding, 'id' | 'role' | 'profile'>) => {
    const id = `${run.role}.${run.profile}.${f.kind}.${hash(`${f.state}|${f.title}|${f.control ?? ''}`)}`;
    if (!out.some((x) => x.id === id)) out.push({ id, role: run.role, profile: run.profile, ...f });
  };
  const dest = (id: string | null) => (id ? (states.get(id)?.title ?? id) : 'nothing happens');

  for (const st of run.states) {
    const where = { state: st.id, steps: st.steps, screenshot: st.screenshot };
    const h = st.health;
    if (h?.badText || h?.rawKeys.length)
      add({
        kind: 'broken-state',
        severity: 'high',
        title: `Broken text on "${st.title}"`,
        detail: [h.badText && `bad text: ${h.badText}`, h.rawKeys.length && `raw i18n keys: ${h.rawKeys.join(', ')}`].filter(Boolean).join('; '),
        ...where,
      });
    if (h?.empty) add({ kind: 'empty-state', severity: 'high', title: `Blank screen: "${st.title}"`, detail: 'The top layer shows no text and no control.', ...where });
    if (h && (h.docOverflow || h.offscreen.length || h.onFold.length))
      add({
        kind: 'layout',
        severity: 'medium',
        title: `Layout on "${st.title}"`,
        detail: [
          h.docOverflow && `page is ${h.docOverflow}px wide`,
          h.offscreen.length && `off screen: ${h.offscreen.join(' | ')}`,
          h.onFold.length && `controls on the fold: ${h.onFold.join(' | ')}`,
        ]
          .filter(Boolean)
          .join('; '),
        ...where,
      });
    if (run.role === 'member' || run.role === 'deputy') {
      const leaks = privacyLeaks(run.texts[st.id] ?? '');
      if (leaks.length) add({ kind: 'privacy', severity: 'critical', title: `${run.role} sees private data on "${st.title}"`, detail: leaks.join('; '), ...where });
    }
    for (const v of st.axe?.violations ?? [])
      if (v.impact === 'critical' || v.impact === 'serious')
        add({
          kind: 'axe',
          severity: v.impact === 'critical' ? 'high' : 'medium',
          // One finding per rule (the report groups the screens).
          title: `axe ${v.impact}: ${v.id}`,
          detail: `${v.help}. First seen on "${st.title}" (${v.nodes} node${v.nodes === 1 ? '' : 's'}: ${v.targets.join(' | ')})`,
          control: v.id,
          ...where,
        });

    for (const a of st.actions) {
      const errors = (a.effects ?? []).filter((e) => e.startsWith('JS error: '));
      if (errors.length)
        add({
          kind: 'js-error',
          severity: 'high',
          title: `JS error after "${a.label}" on "${st.title}"`,
          detail: errors.map((e) => e.slice(10)).join(' | '),
          control: a.label,
          ...where,
          steps: [...st.steps, a.label],
        });
      // Drag handles only react to a drag, not to a click.
      if (a.kind === 'dead' && !DRAG_RE.test(a.label.trim()))
        add({
          kind: 'dead-control',
          severity: 'medium',
          title: `Dead control "${a.label}" on "${st.title}"`,
          detail: 'Clicking it changed nothing: no new screen, no content change, no toast, no request, no demo-database change.',
          control: a.label,
          ...where,
          steps: [...st.steps, a.label],
        });
    }

    if (!st.explored) continue;
    const closers = st.actions.filter((a) => BACK_RE.test(a.label.trim()));
    const leaving = closers.filter((a) => a.kind === 'navigate' || a.kind === 'leaves');
    // "Close Account Hub", "Close create menu"… close the whole stack; on a
    // deeper layer only a plain Back / Close is expected to match system Back.
    const plain = (a: { label: string }) => !/^close .+/i.test(a.label.trim());
    const comparable = leaving.filter((a) => plain(a) || st.layers.length <= 1);
    const visible = comparable[0] ?? closers.find(plain);
    const esc = st.back.escape;
    const sys = st.back.system;
    // Admin and member never leave the signed-in app (runs before the Duo
    // rail counted as in-app recorded false there).
    const inApp = run.role === 'admin' || run.role === 'member' ? true : (st.inApp ?? true);
    // The first screen outside the signed-in app (onboarding, Deputy gigs) is
    // a full screen with nothing under it.
    const fullScreenRoot = !inApp && st.depth === 0;
    if (st.layers.length > 0 && !fullScreenRoot && esc && sys && esc.kind !== 'navigate' && sys.kind !== 'navigate' && sys.kind !== 'leaves' && !leaving.length)
      add({
        kind: 'no-exit',
        severity: 'high',
        title: `No way out of "${st.title}"`,
        detail: `Escape: ${esc.kind}; system Back: ${sys.kind}; ${closers.length ? `close controls (${closers.map((a) => `${a.label}: ${a.kind}`).join(', ')}) don't leave` : 'no Back/Close control'}.`,
        ...where,
      });
    // System Back: inside the signed-in app the browser's Back runs the same
    // chain as Android Back; outside it (onboarding, Deputy gigs) Android Back
    // is wired to the Escape handler, and the browser's Back only matters on
    // the web build.
    const systemLike = inApp ? sys : esc;
    if (visible && visible.kind === 'navigate' && systemLike && systemLike.kind !== 'leaves' && systemLike.to !== visible.to)
      add({
        kind: 'back-mismatch',
        severity: systemLike.kind === 'none' ? 'high' : 'medium',
        title: `System Back ≠ "${visible.label}" on "${st.title}"`,
        detail:
          `"${visible.label}" goes to "${dest(visible.to)}"; system Back${inApp ? ' (browser Back = the Android Back chain)' : ' (Escape = the Android Back handler here)'}: ` +
          `${systemLike.kind === 'none' ? 'nothing happens' : `"${dest(systemLike.to)}"`}; Escape: ${esc ? (esc.kind === 'navigate' ? `"${dest(esc.to)}"` : esc.kind) : 'not checked'}.`,
        control: visible.label,
        ...where,
      });
    else if (!inApp && visible && visible.kind === 'navigate' && sys && sys.kind === 'none')
      add({
        kind: 'back-mismatch',
        severity: 'low',
        title: `Browser Back does nothing on "${st.title}" (web build)`,
        detail: `"${visible.label}" goes to "${dest(visible.to)}" and Escape / Android Back work, but the browser's Back button does nothing (no popstate handler outside the signed-in app).`,
        control: visible.label,
        ...where,
      });
  }
  return out;
}

/** For the report: also the states' finding ids. */
export function attachFindings(run: RunResult): Finding[] {
  const all = [...run.findings.filter((f) => f.kind === 'replay'), ...deriveFindings(run)];
  const byState = new Map<string, string[]>();
  for (const f of all) if (f.state) byState.set(f.state, [...(byState.get(f.state) ?? []), f.id]);
  for (const st of run.states as StateRec[]) st.findings = byState.get(st.id) ?? [];
  run.findings = all;
  return all;
}
