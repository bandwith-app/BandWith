import { useSyncExternalStore } from 'react';
import { isOfflineError } from '../offline/networkErrors';
import { queueLiveOp } from '../liveOutbox';
import { newLocalId, sessionUserId } from '../sessionUser';
import { supabase } from '../supabase';
import { UserError } from '../userError';
import { t } from '@/lib/i18n';
import { adoptSuggestionFiles, removeSongFiles } from './songFiles';
import type { SongChart } from '../ireal';
import type { SongSuggestion, SuggestionKind, SuggestionStatus } from '../songSuggestions';

/**
 * Members suggest, admins review (migration 108). Rows are read under RLS:
 * admins get the band's, a member only their own. Changes go through
 * bw_review_song_suggestion / bw_withdraw_song_suggestion.
 */

const SELECT =
  '*, author:profiles!song_suggestions_created_by_fkey(id, full_name, email, avatar_url), reviewer:profiles!song_suggestions_reviewed_by_fkey(id, full_name, email, avatar_url)';

export async function listSongSuggestions(
  bandId: string,
  opts?: { status?: SuggestionStatus | SuggestionStatus[]; createdBy?: string; songId?: string; limit?: number },
): Promise<{ data: SongSuggestion[] | null; error: Error | null }> {
  try {
    let q = supabase.from('song_suggestions').select(SELECT).eq('band_id', bandId).order('created_at', { ascending: false });
    if (opts?.status) q = Array.isArray(opts.status) ? q.in('status', opts.status) : q.eq('status', opts.status);
    if (opts?.createdBy) q = q.eq('created_by', opts.createdBy);
    if (opts?.songId) q = q.eq('song_id', opts.songId);
    q = q.limit(opts?.limit ?? 200);
    const { data, error } = await q;
    if (error) throw error;
    return { data: (data || []) as unknown as SongSuggestion[], error: null };
  } catch (error: any) {
    return { data: null, error };
  }
}

/** A correction to a band song, or a note for the band. */
/** Lyrics, a note and a message over the server's limits (108): the message to show, else null. */
export const SUGGESTION_LIMITS = { lyrics: 100_000, note: 2000, message: 1000 } as const;
function suggestionTooLong(input: { kind: string; lyrics?: string; note?: string; message?: string }): string | null {
  const over = (text: string | undefined, max: number) => (text ?? '').length > max;
  if (input.kind !== 'note' && over(input.lyrics, SUGGESTION_LIMITS.lyrics)) {
    return t('The lyrics are too long to save: {count} characters, the limit is {max}. Shorten them, the full text stays here.', {
      count: (input.lyrics ?? '').length,
      max: SUGGESTION_LIMITS.lyrics,
    });
  }
  const note = input.kind === 'note' ? (input.note ?? '').trim() : '';
  if (over(note, SUGGESTION_LIMITS.note)) {
    return t('This suggestion is too long to send: {count} characters, the limit is {max}.', { count: note.length, max: SUGGESTION_LIMITS.note });
  }
  const message = input.message?.trim() ?? '';
  if (over(message, SUGGESTION_LIMITS.message)) {
    return t('This suggestion is too long to send: {count} characters, the limit is {max}.', { count: message.length, max: SUGGESTION_LIMITS.message });
  }
  return null;
}

export async function suggestSongChange(input: {
  bandId: string;
  songId: string;
  kind: Exclude<SuggestionKind, 'new_song'>;
  lyrics?: string;
  chordChart?: SongChart | null;
  note?: string;
  message?: string;
}): Promise<{ data: SongSuggestion | null; error: Error | null; queued?: true }> {
  // The server's limits (108), said here first: a change it would refuse is
  // never sent, nor queued to block the others (Codex review #292 round 6).
  const tooLong = suggestionTooLong(input);
  if (tooLong) return { data: null, error: new UserError(tooLong) };
  let row: Record<string, unknown> | null = null;
  // Whose change it is, read before the request: queued only for that account.
  const owner = await sessionUserId();
  try {
    const proposed =
      input.kind === 'note'
        ? { note: (input.note || '').trim() }
        : {
            ...(input.lyrics !== undefined ? { lyrics: input.lyrics } : {}),
            ...(input.chordChart ? { chord_chart: input.chordChart } : {}),
          };
    row = {
      band_id: input.bandId,
      song_id: input.songId,
      kind: input.kind,
      proposed,
      message: input.message?.trim() || null,
      ...(owner ? { created_by: owner } : {}),
    };
    const { data, error } = await supabase.from('song_suggestions').insert(row).select('*').single();
    if (error) throw error;
    notifySuggestionsChanged();
    return { data: data as unknown as SongSuggestion, error: null };
  } catch (error: any) {
    // No signal (a venue, a basement): kept on this phone, sent when back online.
    // Re-read now: a tab switched to another account meanwhile queues nothing.
    const me = row && owner && isOfflineError(error) ? await sessionUserId() : null;
    if (row && me && me === owner) {
      queueLiveOp(me, { kind: 'suggestion', id: newLocalId(), row });
      return { data: null, error: null, queued: true };
    }
    return { data: null, error };
  }
}

