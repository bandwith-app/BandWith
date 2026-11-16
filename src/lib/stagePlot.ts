/**
 * Rider & stage for a gig (migration 092, table event_stage): the stage plot
 * (one or more layouts, "Full band" / "Trio"), the input list, what the band
 * brings and what the venue provides.
 *
 * Pure helpers shared by the app, the rider PDF and the venue's web page
 * (/rider.html). Rows read from the database are sanitised here, so a bad
 * row never breaks a screen.
 */
import { instrumentKeys } from './instruments';

export type PlotItemKind = 'player' | 'wedge' | 'speaker' | 'di';

export interface PlotItem {
  id: string;
  kind: PlotItemKind;
  /** Two-letter code in the circle (players): "DR", "VX". */
  code?: string;
  /** Caption under it: "Drums · riser", "Bass amp". */
  label?: string;
  /** 0 = left, 1 = right, seen from the audience side (stage left on the right). */
  x: number;
  /** 0 = back of the stage, 1 = front (the audience is below). */
  y: number;
  /** Highlighted (lead vocal). */
  lead?: boolean;
  /** Instrument key of a player added from a preset ('drums', 'bass'…, src/lib/instruments.ts). */
  instrument?: string;
}

export interface StagePlot {
  id: string;
  name: string;
  widthM?: number | null;
  depthM?: number | null;
  items: PlotItem[];
}

export type InputKind = 'mic' | 'di';

export interface InputChannel {
  id: string;
  source: string;
  /** Mic model or "DI". */
  mic: string;
  kind: InputKind;
  /** Who plays it (first name). */
  who: string;
  /** The plot item it was made for: removing the item removes its channels. */
  itemId?: string;
  /**
   * Built from the lineup (lineupKey) and not touched since: "<key>:<index>/<count>".
   * Editing the channel drops it; "<key>:-" marks a list kept after the lineup changed.
   */
  auto?: string;
}

export interface StageData {
  plots: StagePlot[];
  inputs: InputChannel[];
  mixer: string;
  bandBrings: string[];
  venueProvides: string[];
  venueAgreed: boolean;
}

/** The database row (snake case). */
export interface StageRow {
  plots: unknown;
  inputs: unknown;
  mixer?: string | null;
  band_brings: unknown;
  venue_provides: unknown;
  venue_agreed?: boolean | null;
}

export const LIMITS = { plots: 6, items: 40, inputs: 96, lines: 40, text: 80 } as const;

export const EMPTY_STAGE: StageData = {
  plots: [],
  inputs: [],
  mixer: '',
  bandBrings: [],
  venueProvides: [],
  venueAgreed: false,
};

