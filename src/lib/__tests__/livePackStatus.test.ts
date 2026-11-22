import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => ({ log: [] as Array<{ table?: string; fn?: string; op: string; args: unknown[] }>, rows: [] as unknown[], native: true }));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => calls.native } }));
vi.mock('../supabase', () => {
  const query = (table: string) => {
    const q: any = {};
    for (const op of ['upsert', 'delete', 'update', 'select', 'eq', 'in', 'maybeSingle']) {
      q[op] = (...args: unknown[]) => {
        calls.log.push({ table, op, args });
        return q;
      };
    }
    q.then = (res: (v: unknown) => void) => res({ data: calls.rows, error: null });
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
    expect(ups[0].args[0]).toEqual({ event_id: 'ev-1', user_id: 'u-1', device_id: deviceId(), version: 'abc', downloaded_at: pack.savedAt });
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

  it('remind and the profile choice go to the server', async () => {
    expect(await remindPackDownload('ev-1', 'u-2')).toBe(true);
    expect(calls.log.find((c) => c.fn === 'bw_live_pack_remind')?.args[0]).toEqual({ p_event_id: 'ev-1', p_user_id: 'u-2' });
    await saveProfileChoice('u-1', { auto: true, askedAt: '2026-11-21T20:00:00.000Z' });
    const up = calls.log.find((c) => c.op === 'update');
    expect(up?.table).toBe('profiles');
    expect(up?.args[0]).toEqual({ live_pack_auto: true, live_pack_asked_at: '2026-11-21T20:00:00.000Z' });
  });
});
