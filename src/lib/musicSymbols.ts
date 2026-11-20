/**
 * Music symbols: ONE registry for every marker a chord chart can hold.
 *
 * Charts come from iReal Pro links (src/lib/ireal.ts), MusicXML files
 * (src/lib/musicxml.ts) and the chord editor. Their raw markers ("%", "x",
 * "{", "N1", "S", "Q", "<D.C. al Coda>", "n", "p", "f", "*A", "T44"…) are
 * read here into semantic symbols, and every chart view draws a symbol with
 * the same icon (src/app/components/ui/MusicSymbol.tsx) and the same
 * accessible name, translated in every app language. Nothing raw reaches
 * the screen.
 *
 * Pure: no React, no DOM.
 */

export type MusicSymbolId =
  // Bar lines
  | 'barline'
  | 'double-bar'
  | 'final-bar'
  | 'repeat-start'
  | 'repeat-end'
  // Repeats inside a bar
  | 'repeat-bar'
  | 'repeat-two-bars'
  | 'repeat-times'
  // Endings and road map
  | 'ending'
  | 'segno'
  | 'coda'
  | 'dc'
  | 'dc-al-coda'
  | 'dc-al-fine'
  | 'dc-al-ending'
  | 'ds'
  | 'ds-al-coda'
  | 'ds-al-fine'
  | 'ds-al-ending'
  | 'to-coda'
  | 'fine'
  | 'end'
  | 'on-cue'
  // In the bar
  | 'fermata'
  | 'no-chord'
  | 'slash'
  | 'break'
  | 'section'
  | 'time-signature'
  | 'alternate-chord'
  // Layout only: read, never drawn
  | 'chord-size'
  | 'spacer'
  | 'separator'
  | 'comment';

/** How a symbol shows: its own icon, a short text in the chart's type, or nothing (layout hints). */
export type SymbolRender = 'icon' | 'text' | 'hidden';

export interface MusicSymbolDef {
  id: MusicSymbolId;
  /**
   * English accessible name, the i18n key (src/lib/i18n). May hold `{n}`
   * (ending number, repeat count) or `{name}` (section, time signature).
   */
  name: string;
  render: SymbolRender;
  /** Short text drawn in the chart when `render` is 'text' ("D.C. al Coda", "N.C."). */
  text?: string;
}

const DEFS: MusicSymbolDef[] = [
  { id: 'barline', name: 'Bar line', render: 'hidden' },
  { id: 'double-bar', name: 'Double bar line', render: 'icon' },
  { id: 'final-bar', name: 'Final bar line', render: 'icon' },
  { id: 'repeat-start', name: 'Repeat start', render: 'icon' },
  { id: 'repeat-end', name: 'Repeat end', render: 'icon' },
  { id: 'repeat-bar', name: 'Repeat the previous bar', render: 'icon' },
  { id: 'repeat-two-bars', name: 'Repeat the previous two bars', render: 'icon' },
  { id: 'repeat-times', name: 'Play {n} times', render: 'text' },
  { id: 'ending', name: 'Ending {n}', render: 'icon' },
  { id: 'segno', name: 'Segno', render: 'icon' },
  { id: 'coda', name: 'Coda', render: 'icon' },
  { id: 'dc', name: 'Da capo: back to the start', render: 'text', text: 'D.C.' },
  { id: 'dc-al-coda', name: 'Da capo al coda: back to the start, then jump to the coda', render: 'text', text: 'D.C. al Coda' },
  { id: 'dc-al-fine', name: 'Da capo al fine: back to the start, play to Fine', render: 'text', text: 'D.C. al Fine' },
  { id: 'dc-al-ending', name: 'Da capo to ending {n}: back to the start, play to ending {n}', render: 'text', text: 'D.C. al {n}.' },
  { id: 'ds', name: 'Dal segno: back to the segno', render: 'text', text: 'D.S.' },
  { id: 'ds-al-coda', name: 'Dal segno al coda: back to the segno, then jump to the coda', render: 'text', text: 'D.S. al Coda' },
  { id: 'ds-al-fine', name: 'Dal segno al fine: back to the segno, play to Fine', render: 'text', text: 'D.S. al Fine' },
  { id: 'ds-al-ending', name: 'Dal segno to ending {n}: back to the segno, play to ending {n}', render: 'text', text: 'D.S. al {n}.' },
  { id: 'to-coda', name: 'To coda: jump to the coda', render: 'icon' },
  { id: 'fine', name: 'Fine: the song ends here', render: 'text', text: 'Fine' },
  { id: 'end', name: 'End', render: 'text', text: 'End' },
  { id: 'on-cue', name: 'On cue', render: 'text', text: 'on cue' },
  { id: 'fermata', name: 'Fermata: hold', render: 'icon' },
  { id: 'no-chord', name: 'No chord', render: 'text', text: 'N.C.' },
  { id: 'slash', name: 'Same chord, next beat', render: 'icon' },
  { id: 'break', name: 'Break', render: 'text', text: 'Break' },
  { id: 'section', name: 'Section {name}', render: 'icon' },
  { id: 'time-signature', name: 'Time signature {name}', render: 'icon' },
  { id: 'alternate-chord', name: 'Alternate chord', render: 'hidden' },
  { id: 'chord-size', name: 'Chord size', render: 'hidden' },
  { id: 'spacer', name: 'Spacer', render: 'hidden' },
  { id: 'separator', name: 'Separator', render: 'hidden' },
  { id: 'comment', name: 'Note', render: 'text' },
];

