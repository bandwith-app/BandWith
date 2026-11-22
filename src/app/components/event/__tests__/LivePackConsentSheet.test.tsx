import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

const m = vi.hoisted(() => ({
  refreshPack: vi.fn(async () => ({ eventId: 'ev-1' })),
  chooseAutomatic: vi.fn(),
  chooseThisEvent: vi.fn(),
  chooseNotNow: vi.fn(),
}));
vi.mock('@/lib/livePackStore', () => ({ refreshPack: m.refreshPack }));
vi.mock('@/lib/livePackConsent', () => ({
  chooseAutomatic: m.chooseAutomatic,
  chooseThisEvent: m.chooseThisEvent,
  chooseNotNow: m.chooseNotNow,
}));
vi.mock('@/lib/haptics', () => ({ haptic: { tap: vi.fn() } }));

import { LivePackConsentSheet } from '../LivePackConsentSheet';

const songs = [
  { id: 's1', title: 'New York State of Mind', artist: 'Billy Joel', lyrics: 'Some folks like to get away…' },
  { id: 's2', title: 'Empire State of Mind', artist: 'Jay-Z' },
] as never[];

const props = () => ({
  open: true,
  onClose: vi.fn(),
  userId: 'u-1',
  event: { id: 'ev-1', band_id: 'b-1', title: 'Rooftop Session', venue_name: 'The Loft, Brooklyn' },
  songs,
  onAnswered: vi.fn(),
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('LivePackConsentSheet (plan §3.3)', () => {
  it('says what, where and how much, in plain words', () => {
    render(<LivePackConsentSheet {...props()} />);
    expect(screen.getByRole('dialog', { name: /Have the setlist with you, even without signal/ })).toBeTruthy();
    expect(screen.getByText(/No fees, no contracts\./)).toBeTruthy();
    expect(screen.getByText(/Only on this device, private to you/)).toBeTruthy();
    expect(screen.getByText(/About 0[.,]1 MB, plus your own files\./)).toBeTruthy();
    expect(screen.getByText(/Settings › Offline & live/)).toBeTruthy();
  });

  it('"Download and keep it automatic" saves the answer and downloads now', () => {
    const p = props();
    render(<LivePackConsentSheet {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download and keep it automatic' }));
    expect(m.chooseAutomatic).toHaveBeenCalledWith('u-1', 'ev-1');
    expect(m.refreshPack).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-1', withFiles: true }));
    expect(p.onAnswered).toHaveBeenCalledWith('auto', expect.any(Promise));
    expect(p.onClose).toHaveBeenCalled();
  });

  it('"Only this gig" keeps this one only', () => {
    render(<LivePackConsentSheet {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Only this gig' }));
    expect(m.chooseThisEvent).toHaveBeenCalledWith('u-1', 'ev-1');
    expect(m.chooseAutomatic).not.toHaveBeenCalled();
    expect(m.refreshPack).toHaveBeenCalledTimes(1);
  });

  it('"Not now" downloads nothing', () => {
    const p = props();
    render(<LivePackConsentSheet {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(m.chooseNotNow).toHaveBeenCalledWith('u-1');
    expect(m.refreshPack).not.toHaveBeenCalled();
    expect(p.onAnswered).toHaveBeenCalledWith('notNow', undefined);
  });

  it('rehearsals say rehearsal', () => {
    render(<LivePackConsentSheet {...props()} rehearsal />);
    expect(screen.getByRole('button', { name: 'Only this rehearsal' })).toBeTruthy();
    expect(screen.getByText(/songs of this rehearsal/)).toBeTruthy();
  });
});
