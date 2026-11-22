/**
 * Voice parts in the lyrics (plan "live offline & tempo" §5): who sings a
 * line or a few words, kept inside `songs.lyrics` as light markers around
 * the words. Lead has no marker:
 *
 *   {v2}…{/v2}   second voice        {all}…{/all}   everyone together
 *   {bv}…{/bv}   backing vocals      {sp}…{/sp}     spoken
 *
 * Markers are line-scoped: an unclosed one ends with its line, a stray close
 * is dropped, a new one closes the one before (no nesting). normalizeLyrics
 * turns a part written across lines into one span per line, so every line
 * stands on its own (notes, timing, the editor).
 *
 * Every place that finds a line by its text (personal notes, rehearsal note
 * lines, line timing, exports) must use the text WITHOUT markers:
 * stripVoiceMarkers / lyricsLineText. Pure: no React, no network.
 */
import { isChordToken } from './lyrics';
import { parseLine, serializeLine, type WordMark } from './songFormat';

export type VoiceTag = 'v2' | 'bv' | 'all' | 'sp';
export type VoicePart = 'lead' | VoiceTag;

/** Parts in the order they are listed (legend, picker). */
export const VOICE_PARTS: readonly VoicePart[] = ['lead', 'v2', 'bv', 'all', 'sp'];
export const VOICE_TAGS: readonly VoiceTag[] = ['v2', 'bv', 'all', 'sp'];
export const isVoiceTag = (v: unknown): v is VoiceTag => typeof v === 'string' && (VOICE_TAGS as readonly string[]).includes(v);

/** One marker: `{bv}`, `{/bv}` (any case). */
export const VOICE_MARKER = /\{(\/?)(v2|bv|all|sp)\}/gi;
const marker = () => new RegExp(VOICE_MARKER.source, 'gi');

/** The text with every voice marker removed (chords and other braces stay). */
export const stripVoiceMarkers = (s: string | null | undefined): string => (s || '').replace(marker(), '');

/** True when the text has at least one voice marker. */
export const hasVoiceMarkers = (s: string | null | undefined): boolean => marker().test(s || '');

export interface VoiceRun {
  voice: VoicePart;
  /** The run's text, chords (`[Am]`) kept, markers removed. */
  text: string;
}

/** A line split by part: `[C]Paper {bv}(ooh){/bv}` → lead "[C]Paper ", bv "(ooh)". */
export function voiceRuns(line: string): VoiceRun[] {
  const out: VoiceRun[] = [];
  let voice: VoicePart = 'lead';
  const push = (text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.voice === voice) last.text += text;
    else out.push({ voice, text });
  };
  let last = 0;
  for (const m of line.matchAll(marker())) {
    push(line.slice(last, m.index));
    last = m.index! + m[0].length;
    const tag = m[2].toLowerCase() as VoiceTag;
    if (!m[1]) voice = tag;
    else if (voice === tag) voice = 'lead';
  }
  push(line.slice(last));
  return out;
}

const BRACKET = /\[([^\]\s]{1,16})\]/g;
/** Words of a run: chords and spaces removed. */
const hasWords = (text: string) => text.replace(BRACKET, (all, c: string) => (isChordToken(c) ? '' : all)).trim().length > 0;

/** The part of a whole line, or 'mixed' when words of different parts share it. */
export function lineVoice(line: string): VoicePart | 'mixed' {
  const parts = new Set(voiceRuns(line).filter((r) => hasWords(r.text)).map((r) => r.voice));
  if (parts.size === 0) return 'lead';
  return parts.size === 1 ? [...parts][0] : 'mixed';
}

const HEADING = /^\s{0,3}#{1,6}\s+\S/;
const BRACKET_HEADING = /^\s*\[([^\]]{1,40})\]\s*$/;
const isHeadingLine = (line: string) => HEADING.test(line) || (BRACKET_HEADING.test(line) && !isChordToken(line.trim().slice(1, -1)));

