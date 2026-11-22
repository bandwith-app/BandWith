/**
 * One song format for the band (`songs.lyrics`): Markdown-ish sections
 * (`# Verse 1`, `# Chorus`…) and ChordPro chords attached to the word they
 * fall on (`[Am]word`). This module tidies any text into that format,
 * reads it word by word for the chord editor, and checks it against the
 * song's iReal chart and key. Pure: no React, no network.
 */
import { chordLabel, type ChartSection, type SongChart } from './ireal';
import { isChordToken, parseJsonLyrics, parseLyrics, type LyricsSection } from './lyrics';
import { foldSemitones, parseKey, pitchClass, transposeLyrics, prefersFlats } from './transpose';
import { instrumentKeys } from './instruments';
import { chordTokenSymbol } from './musicSymbols';
import { hasVoiceMarkers, normalizeVoiceLines } from './voiceParts';

// ── Section names ──────────────────────────────────────────────────────────

export type SectionKind =
  | 'intro'
  | 'verse'
  | 'prechorus'
  | 'chorus'
  | 'postchorus'
  | 'bridge'
  | 'solo'
  | 'instrumental'
  | 'interlude'
  | 'outro'
  | 'coda'
  | 'tag';

/** Canonical name written in the text (English: the app translates it on screen). */
const CANONICAL: Record<SectionKind, string> = {
  intro: 'Intro',
  verse: 'Verse',
  prechorus: 'Pre-chorus',
  chorus: 'Chorus',
  postchorus: 'Post-chorus',
  bridge: 'Bridge',
  solo: 'Solo',
  instrumental: 'Instrumental',
  interlude: 'Interlude',
  outro: 'Outro',
  coda: 'Coda',
  tag: 'Tag',
};

/** Words (folded: lowercase, no accents or dots) that mean each kind, in the app's languages. */
const SECTION_ALIASES: Record<SectionKind, string[]> = {
  intro: ['intro', 'introduction', 'introduzione', 'introduccion', 'introducao', 'einleitung', 'einl', 'i'],
  verse: ['verse', 'vs', 'v', 'strofa', 'str', 'strofe', 'strophe', 'couplet', 'cplt', 'verso', 'estrofa', 'vers', 'a'],
  prechorus: [
    'pre chorus', 'prechorus', 'pre ritornello', 'prerit', 'pre rit', 'pre refrain', 'prerefrain', 'pre estribillo', 'pre coro',
    'precoro', 'pre refrao', 'pc', 'pre ch',
  ],
  chorus: ['chorus', 'ch', 'cho', 'rit', 'ritornello', 'rit no', 'ritornelo', 'refrain', 'ref', 'coro', 'estribillo', 'refrao', 'kehrvers', 'b'],
  postchorus: ['post chorus', 'postchorus', 'post ritornello', 'post rit', 'post refrain', 'post coro', 'post estribillo'],
  bridge: ['bridge', 'br', 'brdg', 'ponte', 'puente', 'pont', 'brucke', 'bruecke', 'middle 8', 'middle eight', 'special', 'c'],
  solo: ['solo', 'assolo', 'guitar solo', 'sax solo', 'keys solo', 'piano solo', 'solo chitarra', 'solo de guitarra'],
  instrumental: ['instrumental', 'inst', 'instr', 'strumentale', 'instrumentale', 'instrumentaal'],
  interlude: ['interlude', 'interludio', 'interludium', 'zwischenspiel', 'stacco'],
  outro: ['outro', 'finale', 'final', 'fin', 'ending', 'end', 'schluss', 'cierre', 'fim', 'chiusura'],
  coda: ['coda'],
  tag: ['tag'],
};

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.:_]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const ALIAS_LOOKUP = new Map<string, SectionKind>();
for (const [kind, words] of Object.entries(SECTION_ALIASES) as [SectionKind, string[]][]) {
  for (const w of words) ALIAS_LOOKUP.set(fold(w), kind);
}
/** Single letters (iReal marks A/B/C, "V", "I") are only read as sections in a chart or on their own heading line. */
const LETTERS = new Set(['a', 'b', 'c', 'i', 'v']);