export const MUSIC_SYMBOLS: Readonly<Record<MusicSymbolId, MusicSymbolDef>> = Object.fromEntries(
  DEFS.map((d) => [d.id, d]),
) as Record<MusicSymbolId, MusicSymbolDef>;

export const musicSymbol = (id: MusicSymbolId): MusicSymbolDef => MUSIC_SYMBOLS[id];

/** Every symbol shown in the legend (Academy, the chart's Symbols sheet), in reading order. */
export const LEGEND_SYMBOLS: MusicSymbolId[] = [
  'section',
  'time-signature',
  'repeat-start',
  'repeat-end',
  'ending',
  'repeat-bar',
  'repeat-two-bars',
  'repeat-times',
  'segno',
  'coda',
  'to-coda',
  'dc-al-coda',
  'ds-al-coda',
  'dc-al-fine',
  'fine',
  'fermata',
  'no-chord',
  'slash',
  'double-bar',
  'final-bar',
  'end',
];

// ── iReal Pro markers ──────────────────────────────────────────────────────

/**
 * Single-character iReal markers (after `unscrambleMusic` expanded
 * "XyQ", "LZ" and "Kcl"). Multi-character ones (`*A`, `T44`, `N1`, `<…>`,
 * `(…)`) are read by the parser and named in IREAL_PREFIXES.
 */
export const IREAL_MARKERS: Readonly<Record<string, MusicSymbolId>> = {
  '|': 'barline',
  '[': 'double-bar',
  ']': 'double-bar',
  '{': 'repeat-start',
  '}': 'repeat-end',
  Z: 'final-bar',
  S: 'segno',
  Q: 'coda',
  f: 'fermata',
  x: 'repeat-bar',
  r: 'repeat-two-bars',
  n: 'no-chord',
  p: 'slash',
  U: 'end',
  s: 'chord-size',
  l: 'chord-size',
  Y: 'spacer',
  ' ': 'separator',
  ',': 'separator',
};

/** Markers with a value: section mark, time signature, ending, comment, alternate chord. */
export const IREAL_PREFIXES: Readonly<Record<string, MusicSymbolId>> = {
  '*': 'section',
  T: 'time-signature',
  N: 'ending',
  '<': 'comment',
  '(': 'alternate-chord',
};

/** The symbol an iReal marker stands for, or null for anything unknown. */
export const irealMarker = (c: string): MusicSymbolId | null => IREAL_MARKERS[c] ?? IREAL_PREFIXES[c] ?? null;

/** iReal time signature digits ("44", "34", "12", "68") → "4/4", "3/4", "12/8", "6/8". */
export const irealTime = (digits: string): string | null => {
  if (!/^\d\d$/.test(digits)) return null;
  if (digits === '12') return '12/8';
  return `${digits[0]}/${digits[1]}`;
};

// ── Chord tokens that are symbols ──────────────────────────────────────────

/** Tokens a bar's `chords` may hold that are not chords. */
export const CHORD_SYMBOL_TOKENS: Readonly<Record<string, MusicSymbolId>> = {
  '%': 'repeat-bar',
  '%%': 'repeat-two-bars',
  'N.C.': 'no-chord',
  '/': 'slash',
  // Raw iReal letters, if a chart was ever stored with them.
  x: 'repeat-bar',
  r: 'repeat-two-bars',
  n: 'no-chord',
  p: 'slash',
};