export interface ReviewOptions {
  reason?: string;
  /** Accept with changes: the fields to write instead of the proposal. */
  applied?: { lyrics?: string | null; chord_chart?: SongChart | null; notes?: string | null };
}

/** Accept (as it is, or with `applied`) or reject; tells the member. */
export async function reviewSongSuggestion(
  suggestion: Pick<SongSuggestion, 'id' | 'kind'>,
  decision: 'accept' | 'reject',
  opts: ReviewOptions & { edited?: boolean; song?: { audio_url?: string | null; chart_url?: string | null } | null } = {},
): Promise<{ status: SuggestionStatus | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('bw_review_song_suggestion', {
      p_id: suggestion.id,
      p_decision: decision,
      p_reason: opts.reason?.trim() || null,
      p_applied: opts.applied ?? null,
      p_edited: !!(opts.edited || opts.applied),
    });
    if (error) throw error;
    const res = (data || {}) as { status?: SuggestionStatus; song_id?: string; files?: string[] };
    // A rejected suggested song is gone: so are its files.
    if (res.files?.length) await removeSongFiles(res.files);
    // An accepted one keeps them, moved into the band's folders.
    if (decision === 'accept' && suggestion.kind === 'new_song' && res.song_id && opts.song) {
      const moved = await adoptSuggestionFiles(opts.song);
      if (Object.keys(moved).length > 0) {
        await supabase.from('songs').update(moved).eq('id', res.song_id);
      }
    }
    notifySuggestionsChanged();
    return { status: res.status ?? null, error: null };
  } catch (error: any) {
    return { status: null, error };
  }
}

/** The author takes a pending suggestion back. */
export async function withdrawSongSuggestion(id: string): Promise<{ error: Error | null }> {
  try {
    const { data, error } = await supabase.rpc('bw_withdraw_song_suggestion', { p_id: id });
    if (error) throw error;
    const files = ((data || {}) as { files?: string[] }).files;
    if (files?.length) await removeSongFiles(files);
    notifySuggestionsChanged();
    return { error: null };
  } catch (error: any) {
    return { error };
  }
}

/** Pending suggestions: the band's for admins, your own for members (RLS). 0 when offline. */
export async function countPendingSuggestions(bandId: string, createdBy?: string): Promise<number> {
  try {
    let q = supabase
      .from('song_suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('band_id', bandId)
      .eq('status', 'pending');
    if (createdBy) q = q.eq('created_by', createdBy);
    const { count, error } = await q;
    return error ? 0 : count || 0;
  } catch {
    return 0;
  }
}

// ── The review screen, opened from anywhere (repertoire, inbox, push) ──

export interface SuggestionsScreen {
  /** Open this suggestion's detail. */
  suggestionId?: string;
}

let screen: SuggestionsScreen | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export const openSongSuggestions = (s: SuggestionsScreen = {}) => {
  screen = { ...s };
  emit();
};
export const closeSongSuggestions = () => {
  screen = null;
  emit();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useSongSuggestionsScreen = () => useSyncExternalStore(subscribe, () => screen, () => screen);

// ── "Suggest a change" for one song (members), from anywhere ──

export interface SuggestTarget {
  id: string;
  band_id: string;
  title: string;
  artist?: string | null;
  lyrics?: string | null;
  notes?: string | null;
  /** Which part to start on. */
  start?: 'text' | 'note';
  /** A note to start from (e.g. one of my personal notes). */
  note?: string;
}

let suggestTarget: SuggestTarget | null = null;
const suggestListeners = new Set<() => void>();
export const openSuggestChange = (song: SuggestTarget) => {
  suggestTarget = { ...song };
  suggestListeners.forEach((l) => l());
};
export const closeSuggestChange = () => {
  suggestTarget = null;
  suggestListeners.forEach((l) => l());
};
const subscribeSuggest = (l: () => void) => {
  suggestListeners.add(l);
  return () => suggestListeners.delete(l);
};
export const useSuggestChangeTarget = () => useSyncExternalStore(subscribeSuggest, () => suggestTarget, () => suggestTarget);

/** Lists and counts refresh after a review, a withdrawal or a new suggestion. */
export const SUGGESTIONS_CHANGED = 'bw:song-suggestions-changed';
export const notifySuggestionsChanged = () => {
  try {
    window.dispatchEvent(new CustomEvent(SUGGESTIONS_CHANGED));
  } catch {
    /* no window (tests) */
  }
};
