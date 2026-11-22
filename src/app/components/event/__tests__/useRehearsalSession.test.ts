import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const fetchMock = vi.fn();
const saveMock = vi.fn();
vi.mock('@/lib/services/rehearsalSessions', () => ({
  fetchRehearsalSession: (...a: unknown[]) => fetchMock(...a),
  saveRehearsalSession: (...a: unknown[]) => saveMock(...a),
}));

import { useRehearsalSession } from '../useRehearsalSession';
import type { StageSessionBridge } from '../useStageLive';
import { endSession, fromRow, startSession, toRow, type SessionRow } from '@/lib/rehearsalSession';

const CTX = { bandId: 'band-1', eventId: 'event-1', date: '2026-11-19' };

const setup = (over: Partial<Parameters<typeof useRehearsalSession>[0]> = {}) => {
  const bridge: { current: StageSessionBridge } = { current: {} };
  const send = vi.fn();
  const hook = renderHook((p: Partial<Parameters<typeof useRehearsalSession>[0]>) =>
    useRehearsalSession({
      enabled: true,
      ...CTX,
      open: true,
      isLeader: true,
      currentSong: { id: 's1', title: 'Paper Boats' },
      total: 3,
      connected: true,
      send,
      bridge,
      ...over,
      ...p,
    }),
  { initialProps: {} });
  return { ...hook, bridge, send };
};

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset().mockResolvedValue(null);
  saveMock.mockReset().mockResolvedValue({ error: null });
});

describe('useRehearsalSession (A1b)', () => {
  it('the admin starts it: sent to the band, saved, the current song counts as played', async () => {
    const { result, send } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start());
    expect(result.current.status).toBe('live');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ v: 1, eventId: 'event-1', date: '2026-11-19' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    const row = saveMock.mock.calls[0][0];
    expect(row).toMatchObject({ band_id: 'band-1', event_id: 'event-1', occurrence_date: '2026-11-19', ended_at: null });
    await waitFor(() => expect(result.current.state?.played).toEqual([{ id: 's1', title: 'Paper Boats', at: expect.any(Number) }]));
  });

  it('offline: kept on the device, saved when the network is back', async () => {
    saveMock.mockResolvedValue({ error: { message: 'offline' } });
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.unsaved).toBe(true));
    expect(localStorage.getItem('bw-rehearsal-session:event-1|2026-11-19')).toContain('"dirty":true');
    saveMock.mockResolvedValue({ error: null });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(result.current.unsaved).toBe(false));
    expect(localStorage.getItem('bw-rehearsal-session:event-1|2026-11-19')).toContain('"dirty":false');
  });

  it('an unsaved session on the device wins over the server after a restart, and is saved', async () => {
    const mine = startSession(Date.now() - 60_000);
    localStorage.setItem('bw-rehearsal-session:event-1|2026-11-19', JSON.stringify({ row: toRow(mine, CTX, 3, Date.now()), dirty: true }));
    fetchMock.mockResolvedValue(null);
    const { result } = setup({ currentSong: null });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.state?.startedAt).toBe(mine.startedAt);
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
  });

  it('a member shows what is saved, then follows the admin on the channel', async () => {
    const saved = startSession(Date.now() - 5 * 60_000);
    fetchMock.mockResolvedValue({ state: saved, summary: null });
    const { result, bridge } = setup({ isLeader: false, currentSong: null });
    await waitFor(() => expect(result.current.status).toBe('live'));
    expect(result.current.canControl).toBe(false);
    act(() => bridge.current.receive?.({ v: 1, eventId: 'event-1', date: '2026-11-19', row: { ...toRow(saved, CTX, 3, Date.now()), ended_at: new Date().toISOString() } }));
    expect(result.current.status).toBe('ended');
    expect(result.current.justEnded).toBe(true);
    // Another rehearsal's session is ignored.
    act(() => bridge.current.receive?.({ v: 1, eventId: 'event-2', date: '2026-11-19', row: null }));
    expect(result.current.status).toBe('ended');
    // A member never writes.
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('the admin answers a late arrival with the running session', async () => {
    const { result, bridge } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(bridge.current.latest?.()).toBeNull();
    act(() => result.current.start());
    expect(bridge.current.latest?.()).toMatchObject({ v: 1, eventId: 'event-1', row: { occurrence_date: '2026-11-19' } });
  });

  it('off (flag, not a band rehearsal): nothing read or written', async () => {
    const { result } = setup({ enabled: false });
    act(() => result.current.start());
    expect(result.current.enabled).toBe(false);
    expect(result.current.status).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });
});

