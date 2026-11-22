import { supabase, getSafeUser } from '../supabase';
import { removeSongFiles } from './songFiles';
import type { SongChart } from '../ireal';
import { voicesKey } from '@/lib/voicesKey';

/**
 * RLS refused the write (0 rows): an error the UI maps to a translated
 * "only admins" message (src/lib/userError.ts); the text is for logs only.
 */
const permissionError = (message: string) => Object.assign(new Error(message), { code: '42501' });

// Types
/** 'suggested': proposed by a member; an admin moves it to learning / ready. */
export type SongStatus = 'suggested' | 'learning' | 'ready' | 'archived';
export type SongPriority = 'high' | 'medium' | 'low';

export interface Song {
  id: string;
  band_id: string;
  
  title: string;
  artist?: string;
  duration_seconds?: number;
  bpm?: number;
  key?: string;
  genre?: string;
  category?: string;
  
  status: SongStatus;
  priority: SongPriority;
  
  audio_url?: string;
  chart_url?: string;
  lyrics?: string;
  /** Chords and form imported from iReal Pro (no melody, no lyrics). */
  chord_chart?: SongChart | null;
  /** Live mode (171): "4/4", "6/8"…; null = the chart's, else 4/4. */
  time_signature?: string | null;
  /** Bars of count-in (1, or 2 for slow songs; 171). */
  count_in_bars?: number;
  /** The song starts this many beats before bar 1 (171). */
  pickup_beats?: number;
  /** Played with a backing track: no count-in offered (171). */
  backing_track?: boolean;
  /** Where each lyric line starts (src/lib/lineTiming.ts; 171). */
  line_timing?: unknown;
  notes?: string;
  
  spotify_id?: string;
  apple_music_id?: string;
  youtube_url?: string;
  
  times_played?: number;
  last_played_at?: string;
  
  added_by?: string;
  created_at: string;
  updated_at: string;
}

/** A song update where null clears a column. */
export type SongChanges = { [K in keyof Song]?: Song[K] | null };

export interface Setlist {
  id: string;
  band_id: string;
  
  name: string;
  description?: string;
  is_template: boolean;
  
  total_duration_seconds?: number;
  song_count?: number;
  
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface SetlistSong {
  id: string;
  setlist_id: string;
  song_id: string;
  
  position: number;
  set_number: number;
  notes?: string;
  
  created_at: string;
  
  // Joined data
  song?: Song;
}

export interface SetlistWithSongs extends Setlist {
  songs: SetlistSong[];
}

// ============================================
// SONGS CRUD
// ============================================

/**
 * Every song column except lyrics, chord_chart and notes, which are about 80%
 * of a song row. Pickers and lists that only show titles use these
 * (Supabase egress, docs/plans/scaling-and-costs.md); the repertoire, the
 * reader and the editor still load full songs.
 */
export const SONG_LIST_COLUMNS =
  'id, band_id, title, artist, duration_seconds, bpm, key, genre, category, status, priority, ' +
  'audio_url, chart_url, spotify_id, apple_music_id, youtube_url, times_played, last_played_at, ' +
  'added_by, created_at, updated_at';

export const getSongs = async (
  bandId: string,
  options?: {
    status?: SongStatus | SongStatus[];
    priority?: SongPriority;
    category?: string;
    search?: string;
    limit?: number;
    /** 'list': no lyrics, chord chart or notes (they come back undefined). */
    columns?: 'list' | 'full';
  }
): Promise<{ data: Song[] | null; error: Error | null }> => {
  try {
    let query = supabase
      .from('songs')
      .select(options?.columns === 'list' ? SONG_LIST_COLUMNS : '*')
      .eq('band_id', bandId)
      .order('title', { ascending: true });

    if (options?.status) {
      if (Array.isArray(options.status)) {
        query = query.in('status', options.status);
      } else {
        query = query.eq('status', options.status);
      }
    }

    if (options?.priority) {
      query = query.eq('priority', options.priority);
    }

    if (options?.category) {
      query = query.eq('category', options.category);
    }

    if (options?.search) {
      query = query.or(`title.ilike.%${options.search}%,artist.ilike.%${options.search}%`);
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) throw error;

    // A list-columns row has no lyrics/chord_chart/notes: those fields stay undefined.
    return { data: data as unknown as Song[] | null, error: null };
  } catch (error: any) {
    return { data: null, error };
  }
};

export const createSong = async (songData: Partial<Song>): Promise<{ data: Song | null; error: Error | null }> => {
  try {
    const { data: { user } } = await getSafeUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('songs')
      .insert({
        ...songData,
        added_by: user.id,
      })
      .select()
      .single();

    if (error) throw error;

    return { data, error: null };
  } catch (error: any) {
    return { data: null, error };
  }
};

/** One song as stored now (the form reloads it after a save conflict). */
/** Song titles by id (best effort: missing ones are left out). */
export const getSongTitles = async (ids: string[]): Promise<Record<string, string>> => {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  try {
    const { data, error } = await supabase.from('songs').select('id, title').in('id', unique);
    if (error || !Array.isArray(data)) return {};
    return Object.fromEntries((data as { id: string; title: string }[]).map((r) => [r.id, r.title]));
  } catch {
    return {};
  }
};

export const getSong = async (songId: string): Promise<{ data: Song | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase.from('songs').select('*').eq('id', songId).single();
    if (error) throw error;
    return { data: data as Song, error: null };
  } catch (error: any) {
    return { data: null, error };
  }
};

