import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';

// "Who sings what" with no signal: the assignment comes with the setlist
// song (the live pack carries songs.vocal_parts and the gig's override), so
// the legend reads it when the server can't be asked. Before, offline, the
// parts fell back to each member's instrument: a lead singer put on Backing
// for one song read "Lead · you". Made-up band and song (New York).

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));
const ME = '11111111-1111-4111-8111-111111111111';
const AVA = '22222222-2222-4222-8222-222222222222';
vi.mock('@/lib/BandContext', () => ({
  useOptionalBand: () => ({
    isAdmin: false,
    selectedBand: {
      id: 'b1',
      members: [
        // By instrument alone I would be the lead.
        { user_id: ME, instrument: 'Lead vocals', is_active: true, profile: { full_name: 'Leo M.' } },
        { user_id: AVA, instrument: 'Keys', is_active: true, profile: { full_name: 'Ava R.' } },
      ],
    },
  }),
}));
vi.mock('@/lib/AuthContext', () => ({ useOptionalAuth: () => ({ user: { id: ME } }) }));
// No signal: the reads fail quietly, as services/vocalParts does offline.
const fetchSong = vi.fn(async (_ids: string[]): Promise<Record<string, unknown>> => ({}));
const fetchRow = vi.fn(async (_ids: string[]): Promise<Record<string, unknown>> => ({}));
vi.mock('@/lib/services/vocalParts', () => ({
  fetchSongVocalParts: (ids: string[]) => fetchSong(ids),
  fetchSetlistVocalParts: (ids: string[]) => fetchRow(ids),
  saveSongVocalParts: async () => ({ error: null }),
  saveSetlistVocalParts: async () => ({ error: null }),
}));

import { StageMode, type StageSong } from '../StageMode';
import { FloorWedgeMode } from '@/app/components/duo/modes/FloorWedgeMode';
import { VoiceAssignmentScope, clearVocalPartsCache } from '@/app/components/songs/WhoSingsWhat';
import { LyricsText } from '@/app/components/ui/LyricsViewer';
import { songFromRow } from '@/lib/livePack';
import { __resetAppFlagsForTest } from '@/lib/appFlags';
import { computePosture, updatePosture, LAPTOP_POSE_PREF, SETTLE_MS } from '@/lib/posture';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const LYRICS = '# Chorus\n[F]Hold the line\n{bv}(ooh, [G]yeah){/bv}';

/** The setlist row as the live pack keeps it (livePack.songFromRow). */
const packed = (songParts: unknown, gigParts?: unknown): StageSong =>
  songFromRow(
    { id: 'r1', song_id: 's1', set_number: 1, vocal_parts: gigParts ?? null, song: { title: 'Hudson Line', key: 'F', lyrics: LYRICS, vocal_parts: songParts } },
    'Unknown Song',
  ) as StageSong;

const flush = () => act(async () => void (await Promise.resolve()));
const legend = () => screen.getByRole('group', { name: 'Voice parts' });
/** "Lead · Ava R." → the names after a part in the legend. */
const whoSings = (part: 'lead' | 'bv') => legend().querySelector(`[data-voice="${part}"]`)?.parentElement?.textContent ?? '';

beforeEach(() => {
  localStorage.clear();
  __resetAppFlagsForTest(null);
  clearVocalPartsCache();
  fetchSong.mockReset().mockResolvedValue({});
  fetchRow.mockReset().mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  act(() => {
    updatePosture(computePosture({ viewport: { w: 393, h: 852 } }));
  });
  localStorage.removeItem(LAPTOP_POSE_PREF);
});

/** The iPhone Duo folded like a laptop (as FloorWedgeMode.songOnly.test). */
const tabletop = () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  act(() => {
    updatePosture(computePosture({ viewport: { w: 669, h: 900 }, division: { x: 0, y: 440, w: 669, h: 20 }, hinge: 'half-open' }));
  });
  act(() => {
    vi.advanceTimersByTime(SETTLE_MS);
  });
  vi.useRealTimers();
};

