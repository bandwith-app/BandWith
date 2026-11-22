import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Kill switch `ble_live` (docs/flags.md): off → the leader serves no clock /
// live characteristic and members read no clock over Bluetooth. The song
// itself still syncs over Bluetooth, the click uses the Realtime clock.
const h = vi.hoisted(() => ({
  starts: [] as Array<Record<string, unknown>>,
  stops: 0,
  updates: [] as string[],
  setClock: 0,
  reads: [] as string[],
  /** While set, clock reads wait for it (a read in flight). */
  hold: null as Promise<void> | null,
  /** What the leader plugin reports on start ('off' = Bluetooth off). */
  startState: 'on',
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: async () => {} }) } }));
vi.mock('@/lib/stageBleNative', () => ({
  stageBleAvailable: () => true,
  stageKey: async () => 'a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2U=',
  StageBle: {
    addListener: async () => ({ remove: async () => {} }),
    start: async (o: Record<string, unknown>) => {
      h.starts.push(o);
      return { state: h.startState };
    },
    stop: async () => {
      h.stops++;
    },
    update: async (o: { value: string }) => {
      h.updates.push(o.value);
    },
    now: async () => ({ now: Date.now() }),
    setClock: async () => {
      h.setClock++;
    },
  },
}));
// No WebCrypto in this jsdom: the state's bytes are its JSON here.
vi.mock('@/lib/stageBle', async (orig) => ({
  ...(await orig<typeof import('@/lib/stageBle')>()),
  stageServiceUuid: async () => 'svc',
  encodeStageState: async (state: unknown) => new TextEncoder().encode(JSON.stringify(state)),
}));
// Every clock read decodes and counts (the real book keeps only better samples).
vi.mock('@/lib/stageBleSync', async (orig) => {
  const real = await orig<typeof import('@/lib/stageBleSync')>();
  class Book {
    last: { offset: number; rtt: number } | null = null;
    add() {
      this.last = { offset: 0, rtt: 1 };
      return this.last;
    }
    best() {
      return this.last;
    }
    clear() {
      this.last = null;
    }
  }
  return { ...real, BleClockBook: Book, decodeClock: async () => Date.now() };
});
vi.mock('@capacitor-community/bluetooth-le', () => ({
  ConnectionPriority: { CONNECTION_PRIORITY_HIGH: 1 },
  BleClient: {
    initialize: async () => {},
    startEnabledNotifications: async () => {},
    stopEnabledNotifications: async () => {},
    isEnabled: async () => true,
    requestLEScan: async (_o: unknown, cb: (r: { device: { deviceId: string } }) => void) => {
      setTimeout(() => cb({ device: { deviceId: 'leader-phone' } }), 0);
    },
    stopLEScan: async () => {},
    connect: async () => {},
    disconnect: async () => {},
    startNotifications: async () => {},
    requestConnectionPriority: async () => {},
    read: async (_id: string, _svc: string, ch: string) => {
      h.reads.push(ch);
      if (h.hold && ch === 'b7d50002-5b1e-4c6a-9b3d-6e0a2f7c1d42') await h.hold;
      return new DataView(new ArrayBuffer(4));
    },
  },
}));

import { useStageBle } from '../useStageBle';
import { STAGE_BLE_CLOCK_CHARACTERISTIC, STAGE_BLE_LIVE_CHARACTERISTIC } from '@/lib/stageBleSync';
import { __resetAppFlagsForTest, __setAppFlagsForTest } from '@/lib/appFlags';

const opts = (isLeader: boolean) => ({ eventId: 'ev-1', savedIds: ['r1', 'r2'], open: true, isLeader, onState: () => {} });

beforeEach(() => {
  localStorage.clear();
  __resetAppFlagsForTest(null);
  h.starts = [];
  h.stops = 0;
  h.updates = [];
  h.setClock = 0;
  h.reads = [];
  h.hold = null;
  h.startState = 'on';
});
afterEach(() => vi.useRealTimers());

