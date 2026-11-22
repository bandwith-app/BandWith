import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  encodeSignedState,
  encodeStageState,
  toBase64,
  STAGE_BLE_CHARACTERISTIC,
  STAGE_BLE_SIGNED_CHARACTERISTIC,
} from '@/lib/stageBle';
import { generateSigner } from '@/lib/stageSign';
import { STAGE_BLE_CLOCK_CHARACTERISTIC, STAGE_BLE_LIVE_CHARACTERISTIC, encodeClock } from '@/lib/stageBleSync';
import { nowMs } from '@/lib/stageClick';

// jsdom has no WebCrypto; the app runs where it does (WKWebView, Android WebView).
const nodeCrypto = 'node:crypto';
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = (await import(/* @vite-ignore */ nodeCrypto)) as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const KEY = toBase64(new Uint8Array(32).map((_, i) => i * 3));
/** The gig's key pair (migration 190): the leader signs its state and clock. */
const SIGNER = await generateSigner();
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
  /** Overrides for one test: the leader's clock (ms ahead), a slow or broken clock read, the state's seq. */
  aheadMs: null as number | null,
  clockDelay: 0,
  clockBroken: false,
  stateSeq: 3,
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
    getServices: vi.fn(async () => [
      {
        uuid: 'gig',
        characteristics: (ble.oldLeader
          ? [STAGE_BLE_CHARACTERISTIC]
          : [STAGE_BLE_CHARACTERISTIC, STAGE_BLE_SIGNED_CHARACTERISTIC, STAGE_BLE_CLOCK_CHARACTERISTIC]
        ).map((uuid) => ({ uuid, properties: {}, descriptors: [] })),
      },
    ]),
    startNotifications: vi.fn(async (_id: string, _s: string, char: string, cb: (v: DataView) => void) => {
      ble.notify.set(char, cb);
    }),
    read: vi.fn(async (_id: string, _s: string, char: string) => {
      if (char === STAGE_BLE_CLOCK_CHARACTERISTIC) {
        // A leader on an older app has no clock characteristic.
        if (ble.oldLeader) throw new Error('Characteristic not found.');
        ble.clockReads++;
        if (ble.clockDelay) await new Promise((r) => setTimeout(r, ble.clockDelay));
        if (ble.clockBroken) return new DataView(new ArrayBuffer(3));
        // The leader stamps on arrival (5 ms each way).
        await new Promise((r) => setTimeout(r, 5));
        const frame = await encodeClock(nowMs() + (ble.aheadMs ?? AHEAD_MS), SIGNER.private);
        await new Promise((r) => setTimeout(r, 5));
        return new DataView(frame.buffer);
      }
      const signed = char === STAGE_BLE_SIGNED_CHARACTERISTIC && !ble.oldLeader;
      if (char !== STAGE_BLE_CHARACTERISTIC && !signed) return new DataView(new ArrayBuffer(0));
      ble.stateReads++;
      const state = { seq: ble.stateSeq, from: 'lead', songId: 'b2', order: null };
      const bytes = signed ? (await encodeSignedState(state, IDS, SIGNER.private))! : (await encodeStageState(state, IDS, KEY))!;
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
  BluetoothLe: { disconnect: vi.fn(async () => {}) },
  ConnectionPriority: { CONNECTION_PRIORITY_BALANCED: 0, CONNECTION_PRIORITY_HIGH: 1, CONNECTION_PRIORITY_LOW_POWER: 2 },
}));

const native = vi.hoisted(() => ({
  start: vi.fn(async (_o: Record<string, string>) => ({ state: 'on' })),
  update: vi.fn(async () => {}),
  updateSigned: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  now: vi.fn(async () => ({ now: 0 })),
  setClock: vi.fn(async (_o: { offset: number }) => {}),
  addListener: vi.fn(async () => ({ remove: async () => {} })),
}));

vi.mock('@/lib/stageBleNative', () => ({
  StageBle: native,
  stageBleAvailable: () => true,
  stageKey: async () => KEY,
  stageVerifyKey: async () => ({ public: SIGNER.public, version: 1 }),
  fetchVerifyKey: async () => ({ answer: { public: SIGNER.public, version: 1 }, server: true }),
  forgetStageKeys: () => {},
  keptVerifyKey: () => ({ public: SIGNER.public, version: 1 }),
  stageSigner: async () => ({ ...SIGNER, version: 1 }),
}));

