import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { watchCrypto, pass } from './stageTestTime';
import { encodeSignedState, encodeStageState, toBase64, STAGE_BLE_CHARACTERISTIC, STAGE_BLE_SIGNED_CHARACTERISTIC } from '@/lib/stageBle';
import { generateSigner } from '@/lib/stageSign';
import { STAGE_BLE_CLOCK_CHARACTERISTIC, STAGE_BLE_LIVE_CHARACTERISTIC, encodeClock, encodeLive } from '@/lib/stageBleSync';

/**
 * A member whose saved setlist is not the leader's (an older download: a song
 * was added or removed since), with no internet, next to the leader's phone.
 * The REAL useStageLive on the REAL useStageBle; only the Supabase channel
 * (down) and the two Bluetooth plugins are stand-ins.
 *
 * Such a phone can't follow the leader's songs (its line says so: status
 * 'outdated'), but the link is up and checked: the admins' signature on the
 * state and on the clock. What keeps time (the click, the count-in, the
 * playhead of Follow the tempo) doesn't depend on the setlist: it runs for
 * as long as the leader is in reach, and stops like for anyone else once the
 * leader is gone.
 */

// jsdom has no WebCrypto; the app runs where it does (WKWebView, Android WebView).
const nodeCrypto = 'node:crypto';
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = (await import(/* @vite-ignore */ nodeCrypto)) as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
watchCrypto();

const KEY = toBase64(new Uint8Array(32).map((_, i) => i * 7));
const SIGNER = await generateSigner();
/** The leader's clock runs this far ahead of the member's. */
const AHEAD_MS = 500;
/** This phone's setlist (an older download), and the leader's (a song added since). */
const SONGS = [
  { id: 'row-1', songId: 'song-1' },
  { id: 'row-2', songId: 'song-2' },
];
const LEADER_IDS = ['row-1', 'row-2', 'row-3'];

