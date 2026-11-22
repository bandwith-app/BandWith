import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  packs: [] as unknown[],
  deleteAllPacks: vi.fn(async () => {
    m.packs = [];
  }),
  saveProfileChoice: vi.fn(async () => undefined),
}));
vi.mock('@/lib/livePackStore', () => ({
  LIVE_PACK_CHANGED: 'bw:live-pack-changed',
  listPacks: vi.fn(async () => m.packs),
  deleteAllPacks: m.deleteAllPacks,
}));
vi.mock('@/lib/livePackFiles', () => ({ packFilesSize: vi.fn(async () => 250_000) }));
vi.mock('@/lib/livePackStatus', () => ({ saveProfileChoice: m.saveProfileChoice }));

import { OfflineLiveSection } from '../OfflineLiveSection';
import { readChoice } from '@/lib/livePackConsent';

const pack = (eventId: string) => ({
  v: 1,
  eventId,
  bandId: 'b-1',
  userId: 'u-1',
  setlistId: 'sl',
  event: { title: 'Rooftop Session' },
  songs: [{ id: 's1', title: 'New York State of Mind' }],
  personal: { s1: { notes: [], files: [{ id: 'f1', name: 'Horns.pdf', local: 'x' }] } },
  version: 'v',
  savedAt: '',
  expiresAt: '',
});

beforeEach(() => {
  localStorage.clear();
  m.packs = [pack('ev-1'), pack('ev-2')];
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('Settings › Offline & live', () => {
  it('automatic on/off follows the account; Wi-Fi only stays on this device', () => {
    render(<OfflineLiveSection userId="u-1" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Automatic download' }));
    expect(readChoice('u-1').auto).toBe(true);
    expect(m.saveProfileChoice).toHaveBeenCalledWith('u-1', { auto: true });
    fireEvent.click(screen.getByRole('switch', { name: 'Wi-Fi only' }));
    expect(readChoice('u-1').wifiOnly).toBe(true);
    expect(m.saveProfileChoice).toHaveBeenCalledTimes(1);
  });

  it('shows the space used and deletes everything after a confirm', async () => {
    render(<OfflineLiveSection userId="u-1" />);
    expect(await screen.findByText(/2 setlists · 0[.,]3 MB/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    expect(m.deleteAllPacks).not.toHaveBeenCalled();
    expect(screen.getByText('Delete all offline setlists?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    expect(m.deleteAllPacks).toHaveBeenCalledWith('u-1');
    await waitFor(() => expect(screen.getByText('Nothing kept on this device')).toBeTruthy());
  });

  it('#296: a rehearsal note the server refused shows here with its words, whatever rehearsal it was for', async () => {
    localStorage.setItem(
      'bw:rehearsal_notes_rejected:u-1',
      JSON.stringify([{ id: 'n9', eventId: 'gone', date: '2026-11-19', songTitle: 'Empire State of Mind', preset: 'tempo', body: 'Count the outro in four', status: 'open', assignees: [] }]),
    );
    render(<OfflineLiveSection userId="u-1" />);
    expect(screen.getByText('Empire State of Mind · Tempo · Count the outro in four')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Remove note: Empire State of Mind/ }));
    await waitFor(() => expect(screen.queryByText('Empire State of Mind · Tempo · Count the outro in four')).toBeNull());
    expect(localStorage.getItem('bw:rehearsal_notes_rejected:u-1')).toBeNull();
  });
});

// live_pack switched off (docs/flags.md): setlists may still be on the device,
// so the space they take and "Delete all" stay; downloading choices go.
describe('Settings › Offline & live with live_pack off', () => {
  it('the space used, Delete all and Wi-Fi only (it still holds for the tidy-up), with a short note', async () => {
    const { __setAppFlagsForTest, __resetAppFlagsForTest } = await import('@/lib/appFlags');
    __resetAppFlagsForTest(null);
    __setAppFlagsForTest({ live_pack: false });
    render(<OfflineLiveSection userId="u-1" />);
    expect(await screen.findByText(/2 setlists · 0[.,]3 MB/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete all' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Automatic download' })).toBeNull();
    // Review #273 round 7: Wi-Fi only still decides when kept setlists are brought up to date.
    expect(screen.getByRole('switch', { name: 'Wi-Fi only' })).toBeTruthy();
    expect(screen.getByText('Updates to what is kept wait for Wi-Fi on this device')).toBeTruthy();
    // Packs go 24 h after their gig, not only when deleted.
    expect(
      screen.getByText('Downloading setlists ahead is paused for now. What is already on this device stays readable offline until 24 hours after its gig, or until you delete it.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete all' })[0]);
    await waitFor(() => expect(m.deleteAllPacks).toHaveBeenCalledWith('u-1'));
    __resetAppFlagsForTest(null);
  });
});
