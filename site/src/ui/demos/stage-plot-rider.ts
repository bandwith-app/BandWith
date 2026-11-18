import { gsap } from 'gsap';

/**
 * Try it: put the band on stage and watch the input list fill in. The rules
 * are the app's (src/lib/stagePlot.ts): presetItem, freeSpot, deskGroup,
 * channelsForItem and syncInputs, ported here as they are. In the app the
 * channels are added when you tap SAVE PLOT; here every change is saved at
 * once. The audience is at the bottom of the stage (y = 1).
 */

export type Kind = 'player' | 'wedge' | 'speaker' | 'di';
export interface Item { id: string; kind: Kind; code?: string; label?: string; x: number; y: number; lead?: boolean; instrument?: string }
export interface Channel { id: string; source: string; mic: string; itemId: string }
export interface Plot { items: Item[]; inputs: Channel[] }

let seq = 0;
const nid = (p: string) => `${p}${++seq}`;

const PRESET_NAME: Record<string, string> = { vocals: 'Vocals', guitar: 'Guitar', bass: 'Bass', keys: 'Keys', drums: 'Drums', percussion: 'Percussion', sax: 'Sax', trumpet: 'Trumpet' };
const CODE: Record<string, string> = { drums: 'DR', percussion: 'PC', bass: 'BS', guitar: 'GT', keys: 'KY', vocals: 'VX', sax: 'SX', trumpet: 'TP' };
const PRESET_SPOT: Record<string, { x: number; y: number }> = {
  drums: { x: 0.5, y: 0.2 }, bass: { x: 0.25, y: 0.3 }, guitar: { x: 0.75, y: 0.3 },
  keys: { x: 0.2, y: 0.66 }, vocals: { x: 0.5, y: 0.66 }, percussion: { x: 0.8, y: 0.3 },
};

/** A musician circle from a preset (app: presetItem). */
export function presetItem(key: string): Item {
  const spot = PRESET_SPOT[key] ?? { x: 0.5, y: 0.5 };
  const label = key === 'drums' ? 'Drums · riser' : key === 'bass' ? 'Bass amp' : key === 'guitar' ? 'Guitar amp' : PRESET_NAME[key] ?? key;
  return { id: nid('i'), kind: 'player', code: CODE[key], label, x: spot.x, y: spot.y, instrument: key };
}
/** Gear and "Other musician" from the second chip row (app: StagePlotView add). */
export function gearItem(kind: Kind): Item {
  return { id: nid('i'), kind, x: kind === 'speaker' ? 0.97 : 0.5, y: kind === 'wedge' ? 0.9 : kind === 'speaker' ? 0.8 : 0.5, ...(kind === 'player' ? { code: '??', label: '' } : {}) };
}

/** The nearest spot no item covers (app: freeSpot), on a 6 × 4 m stage. */
export function freeSpot(items: Pick<Item, 'x' | 'y'>[], want: { x: number; y: number }, ratio = 1.5, gapIn = 0): { x: number; y: number } {
  const gap = Math.max(0.12, gapIn);
  const clamp = (v: number) => Math.min(0.94, Math.max(0.06, v));
  const clampY = (v: number) => Math.min(0.86, Math.max(0.08, v));
  const far = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, (ay - by) / ratio);
  const free = (x: number, y: number) => items.every((i) => far(i.x, i.y, x, y) >= gap);
  if (free(want.x, want.y)) return want;
  for (let ring = 1; ring <= 8; ring++) {
    const r = ring * gap;
    const steps = ring * 8;
    for (let k = 0; k < steps; k++) {
      const a = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * ((2 * Math.PI) / steps);
      const x = clamp(want.x + r * Math.cos(a));
      const y = clampY(want.y + r * ratio * Math.sin(a));
      if (free(x, y)) return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
    }
  }
  return want;
}

/** Desk order: drums, bass, guitars, keys, others (DI boxes too), lead vocal, other vocals. */
export const deskGroup = (item: Item | undefined): number => {
  const key = item?.instrument;
  if (!item) return 4;
  if (key === 'drums') return 0;
  if (key === 'bass') return 1;
  if (key === 'guitar') return 2;
  if (key === 'keys') return 3;
  if (key === 'vocals') return item.lead ? 5 : 6;
  return 4;
};