describe('audit 06 #3/#4: a saved rehearsal is never written over', () => {
  const T0 = Date.now() - 30 * 60_000;
  const live = startSession(T0);
  const ended = { ...endSession({ ...live, played: [{ id: 's1', title: 'Paper Boats' }, { id: 's2', title: 'Superstition' }] }, T0 + 25 * 60_000) };

  it('#4: Start before the saved session has been read does nothing', async () => {
    let answer!: (v: unknown) => void;
    fetchMock.mockImplementation(() => new Promise((r) => (answer = r)));
    const { result } = setup({ currentSong: null });
    expect(result.current.ready).toBe(false);
    act(() => result.current.start());
    expect(result.current.status).toBe('idle');
    expect(saveMock).not.toHaveBeenCalled();
    await act(async () => answer({ state: ended, summary: null, rev: 'r2' }));
    await waitFor(() => expect(result.current.status).toBe('ended'));
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('#4: never read (no signal) and a session is already saved: the first save only creates, then both merge (the earlier start, the saved songs)', async () => {
    fetchMock.mockResolvedValue(undefined);
    saveMock.mockResolvedValueOnce({ error: null, conflict: true }).mockResolvedValue({ error: null, rev: 'r3' });
    const { result, send } = setup({ currentSong: null });
    await waitFor(() => expect(result.current.ready).toBe(true));
    fetchMock.mockResolvedValue({ state: ended, summary: null, rev: 'r2' });
    act(() => result.current.start());
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2));
    // Create only: no revision to overwrite.
    expect(saveMock.mock.calls[0][1] ?? null).toBeNull();
    // Then on top of the saved one: its start and songs kept, running here (#296 round 3: never closed by
    // the saved End), the time between that End and this Start is a pause.
    expect(saveMock.mock.calls[1][1]).toBe('r2');
    const row = saveMock.mock.calls[1][0] as SessionRow;
    expect(row.started_at).toBe(new Date(T0).toISOString());
    expect(row.ended_at).toBeNull();
    expect(row.paused_ms).toBeGreaterThanOrEqual(5 * 60_000 - 1000);
    await waitFor(() => expect(result.current.unsaved).toBe(false));
    expect(result.current.status).toBe('live');
    expect(result.current.state?.played).toHaveLength(2);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ row: expect.objectContaining({ started_at: new Date(T0).toISOString() }) }));
  });

  it('#3: a second admin follows the first one on the channel (no Start rehearsal over an ended one)', async () => {
    fetchMock.mockResolvedValue(null);
    const { result, bridge } = setup({ currentSong: null });
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => bridge.current.receive?.({ v: 1, eventId: 'event-1', date: '2026-11-19', row: toRow(live, CTX, 3, Date.now()) }));
    expect(result.current.status).toBe('live');
    act(() => bridge.current.receive?.({ v: 1, eventId: 'event-1', date: '2026-11-19', row: toRow(ended, CTX, 3, Date.now()) }));
    expect(result.current.status).toBe('ended');
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('#3: a change from a device that missed the end is checked against the saved revision; the saved end wins', async () => {
    fetchMock.mockResolvedValue({ state: live, summary: null, rev: 'r1' });
    saveMock.mockResolvedValue({ error: null, conflict: true });
    const { result } = setup({ currentSong: null });
    await waitFor(() => expect(result.current.status).toBe('live'));
    // Meanwhile the other admin ended it (this device missed the message).
    fetchMock.mockResolvedValue({ state: ended, summary: null, rev: 'r2' });
    act(() => result.current.pause());
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0][1]).toBe('r1');
    await waitFor(() => expect(result.current.status).toBe('ended'));
    expect(result.current.unsaved).toBe(false);
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it('the revision moves on with each save: the next change is checked against it', async () => {
    fetchMock.mockResolvedValue({ state: live, summary: null, rev: 'r1' });
    saveMock.mockResolvedValueOnce({ error: null, rev: 'r2' }).mockResolvedValue({ error: null, rev: 'r3' });
    const { result } = setup({ currentSong: null });
    await waitFor(() => expect(result.current.status).toBe('live'));
    act(() => result.current.pause());
    await waitFor(() => expect(result.current.unsaved).toBe(false));
    act(() => result.current.resume());
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2));
    expect(saveMock.mock.calls.map((c) => c[1])).toEqual(['r1', 'r2']);
  });
});

