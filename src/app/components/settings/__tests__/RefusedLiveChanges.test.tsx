import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, within } from '@testing-library/react';

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

import { OfflineLiveSection } from '../OfflineLiveSection';
import { readRefusedLiveOps } from '@/lib/liveOutbox';

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
    const list = screen.getByRole('region', { name: 'Not sent' });
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
    expect(screen.queryByRole('region', { name: 'Not sent' })).toBeNull();
  });
});
