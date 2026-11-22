import { describe, it, expect, vi, beforeEach } from 'vitest';

// Codex review of #295 (28cb3199, M1): over the band's storage quota the
// move of an accepted song's recording (a Storage copy, refused by 161's
// policy) failed silently on every retry, and the review said "accepted".
// Now: a band without room for the recording can't accept it (it stays
// pending), and a refused copy says why. Claude review of a474bbfb: only
// when the file really doesn't fit (any other refusal, e.g. an expired
// session, is the plain copy error), and "file" (it can be a chart).
const FULL = 'Band storage is full: free up space to add this file.';
const h = vi.hoisted(() => {
  const calls: string[] = [];
  const state = {
    plan: null as unknown,
    // When set, fetchBandPlan answers these in turn (then the last one).
    plans: [] as unknown[],
    copyError: null as unknown,
    size: 5 * 1048576,
  };
  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push(fn);
      if (fn === 'bw_review_song_suggestion') return { data: { status: 'accepted', song_id: 'song-1', files: [] }, error: null };
      if (fn === 'bw_song_file_adopt_begin')
        return { data: { won: true, from: 'band-1/suggestions/m-1/audio/take.mp3', to: `band-1/audio/${args.p_song_id}-take.mp3` }, error: null };
      if (fn === 'bw_song_file_copy_reserve') return { data: { registered: true, reserved_at: new Date().toISOString() }, error: null };
      if (fn === 'bw_song_file_sweep_list') return { data: [], error: null };
      return { data: null, error: null };
    }),
    from: () => {
      const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: null, error: null }) };
      return b;
    },
    storage: {
      from: () => ({
        info: async () => ({ data: { size: state.size, contentType: 'audio/mpeg' }, error: null }),
        copy: async () => (state.copyError ? { data: null, error: state.copyError } : { data: { path: 'x' }, error: null }),
        remove: async () => ({ data: [], error: null }),
      }),
    },
  };
  return { calls, state, client };
});
vi.mock('@/lib/supabase', () => ({ supabase: h.client }));
vi.mock('../../supabase', () => ({ supabase: h.client }));
vi.mock('@/lib/usePlan', () => ({
  fetchBandPlan: vi.fn(async () => (h.state.plans.length > 1 ? h.state.plans.shift() : h.state.plans[0] ?? h.state.plan)),
  knownPlan: () => null,
}));

import { adoptSuggestionFiles } from '../songFiles';
import { reviewSongSuggestion } from '../songSuggestions';

const plan = (used: number, limit: number) => ({ enforced: true, plan: 'free', limits: { storage_mb: limit }, usage: { storage_mb: used } });
const REF = 'sb://song-files/band-1/suggestions/m-1/audio/take.mp3';
const rls = { statusCode: '403', message: 'new row violates row-level security policy' };

beforeEach(() => {
  h.calls.length = 0;
  h.state.plan = null;
  h.state.plans = [];
  h.state.copyError = null;
});

describe('band storage full', () => {
  it('accepting a suggested song whose recording does not fit is refused: the suggestion stays pending', async () => {
    h.state.plan = plan(98, 100);
    const res = await reviewSongSuggestion({ id: 'sg-1', kind: 'new_song' }, 'accept', { song: { audio_url: REF, chart_url: null } });
    expect(res.status).toBeNull();
    expect(res.error?.message).toBe(FULL);
    expect(h.calls).not.toContain('bw_review_song_suggestion');
  });

  it('with room, it is accepted as before', async () => {
    h.state.plan = plan(10, 100);
    const res = await reviewSongSuggestion({ id: 'sg-1', kind: 'new_song' }, 'accept', { song: { audio_url: REF, chart_url: null } });
    expect(res).toEqual({ status: 'accepted', error: null });
  });

  it('a copy refused by the storage policy, the file not fitting the plan, says the storage is full', async () => {
    h.state.plan = plan(98, 100);
    h.state.copyError = rls;
    const out = await adoptSuggestionFiles({ id: 'song-1', band_id: 'band-1', audio_url: REF, chart_url: null }, { client: h.client as never });
    expect(out.error?.message).toBe(FULL);
  });

  it('a refused copy with room on the plan (an expired session) is the plain copy error, not storage full', async () => {
    h.state.plan = plan(10, 100);
    h.state.copyError = { statusCode: '403', message: 'Unauthorized: jwt expired' };
    const out = await adoptSuggestionFiles({ id: 'song-1', band_id: 'band-1', audio_url: REF, chart_url: null }, { client: h.client as never });
    expect(out.error?.message).not.toBe(FULL);
    expect(out.error?.message).toBe('Unauthorized: jwt expired');
  });

  it('accepted, then the move is refused (the band filled up meanwhile): never reported as approved', async () => {
    h.state.plans = [plan(10, 100), plan(98, 100)];
    h.state.copyError = rls;
    const res = await reviewSongSuggestion({ id: 'sg-1', kind: 'new_song' }, 'accept', { song: { audio_url: REF, chart_url: null } });
    expect(res.status).toBeNull();
    expect(res.error?.message).toBe(FULL);
  });
});

describe('band storage full, the words', () => {
  const KEY = 'Band storage is full: free up space to add this file.';
  it('is in all 5 languages, as a file, and French says vous like its neighbours', async () => {
    const dicts = await Promise.all(
      (['de', 'es', 'fr', 'it', 'pt'] as const).map(async (l) => [l, (await import(`../../i18n/locales/${l}.ts`)).default] as const),
    );
    for (const [l, d] of dicts) expect(d[KEY], l).toBeTruthy();
    const fr = dicts.find(([l]) => l === 'fr')![1][KEY] as string;
    expect(fr).toMatch(/libérez/);
    expect(fr).not.toMatch(/libère |enregistrement/);
  });
});
