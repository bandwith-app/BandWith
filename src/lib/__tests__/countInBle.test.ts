import { describe, expect, it } from 'vitest';
import { toBase64 } from '../stageBle';
import { LIVE_MAX_BYTES, decodeLive, encodeLive, type LiveEvent, type LiveEvents } from '../stageBleSync';
import { CLICK_EVENT, clickWire, parseClickState, type ClickState } from '../stageClick';
import { PLAYHEAD_EVENT, parsePlayheadState, type PlayheadState } from '../playhead';
import {
  COUNTIN_AHEAD_SLACK_MS,
  COUNTIN_EVENT,
  COUNTIN_LEAD_MS,
  GO_MS,
  countInAt,
  countInBleWire,
  countInPlan,
  countInWindow,
  parseCountInBle,
  parseCountInState,
  startCountIn,
  stopCountIn,
  type CountInState,
} from '../countIn';
import { meterOf } from '../meter';

// jsdom has no WebCrypto; the app runs where it does (WKWebView, Android WebView).
const nodeCrypto = 'node:crypto';
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = (await import(/* @vite-ignore */ nodeCrypto)) as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const KEY = toBase64(new Uint8Array(32).map((_, i) => i * 7));
const SONG = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER_SONG = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const LEADER = 'k3j9x0ab';
const NOW = 1_795_000_000_123.4567;

/** The heaviest count-in the app makes: an odd meter with its grouping, two bars, a pickup, counting up, the BPM per tick. */
const heavy: CountInState = {
  ...startCountIn({ from: LEADER, songId: SONG, bpm: 132.25, meter: meterOf('11/8', [3, 3, 3, 2], true), bars: 2, pickup: 3, style: 'up', now: NOW }),
  seq: 4_000_000_003,
};
const plain: CountInState = startCountIn({ from: LEADER, songId: SONG, bpm: 120, meter: meterOf('4/4'), now: NOW });

// The worst realistic neighbours in the frame (as in stageBleLive.test.ts): a 7/8 click with groups, a held playhead at 80 %.
const click: ClickState = { seq: 4_000_000_001, from: LEADER, on: true, bpm: 240, beats: 7, bars: null, groups: [2, 2, 3], startAt: NOW, songId: SONG };
const playhead: PlayheadState = { seq: 4_000_000_002, from: LEADER, songId: SONG, on: true, bpm: 96.5, speed: 0.8, bar: 1200, startAt: NOW + 333.789, hold: [1196, 1199] };