const { useStageBle, forgetSignedLeaders, forgetScanStarts } = await import('../useStageBle');

beforeEach(() => {
  forgetSignedLeaders();
  forgetScanStarts();
  ble.oldLeader = false;
  ble.notify.clear();
  ble.clockReads = 0;
  ble.disconnectCbs = [];
  ble.echo = false;
  ble.stateReads = 0;
  ble.aheadMs = null;
  ble.clockDelay = 0;
  ble.clockBroken = false;
  ble.stateSeq = 3;
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
    // The state waited for the clock: it applies right after.
    await waitFor(() => expect(onState).toHaveBeenCalled());
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
    await waitFor(() => expect(result.current.clock?.sample).toBeTruthy(), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 500));
    // The first read on connecting and one once the clock is measured (the state waited for it),
    // nothing after while the leader changes nothing.
    expect(ble.stateReads).toBe(2);
    // A real change notification (the 4-byte seq) still reads.
    const seq = new DataView(new ArrayBuffer(4));
    seq.setUint32(0, 4);
    await act(async () => ble.notify.get(STAGE_BLE_SIGNED_CHARACTERISTIC)!(seq));
    await waitFor(() => expect(ble.stateReads).toBe(3));
    await new Promise((r) => setTimeout(r, 300));
    expect(ble.stateReads).toBe(3);
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
    // Followed, with the line asking to update the leader's app.
    expect(result.current.status).toBe('old-leader');
    expect(result.current.clock).toBeNull();
    // It doesn't keep reading a characteristic that isn't there.
    await new Promise((r) => setTimeout(r, 1000));
    expect(ble.clockReads).toBe(0);
    const { BleClient } = await import('@capacitor-community/bluetooth-le');
    // Its band-key clock (if any) isn't trusted any more: not even read.
    expect(vi.mocked(BleClient.read).mock.calls.filter((c) => c[2] === STAGE_BLE_CLOCK_CHARACTERISTIC).length).toBe(0);
    unmount();
  });

  it("member: the leader's first state waits for its clock to be measured (Codex on #280)", async () => {
    ble.clockDelay = 400;
    const onState = vi.fn();
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState }),
    );
    await waitFor(() => expect(ble.stateReads).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 200));
    // Read, but not applied: the clock isn't known yet.
    expect(onState).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.clock?.sample).toBeTruthy(), { timeout: 3000 });
    await waitFor(() => expect(onState).toHaveBeenCalled());
    unmount();
  });

  it('member: a leader whose clock turns out more than 5 minutes off is never followed, and the member is told', async () => {
    ble.aheadMs = -6 * 60_000;
    const onState = vi.fn();
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState }),
    );
    await waitFor(() => expect(result.current.status).toBe('clock-off'), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(onState).not.toHaveBeenCalled();
    unmount();
  });

  it("member: a clock that can't be measured doesn't hold the song for ever (the 5-minute rule then)", async () => {
    ble.clockBroken = true;
    const onState = vi.fn();
    const { unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState }),
    );
    await new Promise((r) => setTimeout(r, 500));
    expect(onState).not.toHaveBeenCalled();
    await waitFor(() => expect(onState).toHaveBeenCalled(), { timeout: 5000 });
    unmount();
  });

  it('member: with the clock measured, a seq only ~30 s beyond it counts (Claude on #280)', async () => {
    const seqAt = (ms: number) => Math.floor((Date.now() + ms - Date.UTC(2024, 0, 1)) / 100);
    // A minute ahead of the measured clock (half a second ahead): made up.
    ble.stateSeq = seqAt(60_000);
    const onState = vi.fn();
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState }),
    );
    await waitFor(() => expect(result.current.clock?.sample).toBeTruthy(), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(onState).not.toHaveBeenCalled();
    unmount();
    // 10 s ahead: fine.
    ble.stateSeq = seqAt(10_000);
    const second = renderHook(() => useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState }));
    await waitFor(() => expect(onState).toHaveBeenCalled(), { timeout: 3000 });
    second.unmount();
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
      signedUuid: STAGE_BLE_SIGNED_CHARACTERISTIC,
      signKey: SIGNER.private,
    });
    expect(Math.abs(native.setClock.mock.calls[0][0].offset - 1000)).toBeLessThan(5);
    unmount();
  });
});
