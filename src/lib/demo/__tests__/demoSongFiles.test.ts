import { describe, expect, it, vi } from 'vitest';

// Codex review of #295 (ed7ec29f, M4): the demo had no handler for 197's
// adoption RPCs, so an accepted suggested song kept its member-folder file
// for good ("files still to move" on every visit). The demo now moves it
// the way the server does: the song links the band's copy.
vi.mock('@/lib/supabase', async () => {
  const { createDemoClient } = await import('@/lib/demo/demoClient');
  return { supabase: createDemoClient() };
});

import { supabase } from '@/lib/supabase';
import { DEMO_USER } from '@/lib/demo/seed';
import { adoptSuggestionFiles, hasUnadoptedFiles, sweepAdoptedFiles } from '@/lib/services/songFiles';

const db = supabase as any;

describe('demo: an accepted song’s files move into the band', () => {
  it('repoints the song to its band copy and has nothing left to move', async () => {
    const { data: mine } = await db.from('band_members').select('band_id, user_id, role');
    const admin = (mine as any[]).find((m) => m.user_id === DEMO_USER.id && m.role === 'admin');
    expect(admin).toBeTruthy();
    const band = admin.band_id as string;
    const id = 'demo-adopt-song';
    const from = `${band}/suggestions/member-x/audio/take.mp3`;
    await db.from('songs').insert({ id, band_id: band, title: 'Coney Island', status: 'learning', audio_url: `sb://song-files/${from}`, chart_url: null });
    const out = await adoptSuggestionFiles({ id, band_id: band, audio_url: `sb://song-files/${from}`, chart_url: null }, { busyWait: { tries: 0, ms: 0 } });
    expect(out.error).toBeNull();
    expect(out.refs.audio_url).toBe(`sb://song-files/${band}/audio/${id}-take.mp3`);
    const { data: row } = await db.from('songs').select('id, status, audio_url, chart_url').eq('id', id).maybeSingle();
    expect(row.audio_url).toBe(out.refs.audio_url);
    expect(hasUnadoptedFiles(row)).toBe(false);
    expect((await sweepAdoptedFiles(band)).error).toBeNull();
  });

  it('a song still waiting for review is not moved', async () => {
    const { data: mine } = await db.from('band_members').select('band_id, user_id, role');
    const band = (mine as any[]).find((m) => m.user_id === DEMO_USER.id && m.role === 'admin').band_id as string;
    const id = 'demo-adopt-waiting';
    const ref = `sb://song-files/${band}/suggestions/member-x/audio/wait.mp3`;
    await db.from('songs').insert({ id, band_id: band, title: 'Waiting', status: 'suggested', audio_url: ref, chart_url: null });
    const out = await adoptSuggestionFiles({ id, band_id: band, audio_url: ref, chart_url: null }, { busyWait: { tries: 0, ms: 0 } });
    expect(out).toEqual({ refs: {}, error: null });
    const { data: row } = await db.from('songs').select('audio_url').eq('id', id).maybeSingle();
    expect(row.audio_url).toBe(ref);
  });
});