export const updateSong = async (
  songId: string,
  updates: SongChanges
): Promise<{ data: Song | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from('songs')
      .update(updates)
      .eq('id', songId)
      .select()
      .single();

    if (error) throw error;

    return { data, error: null };
  } catch (error: any) {
    return { data: null, error };
  }
};

export const deleteSong = async (songId: string): Promise<{ error: Error | null }> => {
  try {
    const { data: existing } = await supabase
      .from('songs')
      .select('audio_url, chart_url')
      .eq('id', songId)
      .maybeSingle();

    // RLS lets only band admins delete songs; for anyone else the delete
    // "succeeds" with zero rows, so ask for the deleted ids back.
    const { data: deleted, error } = await supabase
      .from('songs')
      .delete()
      .eq('id', songId)
      .select('id');

    if (error) throw error;
    if (!deleted || deleted.length === 0) {
      throw permissionError('Only band admins can delete songs.');
    }
    // Files in storage go with the song (only once it is really gone).
    await removeSongFiles([existing?.audio_url, existing?.chart_url]);

    return { error: null };
  } catch (error: any) {
    return { error };
  }
};

/** Today as "YYYY-MM-DD" on this device. */
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Upcoming gigs that use any of these setlists (for delete confirmations). */
export const getUpcomingGigsForSetlists = async (
  setlistIds: string[],
): Promise<{ data: { title: string; date: string }[] | null; error: Error | null }> => {
  if (setlistIds.length === 0) return { data: [], error: null };
  try {
    const { data, error } = await supabase
      .from('events')
      .select('title, event_date')
      .in('setlist_id', setlistIds)
      .gte('event_date', localToday())
      .order('event_date', { ascending: true })
      .limit(50);
    if (error) throw error;
    return { data: (data || []).map((e: { title?: string | null; event_date: string }) => ({ title: e.title || '', date: e.event_date })), error: null };
  } catch (error: any) {
    return { data: null, error };
  }
};

/** Where a song is used: setlist names and the upcoming gigs playing them. Null when it can't be looked up. */
export const getSongUsage = async (songId: string): Promise<{ setlists: string[]; gigs: { title: string; date: string }[] } | null> => {
  try {
    const { data, error } = await supabase.from('setlist_songs').select('setlist_id, setlist:setlists(name)').eq('song_id', songId);
    if (error) throw error;
    const rows = (data || []) as unknown as { setlist_id: string; setlist?: { name?: string | null } | null }[];
    const ids = [...new Set(rows.map((r) => r.setlist_id))];
    const names = [...new Set(rows.map((r) => r.setlist?.name || '').filter(Boolean))];
    const gigs = await getUpcomingGigsForSetlists(ids);
    if (gigs.error) throw gigs.error;
    return { setlists: names, gigs: gigs.data || [] };
  } catch {
    return null;
  }
};

