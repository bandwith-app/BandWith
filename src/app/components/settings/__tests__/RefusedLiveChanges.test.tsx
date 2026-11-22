import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

// Round 4 (coordinator): changes the server refused for their own account
// (liveOutbox's refused list) were kept but shown nowhere, as good as lost.
// Settings › Offline & live lists them: Copy and Remove each, a visible
// message when the clipboard fails. Made-up note (New York).

vi.mock('@/lib/livePackStore', () => ({
  LIVE_PACK_CHANGED: 'bw:live-pack-changed',
  listPacks: vi.fn(async () => []),
  deleteAllPacks: vi.fn(async () => {}),
}));
vi.mock('@/lib/livePackFiles', () => ({ packFilesSize: vi.fn(async () => 0) }));
vi.mock('@/lib/livePackStatus', () => ({ saveProfileChoice: vi.fn(async () => undefined) }));
const titles = vi.hoisted(() => ({ getSongTitles: vi.fn(async (_ids: string[]) => ({ s1: 'Autumn Leaves', s2: 'Blue Bossa' }) as Record<string, string>) }));
vi.mock('@/lib/services/songs', async (orig) => ({ ...(await orig<typeof import('@/lib/services/songs')>()), getSongTitles: titles.getSongTitles }));

import { OfflineLiveSection } from '../OfflineLiveSection';
import { readRefusedLiveOps, REFUSED_LIMIT } from '@/lib/liveOutbox';