export interface SectionName {
  kind: SectionKind | null;
  /** "Verse 2" → 2. */
  number: number | null;
  /** What follows: "x2", "(soft)". */
  suffix: string;
  /** The name as written, when it isn't a known kind. */
  raw: string;
}

/**
 * "Rit.", "RITORNELLO 2", "Chorus x2", "Strofa 1", "[Pre-Chorus]" → kind,
 * number and suffix. Unknown names keep their text in `raw`.
 */
export function parseSectionName(name: string, opts: { letters?: boolean } = {}): SectionName {
  const raw = name.trim();
  // Repeat marks and notes after the name stay as written.
  const sm = raw.match(/^(.*?)(\s+(?:x\s?\d+|\d+\s?x|\(.*\)|[-–—].*))$/i);
  const head = (sm ? sm[1] : raw).trim();
  const suffix = sm ? sm[2].trim() : '';
  let words = fold(head);
  let number: number | null = null;
  // "Verse 2", "Strofa 2", "V2", "2nd verse", "1° strofa".
  const tail = words.match(/^(.*?)\s*(\d{1,2})$/);
  const lead = words.match(/^(\d{1,2})\s*(?:st|nd|rd|th|a|o|°|ª|º|e|eme|er)?\s+(.*)$/);
  if (tail && tail[1]) {
    number = Number(tail[2]);
    words = tail[1].trim();
  } else if (lead && lead[2]) {
    number = Number(lead[1]);
    words = lead[2].trim();
  }
  let kind = ALIAS_LOOKUP.get(words) ?? null;
  if (kind && LETTERS.has(words) && !opts.letters) kind = null;
  return { kind, number, suffix, raw };
}

/** The canonical heading text: "Verse 2", "Chorus x2", "Pre-chorus"; unknown names unchanged. */
export function canonicalSectionName(name: string): string {
  const p = parseSectionName(name);
  if (!p.kind) return p.raw;
  return [CANONICAL[p.kind] + (p.number != null ? ` ${p.number}` : ''), p.suffix].filter(Boolean).join(' ');
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** A section name for the screen, in the viewer's language ("Verse 2" → "Strofa 2"). */
export function sectionLabel(name: string, t: Translate): string {
  const p = parseSectionName(name);
  if (!p.kind) return p.raw;
  const base = (() => {
    switch (p.kind) {
      case 'intro':
        return t('Intro');
      case 'verse':
        return p.number != null ? t('Verse {n}', { n: p.number }) : t('Verse');
      case 'prechorus':
        return t('Pre-chorus');
      case 'chorus':
        return t('Chorus');
      case 'postchorus':
        return t('Post-chorus');
      case 'bridge':
        return t('Bridge');
      case 'solo':
        return t('Solo');
      case 'instrumental':
        return t('Instrumental');
      case 'interlude':
        return t('Interlude');
      case 'outro':
        return t('Outro');
      case 'coda':
        return t('Coda');
      case 'tag':
        return t('Tag');
    }
  })();
  const numbered = p.kind !== 'verse' && p.number != null ? `${base} ${p.number}` : base;
  return [numbered, p.suffix].filter(Boolean).join(' ');
}

// ── Chords ─────────────────────────────────────────────────────────────────

const BRACKET = /\[([^\]\s]{1,16})\]/g;

/** A line of bare chords, as in "chords over lyrics" sheets: "C   G/B   Am  F". */
export function isBareChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter((x) => x && x !== '|' && x !== '||' && x !== '/' && !/^x\d+$/i.test(x));
  if (tokens.length === 0) return false;
  if (!tokens.every((x) => isChordToken(x.replace(/^\(|\)$/g, '')))) return false;
  // One capital letter alone ("A", "E") reads like a word unless it's spaced like a chord line.
  return tokens.length > 1 || tokens[0].length > 1 || /\s{2,}/.test(line) || /^\s/.test(line);
}

const isHeading = (line: string) => /^\s{0,3}#{1,6}\s+\S/.test(line) || /^\s*\[([^\]]{1,40})\]\s*$/.test(line) && !isChordToken(line.trim().slice(1, -1));

