import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { encodeStageState, toBase64, STAGE_BLE_CHARACTERISTIC } from '@/lib/stageBle';
import { STAGE_BLE_CLOCK_CHARACTERISTIC, STAGE_BLE_LIVE_CHARACTERISTIC, decodeLive, encodeClock, encodeLive, type LiveEvents } from '@/lib/stageBleSync';
import { fromBase64 } from '@/lib/stageBle';
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
  /** What the leader's live characteristic holds (null: an older leader, no such characteristic). */
  live: null as null | { seq: number; events: Record<string, unknown> },
  liveReads: 0,
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
      if (char === STAGE_BLE_LIVE_CHARACTERISTIC && !ble.live) throw new Error('Characteristic not found.');
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
      if (char === STAGE_BLE_LIVE_CHARACTERISTIC) {
        if (!ble.live) throw new Error('Characteristic not found.');
        ble.liveReads++;
        const frame = (await encodeLive(ble.live.seq, ble.live.events, KEY))!;
        return new DataView(frame.buffer);
      }
      if (char !== STAGE_BLE_CHARACTERISTIC) return new DataView(new ArrayBuffer(0));
      const bytes = (await encodeStageState({ seq: 3, from: 'lead', songId: 'b2', order: null }, IDS, KEY))!;
      return new DataView(bytes.buffer);
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
  updateLive: vi.fn(async (_o: { value: string; notify: string }) => {}),
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
const { __resetAppFlagsForTest, __setAppFlagsForTest } = await import('@/lib/appFlags');

const click = { seq: 5, from: 'lead', on: true, bpm: 120, beats: 4, bars: null, startAt: 1_795_000_000_000, songId: 'a1' };
const head = { seq: 6, from: 'lead', songId: 'a1', on: true, bpm: 120, speed: 1, bar: 8, startAt: 1_795_000_000_000, hold: null };

/** The last frame the leader served, decoded. */
const served = async (n = -1) => {
  const calls = native.updateLive.mock.calls;
  const call = calls[n < 0 ? calls.length + n : n][0];
  return { ...(await decodeLive(fromBase64(call.value), KEY))!, notify: fromBase64(call.notify) };
};

beforeEach(async () => {
  // The test before may still be saying goodbye (its last frame, then Bluetooth stops).
  await new Promise((r) => setTimeout(r, 50));
  ble.oldLeader = false;
  ble.notify.clear();
  ble.clockReads = 0;
  ble.liveReads = 0;
  ble.live = { seq: 1, events: {} };
  ble.disconnectCbs = [];
  vi.clearAllMocks();
  __resetAppFlagsForTest(null);
});

