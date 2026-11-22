import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => ({
  log: [] as Array<{ table?: string; fn?: string; op: string; args: unknown[] }>,
  rows: [] as unknown[],
  native: true,
  /** What an upsert … select() returns: the row written ([] when the server dropped it). */
  upserted: null as unknown[] | null,
  /** The stored row a re-read returns. */
  current: null as unknown,
  /** Held upserts: each waits for its gate. */
  gates: [] as Array<Promise<void>>,
  settled: [] as string[],
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => calls.native } }));
vi.mock('../supabase', () => {
  const query = (table: string) => {
    const q: any = {};
    let first = '';
    let single = false;
    for (const op of ['upsert', 'delete', 'update', 'select', 'eq', 'in', 'maybeSingle']) {
      q[op] = (...args: unknown[]) => {
        calls.log.push({ table, op, args });
        first ||= op;
        if (op === 'maybeSingle') single = true;
        return q;
      };
    }
    q.then = (res: (v: unknown) => void) => {
      const gate = first === 'upsert' ? calls.gates.shift() : undefined;
      return Promise.resolve(gate).then(() => {
        calls.settled.push(first);
        if (first === 'upsert') return res({ data: calls.upserted ?? [{}], error: null });
        if (first === 'select' && single) return res({ data: calls.current, error: null });
        return res({ data: calls.rows, error: null });
      });
    };
    return q;
  };
  return {
    isDemoMode: false,
    supabase: {
      from: (t: string) => query(t),
      rpc: async (fn: string, args: unknown) => {
        calls.log.push({ fn, op: 'rpc', args: [args] });
        return { data: true, error: null };
      },
    },
  };
});

import {
  deviceId,
  reportPackStatus,
  forgetPackStatus,
  fetchEventPackStatus,
  remindPackDownload,
  saveProfileChoice,
} from '../livePackStatus';

beforeEach(() => {
  calls.log = [];
  calls.rows = [];
  calls.upserted = null;
  calls.current = null;
  calls.gates = [];
  calls.settled = [];
  calls.native = true;
  localStorage.clear();
});

const pack = { eventId: 'ev-1', userId: 'u-1', version: 'abc', savedAt: '2026-11-21T20:00:00.000Z' };

describe('live pack status', () => {
  it('keeps one id per device', () => {
    const a = deviceId();
    expect(a).toBeTruthy();
    expect(deviceId()).toBe(a);
  });

  it('reports a pack version once, again only when it changes', async () => {
    await reportPackStatus(pack);
    await reportPackStatus(pack);
    const ups = calls.log.filter((c) => c.op === 'upsert');
    expect(ups).toHaveLength(1);
    expect(ups[0].table).toBe('live_pack_status');
    expect(ups[0].args[0]).toEqual({ event_id: 'ev-1', user_id: 'u-1', device_id: deviceId(), version: 'abc', downloaded_at: pack.savedAt, partial: false });
    await reportPackStatus({ ...pack, version: 'def' });
    expect(calls.log.filter((c) => c.op === 'upsert')).toHaveLength(2);
  });

  it('the web does not report (no pack for the venue there)', async () => {
    calls.native = false;
    await reportPackStatus(pack);
    expect(calls.log).toHaveLength(0);
  });

  it('forgetting removes this device’s rows and lets the next save report again', async () => {
    await reportPackStatus(pack);
    await forgetPackStatus('u-1', ['ev-1']);
    const del = calls.log.filter((c) => c.op === 'delete' || (c.op === 'in' && c.table === 'live_pack_status'));
    expect(del.map((c) => c.op)).toEqual(['delete', 'in']);
    await reportPackStatus(pack);
    expect(calls.log.filter((c) => c.op === 'upsert')).toHaveLength(2);
  });

  it('admins: one row per member, the latest device wins', async () => {
    calls.rows = [
      { user_id: 'a', version: 'v1', downloaded_at: '2026-11-20T10:00:00Z' },
      { user_id: 'a', version: 'v2', downloaded_at: '2026-11-21T10:00:00Z' },
      { user_id: 'b', version: 'v1', downloaded_at: '2026-11-19T10:00:00Z' },
    ];
    const rows = await fetchEventPackStatus('ev-1');
    expect(rows?.map((r) => `${r.userId}:${r.version}`).sort()).toEqual(['a:v2', 'b:v1']);
  });

  it('a partial pack is reported partial, and again once it is whole (round 4)', async () => {
    await reportPackStatus({ ...pack, partial: true });
    await reportPackStatus({ ...pack, partial: true });
    await reportPackStatus(pack);
    const ups = calls.log.filter((c) => c.op === 'upsert').map((c) => (c.args[0] as { partial: boolean }).partial);
    expect(ups).toEqual([true, false]);
  });

  it('admins: a partial pack does not count as ready (round 4)', async () => {
    calls.rows = [
      { user_id: 'a', version: 'v1', downloaded_at: '2026-11-21T10:00:00Z', partial: true },
      { user_id: 'b', version: 'v1', downloaded_at: '2026-11-19T10:00:00Z', partial: false },
    ];
    const rows = await fetchEventPackStatus('ev-1');
    expect(rows?.map((r) => r.userId)).toEqual(['b']);
  });

  it('remind and the profile choice go to the server', async () => {
    expect(await remindPackDownload('ev-1', 'u-2')).toBe(true);
    expect(calls.log.find((c) => c.fn === 'bw_live_pack_remind')?.args[0]).toEqual({ p_event_id: 'ev-1', p_user_id: 'u-2' });
    await saveProfileChoice('u-1', { auto: true, askedAt: '2026-11-21T20:00:00.000Z' });
    const up = calls.log.find((c) => c.op === 'update');
    expect(up?.table).toBe('profiles');
    expect(up?.args[0]).toEqual({ live_pack_auto: true, live_pack_asked_at: '2026-11-21T20:00:00.000Z' });
  });
});

