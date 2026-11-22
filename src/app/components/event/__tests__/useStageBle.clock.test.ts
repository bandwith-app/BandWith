import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { encodeStageState, toBase64, STAGE_BLE_CHARACTERISTIC } from '@/lib/stageBle';
import { STAGE_BLE_CLOCK_CHARACTERISTIC, STAGE_BLE_LIVE_CHARACTERISTIC, encodeClock } from '@/lib/stageBleSync';
import { nowMs } from '@/lib/stageClick';

// jsdom has no WebCrypto; the app runs where it does (WKWebView, Android WebView).
const nodeCrypto = 'node:crypto';
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = (await import(/* @vite-ignore */ nodeCrypto)) as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const KEY = toBase64(new Uint8Array(32).map((_, i) => i * 3));
const IDS = ['a1', 'b2'];
/** The simulated leader's clock runs this far ahead of the member's. */
const AHEAD_MS = 500;

const ble = vi.hoisted(() => ({
  oldLeader: false,
  notify: new Map<string, (v: DataView) => void>(),
  clockReads: 0,
  enabledCb: null as null | ((on: boolean) => void),
  disconnectCbs: [] as Array<() => void>,
  /** iOS (plugin 8.3.0): every read's value is also delivered to the notification callback. */
  echo: false,
  stateReads: 0,
}));

vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {
    initialize: vi.fn(async () => {}),
    isEnabled: vi.fn(async () => true),
    requestLEScan: vi.fn(async (_o: unknown, cb: (r: { device: { deviceId: string } }) => void) => {
      setTimeout(() => cb({ device: { deviceId: 'leader-phone' } }), 0);
    }),
    stopLEScan: vi.fn(async () => {}),
    connect: vi.fn(async (_id: string, onDisconnect: () => void) => {
      ble.disconnectCbs.push(onDisconnect);
    }),
    disconnect: vi.fn(async () => {}),
    requestConnectionPriority: vi.fn(async () => {}),
    startNotifications: vi.fn(async (_id: string, _s: string, char: string, cb: (v: DataView) => void) => {
      ble.notify.set(char, cb);
    }),
    read: vi.fn(async (_id: string, _s: string, char: string) => {
      if (char === STAGE_BLE_CLOCK_CHARACTERISTIC) {
        // A leader on an older app has no clock characteristic.
        if (ble.oldLeader) throw new Error('Characteristic not found.');
        ble.clockReads++;
        // The leader stamps on arrival (5 ms each way).
        await new Promise((r) => setTimeout(r, 5));
        const frame = await encodeClock(nowMs() + AHEAD_MS, KEY);
        await new Promise((r) => setTimeout(r, 5));
        return new DataView(frame.buffer);
      }
      if (char !== STAGE_BLE_CHARACTERISTIC) return new DataView(new ArrayBuffer(0));
      ble.stateReads++;
      const bytes = (await encodeStageState({ seq: 3, from: 'lead', songId: 'b2', order: null }, IDS, KEY))!;
      const view = new DataView(bytes.buffer);
      const cb = ble.notify.get(char);
      if (ble.echo && cb) setTimeout(() => cb(view), 0);
      return view;
    }),
    write: vi.fn(async () => {
      throw new Error('members never write (an Android write can crash when Bluetooth turns off)');
    }),
    startEnabledNotifications: vi.fn(async (cb: (on: boolean) => void) => {
      ble.enabledCb = cb;
    }),
    stopEnabledNotifications: vi.fn(async () => {}),
  },
  ConnectionPriority: { CONNECTION_PRIORITY_BALANCED: 0, CONNECTION_PRIORITY_HIGH: 1, CONNECTION_PRIORITY_LOW_POWER: 2 },
}));

const native = vi.hoisted(() => ({
  start: vi.fn(async (_o: Record<string, string>) => ({ state: 'on' })),
  update: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  now: vi.fn(async () => ({ now: 0 })),
  setClock: vi.fn(async (_o: { offset: number }) => {}),
  addListener: vi.fn(async () => ({ remove: async () => {} })),
}));

vi.mock('@/lib/stageBleNative', () => ({
  StageBle: native,
  stageBleAvailable: () => true,
  stageKey: async () => KEY,
}));

const { useStageBle, forgetScanStarts } = await import('../useStageBle');

beforeEach(() => {
  forgetScanStarts();
  ble.oldLeader = false;
  ble.notify.clear();
  ble.clockReads = 0;
  ble.disconnectCbs = [];
  ble.echo = false;
  ble.stateReads = 0;
  vi.clearAllMocks();
});