export const bulkCreateSongs = async (
  bandId: string,
  songs: Omit<Song, 'id' | 'band_id' | 'created_at' | 'updated_at'>[]
): Promise<{ data: Song[] | null; error: Error | null }> => {
  try {
    const { data: { user } } = await getSafeUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('songs')
      .insert(
        songs.map(s => ({
          ...s,
          band_id: bandId,
          added_by: user.id,
        }))
      )
      .select();

    if (error) throw error;

    return { data, error: null };
  } catch (error: any) {
    return { data: null, error };
  }
};

export const seedRepertoireSongs = async (
  bandId: string
): Promise<{ data: Song[] | null; count: number; error: Error | null }> => {
  try {
    const { data: { user } } = await getSafeUser();
    if (!user) throw new Error('Not authenticated');

    const { REPERTOIRE_SONGS } = await import('@/app/data/repertoire-songs');

    const { data: existing } = await supabase
      .from('songs')
      .select('title, artist')
      .eq('band_id', bandId);

    const existingSet = new Set(
      (existing || []).map(s => `${s.title}|||${s.artist}`)
    );

    const newSongs = REPERTOIRE_SONGS.filter(
      s => !existingSet.has(`${s.title}|||${s.artist}`)
    );

    if (newSongs.length === 0) {
      return { data: [], count: 0, error: null };
    }

    const BATCH_SIZE = 100;
    const allInserted: Song[] = [];

    for (let i = 0; i < newSongs.length; i += BATCH_SIZE) {
      const batch = newSongs.slice(i, i + BATCH_SIZE);
      const { data, error } = await supabase
        .from('songs')
        .insert(
          batch.map(s => ({
            ...s,
            band_id: bandId,
            added_by: user.id,
          }))
        )
        .select();

      if (error) throw error;
      if (data) allInserted.push(...data);
    }

    return { data: allInserted, count: allInserted.length, error: null };
  } catch (error: any) {
    return { data: null, count: 0, error };
  }
};

// ============================================
// SETLISTS CRUD
// ============================================

