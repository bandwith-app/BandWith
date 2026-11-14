import { isChordToken } from './lyrics';
import type { SongChart } from './ireal';

/**
 * Suggestions from band members (migration 108): a member proposes, an admin
 * accepts (as it is or with changes) or rejects, with a reason.
 *
 *   new_song  a song added with status 'suggested'
 *   lyrics    a corrected songs.lyrics (chords inline, as stored)
 *   chords    the same text where only the chords change, or a chord chart
 *   note      a note for the whole band (goes into songs.notes)
 */
export type SuggestionKind = 'new_song' | 'lyrics' | 'chords' | 'note';
export type SuggestionStatus = 'pending' | 'accepted' | 'accepted_edited' | 'rejected' | 'withdrawn';

export interface SuggestionPerson {
  id?: string;
  full_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

export interface SongSuggestion {
  id: string;
  band_id: string;
  song_id: string | null;
  song_title: string;
  kind: SuggestionKind;
  proposed: { lyrics?: string; chord_chart?: SongChart; note?: string };
  /** The song when the suggestion was made (server-side copy). */
  original: { lyrics?: string | null; chord_chart?: SongChart | null; notes?: string | null };
  message: string | null;
  status: SuggestionStatus;
  reason: string | null;
  applied: { lyrics?: string | null; chord_chart?: SongChart | null; notes?: string | null } | null;
  created_by: string;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  author?: SuggestionPerson | null;
  reviewer?: SuggestionPerson | null;
}

/** Lyrics without chords: "[Am]Hello ♪ [G]" → "Hello". */
export function stripChords(text: string | null | undefined): string {
  return (text || '')
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/\[([^\]\s]{1,16})\]/g, (m, c: string) => (isChordToken(c) ? '' : m))
        .replace(/^\s*♪\s*/, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n');
}

/**
 * What a correction to songs.lyrics changes: only the chords (same words), or
 * the words. null when nothing changed.
 */
export function correctionKind(before: string | null | undefined, after: string | null | undefined): 'lyrics' | 'chords' | null {
  const a = (before || '').replace(/\r\n/g, '\n').trimEnd();
  const b = (after || '').replace(/\r\n/g, '\n').trimEnd();
  if (a === b) return null;
  return stripChords(a) === stripChords(b) ? 'chords' : 'lyrics';
}

export type DiffLine = { op: 'same' | 'add' | 'del'; text: string };

/**
 * Line-by-line difference (longest common subsequence), for the review's
 * before / after. Long texts fall back to "all removed, all added".
 */
export function diffLines(before: string | null | undefined, after: string | null | undefined): DiffLine[] {
  const a = (before || '').replace(/\r\n/g, '\n').split('\n');
  const b = (after || '').replace(/\r\n/g, '\n').split('\n');
  if (!before) a.length = 0;
  if (!after) b.length = 0;
  // Common start and end first: most corrections touch a few lines.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head: DiffLine[] = a.slice(0, start).map((text) => ({ op: 'same', text }));
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ op: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  let mid: DiffLine[];
  if (midA.length * midB.length > 250_000) {
    mid = [...midA.map((text) => ({ op: 'del' as const, text })), ...midB.map((text) => ({ op: 'add' as const, text }))];
  } else {
    const n = midA.length;
    const m = midB.length;
    const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    mid = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        mid.push({ op: 'same', text: midA[i] });
        i++;
        j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
        mid.push({ op: 'del', text: midA[i++] });
      } else {
        mid.push({ op: 'add', text: midB[j++] });
      }
    }
    while (i < n) mid.push({ op: 'del', text: midA[i++] });
    while (j < m) mid.push({ op: 'add', text: midB[j++] });
  }
  return [...head, ...mid, ...tail];
}

/** Lines changed in a diff (added + removed). */
export const changedLineCount = (diff: DiffLine[]) => diff.filter((d) => d.op !== 'same').length;

/**
 * Only the changed lines with a little context around them; runs of
 * unchanged lines in between become one `null` (shown as "…").
 */
export function diffHunks(diff: DiffLine[], context = 2): (DiffLine | null)[] {
  const keep = new Array<boolean>(diff.length).fill(false);
  diff.forEach((d, i) => {
    if (d.op === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(diff.length - 1, i + context); k++) keep[k] = true;
  });
  const out: (DiffLine | null)[] = [];
  let skipped = false;
  diff.forEach((d, i) => {
    if (keep[i]) {
      out.push(d);
      skipped = false;
    } else if (!skipped) {
      out.push(null);
      skipped = true;
    }
  });
  return out;
}

/** The text the song gets when a note is accepted as it is (appended to its notes). */
export function notesWithNote(notes: string | null | undefined, note: string): string {
  const cur = (notes || '').trimEnd();
  return cur ? `${cur}\n\n${note.trim()}` : note.trim();
}

/** The song's current value for the field a suggestion changes. */
export function suggestionField(s: Pick<SongSuggestion, 'kind'>): 'lyrics' | 'notes' | null {
  if (s.kind === 'lyrics' || s.kind === 'chords') return 'lyrics';
  if (s.kind === 'note') return 'notes';
  return null;
}

/**
 * The song changed after the suggestion was made: the review compares with
 * the current text, and says so.
 */
export function songChangedSince(
  s: Pick<SongSuggestion, 'kind' | 'original'>,
  song: { lyrics?: string | null; notes?: string | null } | null | undefined,
): boolean {
  const field = suggestionField(s);
  if (!field || !song) return false;
  const was = (s.original?.[field] ?? '') || '';
  const now = (song[field] ?? '') || '';
  return was.replace(/\r\n/g, '\n').trimEnd() !== now.replace(/\r\n/g, '\n').trimEnd();
}
