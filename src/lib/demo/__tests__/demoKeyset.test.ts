import { describe, expect, it, vi } from 'vitest';

// Codex review of #295: the suggestions list pages with a keyset filter
// (created_at.lt."T",and(created_at.eq."T",id.lt."I")). The demo compared the
// values with their quotes still on, so no older page ever came back and the
// oldest suggestion could not be reached in the demo.
vi.mock('@/lib/supabase', async () => {
  const { createDemoClient } = await import('@/lib/demo/demoClient');
  return { supabase: createDemoClient() };
});

import { supabase } from '@/lib/supabase';
import { listSongSuggestions } from '@/lib/services/songSuggestions';

describe('demo keyset pages', () => {
  it('reaches every suggestion, oldest included, one page at a time', async () => {
    const { data: all } = await (supabase as any).from('song_suggestions').select('id, band_id, created_at');
    expect(all.length).toBeGreaterThanOrEqual(3);
    const bandId = all[0].band_id;
    const want = all.filter((r: any) => r.band_id === bandId).length;
    const seen: string[] = [];
    let before: { created_at: string; id: string } | undefined;
    for (let n = 0; n < want + 2; n++) {
      const { data, error } = await listSongSuggestions(bandId, { limit: 1, before });
      expect(error).toBeNull();
      if (!data?.length) break;
      seen.push(data[0].id);
      before = data[0];
    }
    expect(seen.length).toBe(want);
    expect(new Set(seen).size).toBe(want);
  });

  it('handles quoted values with commas and parentheses inside', async () => {
    const { data } = await (supabase as any)
      .from('song_suggestions')
      .select('id')
      .or('message.eq."We always sing “snow” live, and Lena plays a Dm there.",id.eq."nope"');
    expect(data.length).toBe(1);
  });
});