export const getSetlists = async (
  bandId: string,
  options?: {
    isTemplate?: boolean;
    limit?: number;
  }
): Promise<{ data: Setlist[] | null; error: Error | null }> => {
  try {
    let query = supabase
      .from('setlists')
      .select('*')
      .eq('band_id', bandId)
      .order('created_at', { ascending: false });

    if (options?.isTemplate !== undefined) {
      query = query.eq('is_template', options.isTemplate);
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Live totals: the stored song_count / total_duration_seconds can be stale
    // (the duration was never written), so count from the setlist's songs.
    const ids = (data || []).map((s: Setlist) => s.id);
    if (ids.length > 0) {
      const { data: rows, error: rowsError } = await supabase
        .from('setlist_songs')
        .select('setlist_id, song:songs (duration_seconds)')
        .in('setlist_id', ids);
      if (!rowsError && rows) {
        const totals = new Map<string, { count: number; seconds: number }>();
        for (const r of rows as Array<{ setlist_id: string; song?: { duration_seconds?: number | null } | null }>) {
          const t = totals.get(r.setlist_id) || { count: 0, seconds: 0 };
          t.count += 1;
          t.seconds += r.song?.duration_seconds || 0;
          totals.set(r.setlist_id, t);
        }
        return {
          data: (data || []).map((s: Setlist) => {
            const t = totals.get(s.id);
            return { ...s, song_count: t?.count ?? 0, total_duration_seconds: t?.seconds ?? 0 };
          }),
          error: null,
        };
      }
    }

    return { data, error: null };
  } catch (error: any) {
    return { data: null, error };
  }
};

/**
 * The song ids of several setlists, in running order, from one query that
 * downloads no song data (getSetlist loads every full song of one setlist).
 */
export const getSetlistSongIds = async (
  setlistIds: string[]
): Promise<{ data: Map<string, string[]>; error: Error | null }> => {
  const ids = new Map<string, string[]>();
  if (setlistIds.length === 0) return { data: ids, error: null };
  const { data, error } = await supabase
    .from('setlist_songs')
    .select('setlist_id, song_id')
    .in('setlist_id', setlistIds)
    .order('set_number', { ascending: true })
    .order('position', { ascending: true });
  if (error) return { data: ids, error };
  for (const row of (data ?? []) as { setlist_id: string; song_id: string }[]) {
    const list = ids.get(row.setlist_id) ?? [];
    list.push(row.song_id);
    ids.set(row.setlist_id, list);
  }
  return { data: ids, error: null };
};

export const getSetlist = async (setlistId: string): Promise<{ data: SetlistWithSongs | null; error: Error | null }> => {
  try {
    const { data: setlist, error: setlistError } = await supabase
      .from('setlists')
      .select('*')
      .eq('id', setlistId)
      .single();

    if (setlistError) throw setlistError;

    // Get setlist songs with song data
    const { data: songs, error: songsError } = await supabase
      .from('setlist_songs')
      .select(`
        *,
        song:songs (*)
      `)
      .eq('setlist_id', setlistId)
      .order('set_number', { ascending: true })
      .order('position', { ascending: true });

    if (songsError) throw songsError;

    return {
      data: {
        ...setlist,
        songs: songs || [],
      },
      error: null,
    };
  } catch (error: any) {
    return { data: null, error };
  }
};

export const createSetlist = async (
  setlistData: Partial<Setlist>,
  songs?: { song_id: string; position: number; set_number?: number; notes?: string }[]
): Promise<{ data: Setlist | null; error: Error | null }> => {
  try {
    const { data: { user } } = await getSafeUser();
    if (!user) throw new Error('Not authenticated');

    const { data: setlist, error: insertError } = await supabase
      .from('setlists')
      .insert({
        ...setlistData,
        created_by: user.id,
        song_count: songs?.length || 0,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Add songs if provided
    if (songs && songs.length > 0) {
      const { error: songsError } = await supabase
        .from('setlist_songs')
        .insert(
          songs.map(s => ({
            ...s,
            setlist_id: setlist.id,
          }))
        );

      if (songsError) {
        // Don't leave an empty setlist behind that looks like it saved.
        await supabase.from('setlists').delete().eq('id', setlist.id);
        throw songsError;
      }
    }

    return { data: setlist, error: null };
  } catch (error: any) {
    return { data: null, error };
  }
};

export const updateSetlist = async (
  setlistId: string,
  updates: Partial<Setlist>
): Promise<{ data: Setlist | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from('setlists')
      .update(updates)
      .eq('id', setlistId)
      .select()
      .single();

    if (error) throw error;

    return { data, error: null };
  } catch (error: any) {
    return { data: null, error };
  }
};

export const deleteSetlist = async (setlistId: string): Promise<{ error: Error | null }> => {
  try {
    const { data: deleted, error } = await supabase
      .from('setlists')
      .delete()
      .eq('id', setlistId)
      .select('id');

    if (error) throw error;
    if (!deleted || deleted.length === 0) {
      throw permissionError('This setlist could not be deleted. You may not have permission.');
    }

    return { error: null };
  } catch (error: any) {
    return { error };
  }
};

// ============================================
// SETLIST SONGS
// ============================================

/** Recount a setlist's songs and store it on the setlist (there is no RPC for this). */
const refreshSetlistSongCount = async (setlistId: string): Promise<void> => {
  const { count, error } = await supabase
    .from('setlist_songs')
    .select('id', { count: 'exact', head: true })
    .eq('setlist_id', setlistId);
  if (error || count == null) return;
  await supabase.from('setlists').update({ song_count: count }).eq('id', setlistId);
};

export const addSongToSetlist = async (
  setlistId: string,
  songId: string,
  position: number,
  setNumber: number = 1
): Promise<{ data: SetlistSong | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from('setlist_songs')
      .insert({
        setlist_id: setlistId,
        song_id: songId,
        position,
        set_number: setNumber,
      })
      .select()
      .single();

    if (error) throw error;

    await refreshSetlistSongCount(setlistId);

    return { data, error: null };
  } catch (error: any) {
    return { data: null, error };
  }
};

export const removeSongFromSetlist = async (setlistSongId: string): Promise<{ error: Error | null }> => {
  try {
    // Get setlist_id before deleting
    const { data: setlistSong } = await supabase
      .from('setlist_songs')
      .select('setlist_id')
      .eq('id', setlistSongId)
      .maybeSingle();

    const { error } = await supabase
      .from('setlist_songs')
      .delete()
      .eq('id', setlistSongId);

    if (error) throw error;

    if (setlistSong?.setlist_id) {
      await refreshSetlistSongCount(setlistSong.setlist_id);
    }

    return { error: null };
  } catch (error: any) {
    return { error };
  }
};

/** One entry for replaceSetlistSongs: a song id, or a song id with its set. */
export type SetlistSongInput =
  | string
  /** `id`: the row this entry is (Stage's order): it keeps that row, never matched by song. */
  | { song_id: string; set_number?: number; notes?: string | null; id?: string };

type PreviousSetlistRow = { song_id: string; set_number: number | null; position: number };

/**
 * A setlist as an editor loaded it: its name and its songs in play order.
 * A save that carries it is written only while the setlist is still that
 * (188); otherwise it returns what is stored now as `conflict`. A song with
 * `id` checks that row is still in that place (the same song twice swapped
 * is a change); with `vocal_parts`, that who sings it is unchanged.
 */
export type SetlistStateSong = { song_id: string; set_number: number; id?: string; vocal_parts?: unknown };
export type SetlistState = { name: string; songs: SetlistStateSong[] };

/** A setlist's rows as a save left them, in play order (188 `rows`). */
export type SavedSetlistRow = { id: string; song_id: string; set_number: number; position: number };

/**
 * Stored rows → their running order, as SetlistState has it: each with its
 * row id, and who sings it when `withVoices` (rows read with vocal_parts).
 */
export const setlistOrder = (
  rows: { id?: string; song_id: string; position: number; set_number?: number | null; vocal_parts?: unknown }[],
  opts?: { withVoices?: boolean }
): SetlistStateSong[] =>
  [...rows]
    .sort((a, b) => (a.set_number ?? 1) - (b.set_number ?? 1) || a.position - b.position || String(a.id ?? '').localeCompare(String(b.id ?? '')))
    .map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      song_id: r.song_id,
      set_number: r.set_number ?? 1,
      ...(opts?.withVoices ? { vocal_parts: r.vocal_parts ?? null } : {}),
    }));