/** The parts a song uses, in order; empty when everything is lead (no legend then). */
export function songVoiceParts(lyrics: string | null | undefined): VoicePart[] {
  if (!hasVoiceMarkers(lyrics)) return [];
  const found = new Set<VoicePart>();
  for (const line of (lyrics || '').split('\n')) {
    if (!line.trim() || isHeadingLine(line)) continue;
    for (const r of voiceRuns(line)) if (hasWords(r.text)) found.add(r.voice);
  }
  if (![...found].some((p) => p !== 'lead')) return [];
  return VOICE_PARTS.filter((p) => found.has(p));
}

const OPEN_RE = '\\{(?:v2|bv|all|sp)\\}';
const CLOSE_RE = '\\{\\/(?:v2|bv|all|sp)\\}';

/** One line's markers in the band's form (lower case, balanced, opening before the word's chord). */
function tidyLine(line: string, carry: VoiceTag | null): { line: string; open: VoiceTag | null } {
  const lead = line.match(/^\s*/)![0];
  const source = (carry ? `${lead}{${carry}}${line.slice(lead.length)}` : line).replace(/\s+$/, '');
  let out = '';
  let open: VoiceTag | null = null;
  let last = 0;
  for (const m of source.matchAll(marker())) {
    out += source.slice(last, m.index);
    last = m.index! + m[0].length;
    const tag = m[2].toLowerCase() as VoiceTag;
    if (!m[1]) {
      if (open === tag) continue;
      if (open) out += `{/${open}}`;
      out += `{${tag}}`;
      open = tag;
    } else if (open === tag) {
      out += `{/${tag}}`;
      open = null;
    }
  }
  out += source.slice(last);
  if (open) out = `${out.replace(/\s+$/, '')}{/${open}}`;
  let prev = '';
  while (prev !== out) {
    prev = out;
    out = out
      // "[Am]{bv}" → "{bv}[Am]": the chord belongs to the word inside the part.
      .replace(new RegExp(`((?:\\[[^\\]\\s]{1,16}\\])+)\\s*(${OPEN_RE})`, 'g'), (all, chords: string, tag: string) =>
        [...chords.matchAll(BRACKET)].every((c) => isChordToken(c[1])) ? `${tag}${chords}` : all,
      )
      // Spaces stay outside the part: "{bv} ooh" → " {bv}ooh", "ooh {/bv}" → "ooh{/bv} ".
      .replace(new RegExp(`(${OPEN_RE})(\\s+)`, 'g'), '$2$1')
      .replace(new RegExp(`(\\s+)(${CLOSE_RE})`, 'g'), '$2$1')
      // Empty parts go.
      .replace(/\{(v2|bv|all|sp)\}\{\/\1\}/g, '');
  }
  return { line: out.replace(/\s+$/, ''), open };
}

/**
 * Lines of lyrics with their markers tidied: lower case, balanced per line
 * (a part running over several lines becomes one span per line, until a
 * heading), opening markers before the first word's chord. Lines without
 * markers are returned as they are.
 */
export function normalizeVoiceLines(lines: string[]): string[] {
  let carry: VoiceTag | null = null;
  return lines.map((line) => {
    if (isHeadingLine(line)) {
      carry = null;
      return line;
    }
    if (!line.trim() || (!carry && !hasVoiceMarkers(line))) return line;
    const r = tidyLine(line, carry);
    carry = r.open;
    return r.line;
  });
}

// ── My part ────────────────────────────────────────────────────────────────

const foldText = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Phrases (folded) for backing vocals and second voice, in the app's languages. */
const BACKING = [
  'backing vocals', 'backing vocal', 'backing vocalist', 'backing', 'backup vocals', 'background vocals', 'bvs', 'bv',
  'harmony vocals', 'harmonies', 'cori', 'coro', 'corista', 'coros', 'choeurs', 'choriste', 'chor', 'backgroundgesang',
  'voz de apoio', 'vocal de apoio', 'coros de apoyo',
];
const SECOND = [
  'second voice', '2nd voice', 'second vocals', 'seconda voce', '2a voce', 'segunda voz', '2a voz', 'deuxieme voix',
  'seconde voix', '2e voix', 'zweite stimme', '2 stimme',
];
const has = (folded: string, words: string[]) => words.some((w) => new RegExp(`(^|\\s)${w}(?=\\s|$)`).test(folded));
const SINGER = ['lead vocals', 'vocals', 'vocal', 'vocalist', 'voice', 'singer', 'voce', 'cantante', 'chant', 'chanteur', 'chanteuse', 'voz', 'gesang', 'sanger', 'saengerin', 'sangerin'];

