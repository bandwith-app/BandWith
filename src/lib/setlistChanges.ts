/**
 * What a setlist save changed, for the one notification sent after Save
 * ("2 songs moved, 1 added"). Rows are compared by song id in play order
 * (set 1 first, then set 2, …); the server writes the translated text
 * (migration 107, bw_notify_setlist_saved).
 */

export interface SetlistEntry {
  songId: string;
  /** 1-based set number; anything else counts as set 1. */
  setNumber?: number | null;
}

export interface SetlistChange {
  moved: number;
  added: number;
  removed: number;
}

const setOf = (e: SetlistEntry) => (typeof e.setNumber === 'number' && e.setNumber >= 1 ? Math.floor(e.setNumber) : 1);

/** Length-indexed LCS membership: which items of `a` are in a longest common subsequence with `b`. */
function lcsKeep(a: string[], b: string[]): Set<number> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const keep = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      keep.add(i);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return keep;
}

/**
 * Songs added, removed and moved between two versions of a setlist.
 * A song counts as moved when it changed set, or when it isn't part of the
 * longest run of songs that kept their order (dragging one song from 5th to
 * 1st moves 1 song, not 4). A song listed twice is matched occurrence by
 * occurrence.
 */
export function diffSetlist(before: SetlistEntry[], after: SetlistEntry[]): SetlistChange {
  // Key each occurrence: "id#1", "id#2", … so duplicates pair up in order.
  const keyed = (list: SetlistEntry[]) => {
    const seen = new Map<string, number>();
    return list
      .filter((e) => !!e?.songId)
      .map((e) => {
        const n = (seen.get(e.songId) ?? 0) + 1;
        seen.set(e.songId, n);
        return { key: `${e.songId}#${n}`, set: setOf(e) };
      });
  };
  const a = keyed(before);
  const b = keyed(after);
  const aKeys = new Set(a.map((x) => x.key));
  const bKeys = new Set(b.map((x) => x.key));
  const added = b.filter((x) => !aKeys.has(x.key)).length;
  const removed = a.filter((x) => !bKeys.has(x.key)).length;

  const commonA = a.filter((x) => bKeys.has(x.key));
  const commonB = b.filter((x) => aKeys.has(x.key));
  const setAfter = new Map(commonB.map((x) => [x.key, x.set]));
  const keep = lcsKeep(
    commonA.map((x) => x.key),
    commonB.map((x) => x.key)
  );
  let moved = 0;
  commonA.forEach((x, i) => {
    if (!keep.has(i) || setAfter.get(x.key) !== x.set) moved++;
  });
  return { moved, added, removed };
}

export const hasSetlistChange = (c: SetlistChange | null | undefined): c is SetlistChange =>
  !!c && c.moved + c.added + c.removed > 0;

/** Play-order entries from setlist_songs rows (set_number, then position). */
export function entriesFromRows(rows: { song_id?: string | null; set_number?: number | null; position?: number | null }[]): SetlistEntry[] {
  return [...rows]
    .filter((r) => !!r?.song_id)
    .sort((x, y) => (setOf({ songId: '', setNumber: x.set_number }) - setOf({ songId: '', setNumber: y.set_number })) || (x.position ?? 0) - (y.position ?? 0))
    .map((r) => ({ songId: r.song_id as string, setNumber: r.set_number }));
}

/** Song fields named in a "song updated" notification (server translates them). */
export type SongField = 'title' | 'artist' | 'key' | 'tempo' | 'duration' | 'lyrics' | 'chords' | 'notes' | 'media' | 'genres';

const FIELD_OF: Record<string, SongField> = {
  title: 'title',
  artist: 'artist',
  key: 'key',
  bpm: 'tempo',
  time_signature: 'tempo',
  count_in_bars: 'tempo',
  pickup_beats: 'tempo',
  backing_track: 'tempo',
  line_timing: 'lyrics',
  duration_seconds: 'duration',
  lyrics: 'lyrics',
  chord_chart: 'chords',
  notes: 'notes',
  audio_url: 'media',
  chart_url: 'media',
  youtube_url: 'media',
  spotify_id: 'media',
  genre: 'genres',
  genres: 'genres',
  category: 'genres',
};

/** The notification fields for a song update payload (column names → SongField, deduplicated, stable order). */
export function songFieldsChanged(changes: Record<string, unknown>): SongField[] {
  const order: SongField[] = ['title', 'artist', 'key', 'tempo', 'duration', 'lyrics', 'chords', 'notes', 'media', 'genres'];
  const got = new Set<SongField>();
  for (const k of Object.keys(changes || {})) {
    const f = FIELD_OF[k];
    if (f) got.add(f);
  }
  return order.filter((f) => got.has(f));
}