type SetlistExpected = SetlistState | Pick<SetlistState, 'songs'>;

/** `stored` is still what `expected` was, checked like 188 (ids and singers when expected has them). */
export const setlistMatches = (stored: SetlistState, expected: SetlistState) =>
  stored.name === expected.name &&
  stored.songs.length === expected.songs.length &&
  expected.songs.every((x, i) => {
    const s = stored.songs[i];
    return (
      x.song_id === s.song_id &&
      (x.set_number ?? 1) === (s.set_number ?? 1) &&
      (!x.id || x.id === s.id) &&
      (!('vocal_parts' in x) || voicesKey(x.vocal_parts) === voicesKey(s.vocal_parts))
    );
  });

/** The function from 188 isn't on the server yet (older database). */
const isMissingFunction = (e: unknown) => {
  const err = e as { code?: string; message?: string } | null;
  return !!err && (err.code === 'PGRST202' || err.code === '42883' || /could not find the function/i.test(err.message || ''));
};

const setlistEntry = (entry: SetlistSongInput) => {
  const item = typeof entry === 'string' ? { song_id: entry } : entry;
  const setNumber =
    typeof item.set_number === 'number' && Number.isFinite(item.set_number) && item.set_number >= 1
      ? Math.floor(item.set_number)
      : 1;
  return {
    ...('id' in item && item.id ? { id: item.id } : {}),
    song_id: item.song_id,
    set_number: setNumber,
    ...('notes' in item && item.notes !== undefined ? { notes: item.notes } : {}),
  };
};

