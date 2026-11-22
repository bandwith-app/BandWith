import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

vi.mock('../LivePackConsentSheet', () => ({ downloadPackNow: vi.fn(async () => true) }));
vi.mock('../WaitingChangesTag', () => ({ WaitingChangesTag: () => null }));

import { OfflineReadyRow } from '../OfflineReadyRow';

const file = (id: string, name: string, unavailable?: boolean) => ({ id, song_id: 's1', name, kind: 'pdf', ref: id, ...(unavailable ? { unavailable: true, tries: 3 } : {}) });
const pack = (files: ReturnType<typeof file>[]) => ({
  v: 1 as const,
  eventId: 'e1',
  bandId: 'b1',
  userId: 'u1',
  setlistId: 'sl',
  event: { id: 'e1', band_id: 'b1', setlist_id: 'sl', event_date: '2026-11-28', title: 'The Loft, Brooklyn' },
  songs: [{ id: 'ss1', songId: 's1', setNumber: 1, title: 'Paper Boats' }],
  personal: { s1: { notes: [], files } },
  version: 'v',
  savedAt: new Date().toISOString(),
  expiresAt: '',
});
afterEach(cleanup);

// Review #273 round 8 (item 4): a file of mine missing keeps the pack from
// "Offline ready", also a round 7 pack that gave up on a dead link.
describe('Offline ready only with every file of mine', () => {
  it('a file it gave up on (round 7): not ready, Download offered', () => {
    render(<OfflineReadyRow pack={pack([file('f1', 'Horns.pdf', true), file('f2', 'Bass.pdf')]) as never} userId="u1" event={{ id: 'e1' }} online />);
    expect(screen.queryByText(/^Offline ready/)).toBeNull();
    expect(screen.getByText('Download for offline')).toBeTruthy();
    expect(screen.queryByText(/^Except/)).toBeNull();
  });

  it('every file there: ready, no "except" line', () => {
    render(<OfflineReadyRow pack={pack([file('f2', 'Bass.pdf')]) as never} userId="u1" event={{ id: 'e1' }} online />);
    expect(screen.getByText(/^Offline ready/)).toBeTruthy();
    expect(screen.queryByText(/^Except/)).toBeNull();
  });
});