const refuse = (ops: unknown[]) => localStorage.setItem('bw:live_refused:u-1', JSON.stringify(ops));
const note = { kind: 'note', id: 'n1', songId: 's1', anchor: { type: 'song' }, body: 'Watch the drummer before the bridge' };
const suggestion = { kind: 'suggestion', id: 'g1', row: { band_id: 'b1', song_id: 's1', kind: 'note', proposed: { note: 'Slower intro on Empire State' } } };

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Settings › Offline & live: changes the band refused', () => {
  it('lists each refused change, read as a status', () => {
    refuse([note, suggestion]);
    render(<OfflineLiveSection userId="u-1" />);
    const list = screen.getByRole('region', { name: 'Changes not sent' });
    expect(within(list).getByRole('status').textContent).toMatch(/weren.t sent/i);
    expect(within(list).getByText('Watch the drummer before the bridge')).toBeTruthy();
    expect(within(list).getByText('Slower intro on Empire State')).toBeTruthy();
    expect(within(list).getByRole('button', { name: 'Copy change: Watch the drummer before the bridge' })).toBeTruthy();
    expect(within(list).getByRole('button', { name: 'Remove change: Slower intro on Empire State' })).toBeTruthy();
  });

  it('Copy puts the text on the clipboard; Remove takes it off this phone', async () => {
    refuse([note, suggestion]);
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<OfflineLiveSection userId="u-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy change: Watch the drummer before the bridge' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Watch the drummer before the bridge'));
    expect(await screen.findByText('Copied')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove change: Watch the drummer before the bridge' }));
    await waitFor(() => expect(screen.queryByText('Watch the drummer before the bridge')).toBeNull());
    expect(readRefusedLiveOps('u-1')).toEqual([suggestion]);
  });

  it('the clipboard fails: says so, the text stays', async () => {
    refuse([note]);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error('blocked'); }) } });
    render(<OfflineLiveSection userId="u-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy change: Watch the drummer before the bridge' }));
    expect(await screen.findByText(/couldn.t copy this change/i)).toBeTruthy();
    expect(screen.getByText('Watch the drummer before the bridge')).toBeTruthy();
  });

  it('nothing refused: nothing shown', () => {
    render(<OfflineLiveSection userId="u-1" />);
    expect(screen.queryByRole('region', { name: 'Changes not sent' })).toBeNull();
  });

  // Round 5 (Codex MINOR): a suggestion with only a chord chart copies the chart.
  it('a chord-chart suggestion copies its chords, not a label', async () => {
    const chart = {
      v: 1, source: 'ireal', title: 'Empire State', key: 'C',
      sections: [{ label: 'A', bars: [{ chords: ['C^7'] }, { chords: ['A-7', 'D7'] }] }],
    };
    refuse([{ kind: 'suggestion', id: 'g2', row: { band_id: 'b1', song_id: 's1', kind: 'chords', proposed: { chord_chart: chart } } }]);
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<OfflineLiveSection userId="u-1" />);
    fireEvent.click(screen.getByRole('button', { name: /^Copy change:/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toMatch(/Empire State/);
    expect(copied).toMatch(/Cmaj7/);
    expect(copied).toMatch(/Am7/);
  });

  // Round 5 (Codex MINOR): never silent: a full list says so.
  it('a full list says it is full', () => {
    refuse(Array.from({ length: REFUSED_LIMIT }, (_, i) => ({ ...note, id: `n${i}` })));
    render(<OfflineLiveSection userId="u-1" />);
    expect(screen.getByText(/this list is full/i)).toBeTruthy();
  });

  // Round 5 (Claude MINOR 3): removed by a stable id, never by position.
  const noteB = { ...note, id: 'n2', body: 'Count in the last chorus' };
  it('Remove takes off that change, even after the list changed in another tab', () => {
    refuse([note, noteB]);
    render(<OfflineLiveSection userId="u-1" />);
    // Another tab removed the first one; this tab has not heard yet.
    refuse([noteB]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove change: Watch the drummer before the bridge' }));
    expect(readRefusedLiveOps('u-1').map((o) => (o as { id?: string }).id)).toEqual(['n2']);
  });

  it('follows changes made in another tab (storage event)', async () => {
    refuse([note, noteB]);
    render(<OfflineLiveSection userId="u-1" />);
    refuse([noteB]);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'bw:live_refused:u-1' }));
    });
    await waitFor(() => expect(screen.queryByText('Watch the drummer before the bridge')).toBeNull());
    expect(screen.getByText('Count in the last chorus')).toBeTruthy();
  });

  it('Remove can be undone; focus moves to the next change', async () => {
    refuse([note, noteB]);
    render(<OfflineLiveSection userId="u-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove change: Watch the drummer before the bridge' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Copy change: Count in the last chorus' }));
    expect(screen.getByText('Change removed.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(readRefusedLiveOps('u-1').map((o) => (o as { id?: string }).id)).toEqual(['n1', 'n2']);
    expect(await screen.findByText('Watch the drummer before the bridge')).toBeTruthy();
  });

  it('removing the last change: focus goes to Undo', () => {
    refuse([note]);
    render(<OfflineLiveSection userId="u-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove change: Watch the drummer before the bridge' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo' }));
  });

  // Round 5 (Claude MINOR 4): an order shows its songs.
  it('a setlist order shows its songs, in the new order', async () => {
    refuse([{
      kind: 'order', setlistId: 'sl1',
      rows: [
        { id: 'r2', setlist_id: 'sl1', song_id: 's2', position: 0, set_number: 1 },
        { id: 'r1', setlist_id: 'sl1', song_id: 's1', position: 1, set_number: 1 },
      ],
      before: [{ songId: 's1', setNumber: 1 }, { songId: 's2', setNumber: 1 }],
    }]);
    render(<OfflineLiveSection userId="u-1" />);
    expect(await screen.findByText(/1\. Blue Bossa\s+2\. Autumn Leaves/)).toBeTruthy();
  });

  // Round 5 (Claude MINOR 5): "Copied" is announced, not only drawn.
  it('"Copied" is announced in the polite region', async () => {
    refuse([note]);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } });
    render(<OfflineLiveSection userId="u-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy change: Watch the drummer before the bridge' }));
    await waitFor(() => {
      const live = [...document.querySelectorAll('[aria-live="polite"]')].map((e) => e.textContent).join(' ');
      expect(live).toMatch(/copied/i);
    });
  });

  // Round 6 (Codex B1): an undo belongs to the account that removed it.
  it("an undo never crosses to another account: after a switch it is gone, and B's list is untouched", () => {
    refuse([note]);
    localStorage.setItem('bw:live_refused:u-2', JSON.stringify([noteB]));
    const { rerender } = render(<OfflineLiveSection userId="u-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove change: Watch the drummer before the bridge' }));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    rerender(<OfflineLiveSection userId="u-2" />);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(readRefusedLiveOps('u-2').map((o) => (o as { id?: string }).id)).toEqual(['n2']);
    expect(readRefusedLiveOps('u-1')).toEqual([]);
  });

  // Round 6 (Codex B4): a gig setlist edited offline that met a newer one.
  it('a gig setlist kept after a conflict shows why and its songs', async () => {
    refuse([{ kind: 'gigSetlist', eventId: 'e1', setlistId: 'sl1', songs: [{ song_id: 's2', set_number: 1 }, { song_id: 's1', set_number: 1 }], reason: 'changed' }]);
    render(<OfflineLiveSection userId="u-1" />);
    expect(await screen.findByText(/someone else changed it meanwhile[\s\S]*1\. Blue Bossa\s+2\. Autumn Leaves/i)).toBeTruthy();
  });
});