describe('round 7 (review #273, Claude)', () => {
  const stamps = () => calls.log.filter((c) => c.op === 'upsert').map((c) => (c.args[0] as { downloaded_at: string }).downloaded_at);

  it('Delete all waits for a write already in flight, so it cannot bring the row back', async () => {
    let open!: () => void;
    calls.gates.push(new Promise<void>((r) => (open = r)));
    const writing = reportPackStatus(pack);
    const forgetting = forgetPackStatus('u-1');
    await Promise.resolve();
    open();
    await Promise.all([writing, forgetting]);
    expect(calls.settled.filter((op) => op === 'upsert' || op === 'delete')).toEqual(['upsert', 'delete']);
  });

  it('a write after Delete all waits for the delete', async () => {
    let open!: () => void;
    calls.gates.push(new Promise<void>((r) => (open = r)));
    const first = reportPackStatus(pack);
    const forgetting = forgetPackStatus('u-1', ['ev-1']);
    const again = reportPackStatus({ ...pack, version: 'v2', savedAt: '2026-11-21T20:05:00.000Z' });
    open();
    await Promise.all([first, forgetting, again]);
    expect(calls.settled.filter((op) => op === 'upsert' || op === 'delete')).toEqual(['upsert', 'delete', 'upsert']);
  });

  it('the device clock went back: the stamp still moves forward', async () => {
    await reportPackStatus(pack);
    await reportPackStatus({ ...pack, version: 'v2', savedAt: '2026-11-21T19:00:00.000Z' });
    const [a, b] = stamps();
    expect(Date.parse(b)).toBeGreaterThan(Date.parse(a));
  });

  it('the server dropped the save (its stamp is newer): sent again just above it', async () => {
    calls.upserted = [];
    calls.current = { downloaded_at: '2027-01-01T00:00:00.000Z' };
    await reportPackStatus(pack);
    const sent = stamps();
    expect(sent).toHaveLength(2);
    expect(Date.parse(sent[1])).toBeGreaterThan(Date.parse('2027-01-01T00:00:00.000Z'));
    expect(calls.log.some((c) => c.op === 'select' && c.args[0] === 'downloaded_at')).toBe(true);
  });
});

describe('Codex round MINOR (livePackStatus:74, 11-22): the delete goes through the chain', () => {
  const sent = () => calls.settled.filter((op) => op === 'upsert' || op === 'delete');

  it('a write still queued (not started) when the pack is forgotten is cancelled, not sent', async () => {
    let open!: () => void;
    calls.gates.push(new Promise<void>((r) => (open = r)));
    const inFlight = reportPackStatus(pack);
    const queued = reportPackStatus({ ...pack, version: 'v2', savedAt: '2026-11-21T20:05:00.000Z' });
    const forgetting = forgetPackStatus('u-1', ['ev-1']);
    open();
    await Promise.all([inFlight, queued, forgetting]);
    expect(sent()).toEqual(['upsert', 'delete']);
  });

  it('Delete all: a queued write of any event is cancelled, and a write for an event not queued yet waits for the delete', async () => {
    let open!: () => void;
    calls.gates.push(new Promise<void>((r) => (open = r)));
    const inFlight = reportPackStatus(pack);
    const queued = reportPackStatus({ ...pack, version: 'v2', savedAt: '2026-11-21T20:05:00.000Z' });
    const forgetting = forgetPackStatus('u-1');
    // A pack saved again after Delete all, for another event.
    const after = reportPackStatus({ ...pack, eventId: 'ev-2', version: 'v3', savedAt: '2026-11-21T20:06:00.000Z' });
    open();
    await Promise.all([inFlight, queued, forgetting, after]);
    expect(sent()).toEqual(['upsert', 'delete', 'upsert']);
  });
});