let seq = 0;
/** Short random id for plots, items and channels. */
export const newId = (): string =>
  `${Date.now().toString(36)}${(seq++ % 1296).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const str = (v: unknown, max: number = LIMITS.text): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num01 = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
};
const metres = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 && n <= 100 ? Math.round(n * 10) / 10 : null;
};
const KINDS: PlotItemKind[] = ['player', 'wedge', 'speaker', 'di'];

const asItem = (v: unknown): PlotItem | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const kind = KINDS.includes(o.kind as PlotItemKind) ? (o.kind as PlotItemKind) : 'player';
  return {
    id: str(o.id, 40) || newId(),
    kind,
    code: str(o.code, 3).toUpperCase() || undefined,
    label: str(o.label, 40) || undefined,
    x: num01(o.x, 0.5),
    y: num01(o.y, 0.5),
    lead: o.lead === true || undefined,
    instrument: kind === 'player' ? str(o.instrument, 20).toLowerCase() || undefined : undefined,
  };
};

const asPlot = (v: unknown): StagePlot | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const items = Array.isArray(o.items) ? o.items.map(asItem).filter((i): i is PlotItem => !!i).slice(0, LIMITS.items) : [];
  return {
    id: str(o.id, 40) || newId(),
    name: str(o.name, 30) || 'Full band',
    widthM: metres(o.width_m ?? o.widthM),
    depthM: metres(o.depth_m ?? o.depthM),
    items,
  };
};

const asInput = (v: unknown): InputChannel | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const source = str(o.source, 40);
  const mic = str(o.mic, 30);
  if (!source && !mic) return null;
  const kind: InputKind = o.kind === 'di' || /^di\b/i.test(mic) ? 'di' : 'mic';
  const itemId = str(o.itemId ?? o.item_id, 40);
  const auto = str(o.auto, 24);
  return { id: str(o.id, 40) || newId(), source, mic, kind, who: str(o.who, 30), ...(itemId ? { itemId } : {}), ...(auto ? { auto } : {}) };
};

const asLines = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, LIMITS.lines) : [];

/** A row from event_stage (or the rider page's `stage`), sanitised. */
export function asStageData(row: Partial<StageRow> | null | undefined): StageData {
  if (!row) return { ...EMPTY_STAGE };
  return {
    plots: Array.isArray(row.plots) ? row.plots.map(asPlot).filter((p): p is StagePlot => !!p).slice(0, LIMITS.plots) : [],
    inputs: Array.isArray(row.inputs) ? row.inputs.map(asInput).filter((i): i is InputChannel => !!i).slice(0, LIMITS.inputs) : [],
    mixer: str(row.mixer, 60),
    bandBrings: asLines(row.band_brings),
    venueProvides: asLines(row.venue_provides),
    venueAgreed: row.venue_agreed === true,
  };
}

/** What gets written to event_stage. */
export function toStageRow(d: StageData): StageRow {
  const clean = asStageData({
    plots: d.plots.map((p) => ({ ...p, width_m: p.widthM, depth_m: p.depthM })),
    inputs: d.inputs,
    mixer: d.mixer,
    band_brings: d.bandBrings,
    venue_provides: d.venueProvides,
    venue_agreed: d.venueAgreed,
  });
  return {
    plots: clean.plots.map((p) => ({
      id: p.id,
      name: p.name,
      width_m: p.widthM ?? null,
      depth_m: p.depthM ?? null,
      items: p.items.map((i) => ({
        id: i.id,
        kind: i.kind,
        ...(i.code ? { code: i.code } : {}),
        ...(i.label ? { label: i.label } : {}),
        x: Math.round(i.x * 1000) / 1000,
        y: Math.round(i.y * 1000) / 1000,
        ...(i.lead ? { lead: true } : {}),
        ...(i.instrument ? { instrument: i.instrument } : {}),
      })),
    })),
    inputs: clean.inputs.map((c) => ({
      id: c.id,
      source: c.source,
      mic: c.mic,
      kind: c.kind,
      who: c.who,
      ...(c.itemId ? { itemId: c.itemId } : {}),
      ...(c.auto ? { auto: c.auto } : {}),
    })),
    mixer: clean.mixer || null,
    band_brings: clean.bandBrings,
    venue_provides: clean.venueProvides,
    venue_agreed: clean.venueAgreed,
  };
}

/** True when nothing has been filled in. */
export const isStageEmpty = (d: StageData): boolean =>
  d.plots.every((p) => p.items.length === 0) && d.inputs.length === 0 && d.bandBrings.length === 0 && d.venueProvides.length === 0;

/** "01", "02"… */
export const channelLabel = (index: number): string => String(index + 1).padStart(2, '0');

/** Players on a plot. */
export const playersOf = (plot: StagePlot | undefined): PlotItem[] => (plot?.items ?? []).filter((i) => i.kind === 'player');

/** "6 × 4 m" or ''. */
export const stageSize = (plot: StagePlot | undefined): string =>
  plot?.widthM && plot?.depthM ? `${fmtM(plot.widthM)} × ${fmtM(plot.depthM)} m` : '';
const fmtM = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Moves an item to a new spot, kept inside the stage. */
export function moveItem(plot: StagePlot, itemId: string, x: number, y: number): StagePlot {
  return {
    ...plot,
    items: plot.items.map((i) => (i.id === itemId ? { ...i, x: num01(x, i.x), y: num01(y, i.y) } : i)),
  };
}

/** Moves a channel from one position to another. */
export function moveInput(list: InputChannel[], from: number, to: number): InputChannel[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

// ------------------------------------------------------- starter from lineup --

type Tr = (english: string, vars?: Record<string, string | number>) => string;
const plain: Tr = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : s);

/** Two-letter code for an instrument key. */
export function instrumentCode(key: string | null | undefined): string {
  switch (key) {
    case 'drums': return 'DR';
    case 'percussion': return 'PC';
    case 'bass':
    case 'double-bass': return 'BS';
    case 'guitar': return 'GT';
    case 'keys': return 'KY';
    case 'vocals': return 'VX';
    case 'sax': return 'SX';
    case 'trumpet': return 'TP';
    case 'trombone': return 'TB';
    case 'violin': return 'VN';
    case 'cello': return 'VC';
    case 'dj': return 'DJ';
    default: return (key || '?').replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase() || '?';
  }
}

export interface LineupPlayer {
  /** "Marta C." */
  name: string;
  /** Free text: "Guitar / Backing vocals", "Keys · Band leader". */
  instrument?: string | null;
}

/** First name, for the WHO column. */
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * A first plot and input list from the gig's lineup (admins see it as a
 * suggestion until they save it). Positions follow the usual small-band
 * layout: drums centre back, bass and guitar amps either side, keys, lead
 * vocal and a second guitar in front, wedges at the front edge.
 */
export function starterStage(lineup: LineupPlayer[], t: Tr = plain): StageData {
  const back: { x: number; y: number }[] = [
    { x: 0.25, y: 0.3 },
    { x: 0.75, y: 0.3 },
    { x: 0.12, y: 0.32 },
    { x: 0.88, y: 0.32 },
  ];
  const front: { x: number; y: number }[] = [
    { x: 0.5, y: 0.66 },
    { x: 0.2, y: 0.66 },
    { x: 0.8, y: 0.66 },
    { x: 0.35, y: 0.7 },
    { x: 0.65, y: 0.7 },
  ];
  const items: PlotItem[] = [];
  // Channels in the usual desk order: drums, bass, guitars, keys, others, vocals.
  const inputs: { c: InputChannel; group: number }[] = [];
  let group = 4;
  // Channels made for the player being placed (linked to its circle).
  let itemId = '';
  const ch = (source: string, mic: string, who: string, kind: InputKind = /^di\b/i.test(mic) ? 'di' : 'mic') =>
    inputs.push({ c: { id: newId(), source, mic, kind, who, itemId }, group });

  // Lead vocal first in front, the drummer centre back, then the rest.
  const players = lineup.map((p) => ({ ...p, keys: instrumentKeys(p.instrument) }));
  const order = [...players].sort((a, b) => rank(a.keys[0]) - rank(b.keys[0]));
  let leadTaken = false;
  let guitars = 0;
  for (const p of order) {
    const key = p.keys[0] ?? '';
    const who = firstName(p.name);
    const sings = p.keys.includes('vocals');
    let spot: { x: number; y: number } | undefined;
    let label = '';
    let lead = false;
    itemId = newId();
    group = key === 'drums' ? 0 : key === 'bass' || key === 'double-bass' ? 1 : key === 'guitar' ? 2 : key === 'keys' ? 3 : 4;
    if (key === 'drums') {
      spot = { x: 0.5, y: 0.2 };
      label = t('Drums · riser');
      ch(t('Kick'), 'Beta 52', who);
      ch(t('Snare'), 'SM57', who);
      ch(t('OH L'), 'C414', who);
      ch(t('OH R'), 'C414', who);
    } else if (key === 'bass' || key === 'double-bass') {
      spot = back.shift();
      label = t('Bass amp');
      ch(t('Bass'), 'DI', who);
    } else if (key === 'guitar') {
      guitars += 1;
      spot = guitars === 1 ? back.shift() : front.pop();
      label = guitars === 1 ? t('Guitar amp') : t('Gtr / bvx');
      ch(guitars === 1 ? t('Guitar') : t('Guitar 2'), 'SM57', who);
    } else if (key === 'keys') {
      spot = front.splice(1, 1)[0] ?? front.shift();
      label = t('Keys');
      ch(t('Keys L'), 'DI', who);
      ch(t('Keys R'), 'DI', who);
    } else if (key === 'vocals' && !leadTaken) {
      leadTaken = true;
      lead = true;
      spot = front.shift();
      label = t('Lead vox');
    } else {
      spot = front.shift() ?? back.shift();
      label = p.instrument ? p.instrument.split(/[·/,]/)[0].trim() : '';
      if (key && key !== 'vocals') ch(label || key, key === 'dj' ? 'DI' : 'SM57', who);
    }
    items.push({ id: itemId, kind: 'player', code: instrumentCode(key), label: label || undefined, x: spot?.x ?? 0.5, y: spot?.y ?? 0.5, ...(lead ? { lead: true } : {}), ...(key ? { instrument: key } : {}) });
    if (sings) {
      group = lead ? 5 : 6;
      if (lead) ch(t('Lead vox'), 'Beta 58', who);
      else ch(t('Bvx {n}', { n: inputs.filter((x) => x.group === 6).length + 1 }), 'SM58', who);
    }
  }
  // A wedge in front of every player in the front row, a speaker each side.
  for (const p of items.filter((i) => i.kind === 'player' && i.y >= 0.5)) {
    items.push({ id: newId(), kind: 'wedge', x: p.x, y: Math.min(1, p.y + 0.24) });
  }
  if (items.length > 0) {
    items.push({ id: newId(), kind: 'speaker', x: 0.03, y: 0.8 });
    items.push({ id: newId(), kind: 'speaker', x: 0.97, y: 0.8 });
  }
  // Remembers the lineup it was built from (lineupInputsOffer).
  const key = lineupKey(lineup);
  const list = inputs.sort((a, b) => a.group - b.group).map((x) => x.c);
  return {
    ...EMPTY_STAGE,
    plots: items.length > 0 ? [{ id: newId(), name: t('Full band'), widthM: 6, depthM: 4, items }] : [],
    inputs: list.map((c, i) => ({ ...c, auto: `${key}:${i}/${list.length}` })),
  };
}

/**
 * Short fingerprint of who plays what on the lineup (first names and
 * instruments, in any order). The input list built from a lineup keeps it,
 * so a later change of the lineup can be noticed.
 */
export function lineupKey(lineup: LineupPlayer[]): string {
  const parts = lineup.map((p) => `${firstName(p.name).toLowerCase()}=${instrumentKeys(p.instrument).join('+')}`).sort();
  let h = 0x811c9dc5;
  for (const ch of parts.join(',')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * The input list made from the lineup's instruments (the channels of the
 * starter stage, in desk order), linked to the players of `plot` that have
 * the same instrument, so removing one from the plot still removes them.
 */
export function inputsFromLineup(lineup: LineupPlayer[], t: Tr = plain, plot?: StagePlot): InputChannel[] {
  const starter = starterStage(lineup, t);
  const made = new Map((starter.plots[0]?.items ?? []).map((i) => [i.id, i] as const));
  const free = playersOf(plot).filter((p) => p.instrument);
  const relink = new Map<string, string | undefined>();
  return starter.inputs.map(({ itemId, ...c }) => {
    if (!itemId) return c;
    if (!relink.has(itemId)) {
      const inst = made.get(itemId)?.instrument;
      const at = inst ? free.findIndex((p) => p.instrument === inst) : -1;
      relink.set(itemId, at >= 0 ? free.splice(at, 1)[0].id : undefined);
    }
    const id = relink.get(itemId);
    return id ? { ...c, itemId: id } : c;
  });
}

const autoParts = (c: InputChannel) => {
  const m = /^(\w+):(?:(\d+)\/(\d+)|-)$/.exec(c.auto ?? '');
  return m ? { key: m[1], index: m[2] != null ? Number(m[2]) : -1, count: m[3] != null ? Number(m[3]) : -1 } : null;
};

/**
 * True when the list is not exactly the one built from a lineup: a channel
 * was edited, added, removed or moved by hand (or the list predates the
 * lineup fingerprint). An empty list has nothing to lose.
 */
export function inputsEditedByHand(inputs: InputChannel[]): boolean {
  if (inputs.length === 0) return false;
  const first = autoParts(inputs[0]);
  return !inputs.every((c, i) => {
    const a = autoParts(c);
    return !!a && !!first && a.key === first.key && a.index === i && a.count === inputs.length;
  });
}

/** A channel the user changed: it no longer counts as built from the lineup. */
export const handEdited = (c: InputChannel): InputChannel => {
  if (!c.auto) return c;
  const { auto: _auto, ...rest } = c;
  return rest;
};

/**
 * What the input list can offer from the lineup:
 * - `build`: the list is empty and the lineup has instruments with channels;
 * - `update`: the list was built from an earlier lineup and differs from the
 *   current one (`edited`: hand edits would be replaced, so ask first);
 * - `none`: nothing to offer (already the lineup's list, kept on purpose,
 *   or no way to tell).
 */
export function lineupInputsOffer(
  inputs: InputChannel[],
  lineup: LineupPlayer[],
  t: Tr = plain,
): { kind: 'none' | 'build' | 'update'; edited: boolean } {
  const edited = inputsEditedByHand(inputs);
  const fresh = starterStage(lineup, t).inputs;
  if (fresh.length === 0) return { kind: 'none', edited };
  if (inputs.length === 0) return { kind: 'build', edited: false };
  const builtFrom = inputs.map(autoParts).find(Boolean)?.key;
  if (!builtFrom || builtFrom === lineupKey(lineup)) return { kind: 'none', edited };
  const same =
    fresh.length === inputs.length &&
    fresh.every((c, i) => c.source === inputs[i].source && c.mic === inputs[i].mic && c.kind === inputs[i].kind && c.who === inputs[i].who);
  return { kind: same ? 'none' : 'update', edited };
}

/** Keeps the list as it is after the lineup changed: no more offers until the lineup changes again. */
export const keepInputs = (inputs: InputChannel[], lineup: LineupPlayer[]): InputChannel[] => {
  const key = lineupKey(lineup);
  return inputs.map((c) => ({ ...c, auto: `${key}:-` }));
};

/** Lead vocal first, then the drummer, then everyone else. */
const rank = (key: string | undefined) =>
  key === 'vocals' ? 0 : key === 'drums' ? 1 : key === 'bass' || key === 'double-bass' ? 2 : key === 'guitar' ? 3 : key === 'keys' ? 4 : 5;

/** A copy of a plot under a new name ("Trio"). */
export function duplicatePlot(plot: StagePlot, name: string): StagePlot {
  return { ...plot, id: newId(), name, items: plot.items.map((i) => ({ ...i, id: newId() })) };
}

// ------------------------------------------------- instrument presets --

/** Instruments offered when adding a musician to the plot (keys of src/lib/instruments.ts). */
export const PLOT_PRESETS = ['vocals', 'guitar', 'bass', 'keys', 'drums', 'percussion', 'sax', 'trumpet'] as const;
export type PlotPreset = (typeof PLOT_PRESETS)[number];

/** Name of a preset in the add menu. */
export function presetName(key: string, t: Tr = plain): string {
  switch (key) {
    case 'vocals': return t('Vocals');
    case 'guitar': return t('Guitar');
    case 'bass': return t('Bass');
    case 'keys': return t('Keys');
    case 'drums': return t('Drums');
    case 'percussion': return t('Percussion');
    case 'sax': return t('Sax');
    case 'trumpet': return t('Trumpet');
    default: return key;
  }
}

/** Where a preset goes when added without a spot (the usual small-band layout). */
const PRESET_SPOT: Record<string, { x: number; y: number }> = {
  drums: { x: 0.5, y: 0.2 },
  bass: { x: 0.25, y: 0.3 },
  guitar: { x: 0.75, y: 0.3 },
  keys: { x: 0.2, y: 0.66 },
  vocals: { x: 0.5, y: 0.66 },
  percussion: { x: 0.8, y: 0.3 },
};

/** A musician circle from a preset: code and caption filled in, both still editable. */
export function presetItem(key: string, t: Tr = plain, at?: { x: number; y: number }): PlotItem {
  const spot = at ?? PRESET_SPOT[key] ?? { x: 0.5, y: 0.5 };
  const label =
    key === 'drums' ? t('Drums · riser') : key === 'bass' ? t('Bass amp') : key === 'guitar' ? t('Guitar amp') : presetName(key, t);
  return { id: newId(), kind: 'player', code: instrumentCode(key), label, x: spot.x, y: spot.y, instrument: key };
}

/** Closer than this (share of the stage width) and two circles overlap. */
const CROWD = 0.12;

/**
 * The nearest spot to `want` that no item already covers: added from the chip
 * row, a sax or a second guitar used to land on the circle already at its
 * usual place. Steps out in rings and stays on the stage; falls back to
 * `want` when the stage is full.
 */
export function freeSpot(
  items: ReadonlyArray<Pick<PlotItem, 'x' | 'y'>>,
  want: { x: number; y: number },
  /**
   * The drawn stage: `ratio` its width / depth (x and y are fractions of
   * each, so a wide stage packs y tighter), `gap` the least distance between
   * centres as a fraction of its width (a circle and a bit, at its size).
   */
  stage: { ratio?: number; gap?: number } = {},
): { x: number; y: number } {
  const ratio = stage.ratio && stage.ratio > 0 ? stage.ratio : 1;
  const gap = Math.max(CROWD, stage.gap ?? 0);
  const clamp = (v: number) => Math.min(0.94, Math.max(0.06, v));
  // Room under a circle for its caption ("Sax"), inside the stage's edge.
  const clampY = (v: number) => Math.min(0.86, Math.max(0.08, v));
  // Distances in stage widths: y is a fraction of the depth (width / ratio).
  const far = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, (ay - by) / ratio);
  const free = (x: number, y: number) => items.every((i) => far(i.x, i.y, x, y) >= gap);
  if (free(want.x, want.y)) return want;
  for (let ring = 1; ring <= 8; ring++) {
    const r = ring * gap;
    const steps = ring * 8;
    for (let k = 0; k < steps; k++) {
      // Sideways first (same row of the stage), then forward and back.
      const a = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * ((2 * Math.PI) / steps);
      const x = clamp(want.x + r * Math.cos(a));
      const y = clampY(want.y + r * ratio * Math.sin(a));
      if (free(x, y)) return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
    }
  }
  return want;
}

/** Desk order: drums, bass, guitars, keys, others, lead vocal, other vocals; DI boxes with the others. */
const deskGroup = (item: PlotItem | undefined): number => {
  const key = item?.instrument;
  if (!item) return 4;
  if (key === 'drums') return 0;
  if (key === 'bass' || key === 'double-bass') return 1;
  if (key === 'guitar') return 2;
  if (key === 'keys') return 3;
  if (key === 'vocals') return item.lead ? 5 : 6;
  return 4;
};

/**
 * The usual channels for an item: a preset musician's instrument, or a DI box.
 * A generic musician (no instrument), a wedge or a speaker has none.
 */
export function channelsForItem(item: PlotItem, t: Tr = plain): InputChannel[] {
  const make = (source: string, mic: string): InputChannel => ({
    id: newId(),
    source,
    mic,
    kind: /^di\b/i.test(mic) ? 'di' : 'mic',
    who: '',
    itemId: item.id,
  });
  if (item.kind === 'di') return [make(item.label || t('DI box'), 'DI')];
  if (item.kind !== 'player') return [];
  switch (item.instrument) {
    case 'drums':
      return [make(t('Kick'), 'Beta 52'), make(t('Snare'), 'SM57'), make(t('OH L'), 'C414'), make(t('OH R'), 'C414')];
    case 'bass':
    case 'double-bass':
      return [make(t('Bass'), 'DI')];
    case 'guitar':
      return [make(t('Guitar'), 'SM57')];
    case 'keys':
      return [make(t('Keys L'), 'DI'), make(t('Keys R'), 'DI')];
    case 'vocals':
      return [item.lead ? make(t('Lead vox'), 'Beta 58') : make(t('Vox'), 'SM58')];
    case 'dj':
      return [make(t('DJ L'), 'DI'), make(t('DJ R'), 'DI')];
    case undefined:
    case '':
      return [];
    default:
      return [make(item.label || presetName(item.instrument, t), 'SM57')];
  }
}

/**
 * The input list after a plot is saved: the channels of items removed from the
 * plot go, items added get their usual channels in desk order, and every other
 * channel stays exactly as edited (so it stays editable by hand).
 */
export function syncInputs(prev: StagePlot | undefined, next: StagePlot, inputs: InputChannel[], t: Tr = plain): InputChannel[] {
  const before = new Set((prev?.items ?? []).map((i) => i.id));
  const now = new Map(next.items.map((i) => [i.id, i] as const));
  const removed = new Set([...before].filter((id) => !now.has(id)));
  let list = inputs.filter((c) => !c.itemId || !removed.has(c.itemId));
  const added = next.items.filter((i) => !before.has(i.id));
  const linked = new Set(list.map((c) => c.itemId).filter(Boolean));
  for (const item of added) {
    if (linked.has(item.id)) continue;
    const channels = channelsForItem(item, t);
    if (!channels.length) continue;
    const g = deskGroup(item);
    // Before the first channel of a later group (of this plot), else at the end.
    const at = list.findIndex((c) => c.itemId && now.has(c.itemId) && deskGroup(now.get(c.itemId)) > g);
    list = at < 0 ? [...list, ...channels] : [...list.slice(0, at), ...channels, ...list.slice(at)];
  }
  return list.slice(0, LIMITS.inputs);
}
