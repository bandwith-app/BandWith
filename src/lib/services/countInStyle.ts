/**
 * The band's count-in direction (bands.count_in_style, migration 171):
 * 'down' (4 3 2 1, the default) or 'up' (1 2 3 4). Read and written on its
 * own, so the rest of the band's columns (grant 080) don't depend on 171
 * being applied: before it, reads give 'down' and the choice isn't saved.
 */
import { supabase } from '@/lib/supabase';
import type { CountInStyle } from '@/lib/countIn';

export async function getCountInStyle(bandId: string): Promise<CountInStyle> {
  try {
    const { data, error } = await supabase.from('bands').select('count_in_style').eq('id', bandId).maybeSingle();
    if (error || !data) return 'down';
    return (data as { count_in_style?: string }).count_in_style === 'up' ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

export async function setCountInStyle(bandId: string, style: CountInStyle): Promise<{ error: Error | null }> {
  try {
    const { error } = await supabase.from('bands').update({ count_in_style: style }).eq('id', bandId);
    return { error: error ? new Error(error.message) : null };
  } catch (e) {
    return { error: e as Error };
  }
}