/**
 * "C    G" over "Paper boats on the river" → "[C]Paper boats on the [G]river":
 * each chord goes on the word under it (or the next one).
 */
export function mergeChordLine(chords: string, lyric: string): string {
  const marks: { at: number; chord: string }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chords))) {
    const c = m[0].replace(/^\(|\)$/g, '');
    if (isChordToken(c)) marks.push({ at: m.index, chord: c });
  }
  const words: { start: number; end: number }[] = [];
  const wr = /\S+/g;
  while ((m = wr.exec(lyric))) words.push({ start: m.index, end: m.index + m[0].length });
  const byWord = new Map<number, string[]>();
  const after: string[] = [];
  for (const mk of marks) {
    // A chord over a word belongs to it; over a space, to the next word.
    const wi = words.findIndex((w) => mk.at < w.end);
    if (wi < 0) {
      after.push(mk.chord);
      continue;
    }
    byWord.set(wi, [...(byWord.get(wi) || []), mk.chord]);
  }
  let out = '';
  let last = 0;
  words.forEach((w, i) => {
    out += lyric.slice(last, w.start);
    const cs = byWord.get(i);
    out += (cs ? cs.map((c) => `[${c}]`).join('') : '') + lyric.slice(w.start, w.end);
    last = w.end;
  });
  out += lyric.slice(last);
  if (after.length) out += ` ${after.map((c) => `[${c}]`).join(' ')}`;
  return out.replace(/\s+$/, '');
}

/** "[Am] word" → "[Am]word": a chord before a space belongs to the next word. Chord-only lines stay. */
export function attachChords(line: string): string {
  const words = line.replace(BRACKET, (all, c: string) => (isChordToken(c) ? '' : all)).trim();
  if (!words) return line.replace(/\s+$/, '');
  return line
    .replace(/\[([^\]\s]{1,16})\]\s+(?=[^\s[])/g, (all, c: string) => (isChordToken(c) ? `[${c}]` : all))
    .replace(/\s+$/, '');
}

