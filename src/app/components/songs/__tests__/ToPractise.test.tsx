import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import type { RehearsalNote } from '@/lib/rehearsalNotes';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));

const ME = 'u-me';
const state = vi.hoisted(() => ({ notes: [] as unknown[], isAdmin: false, flag: true }));
const practised = vi.fn();
vi.mock('@/app/components/event/useBandNotes', () => ({
  useBandNotes: () => ({ notes: state.notes, loaded: true, practised, ok: vi.fn() }),
}));
vi.mock('@/lib/AuthContext', () => ({ useOptionalAuth: () => ({ user: { id: 'u-me' } }) }));
vi.mock('@/lib/BandContext', () => ({ useOptionalBand: () => ({ isAdmin: state.isAdmin, selectedBand: { id: 'b' } }) }));
vi.mock('@/lib/flags', () => ({ useBandFlag: () => state.flag }));
const openSuggestChange = vi.fn();
vi.mock('@/lib/services/songSuggestions', () => ({ openSuggestChange: (x: unknown) => openSuggestChange(x) }));
const updateSong = vi.fn(async () => ({ error: null }));
vi.mock('@/lib/services/songs', () => ({ updateSong: (...a: unknown[]) => updateSong(...(a as [])) }));

import { FromRehearsalStrip } from '../FromRehearsalStrip';
import { ToPractiseCard } from '@/app/components/dashboard/ToPractiseCard';
import { toPractise } from '@/lib/toPractise';

let seq = 0;
const note = (over: Partial<RehearsalNote> = {}): RehearsalNote => ({
  id: `n${++seq}`,
  bandId: 'b',
  eventId: 'e',
  date: '2026-11-12',
  sessionId: null,
  songId: 's1',
  songTitle: 'Paper Boats',
  preset: 'ending',
  section: null,
  body: null,
  scope: 'band',
  status: 'open',
  markedAtS: null,
  createdBy: 'u-admin',
  okBy: null,
  okAt: null,
  createdAt: '2026-11-12T20:00:00.000Z',
  assignees: [],
  ...over,
});

beforeEach(() => {
  state.notes = [];
  state.isAdmin = false;
  state.flag = true;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('Home "To practise" (A3)', () => {
  it('a song per card, Practised on the notes for me, the song opens', () => {
    const onOpen = vi.fn();
    const mine = note({ id: 'm', scope: 'members', assignees: [{ userId: ME, practisedAt: null }] });
    const groups = toPractise([note({ id: 'b1' }), mine, note({ id: 'x', songId: 's2', songTitle: 'Harbor Lights' })], ME);
    render(<ToPractiseCard groups={groups} userId={ME} onOpenSong={onOpen} onPractised={practised} />);
    const card = screen.getByRole('region', { name: 'To practise · Paper Boats' });
    expect(within(card).getAllByRole('button', { name: /Practised/ })).toHaveLength(1);
    fireEvent.click(within(card).getByRole('button', { name: /Practised/ }));
    expect(practised).toHaveBeenCalledWith('m', true);
    fireEvent.click(screen.getByRole('button', { name: 'Open Harbor Lights' }));
    expect(onOpen).toHaveBeenCalledWith('s2');
  });

  it('more than four songs: the rest are counted', () => {
    const groups = toPractise(['a', 'b', 'c', 'd', 'e', 'f'].map((s) => note({ songId: s, songTitle: s.toUpperCase() })), ME);
    render(<ToPractiseCard groups={groups} userId={ME} onPractised={practised} />);
    expect(screen.getByText('More songs: 2')).toBeInTheDocument();
  });
});

describe('song page "From rehearsals" (A3)', () => {
  it('nothing when the song has no open notes or the feature is off', () => {
    state.notes = [note({ songId: 'other' })];
    const { container } = render(<FromRehearsalStrip songId="s1" bandId="b" title="Paper Boats" />);
    expect(container).toBeEmptyDOMElement();
    state.notes = [note()];
    state.flag = false;
    cleanup();
    expect(render(<FromRehearsalStrip songId="s1" bandId="b" title="Paper Boats" />).container).toBeEmptyDOMElement();
  });

  it('a member turns a tempo note into a suggestion to the band (108)', () => {
    state.notes = [note({ id: 't', preset: 'tempo', body: 'Tempo: 96' })];
    render(<FromRehearsalStrip songId="s1" bandId="b" title="Paper Boats" />);
    expect(screen.getByText('From rehearsals · 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Suggest to the band: 96 BPM' }));
    expect(openSuggestChange).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', band_id: 'b', start: 'note', note: expect.stringContaining('96 BPM') }));
    expect(updateSong).not.toHaveBeenCalled();
  });

  it('an admin sets the key on the song', async () => {
    state.isAdmin = true;
    state.notes = [note({ id: 'k', preset: 'key', body: 'down to Bb' })];
    render(<FromRehearsalStrip songId="s1" bandId="b" title="Paper Boats" />);
    fireEvent.click(screen.getByRole('button', { name: 'Set on the song: Key: Bb' }));
    expect(updateSong).toHaveBeenCalledWith('s1', { key: 'Bb' });
    await waitFor(() => expect(screen.getByText('Saved: Key: Bb')).toBeInTheDocument());
    expect(openSuggestChange).not.toHaveBeenCalled();
  });
});