/**
 * The part a member sings from their instrument field: "Backing vocals",
 * "Guitar / Cori" → backing; "Second voice" → second; any other singer →
 * lead. Null for members who don't sing.
 */
export function instrumentVoicePart(instrument: string | null | undefined): VoicePart | null {
  const f = foldText(instrument || '');
  if (!f) return null;
  if (has(f, SECOND)) return 'v2';
  if (has(f, BACKING)) return 'bv';
  if (has(f, SINGER)) return 'lead';
  return null;
}

/** A run is "mine" when it is (one of) my part(s), or everyone sings it. */
export const isMyPart = (voice: VoicePart, mine: VoicePart | readonly VoicePart[] | null | undefined): boolean =>
  voice === 'all' || (Array.isArray(mine) ? mine.includes(voice) : !!mine && voice === mine);

// ── Editing (C2: the Voice picker in the chord editor) ─────────────────────

/** The part of each word of a line (as parseLine counts words): the part its first letter is in. */
export function wordVoices(line: string): VoicePart[] {
  let voice: VoicePart = 'lead';
  const apply = (tag: string) => {
    if (tag.startsWith('/')) {
      if (voice === tag.slice(1)) voice = 'lead';
    } else voice = tag as VoiceTag;
  };
  const rank = (tag: string) => (tag.startsWith('/') ? 0 : 1);
  return parseLine(line).words.map((w) => {
    const marks = [...(w.marks ?? [])].sort((a, b) => a.at - b.at || rank(a.tag) - rank(b.tag));
    marks.filter((m) => m.at === 0).forEach((m) => apply(m.tag));
    const v = voice;
    marks.filter((m) => m.at > 0).forEach((m) => apply(m.tag));
    return v;
  });
}

/**
 * One part on a line (or on words `from`…`to` of it, as parseLine counts
 * them); 'lead' or tapping the part those words already have clears it.
 * Chords stay where they are; the line's markers are rewritten in the
 * band's form.
 */
export function setLineVoice(line: string, voice: VoicePart, range?: { from: number; to: number }): string {
  const model = parseLine(line);
  const n = model.words.length;
  if (!n) return line;
  const voices = wordVoices(line);
  const from = Math.max(0, Math.min(range ? Math.min(range.from, range.to) : 0, n - 1));
  const to = Math.max(from, Math.min(range ? Math.max(range.from, range.to) : n - 1, n - 1));
  const already = voices.slice(from, to + 1).every((v) => v === voice);
  for (let i = from; i <= to; i++) voices[i] = already ? 'lead' : voice;
  model.words.forEach((w, i) => {
    const marks: WordMark[] = [];
    const v = voices[i];
    if (v !== 'lead' && voices[i - 1] !== v) marks.push({ at: 0, tag: v });
    if (v !== 'lead' && voices[i + 1] !== v) marks.push({ at: w.text.length, tag: `/${v}` });
    if (marks.length) w.marks = marks;
    else delete w.marks;
  });
  return serializeLine(model);
}

// ── Suggestions on paste / import ──────────────────────────────────────────

export interface VoiceSuggestion {
  /** Line index in the text. */
  line: number;
  voice: VoiceTag;
}

const ALL_PREFIX = /^(\s*)(?:all|tutti|todos|tous|alle|everyone|everybody|coro)\s*:\s*/i;

/**
 * Parts a pasted or imported text seems to have: a line wholly in
 * parentheses — "(ooh, yeah)" — is backing; a line starting "All:" or
 * "Tutti:" is everyone. Lines that already have a part are left alone.
 * Nothing changes until applyVoiceSuggestions.
 */
export function suggestVoiceParts(lyrics: string | null | undefined): VoiceSuggestion[] {
  const out: VoiceSuggestion[] = [];
  (lyrics || '').split('\n').forEach((line, i) => {
    if (!line.trim() || isHeadingLine(line) || hasVoiceMarkers(line)) return;
    const words = line.replace(BRACKET, (all, c: string) => (isChordToken(c) ? '' : all)).trim();
    if (/^\([^()]*\)$/.test(words)) out.push({ line: i, voice: 'bv' });
    else if (ALL_PREFIX.test(line) && line.replace(ALL_PREFIX, '').trim()) out.push({ line: i, voice: 'all' });
  });
  return out;
}

