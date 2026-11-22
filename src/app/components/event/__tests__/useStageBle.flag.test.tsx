import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Kill switch `ble_live` (docs/flags.md): off → the leader serves no clock /
// live characteristic and members read no clock over Bluetooth. The song
// itself still syncs over Bluetooth, the click uses the Realtime clock.
const h = vi.hoisted(() => ({
  starts: [] as Array<Record<string, unknown>>,
  setClock: 0,
  reads: [] as string[],
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
      return { state: 'on' };
    },
    stop: async () => {},
    update: async () => {},
    now: async () => ({ now: Date.now() }),
    setClock: async () => {
      h.setClock++;
    },
  },
}));
vi.mock('@/lib/stageBle', async (orig) => ({ ...(await orig<typeof import('@/lib/stageBle')>()), stageServiceUuid: async () => 'svc' }));
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
  h.setClock = 0;
  h.reads = [];
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
});