describe('useStageBle: live frame (click, playhead)', () => {
  it("leader: a click sent before Bluetooth is up goes out as soon as it is, with the playhead next to it", async () => {
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: true, onState: () => {} }),
    );
    act(() => result.current.publishLive('click', click));
    await waitFor(() => expect(native.updateLive).toHaveBeenCalled());
    expect((await served()).events).toEqual({ click });
    act(() => result.current.publishLive('playhead', head));
    await waitFor(() => expect(native.updateLive).toHaveBeenCalledTimes(2));
    const second = await served();
    // The newest of each: a member reading now gets both.
    expect(second.events).toEqual({ click, playhead: head });
    // Subscribers are told the frame's seq, then read.
    expect(new DataView(second.notify.buffer).getUint32(0)).toBe(second.seq);
    expect(second.seq).toBeGreaterThan((await served(0)).seq);
    unmount();
  });

  it("leader: closing Stage sends the stopped states before Bluetooth stops", async () => {
    const order: string[] = [];
    native.updateLive.mockImplementation(async () => void order.push('live'));
    native.stop.mockImplementation(async () => void order.push('stop'));
    const off = { ...click, on: false, seq: 7 };
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: true, onState: () => {}, farewell: () => ({ click: off }) }),
    );
    act(() => result.current.publishLive('click', click));
    await waitFor(() => expect(native.updateLive).toHaveBeenCalled());
    unmount();
    await waitFor(() => expect(native.stop).toHaveBeenCalled());
    expect(order.slice(-2)).toEqual(['live', 'stop']);
    expect((await served()).events.click).toEqual(off);
  });

  it('leader: Bluetooth restarting while Stage stays open (a kill switch, Bluetooth back) serves the last state and the running click again, and says nothing stopped', async () => {
    const off = { ...click, on: false, seq: 7 };
    const farewell = vi.fn(() => ({ click: off }));
    const { result, rerender, unmount } = renderHook(
      ({ ids }) => useStageBle({ eventId: 'gig', savedIds: ids, open: true, isLeader: true, onState: () => {}, farewell }),
      { initialProps: { ids: IDS } },
    );
    await waitFor(() => expect(native.start).toHaveBeenCalledTimes(1));
    act(() => result.current.publish({ seq: 4, from: 'lead', songId: 'b2', order: null }));
    act(() => result.current.publishLive('click', click));
    await waitFor(() => expect(native.updateLive).toHaveBeenCalled());
    await waitFor(() => expect(native.update).toHaveBeenCalled());
    // Bluetooth stops (here: no setlist for a moment), Stage stays open…
    rerender({ ids: [] });
    await waitFor(() => expect(native.stop).toHaveBeenCalled());
    native.update.mockClear();
    native.updateLive.mockClear();
    // …and starts again.
    rerender({ ids: IDS });
    await waitFor(() => expect(native.start).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(native.update).toHaveBeenCalled());
    await waitFor(() => expect(native.updateLive).toHaveBeenCalled());
    expect(farewell).not.toHaveBeenCalled();
    expect((await served()).events).toEqual({ click });
    unmount();
    // Closing Stage is a goodbye.
    expect(farewell).toHaveBeenCalled();
  });

  it('leader: Stage closed (open false) is a goodbye too, and nothing is replayed next time', async () => {
    const off = { ...click, on: false, seq: 7 };
    const farewell = vi.fn(() => ({ click: off }));
    const { result, rerender, unmount } = renderHook(
      ({ open }) => useStageBle({ eventId: 'gig', savedIds: IDS, open, isLeader: true, onState: () => {}, farewell }),
      { initialProps: { open: true } },
    );
    await waitFor(() => expect(native.start).toHaveBeenCalledTimes(1));
    act(() => result.current.publishLive('click', click));
    await waitFor(() => expect(native.updateLive).toHaveBeenCalled());
    rerender({ open: false });
    expect(farewell).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(native.stop).toHaveBeenCalled());
    native.updateLive.mockClear();
    native.update.mockClear();
    rerender({ open: true });
    await waitFor(() => expect(native.start).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 100));
    expect(native.updateLive).not.toHaveBeenCalled();
    expect(native.update).not.toHaveBeenCalled();
    unmount();
  });

  it('leader: the switch turned off mid-show (ble_live) sends the stopped click once, then nothing more goes out over Bluetooth; back on, what runs now is served again', async () => {
    const off = { ...click, on: false, seq: 7 };
    const farewell = vi.fn((_why?: 'closing' | 'off') => ({ click: off }));
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: true, onState: () => {}, farewell }),
    );
    act(() => result.current.publishLive('click', click));
    await waitFor(() => expect(native.updateLive).toHaveBeenCalledTimes(1));
    act(() => __setAppFlagsForTest({ ble_live: false }));
    // Phones still reading (their switch not read yet, or no signal) are told it stopped.
    await waitFor(() => expect(native.updateLive).toHaveBeenCalledTimes(2));
    expect(farewell).toHaveBeenCalledWith('off');
    expect((await served()).events).toEqual({ click: off });
    // The click and the playhead from now on: not over Bluetooth.
    const faster = { ...click, bpm: 140, seq: 9 };
    act(() => result.current.publishLive('click', faster));
    act(() => result.current.publishLive('playhead', head));
    await new Promise((r) => setTimeout(r, 100));
    expect(native.updateLive).toHaveBeenCalledTimes(2);
    // The song still goes out.
    act(() => result.current.publish({ seq: 4, from: 'lead', songId: 'b2', order: null }));
    await waitFor(() => expect(native.update).toHaveBeenCalled());
    // Back on: what runs now.
    act(() => __setAppFlagsForTest({ ble_live: true }));
    await waitFor(() => expect(native.updateLive).toHaveBeenCalledTimes(3));
    expect((await served()).events).toEqual({ click: faster, playhead: head });
    unmount();
  });

  it('leader: with the switch off, closing Stage says nothing over Bluetooth (the stop already went out)', async () => {
    const off = { ...click, on: false, seq: 7 };
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: true, onState: () => {}, farewell: () => ({ click: off }) }),
    );
    act(() => result.current.publishLive('click', click));
    await waitFor(() => expect(native.updateLive).toHaveBeenCalledTimes(1));
    act(() => __setAppFlagsForTest({ ble_live: false }));
    await waitFor(() => expect(native.updateLive).toHaveBeenCalledTimes(2));
    unmount();
    await waitFor(() => expect(native.stop).toHaveBeenCalled());
    expect(native.updateLive).toHaveBeenCalledTimes(2);
  });

  it('leader: the switch off with nothing running sends nothing', async () => {
    const { unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: true, onState: () => {}, farewell: () => ({}) }),
    );
    await waitFor(() => expect(native.start).toHaveBeenCalledTimes(1));
    act(() => __setAppFlagsForTest({ ble_live: false }));
    await new Promise((r) => setTimeout(r, 100));
    expect(native.updateLive).not.toHaveBeenCalled();
    unmount();
  });

  it('member: the switch off mid-show: a new live frame is not read and nothing reaches the click; back on, where the band is now is read', async () => {
    ble.live = { seq: 3, events: { click } };
    const onLive = vi.fn();
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState: () => {}, onLive }),
    );
    await waitFor(() => expect(onLive).toHaveBeenCalledWith('click', click));
    act(() => __setAppFlagsForTest({ ble_live: false }));
    const reads = ble.liveReads;
    const faster = { ...click, bpm: 140, seq: 9 };
    ble.live = { seq: 4, events: { click: faster } };
    await act(async () => ble.notify.get(STAGE_BLE_LIVE_CHARACTERISTIC)!(new DataView(new ArrayBuffer(4))));
    await new Promise((r) => setTimeout(r, 100));
    expect(ble.liveReads).toBe(reads);
    expect(onLive).not.toHaveBeenCalledWith('click', faster);
    // The song link stays.
    expect(result.current.status).toBe('connected');
    act(() => __setAppFlagsForTest({ ble_live: true }));
    await waitFor(() => expect(onLive).toHaveBeenCalledWith('click', faster));
    unmount();
  });

  it('member: the switch off before linking: the live frame is never read, the song still syncs', async () => {
    __setAppFlagsForTest({ ble_live: false });
    ble.live = { seq: 3, events: { click, playhead: head } };
    const onLive = vi.fn();
    const onState = vi.fn();
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState, onLive }),
    );
    await waitFor(() => expect(onState).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 200));
    expect(result.current.status).toBe('connected');
    expect(ble.liveReads).toBe(0);
    expect(onLive).not.toHaveBeenCalled();
    unmount();
  });

  it('member: a read in flight when the switch goes off brings nothing', async () => {
    ble.live = { seq: 3, events: { click } };
    const onLive = vi.fn();
    const { unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState: () => {}, onLive }),
    );
    await waitFor(() => expect(onLive).toHaveBeenCalledWith('click', click));
    const faster = { ...click, bpm: 140, seq: 9 };
    ble.live = { seq: 4, events: { click: faster } };
    const { BleClient } = await import('@capacitor-community/bluetooth-le');
    const real = vi.mocked(BleClient.read).getMockImplementation()!;
    let release = () => {};
    vi.mocked(BleClient.read).mockImplementationOnce(async (...args) => {
      await new Promise<void>((r) => (release = r));
      return real(...args);
    });
    await act(async () => ble.notify.get(STAGE_BLE_LIVE_CHARACTERISTIC)!(new DataView(new ArrayBuffer(4))));
    act(() => __setAppFlagsForTest({ ble_live: false }));
    release();
    await new Promise((r) => setTimeout(r, 100));
    expect(onLive).not.toHaveBeenCalledWith('click', faster);
    unmount();
  });

  it('member: connecting reads where the band is (catch-up), then every change', async () => {
    ble.live = { seq: 3, events: { click, playhead: head } };
    const onLive = vi.fn();
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState: () => {}, onLive }),
    );
    await waitFor(() => expect(onLive).toHaveBeenCalledWith('click', click));
    expect(onLive).toHaveBeenCalledWith('playhead', head);
    expect(result.current.status).toBe('connected');
    const stop = { ...head, on: false, seq: 9 };
    ble.live = { seq: 4, events: { click, playhead: stop } };
    await act(async () => ble.notify.get(STAGE_BLE_LIVE_CHARACTERISTIC)!(new DataView(new ArrayBuffer(4))));
    await waitFor(() => expect(onLive).toHaveBeenCalledWith('playhead', stop));
    unmount();
  });

  it("member: the clock is tied to the leader from its click, even before it picked a song", async () => {
    ble.live = { seq: 2, events: { click: { ...click, from: 'lead-2' } } };
    const { BleClient } = await import('@capacitor-community/bluetooth-le');
    // No state yet: the leader hasn't moved (empty state characteristic).
    vi.mocked(BleClient.read).mockImplementationOnce(async () => new DataView(new ArrayBuffer(0)));
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState: () => {}, onLive: () => {} }),
    );
    await waitFor(() => expect(result.current.clock?.from).toBe('lead-2'), { timeout: 3000 });
    unmount();
  });

  it('member: a leader on an older app (no live characteristic) still syncs the song', async () => {
    ble.live = null;
    const onState = vi.fn();
    const onLive = vi.fn();
    const { result, unmount } = renderHook(() =>
      useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState, onLive }),
    );
    await waitFor(() => expect(onState).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 200));
    expect(result.current.status).toBe('connected');
    expect(onLive).not.toHaveBeenCalled();
    unmount();
  });
});
