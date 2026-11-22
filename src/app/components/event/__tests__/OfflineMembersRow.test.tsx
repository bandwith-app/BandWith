import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  status: [] as Array<{ userId: string; version: string; downloadedAt: string }> | null,
  remind: vi.fn(async () => true),
}));
vi.mock('@/lib/livePackStatus', () => ({
  fetchEventPackStatus: vi.fn(async () => m.status),
  remindPackDownload: m.remind,
}));
vi.mock('@/lib/livePackStore', () => ({ LIVE_PACK_CHANGED: 'bw:live-pack-changed' }));
vi.mock('@/lib/haptics', () => ({ haptic: { tap: vi.fn() } }));

import { OfflineMembersRow, offlineCounts } from '../OfflineMembersRow';

const member = (userId: string | undefined, name: string, status = 'confirmed') => ({ userId, name, status }) as never;
const lineup = [
  member('u-1', 'Maya Chen'),
  member('u-2', 'Luis Ortiz'),
  member('u-3', 'Sam Rivera', 'declined'),
  member('u-4', 'Ava Brooks', 'pending'),
  member(undefined, 'Guest drummer'),
];
const ready = (userId: string) => ({ userId, version: 'v1', downloadedAt: '2026-11-21T20:00:00Z' });

beforeEach(() => {
  m.status = [ready('u-1')];
  m.remind.mockClear();
});
afterEach(cleanup);

describe('Offline: N of M members ready (plan §3.4)', () => {
  it('counts the lineup with an account, minus who declined', () => {
    const c = offlineCounts(lineup, [ready('u-1'), ready('u-3')]);
    expect(c.total).toBe(3);
    expect(c.ready).toBe(1);
    expect(c.notReady.map((x: any) => x.name)).toEqual(['Luis Ortiz', 'Ava Brooks']);
  });

  it('shows the count, lists who is not ready, and reminds one', async () => {
    render(<OfflineMembersRow eventId="ev-1" members={lineup} online />);
    const row = await screen.findByRole('button', { name: /Offline: 1 of 3 members ready/ });
    fireEvent.click(row);
    fireEvent.click(screen.getByRole('button', { name: 'Remind Luis Ortiz' }));
    expect(m.remind).toHaveBeenCalledWith('ev-1', 'u-2');
    await waitFor(() => expect(screen.getByText('Reminded')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Remind Ava Brooks' })).toBeTruthy();
  });

  it('everyone ready: nothing to open', async () => {
    m.status = [ready('u-1'), ready('u-2'), ready('u-4')];
    render(<OfflineMembersRow eventId="ev-1" members={lineup} online />);
    expect(await screen.findByText('Everyone has the setlist on their phone.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remind/ })).toBeNull();
  });

  it('no Remind without signal', async () => {
    render(<OfflineMembersRow eventId="ev-1" members={lineup} online={false} />);
    fireEvent.click(await screen.findByRole('button', { name: /Offline: 1 of 3/ }));
    expect((screen.getByRole('button', { name: 'Remind Luis Ortiz' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('an older database (no status table): the row stays hidden', async () => {
    m.status = null;
    const { container } = render(<OfflineMembersRow eventId="ev-1" members={lineup} online />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });
});