/** The symbol a chord token is (repeat, no chord, slash), or null for a real chord. */
export const chordTokenSymbol = (token: string): MusicSymbolId | null => CHORD_SYMBOL_TOKENS[token.trim()] ?? null;

/** True for tokens that are chords to play (not "%", "N.C." or a slash). */
export const isPlayedChord = (token: string): boolean => !chordTokenSymbol(token);

// ── Text written on a bar ──────────────────────────────────────────────────

export interface TextSymbol {
  id: MusicSymbolId;
  /** Ending number or repeat count. */
  n?: number;
  /** For 'comment': the words as written (a player's note, not a marker). */
  text?: string;
}

const ORDINAL = '(\\d)(?:st|nd|rd|th|°|\\.)?';
/** Road-map texts, most specific first. Folded: lower case, single spaces, no dots. */
const TEXT_RULES: { re: RegExp; id: MusicSymbolId; n?: (m: RegExpMatchArray) => number }[] = [
  { re: /^d ?c al coda$/, id: 'dc-al-coda' },
  { re: /^d ?c al fine$/, id: 'dc-al-fine' },
  { re: new RegExp(`^d ?c al ${ORDINAL} ?(?:end|ending|ende|finale|final|fin)?$`), id: 'dc-al-ending', n: (m) => Number(m[1]) },
  { re: /^d ?c on cue$/, id: 'dc' },
  { re: /^(?:d ?c|da capo)$/, id: 'dc' },
  { re: /^d ?s al coda$/, id: 'ds-al-coda' },
  { re: /^d ?s al fine$/, id: 'ds-al-fine' },
  { re: new RegExp(`^d ?s al ${ORDINAL} ?(?:end|ending|ende|finale|final|fin)?$`), id: 'ds-al-ending', n: (m) => Number(m[1]) },
  { re: /^d ?s on cue$/, id: 'ds' },
  { re: /^(?:d ?s|dal segno)$/, id: 'ds' },
  { re: /^(?:to coda|al coda|coda)$/, id: 'to-coda' },
  { re: /^fine$/, id: 'fine' },
  { re: /^(?:end|the end)$/, id: 'end' },
  { re: /^on cue$/, id: 'on-cue' },
  { re: /^(?:break|stop|stop time)$/, id: 'break' },
  { re: /^(?:x ?(\d{1,2})|(\d{1,2}) ?x|(\d{1,2}) times)$/, id: 'repeat-times', n: (m) => Number(m[1] || m[2] || m[3]) },
];

const foldText = (s: string) =>
  s
    .toLowerCase()
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Text on a bar ("D.C. al Coda", "3x", "Fine", "Solo on AABA") → symbols.
 * Several road-map marks in one text ("Fine D.S. al Coda") are each read;
 * anything else stays a comment, drawn as the player wrote it.
 */
export function textSymbols(text: string | undefined | null): TextSymbol[] {
  const raw = (text || '').trim();
  if (!raw) return [];
  const whole = matchText(raw);
  if (whole) return [whole];
  // "Fine D.C. al Coda", "3x D.S. al Fine": split at the start of a mark.
  const parts = raw.split(/\s+(?=(?:D\.?\s?[CS]\.?|Fine\b|\d{1,2}\s?x\b|x\s?\d{1,2}\b|To Coda\b))/i).filter(Boolean);
  if (parts.length > 1) {
    const out = parts.map((p) => matchText(p) ?? { id: 'comment' as const, text: p.trim() });
    if (out.some((o) => o.id !== 'comment')) return out;
  }
  return [{ id: 'comment', text: raw }];
}

function matchText(s: string): TextSymbol | null {
  const f = foldText(s);
  for (const r of TEXT_RULES) {
    const m = f.match(r.re);
    if (m) return r.n ? { id: r.id, n: r.n(m) } : { id: r.id };
  }
  return null;
}

// ── Unknown markers ────────────────────────────────────────────────────────

/**
 * Markers met while parsing that the registry doesn't know. Parsers report
 * them here instead of drawing them; tests read the list (and print it) so
 * a new iReal marker gets a symbol instead of leaking onto the screen.
 */
const unknown = new Map<string, number>();

export function reportUnknownMarker(marker: string): void {
  unknown.set(marker, (unknown.get(marker) ?? 0) + 1);
}

export function unknownMarkers(): ReadonlyMap<string, number> {
  return unknown;
}

export function clearUnknownMarkers(): void {
  unknown.clear();
}
