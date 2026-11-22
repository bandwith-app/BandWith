import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { encodeStageState, toBase64, STAGE_BLE_CHARACTERISTIC } from '@/lib/stageBle';
import { STAGE_BLE_CLOCK_CHARACTERISTIC, encodeClock } from '@/lib/stageBleSync';
import { nowMs } from '@/lib/stageClick';
import type { StageLiveState } from '@/lib/stageLive';

// jsdom has no WebCrypto; the app runs where it does (WKWebView, Android WebView).
const nodeCrypto = 'node:crypto';
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = (await import(/* @vite-ignore */ nodeCrypto)) as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const KEY = toBase64(new Uint8Array(32).map((_, i) => i * 5));
const IDS = ['a1', 'b2', 'c3'];

/**
 * Admins' phones advertising the gig (review of #280). Closer to the real
 * plugin than the leaders test: one scan at a time (a new requestLEScan
 * replaces the callback, stopLEScan ends it), phones that start advertising
 * later are seen only by a scan running then, a disconnect that takes a
 * while, and an ordered log of what the member does.
 */
const air = vi.hoisted(() => ({
  devices: new Map<string, { state: unknown; advertising: boolean; clockAhead?: number; readMs?: number }>(),
  scanCb: null as null | ((r: { device: { deviceId: string } }) => void),
  log: [] as string[],
  connected: new Set<string>(),
  connectTimeouts: [] as number[],
  pendingReads: 0,
}));

const appear = (id: string, state: StageLiveState | null, extra: { clockAhead?: number } = {}) => {
  air.devices.set(id, { state, advertising: true, ...extra });
  air.scanCb?.({ device: { deviceId: id } });
};

vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {
    initialize: vi.fn(async () => {}),
    isEnabled: vi.fn(async () => true),
    requestLEScan: vi.fn(async (_o: unknown, cb: (r: { device: { deviceId: string } }) => void) => {
      air.scanCb = cb;
      air.log.push('scan');
      let i = 0;
      for (const [id, d] of air.devices) if (d.advertising) setTimeout(() => air.scanCb === cb && cb({ device: { deviceId: id } }), 5 * ++i);
    }),
    stopLEScan: vi.fn(async () => {
      air.scanCb = null;
      air.log.push('stop-scan');
    }),
    connect: vi.fn(async (id: string, _cb: unknown, o?: { timeout?: number }) => {
      air.log.push(`connect:${id}`);
      air.connectTimeouts.push(o?.timeout ?? 0);
      air.connected.add(id);
    }),
    disconnect: vi.fn(async (id: string) => {
      air.log.push(`disconnect:${id}`);
      await new Promise((r) => setTimeout(r, 30));
      air.connected.delete(id);
      air.log.push(`disconnected:${id}`);
    }),
    requestConnectionPriority: vi.fn(async () => {}),
    startNotifications: vi.fn(async () => {}),
    read: vi.fn(async (id: string, _s: string, char: string) => {
      const d = air.devices.get(id);
      if (char === STAGE_BLE_CLOCK_CHARACTERISTIC) {
        if (d?.clockAhead === undefined) throw new Error('Characteristic not found.');
        return new DataView((await encodeClock(nowMs() + d.clockAhead, KEY)).buffer);
      }
      if (char !== STAGE_BLE_CHARACTERISTIC) throw new Error('Characteristic not found.');
      air.pendingReads++;
      try {
        if (d?.readMs) await new Promise((r) => setTimeout(r, d.readMs));
        const st = d?.state as StageLiveState | null;
        if (!st) return new DataView(new ArrayBuffer(0));
        return new DataView((await encodeStageState(st, IDS, KEY))!.buffer);
      } finally {
        air.pendingReads--;
      }
    }),
    startEnabledNotifications: vi.fn(async () => {}),
    stopEnabledNotifications: vi.fn(async () => {}),
  },
  ConnectionPriority: { CONNECTION_PRIORITY_HIGH: 1 },
}));

vi.mock('@/lib/stageBleNative', () => ({
  StageBle: {},
  stageBleAvailable: () => true,
  stageKey: async () => KEY,
}));

const { useStageBle, LEADER_CHECK_MS } = await import('../useStageBle');

const lead = (id: string, seq: number, songId: string): StageLiveState => ({ seq, from: id, songId, order: null });
const member = (onState: (s: StageLiveState) => void = () => {}) =>
  renderHook(() => useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState }));