/** Every chord in the text, in order of first appearance. */
export function songChords(lyrics: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (lyrics || '').matchAll(BRACKET)) {
    if (isChordToken(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** True when the text has inline chords. */
export const hasInlineChords = (lyrics: string | null | undefined) => songChords(lyrics).length > 0;

/**
 * Chords of a section of the chart, bar by bar: '%' repeats the bar before,
 * '%%' the two before; slashes are beats, not chords (src/lib/musicSymbols.ts).
 */
export function chartSectionChords(section: ChartSection): string[][] {
  const out: string[][] = [];
  for (const bar of section.bars) {
    const cs = bar.chords.filter((c) => c && c.trim() && c !== '/' && chordTokenSymbol(c) !== 'slash');
    const sym = cs.length === 1 ? chordTokenSymbol(cs[0]) : null;
    if (sym === 'repeat-bar') out.push([...(out[out.length - 1] || [])]);
    else if (sym === 'repeat-two-bars') {
      const [x, y] = [out[out.length - 2] || [], out[out.length - 1] || []];
      out.push([...x], [...y]);
    } else
      out.push(
        cs
          .filter((c) => chordTokenSymbol(c) !== 'repeat-bar' && chordTokenSymbol(c) !== 'repeat-two-bars')
          .map((c) => (chordTokenSymbol(c) === 'no-chord' ? 'N.C.' : chordLabel(c).replace(/♭/g, 'b').replace(/♯/g, '#'))),
      );
  }
  return out;
}

/** Every chord of the chart, readable ("C^7" → "Cmaj7"), in order. */
export function chartChords(chart: SongChart | null | undefined): string[] {
  const out: string[] = [];
  for (const s of chart?.sections || []) for (const bar of chartSectionChords(s)) for (const c of bar) if (c !== 'N.C.' && !out.includes(c)) out.push(c);
  return out;
}

/** Root + quality, ignoring the bass note and spelling: "Bbmaj7/D" ≡ "A#maj7". */
export function chordIdentity(chord: string): string | null {
  const m = chord.replace(/♭/g, 'b').replace(/♯/g, '#').match(/^([A-G][b#]?)(.*?)(?:\/([A-G][b#]?))?$/);
  if (!m) return null;
  const pc = pitchClass(m[1]);
  if (pc == null) return null;
  let q = m[2];
  q = q.replace(/^-\^7?|^m\(?maj7\)?|^mM7/, 'mM7').replace(/^\^7?|^M7|^maj7|^Δ7?/, 'maj7');
  q = q.replace(/^h7?|^ø7?|^m7b5|^-7b5|^min7b5/, 'm7b5').replace(/^o|^°|^dim/, 'dim');
  q = q.replace(/^-|^min(?!or)|^mi(?!n)/, 'm').replace(/^\+|^aug/, 'aug');
  return `${pc}${q}`;
}

/** Chords in the lyrics that the chart never plays (by root and quality). */
export function chordsMissingFromChart(lyrics: string | null | undefined, chart: SongChart | null | undefined): string[] {
  if (!chart) return [];
  const known = new Set(chartChords(chart).map(chordIdentity).filter(Boolean));
  if (known.size === 0) return [];
  return songChords(lyrics).filter((c) => c !== 'N.C.' && !known.has(chordIdentity(c)));
}

// ── Key ────────────────────────────────────────────────────────────────────

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
/** Diatonic triad quality on each step of a major key: I ii iii IV V vi vii°. */
const MAJOR_QUALITY = ['M', 'm', 'm', 'M', 'M', 'm', 'd'];

const triad = (chord: string): { pc: number; q: 'M' | 'm' | 'd' } | null => {
  const id = chordIdentity(chord);
  if (!id) return null;
  const pc = Number(id.match(/^\d+/)![0]);
  const rest = id.replace(/^\d+/, '');
  const q = /^dim|^m7b5/.test(rest) ? 'd' : /^m(?!aj)/.test(rest) ? 'm' : 'M';
  return { pc, q };
};

export interface KeyGuess {
  /** Tonic pitch class. */
  pc: number;
  minor: boolean;
  /** 0…1: share of chords that fit the key. */
  fit: number;
}

/**
 * The key the chords suggest: the major scale that fits most of them (first
 * and last chord weigh more), minor when the song starts or ends on its vi.
 * Null with fewer than 3 different chords.
 */
export function guessKey(chords: string[]): KeyGuess | null {
  const triads = chords.map(triad).filter(Boolean) as { pc: number; q: 'M' | 'm' | 'd' }[];
  if (new Set(triads.map((x) => `${x.pc}${x.q}`)).size < 3) return null;
  let best: { tonic: number; score: number; fits: number } | null = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    let score = 0;
    let fits = 0;
    triads.forEach((c, i) => {
      const step = MAJOR_STEPS.indexOf((c.pc - tonic + 12) % 12);
      const w = i === 0 || i === triads.length - 1 ? 2 : 1;
      if (step >= 0) {
        fits++;
        score += w * (MAJOR_QUALITY[step] === c.q ? 2 : 1);
      }
      if (c.pc === tonic && c.q === 'M') score += w;
    });
    if (!best || score > best.score) best = { tonic, score, fits };
  }
  if (!best) return null;
  const first = triads[0];
  const last = triads[triads.length - 1];
  const rel = (best.tonic + 9) % 12;
  const minor = (first.pc === rel && first.q === 'm') || (last.pc === rel && last.q === 'm');
  return { pc: minor ? rel : best.tonic, minor, fit: best.fits / triads.length };
}

/** Major-key tonic of a key (relative major for minor keys). */
const majorTonic = (k: { pc: number; minor: boolean }) => (k.minor ? (k.pc + 3) % 12 : k.pc);

export interface KeyCheck {
  /** The key the chords sound in, written like the song's key ("D", "Bm"). */
  found: string;
  /** The key they should be in. */
  expected: string;
  /** Move the chords by this much to fix it (−5…+6). */
  semitones: number;
}

const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const keyName = (pc: number, minor: boolean) => {
  const flats = minor ? [2, 7, 0, 5, 10, 3].includes(pc) : [5, 10, 3, 8, 1, 0].includes(pc);
  return `${(flats ? NAMES_FLAT : NAMES_SHARP)[pc]}${minor ? 'm' : ''}`;
};

/**
 * Do the inline chords agree with the song's key (or, without one, the
 * chart's)? Null when they do, or when it can't be told.
 */
export function checkKey(lyrics: string | null | undefined, songKey: string | null | undefined, chartKey?: string | null): KeyCheck | null {
  const expectedKey = parseKey(songKey) ?? parseKey(chartKey?.replace(/-$/, 'm'));
  if (!expectedKey) return null;
  const guess = guessKey(songChords(lyrics));
  if (!guess || guess.fit < 0.6) return null;
  const shift = foldSemitones(majorTonic(expectedKey) - majorTonic(guess));
  if (shift === 0) return null;
  const minor = expectedKey.minor;
  const foundPc = minor ? (majorTonic(guess) + 9) % 12 : majorTonic(guess);
  return { found: keyName(foundPc, minor), expected: keyName(expectedKey.pc, minor), semitones: shift };
}

/** The lyrics' chords moved to the song's key (the KeyCheck proposal). */
export function applyKeyFix(lyrics: string, fix: KeyCheck): string {
  return transposeLyrics(lyrics, fix.semitones, prefersFlats(fix.expected, 0));
}

// ── Tidy the whole text ────────────────────────────────────────────────────

/**
 * JSON lyrics → the same song as text (`# Section` headings, one line per
 * line), for editors that work line by line: the chord editor placed a chord
 * on the JSON itself (`[C]{"lines":[…]}`) and the reader then showed the JSON
 * (audit 09 #8). Null when `raw` is not JSON lyrics.
 */
export function jsonLyricsAsText(raw: string | null | undefined): string | null {
  const sections = parseJsonLyrics(raw);
  if (!sections) return null;
  return sections
    .map((s) => [...(s.name ? [`# ${s.name}`] : []), ...s.lines.map((l) => l.replace(/\s+$/, ''))].join('\n'))
    .join('\n\n');
}

/**
 * Any lyrics text → the band's format: section headings as `# Name` with
 * normalized names ("Rit." → "Chorus", "[Strofa 2]" → "Verse 2"), repeated
 * unnumbered verses numbered, chord lines over lyrics merged inline, and
 * every chord attached to its word. JSON lyrics and plain lyrics without
 * sections stay as they are apart from chords.
 */
export function normalizeLyrics(raw: string | null | undefined): string {
  const text = (raw || '').replace(/\r\n?/g, '\n');
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (trimmed[0] === '{' || (trimmed[0] === '[' && /^\[\s*[[{"]/.test(trimmed))) {
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      /* not JSON */
    }
  }
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '');
    const h = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/) || (line.match(/^\s*\[([^\]]{1,40})\]\s*$/) as RegExpMatchArray | null);
    if (h && !(line.trim().startsWith('[') && isChordToken(h[1]))) {
      out.push(`# ${canonicalSectionName(h[1])}`);
      continue;
    }
    // "Chorus:" alone on a line is a heading too.
    const colon = line.match(/^\s*([^\s:[\]][^:[\]]{0,30}):\s*$/);
    if (colon && parseSectionName(colon[1]).kind) {
      out.push(`# ${canonicalSectionName(colon[1])}`);
      continue;
    }
    if (isBareChordLine(line)) {
      const next = lines[i + 1];
      if (next !== undefined && next.trim() && !isBareChordLine(next) && !isHeading(next) && !/\[[^\]]+\]/.test(next)) {
        out.push(mergeChordLine(line, next.replace(/\s+$/, '')));
        i++;
      } else {
        out.push(
          line
            .trim()
            .split(/\s+/)
            .map((c) => (isChordToken(c.replace(/^\(|\)$/g, '')) ? `[${c.replace(/^\(|\)$/g, '')}]` : c))
            .join(' '),
        );
      }
      continue;
    }
    out.push(attachChords(line));
  }
  // Number repeated verses ("Verse", "Verse" → "Verse 1", "Verse 2") unless some already have numbers.
  const verseLines = out.map((l, i) => ({ l, i })).filter(({ l }) => /^# /.test(l) && parseSectionName(l.slice(2)).kind === 'verse');
  if (verseLines.length > 1 && verseLines.every(({ l }) => parseSectionName(l.slice(2)).number == null)) {
    verseLines.forEach(({ l, i }, n) => {
      const p = parseSectionName(l.slice(2));
      out[i] = `# ${['Verse ' + (n + 1), p.suffix].filter(Boolean).join(' ')}`;
    });
  }
  // Voice parts (§5): one span per line, opening marker before the word's chord.
  const tidy = hasVoiceMarkers(text) ? normalizeVoiceLines(out) : out;
  return tidy.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Word by word (chord editor) ────────────────────────────────────────────

export interface WordChord {
  /** Offset inside the word (0 = on its first letter). */
  at: number;
  chord: string;
}
/** A voice marker on a word (voiceParts.ts): `tag` 'bv' opens, '/bv' closes; `at` 0…text.length. */
export interface WordMark {
  at: number;
  tag: string;
}
export interface LineWord {
  /** The word as written: no chords, no voice markers. */
  text: string;
  chords: WordChord[];
  /** Whitespace after the word. */
  after: string;
  /** Voice markers on the word (only when the line has some). */
  marks?: WordMark[];
}
export interface LineModel {
  lead: string;
  words: LineWord[];
  /** Chords after the last word (or the whole line when it has no words). */
  tail: string[];
}

/** "[C]Paper boats on the [G]river" → words with their chords. */
const CHORD_OR_VOICE = /\[([^\]\s]{1,16})\]|\{(\/?)(v2|bv|all|sp)\}/gi;

export function parseLine(line: string): LineModel {
  let plain = '';
  const marks: { at: number; chord: string }[] = [];
  const voices: { at: number; tag: string }[] = [];
  let last = 0;
  for (const m of line.matchAll(CHORD_OR_VOICE)) {
    if (m[1] !== undefined && !isChordToken(m[1])) continue;
    plain += line.slice(last, m.index);
    if (m[1] !== undefined) marks.push({ at: plain.length, chord: m[1] });
    else voices.push({ at: plain.length, tag: `${m[2]}${m[3].toLowerCase()}` });
    last = m.index! + m[0].length;
  }
  plain += line.slice(last);
  const lead = plain.match(/^\s*/)![0];
  const words: LineWord[] = [];
  const re = /(\S+)(\s*)/g;
  re.lastIndex = lead.length;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(plain))) {
    if (!m[0]) break;
    starts.push(m.index);
    words.push({ text: m[1], chords: [], after: m[2] });
  }
  const tail: string[] = [];
  for (const mk of marks) {
    let wi = -1;
    for (let k = 0; k < words.length; k++) {
      const end = starts[k] + words[k].text.length;
      if (mk.at < end) {
        wi = k;
        break;
      }
    }
    if (wi < 0) {
      tail.push(mk.chord);
      continue;
    }
    const at = Math.max(0, mk.at - starts[wi]);
    words[wi].chords.push({ at, chord: mk.chord });
  }
  // Voice markers: an opening one goes on the word it starts (or the next),
  // a closing one on the word it ends (or the one before). Others are dropped.
  for (const v of voices) {
    let wi = -1;
    if (v.tag.startsWith('/')) {
      for (let k = words.length - 1; k >= 0; k--) if (starts[k] < v.at) {
        wi = k;
        break;
      }
    } else {
      wi = words.findIndex((w, k) => v.at < starts[k] + w.text.length);
    }
    if (wi < 0) continue;
    const at = Math.min(words[wi].text.length, Math.max(0, v.at - starts[wi]));
    (words[wi].marks ??= []).push({ at, tag: v.tag });
  }
  return { lead, words, tail };
}

/** Words with their chords → the line's text. */
export function serializeLine(model: LineModel): string {
  let out = model.lead;
  model.words.forEach((w) => {
    // At one offset: closing markers, then opening ones, then chords ("{/v2}{bv}[Am]ooh").
    const rank = (x: { tag?: string }) => (x.tag === undefined ? 2 : x.tag.startsWith('/') ? 0 : 1);
    const events = [
      ...(w.marks ?? []).map((m) => ({ at: Math.min(m.at, w.text.length), text: `{${m.tag}}`, tag: m.tag })),
      ...w.chords.map((c) => ({ at: Math.min(c.at, w.text.length), text: `[${c.chord}]`, tag: undefined })),
    ].sort((a, b) => a.at - b.at || rank(a) - rank(b));
    let s = '';
    let last = 0;
    for (const e of events) {
      s += w.text.slice(last, e.at) + e.text;
      last = e.at;
    }
    out += s + w.text.slice(last) + w.after;
  });
  if (model.tail.length) out = `${out.replace(/\s+$/, '')}${model.words.length ? ' ' : ''}${model.tail.map((c) => `[${c}]`).join(' ')}`;
  return out.replace(/\s+$/, '');
}

/** One chord on one word (replacing the ones it had); null removes them. */
export function setWordChord(line: string, wordIndex: number, chord: string | null): string {
  const model = parseLine(line);
  if (wordIndex < 0) {
    model.tail = chord ? [...model.tail, chord] : [];
    return serializeLine(model);
  }
  const w = model.words[wordIndex];
  if (!w) return line;
  w.chords = chord ? [{ at: 0, chord }] : [];
  return serializeLine(model);
}

/** The chord a word starts with (the first one on it). */
export const wordChord = (w: LineWord): string | null => w.chords[0]?.chord ?? null;

// ── Sections of the text (for copying and proposing chords) ────────────────

export interface TextSection {
  /** Heading as written (null before the first one). */
  name: string | null;
  /** Line index of the heading in the text (−1 when none). */
  heading: number;
  /** Line indexes of the section's lines (blank lines excluded). */
  lines: number[];
}

/** Where each section of the text starts and which lines belong to it. */
export function textSections(lyrics: string): TextSection[] {
  const lines = (lyrics || '').split('\n');
  const out: TextSection[] = [];
  let cur: TextSection = { name: null, heading: -1, lines: [] };
  lines.forEach((line, i) => {
    const h = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/) || line.match(/^\s*\[([^\]]{1,40})\]\s*$/);
    if (h && !isChordToken(h[1])) {
      if (cur.name != null || cur.lines.length) out.push(cur);
      cur = { name: h[1].trim(), heading: i, lines: [] };
    } else if (line.trim()) {
      cur.lines.push(i);
    }
  });
  if (cur.name != null || cur.lines.length) out.push(cur);
  return out;
}

/**
 * The chords of one section laid on another, line by line and word by word
 * (verse 1 → verse 2). Extra chords of a longer line go on the last word.
 */
export function copySectionChords(lyrics: string, from: TextSection, to: TextSection): string {
  const lines = lyrics.split('\n');
  to.lines.forEach((li, k) => {
    const src = from.lines[k];
    const target = parseLine(lines[li]);
    target.words.forEach((w) => (w.chords = []));
    target.tail = [];
    if (src != null) {
      const source = parseLine(lines[src]);
      source.words.forEach((w, wi) => {
        if (!w.chords.length) return;
        const dest = target.words[Math.min(wi, target.words.length - 1)];
        if (dest) dest.chords = [...dest.chords, ...w.chords.map((c) => ({ at: Math.min(c.at, dest.text.length), chord: c.chord }))];
        else target.tail.push(...w.chords.map((c) => c.chord));
      });
      target.tail.push(...source.tail);
    }
    lines[li] = serializeLine(target);
  });
  return lines.join('\n');
}

/**
 * The chart section that matches a section of the lyrics: same name
 * (Verse ↔ Verse), else iReal letters (verse ↔ A, chorus ↔ B, bridge ↔ C).
 */
export function matchChartSection(chart: SongChart | null | undefined, sectionName: string | null): ChartSection | null {
  if (!chart?.sections.length || !sectionName) return null;
  const want = parseSectionName(sectionName).kind;
  if (!want) return null;
  const withChords = chart.sections.filter((s) => s.bars.some((b) => b.chords.length));
  const named = withChords.find((s) => s.label && parseSectionName(s.label, { letters: false }).kind === want);
  if (named) return named;
  const letter = withChords.find((s) => s.label && s.label.length === 1 && parseSectionName(s.label, { letters: true }).kind === want);
  return letter ?? null;
}

/**
 * A section's chords proposed from the chart: its bars spread over the
 * section's lines, each bar's chords on evenly spaced words.
 */
export function proposeChordsFromChart(lyrics: string, section: TextSection, chartSection: ChartSection): string {
  const bars = chartSectionChords(chartSection).filter((b) => b.length);
  const lines = lyrics.split('\n');
  const n = section.lines.length;
  if (!n || !bars.length) return lyrics;
  section.lines.forEach((li, k) => {
    const from = Math.floor((k * bars.length) / n);
    const to = Math.max(from + 1, Math.floor(((k + 1) * bars.length) / n));
    const chords = bars.slice(from, to).flat().filter((c) => c !== 'N.C.');
    const model = parseLine(lines[li]);
    model.words.forEach((w) => (w.chords = []));
    model.tail = [];
    const count = model.words.length;
    if (!count) {
      model.tail = chords;
    } else {
      chords.forEach((c, j) => {
        const wi = Math.min(count - 1, Math.floor((j * count) / chords.length));
        const w = model.words[wi];
        if (w.chords.length) model.tail.push(c);
        else w.chords = [{ at: 0, chord: c }];
      });
    }
    lines[li] = serializeLine(model);
  });
  return lines.join('\n');
}

// ── Views ──────────────────────────────────────────────────────────────────

/** Lyrics only · lyrics with chords · score / structure. */
export type SongView = 'lyrics' | 'chords' | 'structure';
export const SONG_VIEWS: SongView[] = ['lyrics', 'chords', 'structure'];

/**
 * The view a member starts on, from their instrument: singers read the
 * lyrics, guitar / keys / bass the chords, drums and horns the structure.
 */
export function defaultSongView(instrument: string | null | undefined): SongView {
  const keys = instrumentKeys(instrument);
  if (keys.some((k) => ['guitar', 'keys', 'bass', 'double-bass'].includes(k))) return 'chords';
  if (keys[0] === 'vocals') return 'lyrics';
  if (keys.some((k) => ['drums', 'percussion', 'sax', 'trumpet', 'trombone', 'violin', 'cello', 'dj'].includes(k))) return 'structure';
  return 'chords';
}

export interface SongContent {
  lyrics?: string | null;
  chart?: SongChart | null;
}

/** Which views a song can show. */
export function availableViews(song: SongContent): SongView[] {
  const words = (song.lyrics || '').trim().length > 0;
  const inline = hasInlineChords(song.lyrics);
  const sectionsWithChords = parseLyrics(song.lyrics).some((s) => s.lines.some((l) => /\[[A-G]/.test(l)));
  return [
    ...(words ? (['lyrics'] as const) : []),
    ...(inline || song.chart ? (['chords'] as const) : []),
    ...(song.chart || sectionsWithChords ? (['structure'] as const) : []),
  ];
}

/** The wanted view, or the nearest one this song has. */
export function resolveView(want: SongView, song: SongContent): SongView | null {
  const views = availableViews(song);
  if (views.includes(want)) return want;
  const order: Record<SongView, SongView[]> = {
    lyrics: ['chords', 'structure'],
    chords: ['structure', 'lyrics'],
    structure: ['chords', 'lyrics'],
  };
  return order[want].find((v) => views.includes(v)) ?? null;
}

/** Each section's chords in order (repeats in a row collapsed), for the structure view. */
export function sectionProgressions(lyrics: string | null | undefined): { name: string | null; chords: string[] }[] {
  return parseLyrics(lyrics)
    .map((s: LyricsSection) => {
      const chords: string[] = [];
      for (const line of s.lines) {
        for (const m of line.matchAll(BRACKET)) {
          if (isChordToken(m[1]) && chords[chords.length - 1] !== m[1]) chords.push(m[1]);
        }
      }
      return { name: s.name, chords };
    })
    .filter((s) => s.name || s.chords.length);
}
