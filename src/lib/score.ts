/**
 * Scores (sheet music plan, docs/plans/sheet-music.md §4): a song's MusicXML
 * or compressed MusicXML (.mxl) file, shown note by note in the Score view
 * (src/app/components/ui/ScoreView.tsx, OpenSheetMusicDisplay).
 *
 * - The file is the band's own, kept in `song-files` under
 *   `<band>/score/…` and referenced from `songs.score_path`
 *   (`sb://song-files/<path>`, like the chart and the recording).
 * - This module is the plain part: which files count as a score, what the
 *   bucket is told they are, the facts the view needs without drawing
 *   (bars, key, chords: the screen reader's text and the tests), and the
 *   chord names OSMD prints, taken from the chart's own `chordLabel` so a
 *   score and a chart spell the same chord the same way.
 */
import { chordLabel } from './ireal';
import { harmonyToken, isZip, KIND, mxlScore } from './musicxml';
import { prefersFlats, transposeChord, transposeKey } from './transpose';

export const SCORE_MAX_BYTES = 20 * 1024 * 1024;

/** The two MusicXML types (bucket allowed_mime_types, migration 170). */
export const SCORE_MIME_XML = 'application/vnd.recordare.musicxml+xml';
export const SCORE_MIME_MXL = 'application/vnd.recordare.musicxml';

/** Accept attribute of the "Add score" picker (iOS Files has no MusicXML type: extensions). */
export const SCORE_FILE_ACCEPT = ['.musicxml', '.mxl', '.xml', SCORE_MIME_XML, SCORE_MIME_MXL].join(',');

const ext = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');

export const isScoreFileName = (name: string) => ['musicxml', 'mxl', 'xml'].includes(ext(name));

/** The type to upload a score with: always one of the two MusicXML types, never the OS's guess. */
export const scoreContentType = (name: string): string | null => {
  const e = ext(name);
  if (e === 'mxl') return SCORE_MIME_MXL;
  if (e === 'musicxml' || e === 'xml') return SCORE_MIME_XML;
  return null;
};

type T = (k: string, v?: Record<string, string | number>) => string;

/** What is wrong with a picked score, or null. */
export const validateScoreFile = (file: { name: string; size: number }, t: T): string | null => {
  if (!isScoreFileName(file.name)) return t('Choose a MusicXML score (.musicxml, .mxl or .xml).');
  if (file.size > SCORE_MAX_BYTES) return t('File too large: max {mb} MB for scores.', { mb: SCORE_MAX_BYTES / 1024 / 1024 });
  return null;
};

/** The score's MusicXML text, from a plain or zipped file. Throws 'not-musicxml' or 'too-large'. */
export async function scoreXml(bytes: Uint8Array): Promise<string> {
  if (bytes.length > SCORE_MAX_BYTES) throw new Error('too-large');
  const xml = isZip(bytes) ? await mxlScore(bytes) : new TextDecoder().decode(bytes);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement?.nodeName;
  if (doc.getElementsByTagName('parsererror').length || (root !== 'score-partwise' && root !== 'score-timewise')) {
    throw new Error('not-musicxml');
  }
  return xml;
}

// ── Facts ──

const MAJOR = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const MINOR = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'];

/** Key signature → the app's key text ("G", "Eb", "Am"), or null. */
export function scoreKeyName(fifths: number, minor: boolean): string | null {
  if (!Number.isInteger(fifths) || fifths < -7 || fifths > 7) return null;
  return minor ? `${MINOR[fifths + 7]}m` : MAJOR[fifths + 7];
}

export interface ScoreFacts {
  title: string | null;
  /** Bars of the (first) part: what the Score view draws. */
  bars: number;
  /** The opening key ("G", "Eb", "Am"), or null without a key signature. */
  key: string | null;
  /** Chord symbols in order, as iReal tokens (transposable) ... */
  chordTokens: string[];
  /** ... and as BandWith writes them ("Gmaj7", "Em7", "G6"). */
  chords: string[];
}

const firstText = (el: Element | Document, tag: string) => el.getElementsByTagName(tag)[0]?.textContent?.trim() || '';

/** Bars, key and chords of a score, read without drawing it. */
export function scoreFacts(xml: string): ScoreFacts {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const part = doc.getElementsByTagName('part')[0];
  const scope: Element | Document = part ?? doc;
  const bars = part ? Array.from(part.children).filter((c) => c.nodeName === 'measure').length : 0;
  const keyEl = scope.getElementsByTagName('key')[0];
  const key = keyEl ? scoreKeyName(Number(firstText(keyEl, 'fifths')), firstText(keyEl, 'mode') === 'minor') : null;
  const chordTokens: string[] = [];
  for (const h of Array.from(scope.getElementsByTagName('harmony'))) {
    const tok = harmonyToken(h);
    if (tok && tok !== chordTokens[chordTokens.length - 1]) chordTokens.push(tok);
  }
  const title = firstText(doc, 'work-title') || firstText(doc, 'movement-title') || null;
  return { title, bars, key, chordTokens, chords: chordTokens.map(chordLabel) };
}

const readable = (key: string) => key.replace(/^([A-G])b/, '$1♭').replace(/^([A-G])#/, '$1♯');

/** The score in words, for screen readers (the SVG is one picture): bars, key and chords, transposed. */
export function scoreTextAlternative(facts: ScoreFacts, title: string, semitones: number, t: T): string {
  const max = 48;
  const flats = prefersFlats(facts.key, semitones);
  const chords = facts.chordTokens.slice(0, max).map((c) => chordLabel(transposeChord(c, semitones, flats)));
  const parts = [t('Score: {title}.', { title }), ' '];
  const key = facts.key ? readable(transposeKey(facts.key, semitones)) : null;
  parts.push(
    key
      ? t('{bars} bars, key of {key}.', { bars: facts.bars, key })
      : t('{bars} bars.', { bars: facts.bars }),
  );
  if (chords.length) {
    parts.push(' ', t('Chords: {chords}.', { chords: chords.join(', ') + (facts.chordTokens.length > max ? ', …' : '') }));
  }
  return parts.join('');
}

// ── OSMD chord names ──

/**
 * OSMD's `ChordSymbolEnum` names (the MusicXML kinds without hyphens) →
 * the quality BandWith prints after the root: `chordLabel` of the same
 * iReal token the chart import makes. Kinds with no suffix (major, pedal)
 * are left to OSMD's own empty label.
 */
export function osmdChordLabelTexts(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [kind, quality] of Object.entries(KIND)) {
    const label = chordLabel(`C${quality}`).slice(1);
    if (label) out[kind.replace(/-/g, '')] = label;
  }
  return out;
}

/**
 * OSMD's built-in named chords (EngravingRules.CustomChords, e.g. a
 * suspended fourth with an added 7th is "7sus4") → the chart's name for the
 * same chord ("7sus", from chordLabel), so the two never disagree.
 */
export function osmdCustomChordNames(): Record<string, string> {
  const q = (token: string) => chordLabel(`C${token}`).slice(1);
  return { '7sus4': q('7sus'), mi69: 'm69' };
}

// ── Demo ──

/** Made-up scores bundled with the demo build (src/lib/demo/scores), referenced as `demo://scores/<file>`. */
export const DEMO_SCORE_PREFIX = 'demo://scores/';
export const isDemoScoreRef = (ref: string | null | undefined): ref is string => !!ref && ref.startsWith(DEMO_SCORE_PREFIX);
