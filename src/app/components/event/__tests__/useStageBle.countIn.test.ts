import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { encodeSignedState, encodeStageState, toBase64, fromBase64, STAGE_BLE_CHARACTERISTIC, STAGE_BLE_SIGNED_CHARACTERISTIC } from '@/lib/stageBle';
import { generateSigner } from '@/lib/stageSign';
import { STAGE_BLE_CLOCK_CHARACTERISTIC, STAGE_BLE_LIVE_CHARACTERISTIC, decodeLive, encodeClock, encodeLive } from '@/lib/stageBleSync';
import { nowMs, clickWire, type ClickState } from '@/lib/stageClick';
import { countInBleWire, parseCountInBle, startCountIn, stopCountIn } from '@/lib/countIn';
import { startPlayhead } from '@/lib/playhead';
import { meterOf } from '@/lib/meter';

/**
 * The count-in on the Bluetooth live frame (useStageBle): what the leader's
 * phone serves and how often, and what a member's phone hands on, with the
 * word on whether the phone it read it from was checked as an admin's.
 * The same stand-in for the two plugins as useStageBle.live.test.ts.
 */

// jsdom has no WebCrypto; the app runs where it does (WKWebView, Android WebView).
const nodeCrypto = 'node:crypto';
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = (await import(/* @vite-ignore */ nodeCrypto)) as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const KEY = toBase64(new Uint8Array(32).map((_, i) => i * 3));
const SIGNER = await generateSigner();
/** Another pair: what a member posing as the leader could sign with. */
const IMPOSTOR = await generateSigner();
const IDS = ['a1', 'b2'];
/** The simulated leader's clock runs this far ahead of the member's; a read takes 5 ms each way (as in useStageBle.clock.test.ts). */
const AHEAD_MS = 500;

const ble = vi.hoisted(() => ({
  available: true,
  notify: new Map<string, (v: DataView) => void>(),
  live: null as null | { seq: number; events: Record<string, unknown> },
  liveReads: 0,
  /** The phone linked serves no signed state (this app with no key pair yet). */
  noPair: false,
  /** The phone linked signs with a pair that is not the gig's. */
  impostor: false,
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
    getServices: vi.fn(async () => [
      {
        uuid: 'gig',
        characteristics: [STAGE_BLE_CHARACTERISTIC, ...(ble.noPair ? [] : [STAGE_BLE_SIGNED_CHARACTERISTIC, STAGE_BLE_CLOCK_CHARACTERISTIC]), STAGE_BLE_LIVE_CHARACTERISTIC].map((uuid) => ({
          uuid,
          properties: {},
          descriptors: [],
        })),
      },
    ]),
    startNotifications: vi.fn(async (_id: string, _s: string, char: string, cb: (v: DataView) => void) => {
      ble.notify.set(char, cb);
    }),
    read: vi.fn(async (_id: string, _s: string, char: string) => {
      if (char === STAGE_BLE_CLOCK_CHARACTERISTIC) {
        if (ble.noPair) throw new Error('Characteristic not found.');
        await new Promise((r) => setTimeout(r, 5));
        const frame = await encodeClock(nowMs() + AHEAD_MS, SIGNER.private);
        await new Promise((r) => setTimeout(r, 5));
        return new DataView(frame.buffer);
      }
      if (char === STAGE_BLE_LIVE_CHARACTERISTIC) {
        ble.liveReads++;
        const frame = (await encodeLive(ble.live!.seq, ble.live!.events, KEY))!;
        return new DataView(frame.buffer);
      }
      const signed = char === STAGE_BLE_SIGNED_CHARACTERISTIC;
      if (char !== STAGE_BLE_CHARACTERISTIC && !signed) return new DataView(new ArrayBuffer(0));
      const state = { seq: 3, from: 'lead', songId: 'b2', order: null };
      const bytes = signed ? (await encodeSignedState(state, IDS, (ble.impostor ? IMPOSTOR : SIGNER).private))! : (await encodeStageState(state, IDS, KEY))!;
      return new DataView(bytes.buffer);
    }),
    write: vi.fn(async () => {
      throw new Error('members never write');
    }),
    startEnabledNotifications: vi.fn(async () => {}),
    stopEnabledNotifications: vi.fn(async () => {}),
  },
  BluetoothLe: { disconnect: vi.fn(async () => {}) },
  ConnectionPriority: { CONNECTION_PRIORITY_BALANCED: 0, CONNECTION_PRIORITY_HIGH: 1, CONNECTION_PRIORITY_LOW_POWER: 2 },
}));

const native = vi.hoisted(() => ({
  start: vi.fn(async (_o: Record<string, string>) => ({ state: 'on' })),
  update: vi.fn(async () => {}),
  updateSigned: vi.fn(async () => {}),
  updateLive: vi.fn(async (_o: { value: string; notify: string }) => {}),
  stop: vi.fn(async () => {}),
  now: vi.fn(async () => ({ now: 0 })),
  setClock: vi.fn(async (_o: { offset: number }) => {}),
  addListener: vi.fn(async () => ({ remove: async () => {} })),
}));