const ble = vi.hoisted(() => ({
  /** The leader's phone is in Bluetooth reach (advertising, answering). */
  inReach: true,
  /** The setlist the leader's state is made for. */
  ids: [] as string[],
  notify: new Map<string, (v: DataView) => void>(),
  goodbye: null as null | (() => void),
  live: { seq: 1, events: {} as Record<string, unknown> },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    // No internet: the channel never joins.
    channel: () => {
      const ch = {
        on: () => ch,
        subscribe(cb: (s: string) => void) {
          cb('CHANNEL_ERROR');
          return ch;
        },
        track: async () => {},
        send: async () => {},
      };
      return ch;
    },
    removeChannel: async () => {},
  },
}));
vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {
    initialize: vi.fn(async () => {}),
    isEnabled: vi.fn(async () => true),
    requestLEScan: vi.fn(async (_o: unknown, cb: (r: { device: { deviceId: string } }) => void) => {
      if (ble.inReach) setTimeout(() => cb({ device: { deviceId: 'leader-phone' } }), 0);
    }),
    stopLEScan: vi.fn(async () => {}),
    connect: vi.fn(async (_id: string, cb: () => void) => {
      if (!ble.inReach) throw new Error('Connection timeout.');
      ble.goodbye = cb;
    }),
    disconnect: vi.fn(async () => {}),
    requestConnectionPriority: vi.fn(async () => {}),
    getServices: vi.fn(async () => [
      {
        uuid: 'gig',
        characteristics: [STAGE_BLE_CHARACTERISTIC, STAGE_BLE_SIGNED_CHARACTERISTIC, STAGE_BLE_CLOCK_CHARACTERISTIC, STAGE_BLE_LIVE_CHARACTERISTIC].map((uuid) => ({
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
      if (!ble.inReach) throw new Error('Not connected.');
      const { nowMs } = await import('@/lib/stageClick');
      if (char === STAGE_BLE_CLOCK_CHARACTERISTIC) {
        // 5 ms each way.
        await new Promise((r) => setTimeout(r, 5));
        const frame = await encodeClock(nowMs() + AHEAD_MS, SIGNER.private);
        await new Promise((r) => setTimeout(r, 5));
        return new DataView(frame.buffer);
      }
      if (char === STAGE_BLE_LIVE_CHARACTERISTIC) {
        const frame = (await encodeLive(ble.live.seq, ble.live.events, KEY))!;
        return new DataView(frame.buffer);
      }
      const signed = char === STAGE_BLE_SIGNED_CHARACTERISTIC;
      if (char !== STAGE_BLE_CHARACTERISTIC && !signed) return new DataView(new ArrayBuffer(0));
      // The leader is on the song this phone doesn't have.
      const state = { seq: 3, from: 'lead', songId: ble.ids[ble.ids.length - 1], order: null };
      const bytes = signed ? (await encodeSignedState(state, ble.ids, SIGNER.private))! : (await encodeStageState(state, ble.ids, KEY))!;
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
vi.mock('@/lib/stageBleNative', () => ({
  STAGE_KEY_EVENT: 'bw:stage-key',
  StageBle: {},
  stageBleAvailable: () => true,
  stageKey: async () => KEY,
  fetchStageKey: async () => ({ key: KEY, denied: false }),
  stageVerifyKey: async () => ({ public: SIGNER.public, version: 1 }),
  fetchVerifyKey: async () => ({ answer: { public: SIGNER.public, version: 1 }, server: true }),
  keptVerifyKey: () => ({ public: SIGNER.public, version: 1 }),
  stageSigner: async () => null,
  signerRefused: () => false,
  previousStageKey: () => null,
  forgetStageKeys: () => {},
}));
vi.mock('@/lib/services/songs', () => ({ saveSetlistOrder: async () => ({ error: null }), saveStageOrder: async () => ({ error: null }) }));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySetlistSaved: async () => {} }));

const { useStageLive, BLE_LEADER_GONE_MS } = await import('../useStageLive');
const { forgetScanStarts, forgetSignedLeaders } = await import('../useStageBle');
const { __resetAppFlagsForTest } = await import('@/lib/appFlags');
const { COUNTIN_LEAD_MS, countInAt, countInBleWire, countInPlan, startCountIn } = await import('@/lib/countIn');
const { clickWire, nowMs } = await import('@/lib/stageClick');
const { startPlayhead } = await import('@/lib/playhead');
const { nextSeq } = await import('@/lib/stageLive');
const { meterOf } = await import('@/lib/meter');

const member = () => renderHook(() => useStageLive({ eventId: 'gig-1', setlistId: 'list-1', songs: SONGS, open: true, isLeader: false }));
type Member = ReturnType<typeof member>;
/** The leader's clock, as its phone reads it now. */
const leaderNow = () => nowMs() + AHEAD_MS;
/** The leader changes what it serves on the live frame: a change notice, then the member reads it. */
const serve = async (events: Record<string, unknown>) => {
  ble.live = { seq: ble.live.seq + 1, events };
  await act(async () => {
    ble.notify.get(STAGE_BLE_LIVE_CHARACTERISTIC)?.(new DataView(new ArrayBuffer(4)));
    await pass(50, 10);
  });
};
/** App time moves on until the check holds (up to 15 s of it). */
const until = async (check: () => boolean) => {
  for (let i = 0; i < 150 && !check(); i++) await act(() => pass(100, 50));
  expect(check()).toBe(true);
};
const wait = (ms: number) => act(() => pass(ms));
/** The leader's click and playhead, running on a song both phones have. */
const running = () => ({
  click: clickWire({ seq: nextSeq(undefined, Date.now() + AHEAD_MS), from: 'lead', on: true, bpm: 120, beats: 4, bars: null, startAt: leaderNow(), songId: 'row-1' }),
  playhead: { ...startPlayhead({ from: 'lead', songId: 'row-1', bpm: 120, startAt: leaderNow() }), seq: nextSeq(undefined, Date.now() + AHEAD_MS) },
});
/** A slow two-bar count (40 BPM: 12 s of counting after the 1.5 s lead, then GO), tapped now on the leader's phone. */
const slowCount = () => ({
  ...startCountIn({ from: 'lead', songId: 'row-1', bpm: 40, meter: meterOf('4/4'), bars: 2, now: leaderNow() }),
  seq: nextSeq(undefined, Date.now() + AHEAD_MS),
});
/** The count a phone shows right now (its label), or null: what the overlay draws from the same state and offset. */
const showing = (m: Member): string | null => {
  const { state, offset } = m.result.current.countIn;
  if (!state?.on) return null;
  const plan = countInPlan(state);
  const pos = countInAt(plan, state, nowMs(), offset);
  return pos.stage === 'done' ? null : pos.stage === 'before' ? 'ready' : plan.events[pos.event].label;
};
/** Linked to the leader's phone, its clock measured, and (older setlist) told so. */
const linked = async (m: Member, status: string) => {
  await until(() => m.result.current.bluetooth === status);
  await until(() => !!m.result.current.click.state || !!m.result.current.countIn.state || Object.keys(ble.live.events).length === 0);
};

beforeEach(() => {
  ble.inReach = true;
  ble.ids = LEADER_IDS;
  ble.notify.clear();
  ble.goodbye = null;
  ble.live = { seq: 1, events: {} };
  __resetAppFlagsForTest(null);
  forgetScanStarts();
  forgetSignedLeaders();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

describe('Stage over Bluetooth: a member with an older setlist (no internet), the leader in reach', () => {
  it("the leader's click and playhead keep running for as long as the leader is in reach, well past the 10 s of a leader gone", async () => {
    ble.live = { seq: 2, events: running() };
    const m = member();
    await linked(m, 'outdated');
    expect(m.result.current.click.state).toMatchObject({ on: true, from: 'lead', bpm: 120 });
    expect(m.result.current.playhead.state).toMatchObject({ on: true, from: 'lead' });
    // On the leader's clock, measured over the link (the same one a member on the right setlist uses).
    await until(() => Math.abs(m.result.current.click.offset - AHEAD_MS) < 15);
    await wait(BLE_LEADER_GONE_MS + 5000);
    expect(m.result.current.bluetooth).toBe('outdated');
    expect(m.result.current.click.state).toMatchObject({ on: true, from: 'lead', bpm: 120 });
    expect(m.result.current.playhead.state).toMatchObject({ on: true, from: 'lead' });
    expect(Math.abs(m.result.current.click.offset - AHEAD_MS)).toBeLessThan(15);
    m.unmount();
  });

  it("the leader's count-in shows (the link is checked: the admins' signature on the state and on the clock), and a long one counts to the end", async () => {
    const m = member();
    await linked(m, 'outdated');
    const count = slowCount();
    await serve({ countin: countInBleWire(count) });
    await until(() => !!m.result.current.countIn.state?.on);
    expect(m.result.current.countIn.state).toMatchObject({ on: true, from: 'lead', songId: 'row-1' });
    // 40 BPM, two bars: "2 1" in half time, then "4 3 2 1" 1.5 s apart, GO 12 s into the count.
    const tapped = count.startAt - COUNTIN_LEAD_MS;
    /** Move to `t` ms into the count, on the leader's clock. */
    const at = (t: number) => wait(Math.max(0, count.startAt + t - leaderNow()));
    await at(100);
    expect(showing(m)).toBe('2');
    // The last count before GO, more than 10 s after the tap, the leader still there: counting, not an empty screen.
    await at(11_000);
    expect(leaderNow() - tapped).toBeGreaterThan(BLE_LEADER_GONE_MS);
    expect(m.result.current.bluetooth).toBe('outdated');
    expect(showing(m)).toBe('1');
    await at(12_100);
    expect(showing(m)).toBe('GO');
    await at(12_800);
    expect(showing(m)).toBeNull();
    m.unmount();
  });

  it('the leader out of reach for good: its click, playhead and count stop after the grace period, like for anyone else', async () => {
    ble.live = { seq: 2, events: { ...running(), countin: countInBleWire(slowCount()) } };
    const m = member();
    await linked(m, 'outdated');
    await until(() => !!m.result.current.countIn.state?.on);
    expect(m.result.current.click.state?.on).toBe(true);
    // The leader walks away: the link drops, nothing answers.
    ble.inReach = false;
    await act(async () => ble.goodbye?.());
    await until(() => m.result.current.bluetooth === 'searching');
    await wait(BLE_LEADER_GONE_MS - 2000);
    expect(m.result.current.click.state?.on).toBe(true);
    await wait(2500);
    expect(m.result.current.click.state).toBeNull();
    expect(m.result.current.playhead.state).toBeNull();
    expect(m.result.current.countIn.state).toBeNull();
    m.unmount();
  });
});

describe('Stage over Bluetooth: the same phone on the right setlist (what must not change)', () => {
  it("follows the leader's song, click and playhead as before", async () => {
    ble.ids = SONGS.map((s) => s.id);
    ble.live = { seq: 2, events: running() };
    const m = member();
    await linked(m, 'connected');
    // Its first state waits for the leader's clock, then applies.
    await until(() => m.result.current.currentId === 'row-2');
    expect(m.result.current.leaderHere).toBe(true);
    await wait(BLE_LEADER_GONE_MS + 2000);
    expect(m.result.current.click.state?.on).toBe(true);
    expect(m.result.current.playhead.state?.on).toBe(true);
    m.unmount();
  });
});
