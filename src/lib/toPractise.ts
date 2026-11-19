/**
 * To practise (plan A3): what the rehearsal notes (A2, 132) leave each
 * member to work on, and how they carry over to the next rehearsal. Pure.
 *
 * Only written, open notes count: a mark is not written yet, an OK note is
 * done, and a note I've marked Practised waits for the band's OK.
 */
import { isForMe, myNoteState, type NoteGroup, type RehearsalNote } from './rehearsalNotes';

const isOpen = (n: RehearsalNote) => n.status === 'open';

export interface PractiseGroup extends NoteGroup {
  songId: string;
  /** The newest rehearsal with a note on the song. */
  lastDate: string;
}

const newestFirst = (a: RehearsalNote, b: RehearsalNote) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

/**
 * Home "To practise": songs with open notes for me (or the band), newest
 * rehearsal first (then most notes). `keep`: notes ticked Practised on this
 * screen, which stay until it's left (so the tick can be taken back).
 */
export function toPractise(notes: RehearsalNote[], userId: string | null | undefined, keep?: ReadonlySet<string>): PractiseGroup[] {
  const groups = new Map<string, PractiseGroup>();
  for (const n of [...notes].sort(newestFirst)) {
    if (!n.songId || !isOpen(n) || !isForMe(n, userId)) continue;
    if (myNoteState(n, userId) !== 'open' && !keep?.has(n.id)) continue;
    const g = groups.get(n.songId) ?? { songId: n.songId, title: n.songTitle, notes: [], lastDate: n.date };
    g.notes.push(n);
    groups.set(n.songId, g);
  }
  return [...groups.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.notes.length - a.notes.length);
}

/** The song page: the song's open notes, the ones for me first, newest first. */
export function songNotes(notes: RehearsalNote[], songId: string, userId: string | null | undefined): RehearsalNote[] {
  return notes
    .filter((n) => n.songId === songId && isOpen(n))
    .sort((a, b) => Number(isForMe(b, userId)) - Number(isForMe(a, userId)) || newestFirst(a, b));
}

/**
 * The next rehearsal's "From last time": notes from earlier dates on its
 * songs, in setlist order. Written notes only; one just confirmed OK here
 * stays (so it can be taken back) until the list is read again.
 */
export function fromLastTime(notes: RehearsalNote[], setlistSongIds: string[], date: string): PractiseGroup[] {
  const out: PractiseGroup[] = [];
  for (const songId of setlistSongIds) {
    const mine = notes.filter((n) => n.songId === songId && n.status !== 'marked' && n.date < date).sort(newestFirst);
    if (mine.length) out.push({ songId, title: mine[0].songTitle, notes: mine, lastDate: mine[0].date });
  }
  return out;
}

/** Live mode badges: open notes per song. */
export function openCountBySong(notes: RehearsalNote[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of notes) if (n.songId && isOpen(n)) out[n.songId] = (out[n.songId] ?? 0) + 1;
  return out;
}

/** Focus songs to suggest for the next rehearsal (097): most open notes first, then the most recent. */
export function focusSuggestions(notes: RehearsalNote[]): string[] {
  const stats = new Map<string, { count: number; last: string }>();
  for (const n of notes) {
    if (!n.songId || !isOpen(n)) continue;
    const s = stats.get(n.songId) ?? { count: 0, last: '' };
    s.count++;
    if (n.date > s.last) s.last = n.date;
    stats.set(n.songId, s);
  }
  return [...stats.entries()].sort(([, a], [, b]) => b.count - a.count || b.last.localeCompare(a.last)).map(([id]) => id);
}

/** Focus songs to pre-select (id and title), at most `max`. */
export function suggestedFocusSongs(notes: RehearsalNote[], max = 6): { id: string; title: string }[] {
  const titles = new Map(notes.filter((n) => n.songId && n.songTitle).map((n) => [n.songId!, n.songTitle!]));
  return focusSuggestions(notes)
    .filter((id) => titles.has(id))
    .slice(0, max)
    .map((id) => ({ id, title: titles.get(id)! }));
}

export type SongChange = { kind: 'tempo'; bpm: number } | { kind: 'key'; key: string };

const KEY_RE = /(?:^|[\s:,(])([A-G](?:#|b|♯|♭)?m?)(?=$|[\s,.;)])/;

/**
 * A Tempo or Key note that names the new value becomes a song change (108):
 * "Tempo: 96", "88 bpm", "Key: F#m", "down to Bb".
 */
export function songChangeFromNote(n: RehearsalNote): SongChange | null {
  if (!n.songId) return null;
  const text = `${n.body ?? ''}`.trim();
  if (n.preset === 'tempo') {
    const m = text.match(/\b(\d{2,3})\b/);
    const bpm = m ? Number(m[1]) : NaN;
    return bpm >= 30 && bpm <= 300 ? { kind: 'tempo', bpm } : null;
  }
  if (n.preset === 'key') {
    const m = text.replace(/^key\s*:?/i, ' ').match(KEY_RE);
    return m ? { kind: 'key', key: m[1].replace('♯', '#').replace('♭', 'b') } : null;
  }
  return null;
}