vi.mock('@/lib/stageBleNative', () => ({
  STAGE_KEY_EVENT: 'bw:stage-key',
  StageBle: native,
  stageBleAvailable: () => ble.available,
  stageKey: async () => KEY,
  fetchStageKey: async () => ({ key: KEY, denied: false }),
  stageVerifyKey: async () => ({ public: SIGNER.public, version: 1 }),
  fetchVerifyKey: async () => ({ answer: { public: SIGNER.public, version: 1 }, server: true }),
  keptVerifyKey: () => ({ public: SIGNER.public, version: 1 }),
  stageSigner: async () => ({ ...SIGNER, version: 1 }),
  signerRefused: () => false,
  previousStageKey: () => null,
  forgetStageKeys: () => {},
}));

const { useStageBle, forgetScanStarts, forgetSignedLeaders } = await import('../useStageBle');
const { __resetAppFlagsForTest, __setAppFlagsForTest } = await import('@/lib/appFlags');

const SONG = '0f8fad5b-d9cb-469f-a165-70867728950e';
const count = startCountIn({ from: 'lead', songId: SONG, bpm: 120, meter: meterOf('4/4'), now: 1_795_000_000_000 });
const wire = countInBleWire(count);
const click: ClickState = { seq: 5, from: 'lead', on: true, bpm: 120, beats: 4, bars: null, startAt: count.startAt, songId: SONG };
const head = startPlayhead({ from: 'lead', songId: SONG, bpm: 120, startAt: count.startAt + 2000 });

/** Every frame the leader served, decoded, in order. */
const served = async () =>
  Promise.all(native.updateLive.mock.calls.map(async ([call]) => (await decodeLive(fromBase64(call.value), KEY))!.events));
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  // The test before may still be saying goodbye (its last frame, then Bluetooth stops).
  await settle(50);
  ble.available = true;
  ble.notify.clear();
  ble.liveReads = 0;
  ble.live = { seq: 1, events: {} };
  ble.noPair = false;
  ble.impostor = false;
  vi.clearAllMocks();
  __resetAppFlagsForTest(null);
  forgetScanStarts();
  forgetSignedLeaders();
});

describe('useStageBle: the count-in on the live frame (leader)', () => {
  const leader = () => renderHook(() => useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: true, onState: () => {} }));

  it('a count-in start (the count, the playhead at bar 1, the running click: set in one turn) goes out as one frame', async () => {
    const { result, unmount } = leader();
    await waitFor(() => expect(native.start).toHaveBeenCalled());
    await settle();
    act(() => {
      result.current.publishLive('countin', wire);
      result.current.publishLive('playhead', head);
      result.current.publishLive('click', clickWire(click));
    });
    await waitFor(() => expect(native.updateLive).toHaveBeenCalled());
    await settle();
    // One frame, one change notice: every phone reads once and has the three together.
    expect(native.updateLive).toHaveBeenCalledTimes(1);
    const [frame] = await served();
    expect(parseCountInBle(frame.countin)).toMatchObject({ seq: count.seq, on: true, songId: SONG, from: 'lead' });
    expect(frame.playhead).toEqual(head);
    expect(frame.click).toEqual(clickWire(click));
    unmount();
  });

  it('one start, one stop, and nothing in between or after (no flood)', async () => {
    const { result, unmount } = leader();
    await waitFor(() => expect(native.start).toHaveBeenCalled());
    await settle();
    act(() => result.current.publishLive('countin', wire));
    await waitFor(() => expect(native.updateLive).toHaveBeenCalledTimes(1));
    await settle(1200);
    expect(native.updateLive).toHaveBeenCalledTimes(1);
    const stop = stopCountIn(count);
    act(() => result.current.publishLive('countin', countInBleWire(stop)));
    await waitFor(() => expect(native.updateLive).toHaveBeenCalledTimes(2));
    await settle(600);
    expect(native.updateLive).toHaveBeenCalledTimes(2);
    expect(parseCountInBle((await served())[1].countin)).toMatchObject({ on: false, seq: stop.seq });
    unmount();
  });

  it('a frame too long with the count-in in it still serves the click and the playhead', async () => {
    const { result, unmount } = leader();
    await waitFor(() => expect(native.start).toHaveBeenCalled());
    await settle();
    // Not a count-in the app makes: only here to go past 512 bytes. It stays the newest count-in
    // for the rest of the song, so every later frame would be too long with it.
    act(() => result.current.publishLive('countin', { ...wire, pad: 'x'.repeat(400) }));
    await settle();
    act(() => result.current.publishLive('click', clickWire(click)));
    await settle();
    act(() => result.current.publishLive('playhead', head));
    await waitFor(() => expect(native.updateLive).toHaveBeenCalled());
    await settle();
    const frames = await served();
    expect(frames[frames.length - 1]).toEqual({ click: clickWire(click), playhead: head });
    unmount();
  });

  it('switched off (ble_live): no count-in goes out over Bluetooth', async () => {
    const { result, unmount } = leader();
    await waitFor(() => expect(native.start).toHaveBeenCalled());
    await settle();
    act(() => __setAppFlagsForTest({ ble_live: false }));
    act(() => result.current.publishLive('countin', wire));
    await settle();
    expect(native.updateLive).not.toHaveBeenCalled();
    unmount();
  });

  it('in a browser (no Bluetooth): nothing is asked of the plugin, and nothing throws', async () => {
    ble.available = false;
    const { result, unmount } = leader();
    expect(() => act(() => result.current.publishLive('countin', wire))).not.toThrow();
    await settle();
    expect(native.start).not.toHaveBeenCalled();
    expect(native.updateLive).not.toHaveBeenCalled();
    expect(result.current.status).toBe('off');
    unmount();
  });
});

