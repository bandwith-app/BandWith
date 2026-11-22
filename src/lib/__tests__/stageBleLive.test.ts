import { describe, expect, it } from 'vitest';
import { toBase64 } from '../stageBle';
import { LIVE_MAX_BYTES, STAGE_BLE_SYNC_VERSION, decodeClock, decodeLive, encodeClock, encodeLive } from '../stageBleSync';
import { CLICK_EVENT, clickWire, parseClickState, type ClickState } from '../stageClick';
import { PLAYHEAD_EVENT, parsePlayheadState, type PlayheadState } from '../playhead';

// jsdom has no WebCrypto; the app runs where it does (WKWebView, Android WebView).
const nodeCrypto = 'node:crypto';
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = (await import(/* @vite-ignore */ nodeCrypto)) as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const KEY = toBase64(new Uint8Array(32).map((_, i) => i * 7));
const OTHER_KEY = toBase64(new Uint8Array(32).map((_, i) => 255 - i));
const SONG = '0f8fad5b-d9cb-469f-a165-70867728950e';

// The worst realistic case: 7/8 click with groups, a held playhead at 80 %.
const click: ClickState = {
  seq: 4_000_000_001,
  from: 'k3j9x0ab',
  on: true,
  bpm: 240,
  beats: 7,
  bars: null,
  groups: [2, 2, 3],
  startAt: 1_795_000_000_123.4567,
  songId: SONG,
};
const playhead: PlayheadState = {
  seq: 4_000_000_002,
  from: 'k3j9x0ab',
  songId: SONG,
  on: true,
  bpm: 96.5,
  speed: 0.8,
  bar: 1200,
  startAt: 1_795_000_000_456.789,
  hold: [1196, 1199],
};
/** About what D1's count-in will weigh. */
const countin = { seq: 4_000_000_003, from: 'k3j9x0ab', songId: SONG, startAt: 1_795_000_000_999.25, bars: 2, half: true, voice: 'it', beats: 7, groups: [2, 2, 3] };

describe('live frame (click, playhead, count-in) over Bluetooth', () => {
  it('carries the same click and playhead states as the Realtime channel', async () => {
    // The click travels in its wire form (clickWire), as on the channel.
    const bytes = (await encodeLive(7, { [CLICK_EVENT]: clickWire(click), [PLAYHEAD_EVENT]: playhead }, KEY))!;
    expect(bytes[0]).toBe(STAGE_BLE_SYNC_VERSION);
    const got = (await decodeLive(bytes, KEY))!;
    expect(got.seq).toBe(7);
    expect(parseClickState(got.events.click)).toEqual(click);
    expect(parsePlayheadState(got.events.playhead)).toEqual(playhead);
  });

  it('keeps a stopped state too, so a member learns the click or the playhead stopped', async () => {
    const off = { ...click, on: false, seq: click.seq + 2 };
    const got = (await decodeLive((await encodeLive(8, { [CLICK_EVENT]: clickWire(off) }, KEY))!, KEY))!;
    expect(parseClickState(got.events.click)).toEqual(off);
    expect(got.events.playhead).toBeUndefined();
  });

  it("fits one characteristic value (512 bytes) with the click, the playhead and a count-in", async () => {
    const bytes = (await encodeLive(9, { click: clickWire(click), playhead, countin }, KEY))!;
    expect(bytes).not.toBeNull();
    expect(bytes.length).toBeLessThanOrEqual(LIVE_MAX_BYTES);
    expect((await decodeLive(bytes, KEY))!.events.countin).toEqual(countin);
  });

  it('refuses to build a frame that would not fit, instead of sending half of one', async () => {
    const huge = { ...countin, voice: 'x'.repeat(600) };
    expect(await encodeLive(10, { countin: huge }, KEY)).toBeNull();
  });

  it('rejects another key, a tampered frame, a clock frame, and a torn read', async () => {
    const bytes = (await encodeLive(11, { click }, KEY))!;
    expect(await decodeLive(bytes, OTHER_KEY)).toBeNull();
    const tampered = bytes.slice();
    tampered[12] ^= 1;
    expect(await decodeLive(tampered, KEY)).toBeNull();
    // Half of a long read (the value changed between the two parts).
    expect(await decodeLive(bytes.slice(0, 20), KEY)).toBeNull();
    const clockFrame = await encodeClock(1000, KEY);
    expect(await decodeLive(clockFrame, KEY)).toBeNull();
    // …and a live frame is never mistaken for a clock reading.
    expect(await decodeClock(bytes, KEY)).toBeNull();
  });

  it('drops events this app does not know (a newer leader), keeps the rest', async () => {
    const bytes = (await encodeLive(12, { click, lights: { on: true } } as never, KEY))!;
    const got = (await decodeLive(bytes, KEY))!;
    expect(Object.keys(got.events)).toEqual(['click']);
  });

  it('an empty frame (nothing playing yet) is valid', async () => {
    const got = (await decodeLive((await encodeLive(1, {}, KEY))!, KEY))!;
    expect(got.events).toEqual({});
  });
});
