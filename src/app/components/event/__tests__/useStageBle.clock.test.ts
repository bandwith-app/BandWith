import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { encodeStageState, toBase64, STAGE_BLE_CHARACTERISTIC } from '@/lib/stageBle';
import { STAGE_BLE_SYNC_CHARACTERISTIC, encodePong, parsePing } from '@/lib/stageBleSync';
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
  writes: [] as string[],
}));

vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {
    initialize: vi.fn(async () => {}),
    isEnabled: vi.fn(async () => true),
    requestLEScan: vi.fn(async (_o: unknown, cb: (r: { device: { deviceId: string } }) => void) => {
      setTimeout(() => cb({ device: { deviceId: 'leader-phone' } }), 0);
    }),
    stopLEScan: vi.fn(async () => {}),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    requestConnectionPriority: vi.fn(async () => {}),
    startNotifications: vi.fn(async (_id: string, _s: string, char: string, cb: (v: DataView) => void) => {
      // A leader on an older app has no sync characteristic.
      if (char === STAGE_BLE_SYNC_CHARACTERISTIC && ble.oldLeader) throw new Error('Characteristic not found');
      ble.notify.set(char, cb);
    }),
    read: vi.fn(async (_id: string, _s: string, char: string) => {
      if (char !== STAGE_BLE_CHARACTERISTIC) return new DataView(new ArrayBuffer(0));
      const bytes = (await encodeStageState({ seq: 3, from: 'lead', songId: 'b2', order: null }, IDS, KEY))!;
      return new DataView(bytes.buffer);
    }),
    write: vi.fn(async (_id: string, _s: string, char: string, value: DataView) => {
      ble.writes.push(char);
      if (char !== STAGE_BLE_SYNC_CHARACTERISTIC || ble.oldLeader) throw new Error('not found');
      const nonce = parsePing(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      if (nonce === null) return;
      // The leader stamps on arrival (5 ms each way) and answers that member.
      await new Promise((r) => setTimeout(r, 5));
      const pong = await encodePong(nonce, nowMs() + AHEAD_MS, KEY);
      setTimeout(() => ble.notify.get(STAGE_BLE_SYNC_CHARACTERISTIC)?.(new DataView(pong.buffer)), 5);
    }),
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

const { useStageBle } = await import('../useStageBle');

beforeEach(() => {
  ble.oldLeader = false;
  ble.notify.clear();
  ble.writes = [];
  vi.clearAllMocks();
});

describe('useStageBle clock over Bluetooth', () => {
  it("member: measures the leader's clock with pings, tied to the leader's id", async () => {
    const onState = vi.fn();
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState }),
    );
    await waitFor(() => expect(result.current.status).toBe('connected'));
    await waitFor(() => expect(result.current.clock?.sample).toBeTruthy(), { timeout: 3000 });
    expect(onState).toHaveBeenCalled();
    expect(result.current.clock!.from).toBe('lead');
    expect(Math.abs(result.current.clock!.sample!.offset - AHEAD_MS)).toBeLessThan(15);
    unmount();
  });

  it('member: an on-demand burst pings again', async () => {
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState: () => {} }),
    );
    await waitFor(() => expect(result.current.clock?.sample).toBeTruthy(), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 1000));
    const before = ble.writes.length;
    result.current.burst();
    await waitFor(() => expect(ble.writes.length).toBeGreaterThanOrEqual(before + 6), { timeout: 3000 });
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
    // It doesn't keep pinging a characteristic that isn't there.
    expect(ble.writes).toEqual([]);
    unmount();
  });

  it("leader: serves the sync characteristic and tells the plugin the app's clock", async () => {
    // The plugin's clock is 1 s behind the app's.
    native.now.mockImplementation(async () => ({ now: nowMs() - 1000 }));
    const { unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: true, onState: () => {} }),
    );
    await waitFor(() => expect(native.setClock).toHaveBeenCalled());
    expect(native.start.mock.calls[0][0]).toMatchObject({ syncUuid: STAGE_BLE_SYNC_CHARACTERISTIC, key: KEY });
    expect(Math.abs(native.setClock.mock.calls[0][0].offset - 1000)).toBeLessThan(5);
    unmount();
  });
});
