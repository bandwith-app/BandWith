import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react';

// Voice parts, C2: the Voice picker in the chord editor and "who sings what".
// Made-up song and band (New York).

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));

const ME = '11111111-1111-4111-8111-111111111111';
const SAM = '22222222-2222-4222-8222-222222222222';
let isAdmin = true;
vi.mock('@/lib/BandContext', () => ({
  useOptionalBand: () => ({
    isAdmin,
    selectedBand: {
      id: 'b1',
      members: [
        { user_id: ME, instrument: 'Lead vocals', is_active: true, profile: { full_name: 'Leo M.' } },
        { user_id: SAM, instrument: 'Keys', is_active: true, profile: { full_name: 'Sam R.' } },
      ],
    },
  }),
}));
vi.mock('@/lib/AuthContext', () => ({ useOptionalAuth: () => ({ user: { id: ME } }) }));

const fetchSong = vi.fn();
const fetchSetlist = vi.fn();
const saveSong = vi.fn();
const saveSetlist = vi.fn();
vi.mock('@/lib/services/vocalParts', () => ({
  fetchSongVocalParts: (...a: unknown[]) => fetchSong(...a),
  fetchSetlistVocalParts: (...a: unknown[]) => fetchSetlist(...a),
  saveSongVocalParts: (...a: unknown[]) => saveSong(...a),
  saveSetlistVocalParts: (...a: unknown[]) => saveSetlist(...a),
}));

const LYRICS = '# Chorus\n[F]Hold the line\n{bv}(ooh, [G]yeah){/bv}';
const update = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { id: 's1', band_id: 'b1', title: 'Hudson Line', key: 'F', lyrics: '# Chorus\n[F]Hold the line\nMorning comes', chord_chart: null }, error: null }),
        }),
      }),
      update: (v: unknown) => {
        update(v);
        return { eq: async () => ({ error: null }) };
      },
    }),
  },
}));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySongUpdated: vi.fn() }));

import { ChordEditor, openChordEditor, closeChordEditor } from '../ChordEditor';
import { VoiceAssignmentScope, clearVocalPartsCache } from '../WhoSingsWhat';
import { LyricsText } from '@/app/components/ui/LyricsViewer';

beforeEach(() => {
  isAdmin = true;
  fetchSong.mockReset().mockResolvedValue({ s1: { bv: [SAM] } });
  fetchSetlist.mockReset().mockResolvedValue({ r1: null });
  saveSong.mockReset().mockResolvedValue({ error: null });
  saveSetlist.mockReset().mockResolvedValue({ error: null });
  update.mockReset();
  clearVocalPartsCache();
});
afterEach(() => {
  act(() => closeChordEditor());
  cleanup();
});

describe('the Voice picker in the chord editor', () => {
  it('marks a whole line as backing, then a second tap clears it', async () => {
    render(<ChordEditor />);
    act(() => openChordEditor('s1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Morning' }));
    const voice = screen.getByRole('group', { name: 'Voice' });
    fireEvent.click(within(voice).getByRole('button', { name: 'Backing' }));
    expect(within(voice).getByRole('button', { name: 'Backing' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'comes' }).querySelector('[data-voice="bv"]')).not.toBeNull();
    fireEvent.click(within(voice).getByRole('button', { name: 'Backing' }));
    expect(screen.getByRole('button', { name: 'comes' }).querySelector('[data-voice]')).toBeNull();
  });

  it('marks just a few words and saves them in the lyrics', async () => {
    render(<ChordEditor />);
    act(() => openChordEditor('s1'));
    fireEvent.click(await screen.findByRole('button', { name: 'the' }));
    const voice = screen.getByRole('group', { name: 'Voice' });
    fireEvent.click(within(voice).getByRole('button', { name: 'Just these words' }));
    fireEvent.click(screen.getByRole('button', { name: 'line' }));
    fireEvent.click(within(voice).getByRole('button', { name: '2nd voice' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save chords' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0]).toEqual({ lyrics: '# Chorus\n[F]Hold {v2}the line{/v2}\nMorning comes' });
  });
});

describe('who sings what', () => {
  it('shows the names in the legend and lets an admin assign a part; my part follows', async () => {
    const { container } = render(
      <VoiceAssignmentScope songId="s1" songTitle="Hudson Line" lyrics={LYRICS}>
        <LyricsText lyrics={LYRICS} size={20} />
      </VoiceAssignmentScope>,
    );
    const legend = screen.getByRole('group', { name: 'Voice parts' });
    await waitFor(() => expect(legend).toHaveTextContent('Sam R.'));
    // Leo isn't assigned: his instrument (lead vocals) decides, backing dims.
    expect(container.querySelector('p[data-voice="bv"]')).toHaveAttribute('data-voice-dim', 'true');

    fireEvent.click(within(legend).getByRole('button', { name: 'Who sings what' }));
    const backing = await screen.findByRole('region', { name: 'Backing' });
    fireEvent.click(within(backing).getByRole('button', { name: 'Leo M.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveSong).toHaveBeenCalledWith('s1', { bv: [SAM, ME] }));
    // Now Leo sings the backing: it is bright, his lead lines dim.
    await waitFor(() => expect(container.querySelector('p[data-voice="bv"]')).not.toHaveAttribute('data-voice-dim'));
    expect(legend).toHaveTextContent('Leo M.');
  });

  it('on a gig, an admin can change it for this gig only', async () => {
    render(
      <VoiceAssignmentScope songId="s1" setlistSongId="r1" songTitle="Hudson Line" lyrics={LYRICS}>
        <LyricsText lyrics={LYRICS} size={20} />
      </VoiceAssignmentScope>,
    );
    const legend = screen.getByRole('group', { name: 'Voice parts' });
    await waitFor(() => expect(legend).toHaveTextContent('Sam R.'));
    fireEvent.click(within(legend).getByRole('button', { name: 'Who sings what' }));
    fireEvent.click(await screen.findByRole('button', { name: 'This gig only' }));
    const backing = screen.getByRole('region', { name: 'Backing' });
    fireEvent.click(within(backing).getByRole('button', { name: 'Sam R.' }));
    fireEvent.click(within(backing).getByRole('button', { name: 'Leo M.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveSetlist).toHaveBeenCalledWith('r1', { bv: [ME] }));
    expect(saveSong).not.toHaveBeenCalled();
    await waitFor(() => expect(legend).not.toHaveTextContent('Sam R.'));
  });

  it('members read it but get no button', async () => {
    isAdmin = false;
    render(
      <VoiceAssignmentScope songId="s1" songTitle="Hudson Line" lyrics={LYRICS}>
        <LyricsText lyrics={LYRICS} size={20} />
      </VoiceAssignmentScope>,
    );
    const legend = screen.getByRole('group', { name: 'Voice parts' });
    await waitFor(() => expect(legend).toHaveTextContent('Sam R.'));
    expect(within(legend).queryByRole('button', { name: 'Who sings what' })).toBeNull();
  });
});