/** The usual channels for an item (app: channelsForItem). Wedges, speakers and Other musician have none. */
export function channelsForItem(item: Item): Channel[] {
  const make = (source: string, mic: string): Channel => ({ id: nid('c'), source, mic, itemId: item.id });
  if (item.kind === 'di') return [make(item.label || 'DI box', 'DI')];
  if (item.kind !== 'player' || !item.instrument) return [];
  switch (item.instrument) {
    case 'drums': return [make('Kick', 'Beta 52'), make('Snare', 'SM57'), make('OH L', 'C414'), make('OH R', 'C414')];
    case 'bass': return [make('Bass', 'DI')];
    case 'guitar': return [make('Guitar', 'SM57')];
    case 'keys': return [make('Keys L', 'DI'), make('Keys R', 'DI')];
    case 'vocals': return [item.lead ? make('Lead vox', 'Beta 58') : make('Vox', 'SM58')];
    default: return [make(item.label || PRESET_NAME[item.instrument] || item.instrument, 'SM57')];
  }
}

/** Adds an item; its channels go before the first channel of a later desk group (app: syncInputs). */
export function addItem(p: Plot, item: Item): Plot {
  const items = [...p.items, item];
  const now = new Map(items.map((i) => [i.id, i] as const));
  const channels = channelsForItem(item);
  if (!channels.length) return { items, inputs: p.inputs };
  const g = deskGroup(item);
  const at = p.inputs.findIndex((c) => deskGroup(now.get(c.itemId)) > g);
  return { items, inputs: at < 0 ? [...p.inputs, ...channels] : [...p.inputs.slice(0, at), ...channels, ...p.inputs.slice(at)] };
}
/** Removing an item removes its channels. */
export const removeItem = (p: Plot, id: string): Plot => ({ items: p.items.filter((i) => i.id !== id), inputs: p.inputs.filter((c) => c.itemId !== id) });
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const moveItem = (p: Plot, id: string, x: number, y: number): Plot => ({ ...p, items: p.items.map((i) => (i.id === id ? { ...i, x: clamp01(x), y: clamp01(y) } : i)) });

