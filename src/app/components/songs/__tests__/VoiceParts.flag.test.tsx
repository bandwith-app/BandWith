import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor, renderHook } from '@testing-library/react';

// Kill switch `voice_parts` (docs/flags.md): off → the lyrics read as plain
// lead lines (no markers, colours, legend), no Who sings what, no Voice row.
// Made-up song (New York).

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));
const ME = '11111111-1111-4111-8111-111111111111';
vi.mock('@/lib/BandContext', () => ({
  useOptionalBand: () => ({ isAdmin: true, selectedBand: { id: 'b1', members: [{ user_id: ME, instrument: 'Lead vocals', is_active: true, profile: { full_name: 'Leo M.' } }] } }),
}));
vi.mock('@/lib/AuthContext', () => ({ useOptionalAuth: () => ({ user: { id: ME } }) }));
const fetchSong = vi.fn();
vi.mock('@/lib/services/vocalParts', () => ({
  fetchSongVocalParts: (...a: unknown[]) => fetchSong(...a),
  fetchSetlistVocalParts: async () => ({}),
  saveSongVocalParts: async () => ({ error: null }),
  saveSetlistVocalParts: async () => ({ error: null }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { id: 's1', band_id: 'b1', title: 'Hudson Line', key: 'F', lyrics: '# Chorus\n[F]Hold the line\n(ooh, yeah)', chord_chart: null }, error: null }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySongUpdated: vi.fn() }));

import { ChordEditor, openChordEditor, closeChordEditor } from '../ChordEditor';
import { VoiceAssignmentScope, clearVocalPartsCache } from '../WhoSingsWhat';
import { LyricsText } from '@/app/components/ui/LyricsViewer';
import { useVoiceSuggestions } from '../useVoiceSuggestions';
import { VoicePartsKept } from '../VoiceSafeText';
import { __resetAppFlagsForTest, __setAppFlagsForTest } from '@/lib/appFlags';

const LYRICS = '# Chorus\n[F]Hold the line\n{bv}(ooh, [G]yeah){/bv}\nLead and {v2}echo{/v2}';

beforeEach(() => {
  localStorage.clear();
  __resetAppFlagsForTest(null);
  fetchSong.mockReset().mockResolvedValue({});
  clearVocalPartsCache();
});
afterEach(() => {
  act(() => closeChordEditor());
  cleanup();
});

describe('voice_parts off', () => {
  it('lyrics read as plain lines: no markers, no part styles, no legend', () => {
    __setAppFlagsForTest({ voice_parts: false });
    const { container } = render(<LyricsText lyrics={LYRICS} size={20} />);
    expect(container.textContent).not.toMatch(/\{\/?(bv|v2)\}/);
    expect(container).toHaveTextContent('(ooh, Gyeah)');
    expect(container).toHaveTextContent('Lead and echo');
    expect(container.querySelector('[data-voice]')).toBeNull();
    expect(container.querySelector('[class*="bw-voice-"]')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Voice parts' })).toBeNull();
  });

  it('plain lines keep their line address, so Follow the tempo still finds the sung line', () => {
    __setAppFlagsForTest({ voice_parts: false });
    const { container } = render(<LyricsText lyrics={LYRICS} size={20} />);
    expect(container.querySelector('[data-lyric-section="0"]')).not.toBeNull();
    expect(container.querySelector('p[data-line="0:0"]')).toHaveTextContent('Hold the line');
    expect(container.querySelector('p[data-line="0:1"]')).toHaveTextContent('(ooh, Gyeah)');
    expect(container.querySelector('p[data-line="0:2"]')).toHaveTextContent('Lead and echo');
  });

  it('turned off while the song is on screen: the parts go at once', () => {
    const { container } = render(<LyricsText lyrics={LYRICS} size={20} />);
    expect(screen.getByRole('group', { name: 'Voice parts' })).toBeInTheDocument();
    act(() => __setAppFlagsForTest({ voice_parts: false }));
    expect(screen.queryByRole('group', { name: 'Voice parts' })).toBeNull();
    expect(container.querySelector('[data-voice]')).toBeNull();
  });

  it('no Who sings what: nothing is fetched', async () => {
    __setAppFlagsForTest({ voice_parts: false });
    render(
      <VoiceAssignmentScope songId="s1" songTitle="Hudson Line" lyrics={LYRICS}>
        <LyricsText lyrics={LYRICS} size={20} />
      </VoiceAssignmentScope>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSong).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Who sings what' })).toBeNull();
  });

  it('the chord editor has no Voice row and no "Mark the voice parts"', async () => {
    __setAppFlagsForTest({ voice_parts: false });
    render(<ChordEditor />);
    act(() => openChordEditor('s1'));
    fireEvent.click(await screen.findByRole('button', { name: 'the' }));
    expect(screen.getByRole('group', { name: 'Chords of the song' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Voice' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark the voice parts' })).toBeNull();
  });

  it('on (the default): the editor still has the Voice row', async () => {
    render(<ChordEditor />);
    act(() => openChordEditor('s1'));
    fireEvent.click(await screen.findByRole('button', { name: 'the' }));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Voice' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Mark the voice parts' })).toBeInTheDocument();
  });

  // Add Song (AddSongModal) uses the same hook: pasting "(ooh)" offers nothing while off.
  it('Add Song: no "Mark the voice parts" offer for pasted lyrics', () => {
    const pasted = '# Chorus\nHold the line\n(ooh, yeah)';
    const on = renderHook(() => useVoiceSuggestions(pasted, false));
    expect(on.result.current.length).toBeGreaterThan(0);
    act(() => __setAppFlagsForTest({ voice_parts: false }));
    expect(on.result.current).toEqual([]);
  });

  it('no "has a voice part" note under the lyrics field', () => {
    __setAppFlagsForTest({ voice_parts: false });
    const { container } = render(<VoicePartsKept lyrics={'# Chorus\n{bv}(ooh){/bv}'} />);
    expect(container).toBeEmptyDOMElement();
  });
});