/**
 * Replace a setlist's songs with `songs`, in order, and rename it when
 * `opts.name` is given.
 *
 * One request, one transaction on the server (bw_save_setlist_songs, 188):
 * if anything fails, or the app closes half-way, the setlist stays exactly
 * as it was (audit 09 #3: the old delete + insert could leave it empty).
 * Accepts plain song ids (old callers, everything goes in set 1) or objects
 * carrying `set_number`, so multi-set setlists keep their sets. Notes and
 * who-sings-what already stored for a song are kept unless the caller passes
 * new notes. `previous` is the order before the save (setlistChanges.ts).
 */
export const replaceSetlistSongs = async (
  setlistId: string,
  songs: SetlistSongInput[],
  /** expected without a name: only the songs are checked (a Stage order). */
  opts?: { name?: string; expected?: SetlistExpected }
): Promise<{ error: Error | null; previous?: PreviousSetlistRow[]; conflict?: SetlistState; rows?: SavedSetlistRow[] }> => {
  const entries = songs.map(setlistEntry);
  const name = opts?.name?.trim() || null;
  const expected = opts?.expected;
  try {
    const res = await supabase.rpc('bw_save_setlist_songs', {
      p_setlist_id: setlistId,
      p_songs: entries,
      p_name: name,
      ...(expected ? { p_expected: expected } : {}),
    });
    if (!res?.error) {
      const out = (res?.data ?? {}) as { previous?: PreviousSetlistRow[]; conflict?: boolean; current?: SetlistState; rows?: SavedSetlistRow[] };
      if (out.conflict && out.current) return { error: null, conflict: out.current };
      return {
        error: null,
        previous: Array.isArray(out.previous) ? out.previous : [],
        ...(Array.isArray(out.rows) ? { rows: out.rows } : {}),
      };
    }
    if (!isMissingFunction(res.error)) return { error: res.error as unknown as Error };
  } catch (error: any) {
    if (!isMissingFunction(error)) return { error };
  }
  // Database without 188 yet: the step-by-step save older builds use. The
  // name goes last, with the count, so a failed save never leaves it renamed.
  return replaceSetlistSongsStepwise(setlistId, entries, name, expected);
};

/**
 * Before 188: read, delete, insert (put the old rows back if that fails),
 * recount. Like 188, the n-th time a song appears takes the n-th stored row
 * of that song: its id, notes and vocal_parts (who sings what for this gig,
 * 172) stay. When only the name changed, no row is rewritten at all.
 */
