/**
 * Who sings what (migration 172): songs.vocal_parts and the per-setlist
 * override setlist_songs.vocal_parts. Reads fail quietly (offline, or before
 * 172 is applied): the parts then come from each member's instrument.
 * Writes are admins' (today's song / setlist rules, enforced by RLS).
 */
import { supabase } from '@/lib/supabase';
import { parseVocalParts, type VocalParts } from '@/lib/voiceParts';

export async function fetchSongVocalParts(songIds: string[]): Promise<Record<string, VocalParts | null>> {
  const ids = [...new Set(songIds.filter(Boolean))];
  if (!ids.length) return {};
  try {
    const { data, error } = await supabase.from('songs').select('id, vocal_parts').in('id', ids);
    if (error || !data) return {};
    return Object.fromEntries((data as { id: string; vocal_parts?: unknown }[]).map((r) => [r.id, parseVocalParts(r.vocal_parts)]));
  } catch {
    return {};
  }
}

export async function fetchSetlistVocalParts(rowIds: string[]): Promise<Record<string, VocalParts | null>> {
  const ids = [...new Set(rowIds.filter(Boolean))];
  if (!ids.length) return {};
  try {
    const { data, error } = await supabase.from('setlist_songs').select('id, vocal_parts').in('id', ids);
    if (error || !data) return {};
    return Object.fromEntries((data as { id: string; vocal_parts?: unknown }[]).map((r) => [r.id, parseVocalParts(r.vocal_parts)]));
  } catch {
    return {};
  }
}

export async function saveSongVocalParts(songId: string, parts: VocalParts | null): Promise<{ error: unknown }> {
  const { error } = await supabase.from('songs').update({ vocal_parts: parts }).eq('id', songId);
  return { error };
}

/** null goes back to the song's assignment. */
export async function saveSetlistVocalParts(setlistSongId: string, parts: VocalParts | null): Promise<{ error: unknown }> {
  const { error } = await supabase.from('setlist_songs').update({ vocal_parts: parts }).eq('id', setlistSongId);
  return { error };
}