function openSong(song: StageSong, kind: 'gig' | 'rehearsal' = 'gig') {
  render(
    <StageMode kind={kind} title="The Loft, Brooklyn" dateLabel="Sat 28 Nov" date="2026-11-28" steps={[]} songs={[song]} offlineFrom={new Date().toISOString()} onClose={vi.fn()} />,
  );
  fireEvent.click(within(screen.getByRole('tablist', { name: 'Setlist' })).getAllByRole('tab')[1]);
}

describe('Who sings what with no signal (from the live pack)', () => {
  it('the pack keeps the song’s assignment and the gig’s override', () => {
    const song = packed({ lead: [AVA], bv: [ME] }, { bv: [AVA] });
    expect(song.vocalParts).toEqual({ lead: [AVA], bv: [ME] });
    expect(song.setlistVocalParts).toEqual({ bv: [AVA] });
  });

  it('Stage mode: I am on Backing for this song, the legend says "Backing · you", not "Lead · you"', async () => {
    openSong(packed({ lead: [AVA], bv: [ME] }));
    await flush();
    expect(whoSings('bv')).toBe('Backing· you');
    expect(whoSings('lead')).toBe('Lead· Ava R.');
    expect(legend()).not.toHaveTextContent(/Lead\s*· you/);
  });

  it('Stage mode: this gig’s override wins over the song’s assignment', async () => {
    // For the song I sing the backing; tonight Ava does and I take the lead.
    openSong(packed({ lead: [AVA], bv: [ME] }, { lead: [ME], bv: [AVA] }));
    await flush();
    expect(whoSings('lead')).toBe('Lead· you');
    expect(whoSings('bv')).toBe('Backing· Ava R.');
  });

  it('Song only reads it too', async () => {
    openSong(packed({ lead: [AVA], bv: [ME] }));
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    await flush();
    const view = screen.getByRole('dialog', { name: 'Song only: Hudson Line' });
    const mine = within(view).getByRole('group', { name: 'Voice parts' });
    expect(mine.querySelector('[data-voice="bv"]')?.parentElement).toHaveTextContent('Backing· you');
    expect(mine).not.toHaveTextContent(/Lead\s*· you/);
  });

  it('Live mode on a rehearsal: the song’s assignment (no per-gig override there)', async () => {
    openSong(packed({ lead: [AVA], bv: [ME] }, { lead: [ME] }), 'rehearsal');
    await flush();
    expect(whoSings('bv')).toBe('Backing· you');
    expect(legend()).not.toHaveTextContent(/Lead\s*· you/);
  });

  it('the floor wedge (Laptop pose) reads it too', async () => {
    tabletop();
    render(<FloorWedgeMode songs={[packed({ lead: [AVA], bv: [ME] })]} title="The Loft, Brooklyn" lyricsOn onLyricsOnChange={vi.fn()} />);
    await flush();
    expect(whoSings('bv')).toBe('Backing· you');
    expect(legend()).not.toHaveTextContent(/Lead\s*· you/);
  });

  it('nobody assigned in the pack: my instrument still decides', async () => {
    openSong(packed(null));
    await flush();
    expect(whoSings('lead')).toBe('Lead· you');
  });

  it('with signal the server’s answer wins over what the song came with, also "nobody assigned"', async () => {
    fetchSong.mockResolvedValue({ s1: { lead: [ME] } });
    const view = render(
      <VoiceAssignmentScope songId="s1" lyrics={LYRICS} songParts={{ lead: [AVA], bv: [ME] }}>
        <LyricsText lyrics={LYRICS} size={20} />
      </VoiceAssignmentScope>,
    );
    await flush();
    expect(whoSings('lead')).toBe('Lead· you');
    expect(whoSings('bv')).toBe('Backing');
    view.unmount();

    clearVocalPartsCache();
    fetchSong.mockResolvedValue({ s1: null });
    render(
      <VoiceAssignmentScope songId="s1" lyrics={LYRICS} songParts={{ lead: [AVA], bv: [ME] }}>
        <LyricsText lyrics={LYRICS} size={20} />
      </VoiceAssignmentScope>,
    );
    await flush();
    // Cleared on the server since the pack was saved: back to the instrument.
    expect(whoSings('lead')).toBe('Lead· you');
    expect(whoSings('bv')).toBe('Backing');
  });
});