beforeEach(() => {
  air.devices.clear();
  air.scanCb = null;
  air.log = [];
  air.connected.clear();
  air.connectTimeouts = [];
  air.pendingReads = 0;
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

describe('useStageBle: looking for the admin who leads (review of #280)', () => {
  it("Stage closed and reopened during a leader look: the old look doesn't end the new search, and a leader who shows up later is found", async () => {
    appear('admin-b', lead('b', 3, 'a1'));
    const first = member();
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-b'])));
    // The 30 s look starts its 2 s scan…
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 500);
    expect(air.log.filter((l) => l === 'scan').length).toBe(2);
    // …and Stage is closed and opened again meanwhile; admin B has gone.
    first.unmount();
    air.devices.delete('admin-b');
    const onState = vi.fn();
    const second = member(onState);
    await waitFor(() => expect(second.result.current.status).toBe('searching'));
    // The old look's timer ends here: it must not stop the new search.
    await vi.advanceTimersByTimeAsync(3000);
    // Admin A opens Stage now.
    appear('admin-a', lead('a', 9, 'c3'));
    await vi.advanceTimersByTimeAsync(20_000);
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' })));
    second.unmount();
  });

  it('searching with nothing found keeps looking: a leader who starts advertising after a stopped scan is still found', async () => {
    const onState = vi.fn();
    const m = member(onState);
    await waitFor(() => expect(m.result.current.status).toBe('searching'));
    // The radio ended the scan on its own (iOS does in the background, Android after 30 min).
    air.scanCb = null;
    air.devices.set('admin-a', { state: lead('a', 2, 'b2'), advertising: true });
    await vi.advanceTimersByTimeAsync(20_000);
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' })));
    m.unmount();
  });

  it('three admins: the member goes straight to the newest, not the first one newer than its leader', async () => {
    appear('admin-x', lead('x', 10, 'a1'));
    const onState = vi.fn();
    const m = member(onState);
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'x' })));
    appear('admin-y', lead('y', 11, 'b2'));
    appear('admin-z', lead('z', 50, 'c3'));
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-z'])));
    expect(onState).not.toHaveBeenCalledWith(expect.objectContaining({ from: 'y' }));
    m.unmount();
  });

  it('a probe lets go of a phone before linking to it (a late disconnect would drop the new link)', async () => {
    appear('admin-b', lead('b', 3, 'a1'));
    const m = member();
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-b'])));
    appear('admin-a', lead('a', 9, 'c3'));
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-a'])));
    const a = air.log.filter((l) => l.endsWith(':admin-a'));
    // probe connect, its disconnect done, then the link.
    expect(a.slice(0, 4)).toEqual(['connect:admin-a', 'disconnect:admin-a', 'disconnected:admin-a', 'connect:admin-a']);
    m.unmount();
  });

  it('probes are short, and never while a song read from the leader is under way', async () => {
    appear('admin-b', lead('b', 3, 'a1'));
    const m = member();
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-b'])));
    appear('admin-a', lead('a', 1, 'c3'));
    // The leader's reads are slow now (a song change arrives as the look starts).
    air.devices.get('admin-b')!.readMs = 4000;
    const { BleClient } = await import('@capacitor-community/bluetooth-le');
    const notify = vi.mocked(BleClient.startNotifications).mock.calls[vi.mocked(BleClient.startNotifications).mock.calls.length - 1][3] as (v: DataView) => void;
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 1500);
    notify(new DataView(new ArrayBuffer(4)));
    const probeConnects: number[] = [];
    const before = air.log.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(air.pendingReads).toBe(1);
    expect(air.log.slice(before).filter((l) => l === 'connect:admin-a')).toEqual(probeConnects);
    await vi.advanceTimersByTimeAsync(8000);
    // Once the read is done, the look goes on, with a short connect.
    await waitFor(() => expect(air.log.includes('connect:admin-a')).toBe(true));
    expect(Math.max(...air.connectTimeouts.slice(1))).toBeLessThanOrEqual(2000);
    m.unmount();
  });

  it('an idle leader and an idle admin: the looks slow down instead of probing every 4 s all gig long', async () => {
    appear('admin-b', null);
    const m = member();
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-b'])));
    appear('admin-c', null);
    await vi.advanceTimersByTimeAsync(120_000);
    // Every 4 s would be ~20 probes in 2 minutes.
    expect(air.log.filter((l) => l === 'connect:admin-c').length).toBeLessThanOrEqual(6);
    m.unmount();
  });

  it("moving to another admin's phone drops the old leader's clock (an older app has none to replace it)", async () => {
    appear('admin-b', lead('b', 3, 'a1'), { clockAhead: 800 });
    const m = member();
    await waitFor(() => expect(m.result.current.clock?.from).toBe('b'));
    // Admin A leads on an older app: no clock characteristic.
    appear('admin-a', lead('a', 9, 'c3'));
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-a'])));
    await vi.advanceTimersByTimeAsync(1000);
    expect(m.result.current.clock).toBeNull();
    m.unmount();
  });
});
