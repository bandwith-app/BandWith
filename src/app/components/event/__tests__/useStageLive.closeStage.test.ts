import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { toBase64, fromBase64 } from '@/lib/stageBle';
import { generateSigner } from '@/lib/stageSign';
import { decodeLive } from '@/lib/stageBleSync';

/**
 * Closing Stage the way Event Detail does: `open` goes false on a hook that
 * stays mounted. The REAL useStageLive and the REAL useStageBle together
 * (only the Supabase channel and the two Bluetooth plugins are stand-ins):
 * the goodbye over Bluetooth is asked for by useStageBle's cleanup, after
 * useStageLive has already rendered with the next opening's id.
 */

// jsdom has no WebCrypto; the app runs where it does (WKWebView, Android WebView).
const nodeCrypto = 'node:crypto';
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = (await import(/* @vite-ignore */ nodeCrypto)) as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const KEY = toBase64(new Uint8Array(32).map((_, i) => i * 5));
const SIGNER = await generateSigner();

/** Every broadcast the leader's phone sent on the channel. */
const sent = vi.hoisted(() => [] as Array<{ event: string; payload: Record<string, unknown> }>);
vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: () => {
      const ch = {
        on: () => ch,
        subscribe(cb: (s: string) => void) {
          cb('SUBSCRIBED');
          return ch;
        },
        track: async () => {},
        send: async (m: { event: string; payload: Record<string, unknown> }) => void sent.push({ event: m.event, payload: m.payload }),
      };
      return ch;
    },
    removeChannel: async () => {},
  },
}));
vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {},
  BluetoothLe: {},
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
  stageBleAvailable: () => true,
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
vi.mock('@/lib/services/songs', () => ({ saveSetlistOrder: async () => ({ error: null }), saveStageOrder: async () => ({ error: null }) }));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySetlistSaved: async () => {} }));

const { useStageLive } = await import('../useStageLive');
const { __resetAppFlagsForTest } = await import('@/lib/appFlags');
const { COUNTIN_EVENT, parseCountInBle, startCountIn } = await import('@/lib/countIn');
const { CLICK_EVENT, parseClickState, nowMs } = await import('@/lib/stageClick');
const { PLAYHEAD_EVENT, parsePlayheadState, startPlayhead } = await import('@/lib/playhead');
const { meterOf } = await import('@/lib/meter');

const SONGS = [
  { id: 'row-1', songId: 'song-1' },
  { id: 'row-2', songId: 'song-2' },
];
/** The last frame served over Bluetooth, decoded. */
const lastFrame = async () => {
  const calls = native.updateLive.mock.calls;
  return (await decodeLive(fromBase64(calls[calls.length - 1][0].value), KEY))!.events;
};
const onChannel = (event: string) => sent.filter((m) => m.event === event).map((m) => m.payload);

beforeEach(async () => {
  await new Promise((r) => setTimeout(r, 50));
  sent.length = 0;
  vi.clearAllMocks();
  __resetAppFlagsForTest(null);
});

describe('the leader closes Stage (Event Detail: open goes false, the hook stays)', () => {
  const stage = () =>
    renderHook(({ open }) => useStageLive({ eventId: 'gig-1', setlistId: 'list-1', songs: SONGS, open, isLeader: true }), { initialProps: { open: true } });

  it('a count still counting is stopped on both paths: over Bluetooth before it stops, and on the channel', async () => {
    const leader = stage();
    await waitFor(() => expect(native.start).toHaveBeenCalled());
    const opened = leader.result.current.clientId;
    // A slow two-bar count: still counting when Stage closes.
    act(() => leader.result.current.countIn.set(startCountIn({ from: opened, songId: 'row-1', bpm: 60, meter: meterOf('4/4'), bars: 2, now: nowMs() })));
    await waitFor(async () => expect(parseCountInBle((await lastFrame()).countin)).toMatchObject({ on: true, from: opened }));
    const order: string[] = [];
    native.updateLive.mockImplementation(async () => void order.push('live'));
    native.stop.mockImplementation(async () => void order.push('stop'));
    leader.rerender({ open: false });
    await waitFor(() => expect(native.stop).toHaveBeenCalled());
    // Its id for the next opening is another one already: the Stop is still said, in the name the count had.
    expect(leader.result.current.clientId).not.toBe(opened);
    expect(order).toEqual(['live', 'stop']);
    expect(parseCountInBle((await lastFrame()).countin)).toMatchObject({ on: false, from: opened, songId: 'row-1' });
    expect(onChannel(COUNTIN_EVENT).pop()).toMatchObject({ on: false, from: opened });
    leader.unmount();
  });

  it('its click and its playhead are stopped over Bluetooth the same way', async () => {
    const leader = stage();
    await waitFor(() => expect(native.start).toHaveBeenCalled());
    const opened = leader.result.current.clientId;
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    act(() => leader.result.current.playhead.set(startPlayhead({ from: opened, songId: 'row-1', bpm: 120, startAt: nowMs() })));
    await waitFor(async () => expect(parsePlayheadState((await lastFrame()).playhead)?.on).toBe(true));
    leader.rerender({ open: false });
    await waitFor(() => expect(native.stop).toHaveBeenCalled());
    const frame = await lastFrame();
    expect(parseClickState(frame.click)).toMatchObject({ on: false, from: opened });
    expect(parsePlayheadState(frame.playhead)).toMatchObject({ on: false, from: opened });
    expect(onChannel(CLICK_EVENT).pop()).toMatchObject({ on: false });
    expect(onChannel(PLAYHEAD_EVENT).pop()).toMatchObject({ on: false });
    leader.unmount();
  });

  it('unmounting with Stage open says the same goodbye', async () => {
    const leader = stage();
    await waitFor(() => expect(native.start).toHaveBeenCalled());
    const opened = leader.result.current.clientId;
    act(() => leader.result.current.countIn.set(startCountIn({ from: opened, songId: 'row-1', bpm: 60, meter: meterOf('4/4'), bars: 2, now: nowMs() })));
    await waitFor(() => expect(native.updateLive).toHaveBeenCalled());
    leader.unmount();
    await waitFor(() => expect(native.stop).toHaveBeenCalled());
    expect(parseCountInBle((await lastFrame()).countin)).toMatchObject({ on: false, from: opened });
    expect(onChannel(COUNTIN_EVENT).pop()).toMatchObject({ on: false, from: opened });
  });
});