const replaceSetlistSongsStepwise = async (
  setlistId: string,
  entries: ReturnType<typeof setlistEntry>[],
  name: string | null = null,
  expected?: SetlistExpected
): Promise<{ error: Error | null; previous?: PreviousSetlistRow[]; conflict?: SetlistState; rows?: SavedSetlistRow[] }> => {
  try {
    // Read the current rows first so a failed insert can be undone. Every
    // column, so a database with 172 hands back vocal_parts and one without
    // it doesn't fail.
    const { data: previous, error: readError } = await supabase
      .from('setlist_songs')
      .select('*')
      .eq('setlist_id', setlistId);

    if (readError) throw readError;
    type StoredRow = {
      id: string;
      setlist_id: string;
      song_id: string;
      position: number;
      set_number: number | null;
      notes: string | null;
      vocal_parts?: unknown;
    };
    const previousRows = (previous || []) as StoredRow[];
    // In play order, like 188 and the editor.
    const ordered = [...previousRows].sort(
      (a, b) => (a.set_number ?? 1) - (b.set_number ?? 1) || a.position - b.position || String(a.id).localeCompare(String(b.id))
    );
    // Changed since the editor loaded it: nothing is written.
    if (expected) {
      const { data: head, error: headError } = await supabase.from('setlists').select('name').eq('id', setlistId).single();
      if (headError) throw headError;
      const current: SetlistState = { name: (head as { name?: string } | null)?.name ?? '', songs: setlistOrder(previousRows, { withVoices: true }) };
      if (!setlistMatches(current, { name: current.name, ...expected })) return { error: null, conflict: current };
    }
    const hasVoices = previousRows.some((r) => 'vocal_parts' in r);
    // An entry naming its row keeps it (like 188); the rest match by song.
    const named = new Map<number, StoredRow>();
    entries.forEach((item, i) => {
      const r = 'id' in item && item.id ? ordered.find((o) => o.id === item.id && o.song_id === item.song_id) : undefined;
      if (r && ![...named.values()].includes(r)) named.set(i, r);
    });
    const claimed = new Set([...named.values()].map((r) => r.id));
    const bySong = new Map<string, StoredRow[]>();
    for (const r of ordered) if (!claimed.has(r.id)) bySong.set(r.song_id, [...(bySong.get(r.song_id) ?? []), r]);

    const rows = entries.map((item, i) => {
      const kept = named.get(i) ?? bySong.get(item.song_id)?.shift();
      return {
        ...(kept ? { id: kept.id } : {}),
        setlist_id: setlistId,
        song_id: item.song_id,
        position: i + 1,
        set_number: item.set_number,
        notes: 'notes' in item ? (item.notes ?? null) : kept?.notes ?? null,
        ...(hasVoices ? { vocal_parts: kept?.vocal_parts ?? null } : {}),
      };
    });

    // Same songs, sets, notes and positions (a rename): nothing to rewrite.
    const unchanged =
      rows.length === ordered.length &&
      rows.every((r, i) => {
        const o = ordered[i];
        return r.id === o.id && r.position === o.position && r.set_number === (o.set_number ?? 1) && r.notes === (o.notes ?? null);
      });

    let inserted: { id?: string }[] | null = null;
    if (!unchanged) {
      const { error: deleteError } = await supabase
        .from('setlist_songs')
        .delete()
        .eq('setlist_id', setlistId);

      if (deleteError) throw deleteError;

      if (rows.length > 0) {
        // New rows (no id) take the column defaults, not null.
        const { data: added, error: insertError } = await supabase
          .from('setlist_songs')
          .insert(rows, { defaultToNull: false })
          .select('id');
        inserted = Array.isArray(added) ? (added as { id?: string }[]) : null;

        if (insertError) {
          if (previousRows.length > 0) {
            const { error: restoreError } = await supabase
              .from('setlist_songs')
              .insert(previousRows);
            if (restoreError) {
              console.error('Could not restore setlist songs after a failed save:', restoreError);
            }
          }
          throw insertError;
        }
      }
    }

    const { error: updateError } = await supabase
      .from('setlists')
      .update({ song_count: rows.length, ...(name ? { name } : {}) })
      .eq('id', setlistId);

    if (updateError) throw updateError;

    // What was there before, in play order: callers sum up the change (setlistChanges.ts).
    const before = ordered
      .map(({ song_id, set_number, position }) => ({ song_id, set_number, position }));
    // The rows as saved, new ones with their new ids (inserted in this order).
    const saved = rows.map((r, i) => ({
      id: (r as { id?: string }).id ?? (inserted?.[i]?.id as string),
      song_id: r.song_id,
      set_number: r.set_number,
      position: r.position,
    }));
    return { error: null, previous: before, ...(saved.every((r) => !!r.id) ? { rows: saved } : {}) };
  } catch (error: any) {
    return { error };
  }
};

/**
 * Save a new song order for a setlist in one request (one transaction), so
 * band members' apps reload it once, already in the new order. `rows` come
 * from reorderRows (src/lib/stageLive.ts). Admins only (RLS, migration 074).
 */
export const saveSetlistOrder = async (
  rows: { id: string; setlist_id: string; song_id: string; position: number; set_number: number }[]
): Promise<{ error: Error | null; status?: number }> => {
  if (rows.length === 0) return { error: null };
  try {
    const { data, error, status } = await supabase
      .from('setlist_songs')
      .upsert(rows, { onConflict: 'id', defaultToNull: false })
      .select('id');
    // The HTTP status too: a 503 is worth trying again, a refusal is not (live outbox).
    if (error) return { error, status };
    if (!data || data.length !== rows.length) {
      throw permissionError('The new order could not be saved. You may not have permission.');
    }
    return { error: null };
  } catch (error: any) {
    return { error };
  }
};

/**
 * Stage: the leader's new order (`rows`, from reorderRows), in one save (188)
 * and only over the order it was made on (`saved`, in play order). Another
 * admin removed or added a song meanwhile: nothing is written, no removed row
 * comes back (BW_SETLIST_CONFLICT). Each entry names its row, so the same
 * song twice keeps each row's notes and singers. Never a plain upsert.
 */
