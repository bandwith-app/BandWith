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
import { endSession, fromRow, markPlayed, startSession, toRow, type SessionRow } from '@/lib/rehearsalSession';

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
    saveMock.mockResolvedValueOnce({ error: null, conflict: true }).mockResolvedValue({ error: null, rev: 'r3' });
    const { result } = setup({ currentSong: null });
    await waitFor(() => expect(result.current.status).toBe('live'));
    // Meanwhile the other admin ended it (this device missed the message).
    fetchMock.mockResolvedValue({ state: ended, summary: null, rev: 'r2' });
    act(() => result.current.pause());
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0][1]).toBe('r1');
    await waitFor(() => expect(result.current.status).toBe('ended'));
    // The stale Pause doesn't undo the End; it is saved with it on top of r2 (#296 round 8: every
    // copy keeps all that was done, so all devices merge to the same session later too).
    await waitFor(() => expect(result.current.unsaved).toBe(false));
    expect(saveMock.mock.calls.map((c) => c[1])).toEqual(['r1', 'r2']);
    expect((saveMock.mock.calls[1][0] as SessionRow).ended_at).not.toBeNull();
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

describe('#296 round 4: a late message never undoes a saved End', () => {
  const T0 = Date.now() - 30 * 60_000;
  const live = startSession(T0);
  const ended = endSession(live, T0 + 25 * 60_000);
  const R1 = '2026-11-19T19:00:00.000000+00:00';
  const R2 = '2026-11-19T19:25:00.000000+00:00';
  const R3 = '2026-11-19T19:40:00.000000+00:00';
  const msg = (row: SessionRow, rev?: string) => ({ v: 1, eventId: 'event-1', date: '2026-11-19', row, ...(rev ? { rev } : {}) });

  for (const [label, rev] of [
    ['built on an older revision', R1],
    ['from an older build (no revision)', undefined],
    ['even on a newer revision', R3],
  ] as const) {
    it(`admin: a delayed “running” message ${label} keeps the saved End; Pause then saves nothing over it`, async () => {
      fetchMock.mockResolvedValue({ state: ended, summary: null, rev: R2 });
      const { result, bridge } = setup({ currentSong: null });
      await waitFor(() => expect(result.current.status).toBe('ended'));
      act(() => bridge.current.receive?.(msg(toRow(live, CTX, 3, Date.now()), rev)));
      expect(result.current.status).toBe('ended');
      act(() => result.current.pause());
      await act(async () => {});
      for (const call of saveMock.mock.calls) expect((call[0] as SessionRow).ended_at).not.toBeNull();
      expect(result.current.status).toBe('ended');
    });
  }

  it('member: a delayed “running” message from an older build does not reopen the ended rehearsal', async () => {
    fetchMock.mockResolvedValue({ state: ended, summary: null, rev: R2 });
    const { result, bridge } = setup({ isLeader: false, currentSong: null });
    await waitFor(() => expect(result.current.status).toBe('ended'));
    act(() => bridge.current.receive?.(msg(toRow(live, CTX, 3, Date.now()))));
    expect(result.current.status).toBe('ended');
  });

  it('the band is sent the revision each message is built on', async () => {
    fetchMock.mockResolvedValue({ state: live, summary: null, rev: R1 });
    const { result, send } = setup({ currentSong: null });
    await waitFor(() => expect(result.current.status).toBe('live'));
    act(() => result.current.pause());
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ rev: R1 }));
  });

  it('a newer save’s message is taken as it is (a Pause made on the other admin’s phone)', async () => {
    fetchMock.mockResolvedValue({ state: live, summary: null, rev: R1 });
    const { result, bridge } = setup({ currentSong: null });
    await waitFor(() => expect(result.current.status).toBe('live'));
    act(() => bridge.current.receive?.(msg(toRow({ ...live, pausedAt: T0 + 20 * 60_000 }, CTX, 3, Date.now()), R2)));
    expect(result.current.status).toBe('paused');
  });
});

