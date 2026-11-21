import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const native = { on: true };
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.on } }));
const rows = [
  { setlist_id: 's1', song: { audio_url: 'a1' } },
  { setlist_id: 's1', song: { audio_url: null } },
  { setlist_id: 's1', song: { audio_url: 'a2' } },
];
const inSpy = vi.fn(async () => ({ data: rows, error: null }));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ in: inSpy }) }) },
}));
const store = new Set<string>(['a1']);
vi.mock('@/lib/regiaAudio', () => ({
  cachedAudio: vi.fn(async (refs: string[]) => new Set(refs.filter((r) => store.has(r)))),
  downloadAudio: vi.fn(async (ref: string) => {
    store.add(ref);
    return { ok: true };
  }),
}));

import { useAudioPrefetch } from '../useAudioPrefetch';
import { downloadAudio } from '@/lib/regiaAudio';

const today = new Date();
const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
const gig = { setlistId: 's1', date: ymd, status: 'CONFIRMED', band_id: 'b1' };

beforeEach(() => {
  native.on = true;
  store.clear();
  store.add('a1');
  inSpy.mockClear();
  vi.mocked(downloadAudio).mockClear();
});

describe('audio pre-download when the app opens', () => {
  it('an admin’s phone fetches the missing song files of a gig in the next days', async () => {
    renderHook(() => useAudioPrefetch([gig], () => true));
    await waitFor(() => expect(downloadAudio).toHaveBeenCalledTimes(1));
    expect(inSpy).toHaveBeenCalledWith('setlist_id', ['s1']);
    expect(vi.mocked(downloadAudio).mock.calls[0][0]).toBe('a2');
  });

  it('not on the web, not for members, not with no gig soon', async () => {
    native.on = false;
    renderHook(() => useAudioPrefetch([gig], () => true));
    renderHook(() => useAudioPrefetch([gig], () => false));
    renderHook(() => useAudioPrefetch([{ ...gig, date: '2020-01-01' }], () => true));
    await new Promise((r) => setTimeout(r, 20));
    expect(inSpy).not.toHaveBeenCalled();
    expect(downloadAudio).not.toHaveBeenCalled();
  });

  it('runs once per set of gigs, not on every render', async () => {
    const { rerender } = renderHook(({ list }) => useAudioPrefetch(list, () => true), { initialProps: { list: [gig] } });
    await waitFor(() => expect(downloadAudio).toHaveBeenCalledTimes(1));
    rerender({ list: [{ ...gig }] });
    await new Promise((r) => setTimeout(r, 20));
    expect(inSpy).toHaveBeenCalledTimes(1);
  });
});
