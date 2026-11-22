import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';

// Putting a note on a precise point of a song, made clear (rehearsal 20 Nov:
// "not very clear"): hold a line for a menu, an obvious "tap a line" bar,
// "Add note" without switching My notes on first, and "saved on …".

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));

const savePersonalNote = vi.fn();
let show = false;
const showListeners = new Set<() => void>();
vi.mock('@/lib/services/personalLayer', () => ({
  addPersonalFile: vi.fn(),
  deletePersonalFile: vi.fn(),
  deletePersonalNote: vi.fn(),
  markMyNotesInfoSeen: vi.fn(),
  myNotesInfoSeen: () => true,
  savePersonalNote: (...a: unknown[]) => savePersonalNote(...a),
  usePersonalLayer: () => ({ notes: [], files: [] }),
  useShowMyNotes: () => {
    const [, force] = React.useReducer((x: number) => x + 1, 0);
    React.useEffect(() => {
      showListeners.add(force);
      return () => {
        showListeners.delete(force);
      };
    }, []);
    return [
      show,
      (v: boolean) => {
        show = v;
        showListeners.forEach((l) => l());
      },
    ] as const;
  },
}));
vi.mock('@/lib/services/songFiles', () => ({ openSongResource: vi.fn(), SONG_FILE_ACCEPT: '*/*' }));
vi.mock('@/lib/services/songSuggestions', () => ({ openSuggestChange: vi.fn() }));

import { MyNotesBar, PersonalLayerScope, PersonalLayerSheets } from '../PersonalLayer';
import { LyricsText } from '@/app/components/ui/LyricsViewer';

const song = {
  id: 's1',
  band_id: 'b1',
  title: 'Paper Boats',
  lyrics: '# Verse 1\nPaper boats on the water\n# Chorus\nLanterns in the rain',
};

const renderSong = (opts: { stage?: boolean; onBandNote?: (at: { section: string | null; line: string }) => void } = {}) =>
  render(
    <>
      <PersonalLayerScope song={song} stage={opts.stage} onBandNote={opts.onBandNote}>
        <MyNotesBar />
        <LyricsText lyrics={song.lyrics} size={24} />
      </PersonalLayerScope>
      <PersonalLayerSheets />
    </>,
  );

const hold = (el: HTMLElement) => {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 10, clientY: 10 });
  act(() => {
    vi.advanceTimersByTime(600);
  });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 10, clientY: 10 });
};

beforeEach(() => {
  show = false;
  savePersonalNote.mockReset();
  savePersonalNote.mockResolvedValue({ error: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('notes on a precise point (A–C)', () => {
  it('"Add note" is there with My notes off, and turns them on', () => {
    renderSong();
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(show).toBe(true);
    // The bar stays at the bottom of the screen, whatever is scrolled.
    const bar = screen.getByRole('status', { name: 'Adding a note' });
    expect(within(bar).getByText('Tap the line for your note')).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('status', { name: 'Adding a note' })).toBeNull();
  });

  it('tapping a line while adding opens the note on that line', () => {
    renderSong();
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    fireEvent.click(screen.getByText('Lanterns in the rain'));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText('“Lanterns in the rain”')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Adding a note' })).toBeNull();
  });

  it('holding a line opens a menu: a note for me', () => {
    vi.useFakeTimers();
    renderSong();
    hold(screen.getByText('Lanterns in the rain'));
    const menu = screen.getByRole('dialog', { name: 'Note on this line' });
    expect(within(menu).queryByRole('button', { name: /Note for the band/ })).toBeNull();
    fireEvent.click(within(menu).getByRole('button', { name: /Note for me/ }));
    expect(show).toBe(true);
    expect(within(screen.getByRole('dialog')).getByText('“Lanterns in the rain”')).toBeInTheDocument();
  });

  it('a short tap is not a hold', () => {
    vi.useFakeTimers();
    renderSong();
    const line = screen.getByText('Lanterns in the rain');
    fireEvent.pointerDown(line, { pointerId: 1, clientX: 10, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.pointerUp(line, { pointerId: 1, clientX: 10, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByRole('dialog', { name: 'Note on this line' })).toBeNull();
  });

  it('at a rehearsal the menu also writes for the band, at that section and line', () => {
    vi.useFakeTimers();
    const onBandNote = vi.fn();
    renderSong({ onBandNote });
    hold(screen.getByText('Lanterns in the rain'));
    fireEvent.click(screen.getByRole('button', { name: /Note for the band/ }));
    expect(onBandNote).toHaveBeenCalledWith({ section: 'Chorus', line: 'Lanterns in the rain' });
  });

  it('after saving it says where the note went', async () => {
    renderSong();
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    fireEvent.click(screen.getByText('Lanterns in the rain'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Breathe first' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    });
    expect(savePersonalNote).toHaveBeenCalled();
    expect(await screen.findByText('Note saved on “Lanterns in the rain”')).toBeInTheDocument();
  });

  it('with no signal it says the note is kept on this phone', async () => {
    savePersonalNote.mockResolvedValue({ error: null, queued: true });
    renderSong();
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    fireEvent.click(screen.getByText('Lanterns in the rain'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Breathe first' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    });
    expect(await screen.findByText('Note saved on this phone. It reaches your account when you’re back online.')).toBeInTheDocument();
  });

  it('on Stage the button says Note, not just a pencil', () => {
    renderSong({ stage: true });
    const btn = screen.getByRole('button', { name: 'Add note' });
    expect(btn.textContent).toContain('Note');
    expect(btn.querySelector('.sr-only')).toBeNull();
  });
});