describe('useStageBle clock over Bluetooth', () => {
  it("member: measures the leader's clock with reads, tied to the leader's id", async () => {
    const onState = vi.fn();
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState }),
    );
    await waitFor(() => expect(result.current.status).toBe('connected'));
    await waitFor(() => expect(result.current.clock?.sample).toBeTruthy(), { timeout: 3000 });
    expect(onState).toHaveBeenCalled();
    expect(result.current.clock!.from).toBe('lead');
    // The fastest of the burst's round trips wins (timers in a busy test run are uneven).
    await waitFor(() => expect(Math.abs(result.current.clock!.sample!.offset - AHEAD_MS)).toBeLessThan(15), { timeout: 3000 });
    unmount();
  });

  it('member on iOS: a read echoed to the notification callback does not trigger another read (idle band, no battery drain)', async () => {
    ble.echo = true;
    const onState = vi.fn();
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState }),
    );
    await waitFor(() => expect(result.current.status).toBe('connected'));
    await new Promise((r) => setTimeout(r, 500));
    // The first read on connecting, nothing after while the leader changes nothing.
    expect(ble.stateReads).toBe(1);
    // A real change notification (the 4-byte seq) still reads.
    const seq = new DataView(new ArrayBuffer(4));
    seq.setUint32(0, 4);
    await act(async () => ble.notify.get(STAGE_BLE_CHARACTERISTIC)!(seq));
    await waitFor(() => expect(ble.stateReads).toBe(2));
    await new Promise((r) => setTimeout(r, 300));
    expect(ble.stateReads).toBe(2);
    unmount();
  });

  it('member: an on-demand burst pings again', async () => {
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState: () => {} }),
    );
    await waitFor(() => expect(result.current.clock?.sample).toBeTruthy(), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 1000));
    const before = ble.clockReads;
    result.current.burst();
    await waitFor(() => expect(ble.clockReads).toBeGreaterThanOrEqual(before + 6), { timeout: 3000 });
    unmount();
  });

  it('member: Bluetooth turned off stops the clock reads at once and says so', async () => {
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState: () => {} }),
    );
    await waitFor(() => expect(result.current.clock?.sample).toBeTruthy(), { timeout: 3000 });
    act(() => ble.enabledCb?.(false));
    expect(result.current.status).toBe('bt-off');
    const before = ble.clockReads;
    result.current.burst();
    await new Promise((r) => setTimeout(r, 1200));
    expect(ble.clockReads).toBe(before);
    // The last measure stays: a click keeps its beat while the link is back.
    expect(result.current.clock?.sample).toBeTruthy();
    unmount();
  });

  it('member: Bluetooth back on finds the leader again by itself, even if the old link never said goodbye', async () => {
    const { BleClient } = await import('@capacitor-community/bluetooth-le');
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState: () => {} }),
    );
    await waitFor(() => expect(result.current.status).toBe('connected'));
    // Android often drops the link without calling back when Bluetooth goes off.
    act(() => ble.enabledCb?.(false));
    expect(result.current.status).toBe('bt-off');
    const scans = vi.mocked(BleClient.requestLEScan).mock.calls.length;
    act(() => ble.enabledCb?.(true));
    await waitFor(() => expect(vi.mocked(BleClient.requestLEScan).mock.calls.length).toBe(scans + 1));
    await waitFor(() => expect(result.current.status).toBe('connected'));
    expect(ble.disconnectCbs.length).toBe(2);
    // The old link's late goodbye doesn't drop the new one.
    act(() => ble.disconnectCbs[0]());
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.status).toBe('connected');
    unmount();
  });

  it('member: a leader on an older app still syncs the song, with no Bluetooth clock', async () => {
    ble.oldLeader = true;
    const onState = vi.fn();
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState }),
    );
    await waitFor(() => expect(onState).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 300));
    expect(result.current.status).toBe('connected');
    expect(result.current.clock).toBeNull();
    // It doesn't keep reading a characteristic that isn't there.
    await new Promise((r) => setTimeout(r, 1000));
    expect(ble.clockReads).toBe(0);
    const { BleClient } = await import('@capacitor-community/bluetooth-le');
    expect(vi.mocked(BleClient.read).mock.calls.filter((c) => c[2] === STAGE_BLE_CLOCK_CHARACTERISTIC).length).toBe(1);
    unmount();
  });

  it("leader: serves the clock and live characteristics and tells the plugin the app's clock", async () => {
    // The plugin's clock is 1 s behind the app's.
    native.now.mockImplementation(async () => ({ now: nowMs() - 1000 }));
    const { unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: true, onState: () => {} }),
    );
    await waitFor(() => expect(native.setClock).toHaveBeenCalled());
    expect(native.start.mock.calls[0][0]).toMatchObject({
      clockUuid: STAGE_BLE_CLOCK_CHARACTERISTIC,
      liveUuid: STAGE_BLE_LIVE_CHARACTERISTIC,
      key: KEY,
    });
    expect(Math.abs(native.setClock.mock.calls[0][0].offset - 1000)).toBeLessThan(5);
    unmount();
  });
});