describe('#296 round 4: a conflict merge keeps a copy that ran on after the End', () => {
  it('started here unread and ended offline; the saved one (another start) played a song after that End: it stays running', async () => {
    const T0 = Date.now() - 90 * 60_000;
    // #296 round 8: what it did after the End decides (a song at 1:10), not when it was saved.
    const savedLive = markPlayed(startSession(T0), { id: 's7', title: 'Harbor Lights' }, T0 + 70 * 60_000);
    fetchMock.mockResolvedValue(undefined);
    saveMock.mockResolvedValueOnce({ error: null, conflict: true }).mockResolvedValue({ error: null, rev: new Date().toISOString() });
    const { result } = setup({ currentSong: null });
    await waitFor(() => expect(result.current.ready).toBe(true));
    // Written 10 minutes ago, after this device's End below.
    fetchMock.mockResolvedValue({ state: savedLive, summary: null, rev: new Date(Date.now() - 10 * 60_000).toISOString() });
    const realNow = Date.now.bind(Date);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0 + 5 * 60_000);
    act(() => result.current.start());
    clock.mockReturnValue(T0 + 60 * 60_000);
    act(() => result.current.end());
    clock.mockImplementation(realNow);
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2));
    clock.mockRestore();
    expect(result.current.state?.startedAt).toBe(T0);
    expect(result.current.status).toBe('live');
  });
});

describe('#296 round 5: an older build’s Resume on the channel', () => {
  const T0 = Date.now() - 30 * 60_000;
  const live = startSession(T0);
  /** What builds up to 383f15b send: no rev, no pause times. */
  const oldMsg = (state: Parameters<typeof toRow>[0]) => {
    const row = toRow(state, CTX, 3, Date.now());
    const { pauses: _drop, ...summary } = row.summary;
    return { v: 1, eventId: 'event-1', date: '2026-11-19', row: { ...row, summary } };
  };

  for (const isLeader of [false, true]) {
    it(`${isLeader ? 'admin' : 'member'}: the old build pauses, then resumes: running here again (not frozen)`, async () => {
      fetchMock.mockResolvedValue({ state: live, summary: null, rev: 'r1' });
      const { result, bridge } = setup({ isLeader, currentSong: null });
      await waitFor(() => expect(result.current.status).toBe('live'));
      const pausedAt = Date.now() - 3 * 60_000;
      act(() => bridge.current.receive?.(oldMsg({ ...live, pausedAt, pauses: undefined })));
      expect(result.current.status).toBe('paused');
      // The old build's Resume: paused_ms grows by the pause, pausedAt back to null.
      act(() => bridge.current.receive?.(oldMsg({ ...live, pausedMs: 2 * 60_000, pauses: undefined })));
      expect(result.current.status).toBe('live');
      expect(result.current.state?.pausedMs).toBe(2 * 60_000);
    });
  }

  it('an old build’s Resume after our End: running again, the duration keeps every minute', async () => {
    // Ended 5 minutes ago; the old build's Resume adds those 5 minutes (#296 round 8: it must match).
    const endAt = Date.now() - 5 * 60_000;
    const ended = endSession(live, endAt);
    fetchMock.mockResolvedValue({ state: ended, summary: null, rev: 'r1' });
    const { result, bridge } = setup({ isLeader: false, currentSong: null });
    await waitFor(() => expect(result.current.status).toBe('ended'));
    act(() => bridge.current.receive?.(oldMsg({ ...live, pausedMs: 5 * 60_000, pauses: undefined })));
    expect(result.current.status).toBe('live');
    expect(result.current.state?.pauses).toEqual([[endAt, endAt + 5 * 60_000]]);
  });

  it('Codex r8 B5: an offline old build’s copy with more paused time of its own does not undo our End', async () => {
    const ended = endSession(live, Date.now() - 5 * 60_000);
    fetchMock.mockResolvedValue({ state: ended, summary: null, rev: 'r1' });
    const { result, bridge } = setup({ isLeader: false, currentSong: null });
    await waitFor(() => expect(result.current.status).toBe('ended'));
    // It paused 12 minutes before our End, offline, and comes back running.
    act(() => bridge.current.receive?.(oldMsg({ ...live, pausedMs: 12 * 60_000, pauses: undefined })));
    expect(result.current.status).toBe('ended');
  });
});

