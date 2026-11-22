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
});