describe('#296 round 2: offline, upgrades and lost answers never drop a session change', () => {
  const KEY = 'bw-rehearsal-session:event-1|2026-11-19';
  const T0 = Date.now() - 30 * 60_000;
  const live = startSession(T0);

  it('B1: reopened with no signal from a clean copy, End is saved on top of the revision it was read at', async () => {
    localStorage.setItem(KEY, JSON.stringify({ row: toRow(live, CTX, 3, Date.now()), dirty: false, rev: 'r1' }));
    fetchMock.mockResolvedValue(undefined);
    const { result } = setup({ currentSong: null });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.status).toBe('live');
    act(() => result.current.end());
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0][1]).toBe('r1');
  });

  it('B2: an edit waiting from the previous version (no revision) is merged into the saved row, not dropped', async () => {
    const mine = endSession({ ...live, played: [{ id: 's1', title: 'Paper Boats' }] }, T0 + 25 * 60_000);
    // Written by the previous version: no rev.
    localStorage.setItem(KEY, JSON.stringify({ row: toRow(mine, CTX, 3, Date.now()), dirty: true }));
    fetchMock.mockResolvedValue({ state: { ...live, played: [{ id: 's2', title: 'Superstition' }] }, summary: null, rev: 'r1' });
    saveMock.mockImplementation(async (_row: SessionRow, rev?: string | null) => (rev === 'r1' ? { error: null, rev: 'r2' } : { error: null, conflict: true }));
    const { result } = setup({ currentSong: null });
    await waitFor(() => expect(result.current.unsaved).toBe(false));
    const last = saveMock.mock.calls[saveMock.mock.calls.length - 1];
    expect(last[1]).toBe('r1');
    expect(last[0].ended_at).not.toBeNull();
    expect(last[0].summary.played.map((p: { id: string }) => p.id).sort()).toEqual(['s1', 's2']);
    expect(result.current.status).toBe('ended');
  });

  it('B3: Start saved but its answer lost: on reconnect the row is ours, and the end goes on top of it', async () => {
    fetchMock.mockResolvedValue(null);
    let firstRow: SessionRow | null = null;
    saveMock.mockImplementationOnce(async (row: SessionRow) => {
      firstRow = row; // the server kept it, the answer never arrived
      return { error: { message: 'Failed to fetch' } };
    });
    const { result } = setup({ currentSong: null });
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.unsaved).toBe(true));
    saveMock.mockResolvedValue({ error: { message: 'Failed to fetch' } });
    act(() => result.current.end());
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2));
    // Back online: the insert finds its own Start there.
    fetchMock.mockImplementation(async () => ({ state: fromRow(firstRow)!, summary: null, rev: 'r1' }));
    saveMock.mockImplementation(async (_row: SessionRow, rev?: string | null) => (rev === 'r1' ? { error: null, rev: 'r2' } : { error: null, conflict: true }));
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(result.current.unsaved).toBe(false));
    const last = saveMock.mock.calls[saveMock.mock.calls.length - 1];
    expect(last[1]).toBe('r1');
    expect(last[0].ended_at).not.toBeNull();
    expect(result.current.status).toBe('ended');
  });

  it('Claude B2: a song save went through but its answer was lost; End then finds a newer revision and is kept', async () => {
    fetchMock.mockResolvedValue({ state: live, summary: null, rev: 'r1' });
    const { result, rerender } = setup({ currentSong: null });
    await waitFor(() => expect(result.current.status).toBe('live'));
    // The song change is saved on the server (r2), the answer never arrives.
    saveMock.mockResolvedValueOnce({ error: { message: 'Failed to fetch' } });
    rerender({ currentSong: { id: 's1', title: 'Paper Boats' } });
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1), { timeout: 3000 });
    fetchMock.mockResolvedValue({ state: { ...live, played: [{ id: 's1', title: 'Paper Boats' }] }, summary: null, rev: 'r2' });
    saveMock.mockImplementation(async (_row: SessionRow, rev?: string | null) => (rev === 'r2' ? { error: null, rev: 'r3' } : { error: null, conflict: true }));
    act(() => result.current.end());
    await waitFor(() => expect(result.current.unsaved).toBe(false));
    const last = saveMock.mock.calls[saveMock.mock.calls.length - 1];
    expect(last[1]).toBe('r2');
    expect(last[0].ended_at).not.toBeNull();
    expect(result.current.status).toBe('ended');
  });

  it('Claude minor: a first read that hangs (weak signal) frees Start after about 4 s; it starts as a new row only', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchMock.mockImplementation(() => new Promise(() => {}));
      const { result } = setup({ currentSong: null });
      expect(result.current.ready).toBe(false);
      await act(async () => {
        vi.advanceTimersByTime(4100);
      });
      expect(result.current.ready).toBe(true);
      act(() => result.current.start());
      expect(result.current.status).toBe('live');
      await waitFor(() => expect(saveMock).toHaveBeenCalled());
      expect(saveMock.mock.calls[0][1] ?? null).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('#296 round 3: a change kept on this device is never overwritten', () => {
  const KEY = 'bw-rehearsal-session:event-1|2026-11-19';
  const T0 = Date.now() - 30 * 60_000;
  const live = startSession(T0);

  it('Codex B2: reopened offline with an End not saved yet; another admin’s message arrives first: the End stays, still unsaved', async () => {
    const mine = endSession(live, T0 + 25 * 60_000);
    localStorage.setItem(KEY, JSON.stringify({ row: toRow(mine, CTX, 3, Date.now()), dirty: true, rev: 'r1' }));
    fetchMock.mockResolvedValue(undefined);
    saveMock.mockResolvedValue({ error: { message: 'Failed to fetch' } });
    const { result, bridge } = setup({ currentSong: null });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.status).toBe('ended');
    expect(result.current.unsaved).toBe(true);
    // Reconnect: the other admin's (older) running copy, with a song this device didn't have.
    const theirs = { ...live, played: [{ id: 's2', title: 'Superstition', at: T0 + 5 * 60_000 }] };
    act(() => bridge.current.receive?.({ v: 1, eventId: 'event-1', date: '2026-11-19', row: toRow(theirs, CTX, 3, Date.now()) }));
    expect(result.current.status).toBe('ended');
    expect(result.current.state?.played.map((p) => p.id)).toEqual(['s2']);
    expect(result.current.unsaved).toBe(true);
    const kept = JSON.parse(localStorage.getItem(KEY)!);
    expect(kept.dirty).toBe(true);
    expect(kept.row.ended_at).not.toBeNull();
  });

  it('Codex/Claude minor: a slow first read comes back empty after Start (4 s) was saved: the session stays, and so does the copy here', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let answer!: (v: unknown) => void;
      fetchMock.mockImplementation(() => new Promise((r) => (answer = r)));
      saveMock.mockResolvedValue({ error: null, rev: 'r1' });
      const { result } = setup({ currentSong: null });
      await act(async () => {
        vi.advanceTimersByTime(4100);
      });
      act(() => result.current.start());
      await waitFor(() => expect(result.current.unsaved).toBe(false));
      // The read sent before Start: nothing was saved then.
      await act(async () => answer(null));
      expect(result.current.status).toBe('live');
      expect(JSON.parse(localStorage.getItem(KEY)!).row.started_at).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