describe('#296 round 6: End on the channel, older builds’ pauses', () => {
  const M = 60_000;
  const oldMsg = (state: Parameters<typeof toRow>[0]) => {
    const row = toRow(state, CTX, 3, Date.now());
    const { pauses: _drop, ...summary } = row.summary;
    return { v: 1, eventId: 'event-1', date: '2026-11-19', row: { ...row, summary } };
  };
  const newMsg = (state: Parameters<typeof toRow>[0], rev: string) => ({ v: 1, eventId: 'event-1', date: '2026-11-19', row: toRow(state, CTX, 3, Date.now()), rev });

  it('Codex r7 #5: another admin’s End arrives, its save is slow: the 2.5 s refresh doesn’t bring the running session back', async () => {
    const live = startSession(Date.now() - 30 * M);
    fetchMock.mockResolvedValue({ state: live, summary: null, rev: 'r1' });
    const { result, bridge } = setup({ currentSong: null });
    await waitFor(() => expect(result.current.status).toBe('live'));
    act(() => bridge.current.receive?.(newMsg(endSession(live, Date.now()), 'r1')));
    expect(result.current.status).toBe('ended');
    // The refresh reads the row before the End's save landed.
    await new Promise((r) => setTimeout(r, 2700));
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(result.current.status).toBe('ended');
  }, 10_000);

  it('Codex r7 #5: a save that lands is told to the band again, on its new revision', async () => {
    saveMock.mockResolvedValue({ error: null, rev: 'r9' });
    const { result, send } = setup({ currentSong: null });
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ rev: 'r9', row: expect.objectContaining({ ended_at: null }) })));
  });

  it('Claude r5 #3: member: the new admin paused 20–25, then an older build pauses at 30 and resumes at 33: live, 8 min', async () => {
    const T0 = Date.now() - 40 * M;
    const withPause = { ...startSession(T0), pausedMs: 5 * M, pauses: [[T0 + 20 * M, T0 + 25 * M]] as [number, number][] };
    fetchMock.mockResolvedValue({ state: withPause, summary: null, rev: 'r1' });
    const { result, bridge } = setup({ isLeader: false, currentSong: null });
    await waitFor(() => expect(result.current.state?.pausedMs).toBe(5 * M));
    // The older build never knew of 20–25: its paused time is its own.
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0 + 30 * M);
    act(() => bridge.current.receive?.(oldMsg({ ...startSession(T0), pausedAt: T0 + 30 * M, pauses: undefined })));
    expect(result.current.status).toBe('paused');
    now.mockReturnValue(T0 + 33 * M + 2000);
    act(() => bridge.current.receive?.(oldMsg({ ...startSession(T0), pausedMs: 3 * M, pauses: undefined })));
    now.mockRestore();
    expect(result.current.status).toBe('live');
    expect(result.current.state?.pausedMs).toBe(8 * M);
  });

  it('Claude r5 #2: member: an older build’s 7 min (0:10–0:17), then the new admin’s 0:40–0:45 on an older revision: 12', async () => {
    const T0 = Date.now() - 60 * M;
    fetchMock.mockResolvedValue({ state: startSession(T0), summary: null, rev: 'r1' });
    const { result, bridge } = setup({ isLeader: false, currentSong: null });
    await waitFor(() => expect(result.current.status).toBe('live'));
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0 + 20 * M);
    act(() => bridge.current.receive?.(oldMsg({ ...startSession(T0), pausedMs: 7 * M, pauses: undefined })));
    expect(result.current.state?.pausedMs).toBe(7 * M);
    now.mockReturnValue(T0 + 50 * M);
    act(() => bridge.current.receive?.(newMsg({ ...startSession(T0), pausedMs: 5 * M, pauses: [[T0 + 40 * M, T0 + 45 * M]] }, 'r1')));
    now.mockRestore();
    expect(result.current.state?.pausedMs).toBe(12 * M);
  });
});

describe('main after the 2385ce12 dry run: the 2-minute match is for older builds only', () => {
  it('this build resumes offline 30 s after an End it read, saved 10 minutes later: running, on the revision it read', async () => {
    const M = 60_000;
    const T = Date.now();
    const endAt = T - 10 * M - 30_000;
    const ended = endSession(startSession(T - 50 * M), endAt);
    fetchMock.mockResolvedValue({ state: ended, summary: null, rev: 'r2' });
    saveMock.mockResolvedValue({ error: { message: 'offline' } });
    const { result } = setup({ currentSong: null });
    await waitFor(() => expect(result.current.status).toBe('ended'));
    const now = vi.spyOn(Date, 'now').mockReturnValue(endAt + 30_000);
    act(() => result.current.resume());
    now.mockRestore();
    expect(result.current.status).toBe('live');
    await waitFor(() => expect(result.current.unsaved).toBe(true));
    // Back online 10 minutes later; the server still has the End (r2).
    saveMock.mockReset().mockResolvedValue({ error: null, rev: 'r3' });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(result.current.unsaved).toBe(false));
    const last = saveMock.mock.calls[saveMock.mock.calls.length - 1];
    expect(last[1]).toBe('r2');
    expect((last[0] as SessionRow).ended_at).toBeNull();
    expect((last[0] as SessionRow).paused_ms).toBe(30_000);
    expect(result.current.status).toBe('live');
  });
});