/** Lead vocal and bass already placed, a wedge in front, a speaker each side. */
export function initialPlot(): Plot {
  let p: Plot = { items: [], inputs: [] };
  p = addItem(p, { ...presetItem('vocals'), label: 'Lead vox', lead: true });
  p = addItem(p, presetItem('bass'));
  p = addItem(p, { id: nid('i'), kind: 'wedge', x: 0.5, y: 0.9 });
  p = addItem(p, { id: nid('i'), kind: 'speaker', x: 0.03, y: 0.8 });
  p = addItem(p, { id: nid('i'), kind: 'speaker', x: 0.97, y: 0.8 });
  return p;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const name = (i: Item) => (i.kind === 'player' ? i.label || 'Other musician' : i.kind === 'di' ? 'DI box' : i.kind === 'wedge' ? 'Wedge' : 'Speaker');

/** One mark on the plot: a circle with its code for a player, shapes for gear. */
export function markHtml(i: Item, live: boolean, selected = false) {
  const pos = `left:${i.x * 100}%;top:${i.y * 100}%`;
  const inner = i.kind === 'player'
    ? `<span class="spm__c${i.lead ? ' is-lead' : ''}">${esc(i.code ?? '')}</span>${i.label ? `<span class="spm__cap">${esc(i.label)}</span>` : ''}`
    : `<span class="spm__${i.kind}">${i.kind === 'di' ? 'DI' : ''}</span>`;
  return live
    ? `<button type="button" class="spm spm--${i.kind}${selected ? ' is-sel' : ''}" style="${pos}" data-id="${i.id}" data-k="m-${i.id}" aria-pressed="${selected}" aria-label="${esc(name(i))}. Drag, or use the arrow keys, to move it.">${inner}</button>`
    : `<span class="spm spm--${i.kind}" style="${pos}" aria-hidden="true">${inner}</span>`;
}

export function initStagePlotRiderDemo(root: HTMLElement | null, reduce: boolean) {
  if (!root) return;
  const stage = root.querySelector<HTMLElement>('[data-sp-stage]');
  const rows = root.querySelector<HTMLElement>('[data-sp-rows]');
  const count = root.querySelector<HTMLElement>('[data-sp-count]');
  const sel = root.querySelector<HTMLElement>('[data-sp-sel]');
  const rider = root.querySelector<HTMLElement>('[data-sp-rider]');
  const venue = root.querySelector<HTMLElement>('[data-sp-venue]');
  const note = root.querySelector<HTMLElement>('[data-sp-note]');
  if (!stage || !rows || !rider || !venue) return;
  root.classList.add('is-live');

  let p = initialPlot();
  let selected: string | null = null;
  let sent = false;
  let fresh = new Set<string>();
  const say = (msg: string) => { if (note) note.textContent = msg; };
  const chList = (cs: Channel[]) => cs.map((c) => `${c.source} (${c.mic})`).join(', ');

  const tableRows = (cs: Channel[]) => cs.map((c, i) => `<tr data-c="${c.itemId}"${fresh.has(c.id) ? ' class="is-new"' : ''}><td>${String(i + 1).padStart(2, '0')}</td><td>${esc(c.source)}</td><td>${esc(c.mic)}</td></tr>`).join('');

  const renderVenue = () => {
    if (!sent) { venue.hidden = true; return; }
    venue.hidden = false;
    venue.innerHTML = `<p class="spv__lbl"><svg class="ico" aria-hidden="true"><use href="#i-globe"/></svg>What the venue opens · a web page, no account</p>` +
      `<div class="spv"><section class="spv__card spv__card--ink"><p class="spv__k">Technical rider · From Velvet Static</p><h3 class="spv__h">Client A — Wedding</h3>` +
      `<div class="spv__tiles"><p><em>Version</em>v1</p><p><em>Date</em>Sat 21 Nov 2026</p><p><em>Venue</em>Villa Necchi · Milan</p></div>` +
      `<dl class="spv__times"><dt>Load-in</dt><dd>15:00</dd><dt>Soundcheck</dt><dd>16:30</dd><dt>Show</dt><dd>20:30–00:30</dd></dl></section>` +
      `<section class="spv__card"><h4>Stage plot</h4><p class="spv__k spv__k--mute">Full band</p><div class="sp__stage sp__stage--ro" role="img" aria-label="Stage plot: ${esc(p.items.filter((i) => i.kind === 'player').map(name).join(', ') || 'empty')}">${p.items.map((i) => markHtml(i, false)).join('')}</div><p class="sp__aud">Audience · stage 6 × 4 m</p></section>` +
      `<section class="spv__card"><p class="spv__row"><b>Input list</b><span class="spv__k spv__k--mute">${p.inputs.length} ch</span></p><table class="sp__tbl sp__tbl--light"><thead><tr><th scope="col">Ch</th><th scope="col">Source</th><th scope="col">Mic / DI</th></tr></thead><tbody>${p.inputs.map((c, i) => `<tr><td>${String(i + 1).padStart(2, '0')}</td><td>${esc(c.source)}</td><td>${esc(c.mic)}</td></tr>`).join('')}</tbody></table></section>` +
      `<p class="spv__never"><svg class="ico" aria-hidden="true"><use href="#i-eye-off"/></svg>Never on this page: the client’s details, the band fee or anyone’s fee.</p></div>`;
  };

  const renderRider = () => {
    rider.innerHTML = `<p class="sp__h"><span>Technical rider</span><em>${sent ? 'Sent to the venue 17 Nov' : 'Not sent yet'}</em></p>` +
      `<p class="sp__ready${sent ? ' is-done' : ''}"><span class="sp__tick" aria-hidden="true">${sent ? '<svg class="ico"><use href="#i-check"/></svg>' : ''}</span>${sent ? 'Rider v1 · sent to the venue' : 'Rider v1 · not sent yet'}${sent ? '' : '<b>To do</b>'}</p>` +
      `<button type="button" class="sp__share" data-sp-share data-k="share"><svg class="ico" aria-hidden="true"><use href="#i-${sent ? 'eye' : 'globe'}"/></svg>${sent ? 'See what the venue opens' : 'Share link with the venue'}</button>`;
  };

  const renderSel = () => {
    if (!sel) return;
    const it = p.items.find((i) => i.id === selected);
    sel.innerHTML = it
      ? `<span class="sp__selname">${it.kind === 'player' ? `<b>${esc(it.code ?? '')}</b>` : ''}${esc(name(it))}</span><button type="button" class="sp__rm" data-sp-rm data-k="rm"><svg class="ico" aria-hidden="true"><use href="#i-x"/></svg>Remove</button>`
      : `<span class="sp__hint">Drag an item to move it, or focus it and use the arrow keys. Tap it, then Remove.</span>`;
  };

  const render = () => {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.k;
    stage.innerHTML = p.items.map((i) => markHtml(i, true, i.id === selected)).join('');
    rows.innerHTML = tableRows(p.inputs) || `<tr class="sp__empty"><td colspan="3">No channels yet</td></tr>`;
    if (count) count.textContent = `${p.inputs.length} ch`;
    renderSel(); renderRider(); renderVenue();
    root.querySelectorAll<HTMLButtonElement>('[data-sp-add],[data-sp-gear]').forEach((b) => (b.disabled = p.items.length >= 40));
    if (focusKey) root.querySelector<HTMLElement>(`[data-k="${focusKey}"]`)?.focus({ preventScroll: true });
    if (!reduce && fresh.size) {
      gsap.fromTo(rows.querySelectorAll('.is-new'), { backgroundColor: 'rgba(213,251,70,.55)' }, { backgroundColor: 'rgba(213,251,70,0)', duration: 1.2, ease: 'power2.out', stagger: 0.06 });
      gsap.fromTo(rows.querySelectorAll('.is-new td'), { autoAlpha: 0, x: -10 }, { autoAlpha: 1, x: 0, duration: 0.4, stagger: 0.04 });
    }
    fresh = new Set();
  };

  const place = (item: Item) => {
    const w = stage.getBoundingClientRect().width;
    item = { ...item, ...freeSpot(p.items, item, 1.5, w ? 52 / w : 0) };
    const before = new Set(p.inputs.map((c) => c.id));
    p = addItem(p, item);
    const added = p.inputs.filter((c) => !before.has(c.id));
    fresh = new Set(added.map((c) => c.id));
    selected = item.id;
    root.classList.remove('is-hint');
    render();
    if (!reduce) gsap.fromTo(stage.querySelector(`[data-id="${item.id}"]`), { scale: 0.3, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.45, ease: 'back.out(2)' });
    say(added.length ? `${name(item)} added · ${added.length === 1 ? 'one channel' : `${added.length} channels`} in desk order: ${chList(added)}` : `${name(item)} added · no channel for it`);
  };

  const remove = (id: string) => {
    const it = p.items.find((i) => i.id === id);
    if (!it) return;
    const gone = p.inputs.filter((c) => c.itemId === id);
    const finish = () => { p = removeItem(p, id); selected = null; render(); stage.focus({ preventScroll: true }); };
    say(gone.length ? `${name(it)} removed · ${gone.length === 1 ? 'its channel goes' : `its ${gone.length} channels go`} with it` : `${name(it)} removed`);
    if (reduce || !gone.length) return finish();
    gsap.to(rows.querySelectorAll(`[data-c="${id}"] td`), { autoAlpha: 0, x: 12, duration: 0.25, onComplete: finish });
  };

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const add = t.closest<HTMLButtonElement>('[data-sp-add]');
    const gear = t.closest<HTMLButtonElement>('[data-sp-gear]');
    if (add) return place(presetItem(add.dataset.spAdd!));
    if (gear) return place(gearItem(gear.dataset.spGear as Kind));
    if (t.closest('[data-sp-rm]') && selected) return remove(selected);
    if (t.closest('[data-sp-share]')) {
      const first = !sent;
      sent = true;
      render();
      if (first) say('Link copied. The venue sees the rider without an account. Show readiness ticks the rider line.');
      if (!reduce && first) gsap.fromTo(venue, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'power3.out' });
      venue.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
    }
  });

  // Drag with a mouse, a finger or a pen; a press without a move selects.
  let drag: { id: string; pid: number; x0: number; y0: number; moved: boolean; el: HTMLElement } | null = null;
  const rel = (cx: number, cy: number) => {
    const r = stage.getBoundingClientRect();
    return { x: Math.min(0.97, Math.max(0.03, (cx - r.left) / r.width)), y: Math.min(0.97, Math.max(0.03, (cy - r.top) / r.height)) };
  };
  stage.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.spm');
    if (!el || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    el.focus({ preventScroll: true });
    el.setPointerCapture(e.pointerId);
    drag = { id: el.dataset.id!, pid: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, el };
    el.classList.add('is-lifted');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
    drag.moved = true;
    const { x, y } = rel(e.clientX, e.clientY);
    p = moveItem(p, drag.id, x, y);
    drag.el.style.left = `${x * 100}%`;
    drag.el.style.top = `${y * 100}%`;
  });
  const up = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const { id, moved } = drag;
    drag.el.classList.remove('is-lifted');
    drag = null;
    const it = p.items.find((i) => i.id === id);
    if (moved) { selected = id; say(`${it ? name(it) : 'Item'} moved · the input list stays as it is`); }
    else selected = selected === id ? null : id;
    render();
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('keydown', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.spm');
    if (!el) return;
    const id = el.dataset.id!;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return remove(id); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selected = selected === id ? null : id; return render(); }
    const d = e.shiftKey ? 0.08 : 0.02;
    const v = ({ ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] } as Record<string, number[]>)[e.key];
    if (!v) return;
    e.preventDefault();
    const it = p.items.find((i) => i.id === id)!;
    p = moveItem(p, id, Math.min(0.97, Math.max(0.03, it.x + v[0])), Math.min(0.97, Math.max(0.03, it.y + v[1])));
    selected = id;
    render();
  });

  root.querySelector('[data-sp-reset]')?.addEventListener('click', () => {
    p = initialPlot(); selected = null; sent = false; fresh = new Set();
    render();
    say('Back to the lead vocal and the bass. Add the drums and watch the list.');
  });

  render();
  say('Lead vocal and bass are on stage. Add the drums and watch the list.');
  if (!reduce) {
    new IntersectionObserver(([e], io) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      window.setTimeout(() => { if (p.items.length === 5) root.classList.add('is-hint'); }, 1400);
    }, { threshold: 0.4 }).observe(root);
  }
}