/** The suggestions applied ("All:" labels dropped: the part says it now). */
export function applyVoiceSuggestions(lyrics: string, suggestions: VoiceSuggestion[]): string {
  const lines = lyrics.split('\n');
  for (const s of suggestions) {
    const line = lines[s.line];
    if (line == null || hasVoiceMarkers(line)) continue;
    lines[s.line] = setLineVoice(s.voice === 'all' ? line.replace(ALL_PREFIX, '$1') : line, s.voice);
  }
  return lines.join('\n');
}

// ── Who sings what (songs.vocal_parts, setlist_songs.vocal_parts: 172) ─────

/** Part → user ids of the members who sing it. 'all' is everyone: never assigned. */
export type VocalParts = Partial<Record<Exclude<VoicePart, 'all'>, string[]>>;
export const ASSIGNABLE_PARTS: readonly Exclude<VoicePart, 'all'>[] = ['lead', 'v2', 'bv', 'sp'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The stored json, checked: known parts, uuids once each; null when empty or not an object. */
export function parseVocalParts(raw: unknown): VocalParts | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: VocalParts = {};
  for (const p of ASSIGNABLE_PARTS) {
    const ids = (raw as Record<string, unknown>)[p];
    if (!Array.isArray(ids)) continue;
    const clean = [...new Set(ids.filter((x): x is string => typeof x === 'string' && UUID.test(x)))];
    if (clean.length) out[p] = clean;
  }
  return Object.keys(out).length ? out : null;
}

/** For one gig: the setlist's override when it has one, else the song's. */
export const effectiveVocalParts = (song: VocalParts | null | undefined, setlist: VocalParts | null | undefined): VocalParts | null =>
  setlist ?? song ?? null;

/** The parts assigned to me, or undefined when I'm not assigned (the instrument decides then). */
export function assignedParts(parts: VocalParts | null | undefined, userId: string | null | undefined): VoicePart[] | undefined {
  if (!parts || !userId) return undefined;
  const mine = ASSIGNABLE_PARTS.filter((p) => parts[p]?.includes(userId));
  return mine.length ? mine : undefined;
}

// ── Export ─────────────────────────────────────────────────────────────────

/**
 * Lyrics for an export (ChordPro, print): parts stripped, or written as
 * labels a reader understands without the app — "Backing: (ooh)" for a
 * line, "(2nd voice: high)" for words inside one. Lead is never labelled.
 */
export function lyricsForExport(lyrics: string, mode: 'strip' | 'labels', names: Record<VoicePart, string>): string {
  return (lyrics || '')
    .split('\n')
    .map((line) => {
      if (!hasVoiceMarkers(line)) return line;
      if (mode === 'strip') return stripVoiceMarkers(line);
      const v = lineVoice(line);
      const lead = line.match(/^\s*/)![0];
      if (v !== 'mixed') return v === 'lead' ? stripVoiceMarkers(line) : `${lead}${names[v]}: ${stripVoiceMarkers(line).trim()}`;
      return voiceRuns(line)
        .map((r) => {
          if (r.voice === 'lead' || !r.text.trim()) return r.text;
          const [, pre, body, post] = r.text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
          return `${pre}(${names[r.voice]}: ${body})${post}`;
        })
        .join('');
    })
    .join('\n');
}

/** A song as a ChordPro file (sections as comments), parts as labels or stripped. */
export function songToChordPro(
  song: { title: string; artist?: string | null; key?: string | null; lyrics?: string | null },
  mode: 'strip' | 'labels',
  names: Record<VoicePart, string>,
): string {
  const head = [`{title: ${song.title}}`, song.artist ? `{artist: ${song.artist}}` : '', song.key ? `{key: ${song.key}}` : ''].filter(Boolean);
  const body = lyricsForExport(song.lyrics || '', mode, names)
    .split('\n')
    .map((l) => {
      const h = l.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
      return h ? `{comment: ${h[1]}}` : l;
    });
  return `${[...head, '', ...body].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
