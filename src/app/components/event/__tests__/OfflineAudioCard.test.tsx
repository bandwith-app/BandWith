import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const store = new Set<string>();
const fail = new Map<string, 'link' | 'offline'>();
vi.mock('@/lib/regiaAudio', () => ({
  cachedAudio: vi.fn(async (refs: string[]) => new Set(refs.filter((r) => store.has(r)))),
  downloadAudio: vi.fn(async (ref: string, onProgress?: (p: number | null) => void) => {
    onProgress?.(0.5);
    await new Promise((r) => setTimeout(r, 5));
    const reason = fail.get(ref);
    if (reason) return { ok: false, reason };
    store.add(ref);
    return { ok: true };
  }),
}));
vi.mock('@/lib/haptics', () => ({ haptic: { tap: vi.fn(), confirm: vi.fn() } }));

import { OfflineAudioCard } from '../OfflineAudioCard';
import { downloadAudio } from '@/lib/regiaAudio';

const songs = [
  { title: 'Volare', audio: 'a1' },
  { title: 'Azzurro', audio: 'a2' },
  { title: 'Senza audio' },
];

beforeEach(() => {
  store.clear();
  fail.clear();
  vi.mocked(downloadAudio).mockClear();
});
afterEach(cleanup);

describe('Audio on this device (gig setlist)', () => {
  it('says how many song files are on the device and downloads the rest on Download', async () => {
    store.add('a1');
    render(<OfflineAudioCard songs={songs} />);
    expect(await screen.findByText('Audio on this device 1/2')).toBeTruthy();
    expect(downloadAudio).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Download audio' }));
    expect(await screen.findByText('Audio on this device 2/2')).toBeTruthy();
    expect(screen.getByText('Ready: the stage manager plays it without internet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download audio' })).toBeNull();
    expect(downloadAudio).toHaveBeenCalledTimes(1);
  });

  it('shows the progress while downloading', async () => {
    render(<OfflineAudioCard songs={songs} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download audio' }));
    expect(await screen.findByText(/Downloading 0\/2 · \d+%/)).toBeTruthy();
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(await screen.findByText('Audio on this device 2/2')).toBeTruthy();
  });

  it('a song that can’t be downloaded: which one, why, and Try again', async () => {
    fail.set('a2', 'link');
    render(<OfflineAudioCard songs={songs} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download audio' }));
    expect(await screen.findByText('Azzurro')).toBeTruthy();
    expect(screen.getByText(/The link doesn’t give an audio file/)).toBeTruthy();
    expect(screen.getByText('Audio on this device 1/2')).toBeTruthy();
    fail.clear();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Audio on this device 2/2')).toBeTruthy();
  });

  it('auto: downloads by itself (the days before the gig)', async () => {
    render(<OfflineAudioCard songs={songs} auto />);
    await waitFor(() => expect(downloadAudio).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Audio on this device 2/2')).toBeTruthy();
  });

  it('no song with audio: nothing shown', () => {
    const { container } = render(<OfflineAudioCard songs={[{ title: 'Senza audio' }]} />);
    expect(container.textContent).toBe('');
  });
});