describe('count-in over Bluetooth: the wire form', () => {
  it('says the same count as the channel payload, in fewer bytes', () => {
    for (const state of [plain, heavy, stopCountIn(heavy), { ...plain, songId: null }]) {
      const wire = countInBleWire(state);
      const back = parseCountInBle(JSON.parse(JSON.stringify(wire)))!;
      // The start is carried to a tenth of a millisecond.
      expect(Math.abs(back.startAt - state.startAt)).toBeLessThanOrEqual(0.05);
      expect({ ...back, startAt: 0 }).toEqual({ ...state, startAt: 0 });
      // The count it draws is the same one, beat for beat.
      expect(countInPlan(back)).toEqual(countInPlan(state));
      expect(JSON.stringify(wire).length).toBeLessThan(JSON.stringify(state).length);
    }
  });

  it('reads the channel form too, and drops anything malformed', () => {
    expect(parseCountInBle(plain)).toEqual(plain);
    const wire = countInBleWire(plain);
    for (const bad of [null, 7, {}, { ...wire, q: -1 }, { ...wire, o: 2 }, { ...wire, t: '4/3' }, { ...wire, b: 9000 }, { ...wire, a: 'soon' }, { ...wire, from: '' }, { ...wire, u: 2 }, { ...wire, n: 3 }, { ...wire, g: [9] }])
      expect(parseCountInBle(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe('count-in over Bluetooth: one characteristic value (512 bytes)', () => {
  const size = async (events: LiveEvents) => (await encodeLive(1, events, KEY))?.length ?? Infinity;

  it('the heaviest count-in fits next to the heaviest click and a held playhead', async () => {
    const events = { [CLICK_EVENT]: clickWire(click), [PLAYHEAD_EVENT]: playhead, [COUNTIN_EVENT]: countInBleWire(heavy) };
    expect(await size(events)).toBeLessThanOrEqual(LIVE_MAX_BYTES);
    // In the channel's own form it would not leave the click's frame any room.
    expect(await size({ ...events, [COUNTIN_EVENT]: heavy })).toBeGreaterThan(LIVE_MAX_BYTES - 40);
  });

  it('still fits when the click was left running on another song', async () => {
    const events = { [CLICK_EVENT]: clickWire({ ...click, songId: OTHER_SONG }), [PLAYHEAD_EVENT]: playhead, [COUNTIN_EVENT]: countInBleWire(heavy) };
    const bytes = (await encodeLive(2, events, KEY))!;
    expect(bytes).not.toBeNull();
    expect(bytes.length).toBeLessThanOrEqual(LIVE_MAX_BYTES);
    const got = (await decodeLive(bytes, KEY))!;
    // Every state keeps its own song.
    expect(parseClickState(got.events.click)).toEqual({ ...click, songId: OTHER_SONG });
    expect(parsePlayheadState(got.events.playhead)).toEqual(playhead);
    expect(parseCountInBle(got.events.countin)).toMatchObject({ songId: SONG, from: LEADER, seq: heavy.seq, on: true });
  });

  it('a state with no song of its own never takes another state’s', async () => {
    const events = { [CLICK_EVENT]: clickWire({ ...click, songId: null }), [PLAYHEAD_EVENT]: playhead, [COUNTIN_EVENT]: countInBleWire(heavy) };
    const got = (await decodeLive((await encodeLive(3, events, KEY))!, KEY))!;
    expect(parseClickState(got.events.click)?.songId).toBeNull();
    expect(parseCountInBle(got.events.countin)?.songId).toBe(SONG);
  });
});

/**
 * The released apps (Android 1.0.14, TestFlight 202611222310: commit
 * d3515141) read the live frame with these rules, copied here as released:
 * `decodeLive` of src/lib/stageBleSync.ts and the dispatch in useStageLive's
 * `bleLiveRef` (click → parseClickState, playhead → parsePlayheadState,
 * anything else: nothing). A new leader's frame must leave them exactly where
 * they are today: click and playhead as before, no count-in.
 */
describe('count-in over Bluetooth: a phone still on the released app', () => {
  const RELEASED_LIVE_EVENTS = ['click', 'playhead', 'countin'] as const;
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const hmac8 = async (keyB64: string, data: Uint8Array) => {
    const raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, data as Uint8Array<ArrayBuffer>)).slice(0, 8);
  };
  /** src/lib/stageBleSync.ts `decodeLive` at d3515141. */
  const releasedDecodeLive = async (bytes: Uint8Array, keyB64: string): Promise<{ seq: number; events: Record<string, unknown> } | null> => {
    if (bytes.length < 6 + 2 + 8 || bytes.length > 512) return null;
    if (bytes[0] !== 3 || bytes[1] !== 3) return null;
    const end = bytes.length - 8;
    const expected = await hmac8(keyB64, bytes.slice(0, end));
    let diff = 0;
    for (let i = 0; i < 8; i++) diff |= bytes[end + i] ^ expected[i];
    if (diff !== 0) return null;
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes.slice(6, end)));
    } catch {
      return null;
    }
    if (!isObj(body)) return null;
    const events: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!(RELEASED_LIVE_EVENTS as readonly string[]).includes(k) || !isObj(v)) continue;
      events[k] = { ...('f' in body && !('from' in v) ? { from: body.f } : {}), ...('s' in body && !('songId' in v) ? { songId: body.s } : {}), ...v };
    }
    return { seq: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(2), events };
  };
  /** useStageLive.ts `bleLiveRef.current` at d3515141: what each event does on that phone. */
  const releasedDispatch = (event: string, payload: unknown): { click?: ClickState | null; playhead?: PlayheadState | null } => {
    if (event === CLICK_EVENT) return { click: parseClickState(payload) };
    if (event === PLAYHEAD_EVENT) return { playhead: parsePlayheadState(payload) };
    return {};
  };

  for (const [name, clickSong] of [
    ['everything on one song', SONG],
    ['the click left on another song', OTHER_SONG],
  ] as const) {
    it(`${name}: click and playhead as before, the count-in does nothing`, async () => {
      const theClick = { ...click, songId: clickSong };
      const frame = (await encodeLive(9, { [CLICK_EVENT]: clickWire(theClick), [PLAYHEAD_EVENT]: playhead, [COUNTIN_EVENT]: countInBleWire(heavy) }, KEY))!;
      const got = (await releasedDecodeLive(frame, KEY))!;
      expect(got).not.toBeNull();
      const applied = Object.entries(got.events).map(([e, p]) => releasedDispatch(e as LiveEvent, p));
      expect(applied).toContainEqual({ click: theClick });
      expect(applied).toContainEqual({ playhead });
      // The count-in is in the frame, and the released dispatch has no branch for it.
      expect(got.events.countin).toBeDefined();
      expect(releasedDispatch(COUNTIN_EVENT, got.events.countin)).toEqual({});
      // Were a later app to read it with the channel's parser, it would be dropped whole, never half-read.
      expect(parseCountInState(got.events.countin)).toBeNull();
    });
  }
});

describe('count-in over Bluetooth: fresh, or not shown', () => {
  const plan = countInPlan(plain);
  it('live from the tap to the end of GO, on the leader’s clock', () => {
    // The tap: the count starts COUNTIN_LEAD_MS later.
    expect(countInWindow(plain, plain.startAt - COUNTIN_LEAD_MS)).toBe('live');
    expect(countInWindow(plain, plain.startAt)).toBe('live');
    expect(countInWindow(plain, plain.startAt + plan.goAt + GO_MS - 1)).toBe('live');
    expect(countInWindow(plain, plain.startAt + plan.goAt + GO_MS)).toBe('over');
    // Exactly when the countdown itself says it is done.
    expect(countInAt(plan, plain, plain.startAt + plan.goAt + GO_MS).stage).toBe('done');
    expect(countInAt(plan, plain, plain.startAt + plan.goAt + GO_MS - 1).stage).toBe('go');
  });

  it('a start further ahead than a tap can put it is not a count-in', () => {
    expect(countInWindow(plain, plain.startAt - COUNTIN_LEAD_MS - COUNTIN_AHEAD_SLACK_MS)).toBe('live');
    expect(countInWindow(plain, plain.startAt - COUNTIN_LEAD_MS - COUNTIN_AHEAD_SLACK_MS - 1)).toBe('ahead');
    expect(countInWindow(plain, plain.startAt - 60_000)).toBe('ahead');
  });

  it('a pickup ends with bar 1, not with GO', () => {
    const pickup = startCountIn({ from: LEADER, songId: SONG, bpm: 60, meter: meterOf('4/4'), pickup: 2, now: NOW });
    const p = countInPlan(pickup);
    expect(p.endAt).toBeGreaterThan(p.goAt + GO_MS);
    expect(countInWindow(pickup, pickup.startAt + p.goAt + GO_MS)).toBe('live');
    expect(countInWindow(pickup, pickup.startAt + p.endAt)).toBe('over');
  });
});