describe('useStageBle: the count-in on the live frame (member)', () => {
  const member = (onLive: (...a: unknown[]) => void) =>
    renderHook(() => useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState: () => {}, onLive }));
  const countIns = (onLive: ReturnType<typeof vi.fn>) => onLive.mock.calls.filter(([e]) => e === 'countin');

  it("from a phone whose admin signature was checked: handed on as the leader's, on connecting (mid-count) and on every change", async () => {
    ble.live = { seq: 3, events: { countin: wire } };
    const onLive = vi.fn();
    const { unmount } = member(onLive);
    await waitFor(() => expect(countIns(onLive)).toHaveLength(1));
    expect(countIns(onLive)[0]).toEqual(['countin', wire, true]);
    const stop = countInBleWire(stopCountIn(count));
    ble.live = { seq: 4, events: { countin: stop } };
    await act(async () => ble.notify.get(STAGE_BLE_LIVE_CHARACTERISTIC)!(new DataView(new ArrayBuffer(4))));
    await waitFor(() => expect(countIns(onLive)).toHaveLength(2));
    expect(countIns(onLive)[1]).toEqual(['countin', stop, true]);
    unmount();
  });

  it("the clock the count is shown on is the click's: the leader's signed clock, measured over the link to the click's tolerance", async () => {
    ble.live = { seq: 3, events: { countin: wire } };
    const onLive = vi.fn();
    const { result, unmount } = member(onLive);
    await waitFor(() => expect(countIns(onLive)).toHaveLength(1));
    // Tied to the count-in's leader, so useStageLive's pickClock takes it for this count.
    await waitFor(() => expect(result.current.clock?.from).toBe('lead'), { timeout: 3000 });
    // The same bound as the click's test: a 10 ms round trip, the measure within 15 ms.
    await waitFor(() => expect(Math.abs(result.current.clock!.sample!.offset - AHEAD_MS)).toBeLessThan(15), { timeout: 3000 });
    // Every count then falls at startAt + its time - offset on this phone: off by that measure and nothing else.
    const state = parseCountInBle(countIns(onLive)[0][1])!;
    const error = Math.abs(state.startAt - result.current.clock!.sample!.offset - (count.startAt - AHEAD_MS));
    expect(error).toBeLessThan(15);
    unmount();
  });

  it('from a phone that signs nothing (no key pair): handed on as not checked', async () => {
    ble.noPair = true;
    ble.live = { seq: 3, events: { countin: wire, click: clickWire(click) } };
    const onLive = vi.fn();
    const { unmount } = member(onLive);
    await waitFor(() => expect(countIns(onLive)).toHaveLength(1));
    expect(countIns(onLive)[0]).toEqual(['countin', wire, false]);
    // The click is handed on as it always was.
    expect(onLive).toHaveBeenCalledWith('click', clickWire(click));
    unmount();
  });

  it("from a phone whose signature isn't the admins' (a member posing as the leader, with the band key): never as checked", async () => {
    ble.impostor = true;
    ble.live = { seq: 3, events: { countin: wire } };
    const onLive = vi.fn();
    const { unmount } = member(onLive);
    await settle(1500);
    expect(countIns(onLive).filter(([, , signed]) => signed !== false)).toEqual([]);
    unmount();
  });

  it('switched off (ble_live): the count-in is not read over Bluetooth', async () => {
    __setAppFlagsForTest({ ble_live: false });
    ble.live = { seq: 3, events: { countin: wire } };
    const onLive = vi.fn();
    const { unmount } = member(onLive);
    await settle(400);
    expect(ble.liveReads).toBe(0);
    expect(onLive).not.toHaveBeenCalled();
    unmount();
  });
});