export const saveStageOrder = async (
  setlistId: string,
  rows: { id: string; song_id: string; set_number: number }[],
  /** With `id`: that row must still be in that place (188 checks row ids). */
  saved: { songId: string; setNumber?: number; id?: string }[]
): Promise<{ error: Error | null }> => {
  const res = await replaceSetlistSongs(
    setlistId,
    rows.map((r) => ({ id: r.id, song_id: r.song_id, set_number: r.set_number })),
    { expected: { songs: saved.map((s) => ({ ...(s.id ? { id: s.id } : {}), song_id: s.songId, set_number: s.setNumber ?? 1 })) } }
  );
  if (res.error) return { error: res.error };
  if (!res.conflict) return { error: null };
  // Changed meanwhile into exactly this order (sent before, its answer lost): saved.
  const now = res.conflict.songs;
  if (
    now.length === rows.length &&
    rows.every((r, i) => r.song_id === now[i].song_id && r.set_number === (now[i].set_number ?? 1) && (!now[i].id || now[i].id === r.id))
  )
    return { error: null };
  return { error: Object.assign(new Error('The setlist changed meanwhile.'), { code: 'BW_SETLIST_CONFLICT' }) };
};

/**
 * Save a song's lyrics only while they are still `expected` (what the editor
 * loaded), so one admin's chord edit never erases another's new verse
 * (audit 09 #6). One request, checked on the server (bw_save_song_lyrics,
 * 189). `conflict` holds the lyrics stored now when they had changed;
 * nothing was written then.
 */
export const saveSongLyricsIfUnchanged = async (
  songId: string,
  lyrics: string | null,
  expected: string | null,
  /** Other song-form columns saved in the same transaction (Transpose: key, chart). */
  fields?: SongChanges
): Promise<{ error: Error | null; conflict?: string | null }> => {
  const extra = fields && Object.keys(fields).length > 0 ? fields : null;
  try {
    const res = await supabase.rpc('bw_save_song_lyrics', {
      p_song_id: songId,
      p_lyrics: lyrics,
      p_expected: expected,
      ...(extra ? { p_fields: extra } : {}),
    });
    if (!res?.error) {
      const out = (res?.data ?? {}) as { saved?: boolean; lyrics?: string | null };
      if (out.saved === false) return { error: null, conflict: out.lyrics ?? null };
      return { error: null };
    }
    if (!isMissingFunction(res.error)) return { error: res.error as unknown as Error };
  } catch (error: any) {
    if (!isMissingFunction(error)) return { error };
  }
  // Database without 189 yet: compare, then write only over the row as it
  // was read. updated_at moves on every save (update_songs_updated_at), so a
  // bandmate's save between the read and the write makes it match no row.
  const read = async () => {
    const { data, error } = await supabase.from('songs').select('lyrics, updated_at').eq('id', songId).single();
    const row = (data ?? null) as { lyrics?: string | null; updated_at?: string | null } | null;
    return { error: error as unknown as Error | null, lyrics: row?.lyrics ?? null, updatedAt: row?.updated_at ?? null };
  };
  const now = await read();
  if (now.error) return { error: now.error };
  if (now.lyrics !== expected) return { error: null, conflict: now.lyrics };
  // One update: the lyrics and the other fields land together or not at all.
  const write = supabase.from('songs').update({ ...(extra ?? {}), lyrics }).eq('id', songId);
  const { data: written, error } = await (now.updatedAt ? write.eq('updated_at', now.updatedAt) : write.is('updated_at', null)).select('id');
  if (error) return { error: error as unknown as Error };
  if (Array.isArray(written) && written.length > 0) return { error: null };
  // Nothing written: changed meanwhile (or not this user's to change).
  const latest = await read();
  if (latest.error) return { error: latest.error };
  if (latest.lyrics === expected && latest.updatedAt === now.updatedAt) {
    return { error: permissionError('The lyrics could not be saved. You may not have permission.') };
  }
  return { error: null, conflict: latest.lyrics };
};