describe('ble_live', () => {
  it('on (the default): the leader serves the clock and the live characteristic', async () => {
    renderHook(() => useStageBle(opts(true)));
    await waitFor(() => expect(h.starts).toHaveLength(1));
    expect(h.starts[0]).toMatchObject({ clockUuid: STAGE_BLE_CLOCK_CHARACTERISTIC, liveUuid: STAGE_BLE_LIVE_CHARACTERISTIC });
  });

  it('off: the leader still serves the song, without clock or live characteristic', async () => {
    __setAppFlagsForTest({ ble_live: false });
    renderHook(() => useStageBle(opts(true)));
    await waitFor(() => expect(h.starts).toHaveLength(1));
    expect(h.starts[0].clockUuid).toBeUndefined();
    expect(h.starts[0].liveUuid).toBeUndefined();
    expect(h.starts[0].serviceUuid).toBe('svc');
    await new Promise((r) => setTimeout(r, 20));
    expect(h.setClock).toBe(0);
  });

  it('off: a member connects and reads the song, but no clock', async () => {
    __setAppFlagsForTest({ ble_live: false });
    renderHook(() => useStageBle(opts(false)));
    await waitFor(() => expect(h.reads.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    expect(h.reads).not.toContain(STAGE_BLE_CLOCK_CHARACTERISTIC);
  });

  it('on: a member reads the clock; turned off mid-link the reads stop and the clock clears', async () => {
    const { result } = renderHook(() => useStageBle(opts(false)));
    await waitFor(() => expect(h.reads).toContain(STAGE_BLE_CLOCK_CHARACTERISTIC));
    act(() => __setAppFlagsForTest({ ble_live: false }));
    await new Promise((r) => setTimeout(r, 30));
    const n = h.reads.filter((c) => c === STAGE_BLE_CLOCK_CHARACTERISTIC).length;
    act(() => result.current.burst());
    await new Promise((r) => setTimeout(r, 1200));
    expect(h.reads.filter((c) => c === STAGE_BLE_CLOCK_CHARACTERISTIC).length).toBe(n);
    expect(result.current.clock).toBeNull();
  });

  it('turned off mid-show: the leader keeps serving, no restart, members keep the song', async () => {
    const { result } = renderHook(() => useStageBle(opts(true)));
    await waitFor(() => expect(h.starts).toHaveLength(1));
    await act(async () => {
      result.current.publish({ seq: 7, from: 'lead', songId: 'r2', order: null });
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(h.updates).toHaveLength(1);
    act(() => __setAppFlagsForTest({ ble_live: false }));
    await new Promise((r) => setTimeout(r, 30));
    expect(h.stops).toBe(0);
    expect(h.starts).toHaveLength(1);
  });

  it('Bluetooth restarted during the show: the leader serves the last song again, not an empty value', async () => {
    h.startState = 'off';
    const { result } = renderHook(() => useStageBle(opts(true)));
    await waitFor(() => expect(result.current.status).toBe('bt-off'));
    await act(async () => {
      result.current.publish({ seq: 7, from: 'lead', songId: 'r2', order: null });
      await new Promise((r) => setTimeout(r, 10));
    });
    const last = h.updates[h.updates.length - 1];
    h.startState = 'on';
    await act(async () => {
      await result.current.fix();
    });
    await waitFor(() => expect(h.starts).toHaveLength(2));
    await waitFor(() => expect(h.updates).toHaveLength(2));
    expect(h.updates[1]).toBe(last);
  });

  it('Stage closed and opened again: the old song is not served (the leader starts from its new screen)', async () => {
    const { result, rerender } = renderHook((o: ReturnType<typeof opts>) => useStageBle(o), { initialProps: opts(true) });
    await waitFor(() => expect(h.starts).toHaveLength(1));
    await act(async () => {
      result.current.publish({ seq: 7, from: 'lead', songId: 'r2', order: null });
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(h.updates).toHaveLength(1);
    rerender({ ...opts(true), open: false });
    rerender(opts(true));
    await waitFor(() => expect(h.starts).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(h.updates).toHaveLength(1);
  });

  it('a clock read still in flight when it is turned off sets no clock', async () => {
    const { result } = renderHook(() => useStageBle(opts(false)));
    await waitFor(() => expect(result.current.clock).not.toBeNull());
    let release = () => {};
    h.hold = new Promise<void>((r) => (release = r));
    const before = h.reads.length;
    act(() => result.current.burst());
    await waitFor(() => expect(h.reads.length).toBeGreaterThan(before));
    act(() => __setAppFlagsForTest({ ble_live: false }));
    expect(result.current.clock).toBeNull();
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(result.current.clock).toBeNull();
  });
});
