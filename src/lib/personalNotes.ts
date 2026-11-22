/**
 * Personal notes on a band song (109): where a note sits, found again by the
 * line's words so it survives chord edits and moved sections. Pure.
 */
import { parseLyrics, splitChords } from './lyrics';
import { normalizeLyrics, parseLine } from './songFormat';
import { stripVoiceMarkers } from './voiceParts';

export type NoteAnchor =
  | { type: 'song' }
  | { type: 'line'; line: string; occ: number }
  | { type: 'word'; line: string; occ: number; word: number }
  | { type: 'chord'; line: string; occ: number; chord: string; word?: number };

export interface PersonalNote {
  id: string;
  song_id: string;
  user_id?: string;
  anchor: NoteAnchor;
  body: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * A line's words as written, chords and voice parts removed. Every match by
 * line text goes through here, so adding parts (`{bv}…{/bv}`) to a line
 * never moves the notes pinned to it.
 */
export const lyricsLineText = (line: string): string => {
  const plain = stripVoiceMarkers(line);
  const segs = splitChords(plain);
  return (segs ? segs.map((s) => s.text).join('') : plain).replace(/\s+/g, ' ').trim();
};

/** A line's words, chords removed, spaces and case folded: how notes find it. */
export const lineKey = (line: string): string => lyricsLineText(line).toLowerCase();

export interface LineRef {
  /** Section and line index as drawn (parseLyrics of the normalized text). */
  section: number;
  index: number;
  key: string;
  occ: number;
  text: string;
}

/** Every drawn line with the key and occurrence a note would use. */
export const songLineRefs = (lyrics?: string | null): LineRef[] => {
  const seen = new Map<string, number>();
  const out: LineRef[] = [];
  parseLyrics(normalizeLyrics(lyrics)).forEach((s, si) =>
    s.lines.forEach((text, li) => {
      const key = lineKey(text);
      if (!key) return;
      const occ = seen.get(key) ?? 0;
      seen.set(key, occ + 1);
      out.push({ section: si, index: li, key, occ, text });
    }),
  );
  return out;
};

const refId = (section: number, index: number) => `${section}:${index}`;

/**
 * Notes grouped by drawn line ("section:index"); notes on the whole song, or
 * on a line that's no longer in the song, go to `song` (shown on top, so
 * nothing is lost when the band text changes).
 */
export const placeNotes = (lyrics: string | null | undefined, notes: PersonalNote[]) => {
  const refs = songLineRefs(lyrics);
  const byLine = new Map<string, PersonalNote[]>();
  const song: PersonalNote[] = [];
  for (const n of notes) {
    const a = n.anchor;
    if (a.type === 'song') {
      song.push(n);
      continue;
    }
    const key = (a.line || '').toLowerCase();
    const hits = refs.filter((r) => r.key === key);
    const ref = hits.find((r) => r.occ === a.occ) ?? hits[hits.length - 1];
    if (!ref) {
      song.push(n);
      continue;
    }
    const id = refId(ref.section, ref.index);
    byLine.set(id, [...(byLine.get(id) ?? []), n]);
  }
  return { song, byLine, refId };
};

/** The words of a line, for picking the word a note is on. */
export const lineWords = (line: string): string[] => parseLine(line).words.map((w) => w.text);

/** The chords of a line, in order, without repeats. */
export const lineChords = (line: string): string[] => {
  const out: string[] = [];
  for (const s of splitChords(line) ?? []) if (s.chord && !out.includes(s.chord)) out.push(s.chord);
  return out;
};

/** What a note is on, for its label ("lights", "Am", or the line's start). */
export const anchorLabel = (a: NoteAnchor, text?: string): string | null => {
  if (a.type === 'song') return null;
  if (a.type === 'chord') return a.chord;
  if (a.type === 'word' && text) return lineWords(text)[a.word] ?? null;
  return null;
};
