import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { toBase64 } from '@/lib/stageBle';

// jsdom has no WebCrypto; the app runs where it does (WKWebView, Android WebView).
const nodeCrypto = 'node:crypto';
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = (await import(/* @vite-ignore */ nodeCrypto)) as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const KEY = toBase64(new Uint8Array(32).map((_, i) => i * 5));
const NEW_KEY = toBase64(new Uint8Array(32).map((_, i) => i * 7 + 1));
const IDS = ['a1', 'b2'];

const env = vi.hoisted(() => ({
  platform: 'ios',
  initError: null as string | null,
  enabled: true,
  startState: 'on',
  stateCb: null as null | ((d: { state: string; subscribers: number }) => void),
  resumeCb: null as null | (() => void),
}));

vi.mock('@capacitor/core', async (orig) => {
  const real = (await orig()) as typeof import('@capacitor/core');
  return { ...real, Capacitor: { ...real.Capacitor, getPlatform: () => env.platform } };
});

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (_e: string, cb: () => void) => {
      env.resumeCb = cb;
      return { remove: async () => {} };
    }),
  },
}));

const ble = vi.hoisted(() => ({
  initialize: vi.fn(async () => {
    if (env.initError) throw new Error(env.initError);
  }),
  isEnabled: vi.fn(async () => env.enabled),
  requestEnable: vi.fn(async () => {
    env.enabled = true;
  }),
  openAppSettings: vi.fn(async () => {}),
  startEnabledNotifications: vi.fn(async () => {}),
  stopEnabledNotifications: vi.fn(async () => {}),
  requestLEScan: vi.fn(async () => {}),
  stopLEScan: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
}));

vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: ble,
  ConnectionPriority: { CONNECTION_PRIORITY_HIGH: 1 },
}));

const native = vi.hoisted(() => ({
  start: vi.fn(async () => ({ state: env.startState })),
  update: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  now: vi.fn(async () => ({ now: 0 })),
  setClock: vi.fn(async () => {}),
  addListener: vi.fn(async (_e: string, cb: (d: { state: string; subscribers: number }) => void) => {
    env.stateCb = cb;
    return { remove: async () => {} };
  }),
}));

/** What the server hands out now (null: no key yet, a first fetch still on its way). */
const server = vi.hoisted(() => ({ key: null as string | null, asks: 0, denied: false }));
vi.mock('@/lib/stageBleNative', () => ({
  StageBle: native,
  stageBleAvailable: () => true,
  stageKey: async () => {
    server.asks++;
    return server.denied ? null : server.key;
  },
  // The server's no (this account may no longer see the gig): no key, and nothing kept.
  fetchStageKey: async () => {
    server.asks++;
    return server.denied ? { key: null, denied: true } : { key: server.key, denied: false };
  },
  STAGE_KEY_EVENT: 'bw:stage-key',
  // #288's signed links: no key pair here, so it runs as before (band key only).
  stageVerifyKey: async () => null,
  fetchVerifyKey: async () => ({ answer: null, server: false }),
  forgetStageKeys: () => {},
  keptVerifyKey: () => null,
  stageSigner: async () => null,
  signerRefused: () => false,
  previousStageKey: () => null,
}));

const hook = await import('../useStageBle');
const { useStageBle, KEY_RECHECK_MS } = hook as typeof hook & { KEY_RECHECK_MS: number };

const render = (isLeader: boolean) =>
  renderHook(() => useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader, onState: () => {} }));
const announce = (eventId = 'gig') => window.dispatchEvent(new CustomEvent('bw:stage-key', { detail: eventId }));

beforeEach(() => {
  Object.assign(env, { platform: 'ios', initError: null, enabled: true, startState: 'on', stateCb: null, resumeCb: null });
  Object.assign(server, { key: KEY, asks: 0, denied: false });
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

describe('useStageBle: a band key changed while Stage is open (191; Codex + Claude on 642676fc)', () => {
  it('the leader hears of a new key (Realtime) and starts again with it: the old key\'s service stops', async () => {
    const { result, unmount } = render(true);
    await waitFor(() => expect(result.current.status).toBe('leading'));
    expect(native.start).toHaveBeenCalledTimes(1);
    server.key = NEW_KEY;
    act(() => announce());
    await waitFor(() => expect(native.start).toHaveBeenCalledTimes(2));
    expect(native.stop).toHaveBeenCalled();
    // Another gig's key changing is nothing to this one.
    act(() => announce('other-gig'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(native.start).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('with no message (Realtime down), the leader still finds the new key within a minute or so', async () => {
    const { result, unmount } = render(true);
    await waitFor(() => expect(result.current.status).toBe('leading'));
    server.key = NEW_KEY;
    await vi.advanceTimersByTimeAsync(KEY_RECHECK_MS + 1000);
    await waitFor(() => expect(native.start).toHaveBeenCalledTimes(2));
    unmount();
  });

  it('the same key at a check: nothing starts again', async () => {
    const { result, unmount } = render(true);
    await waitFor(() => expect(result.current.status).toBe('leading'));
    await vi.advanceTimersByTimeAsync(KEY_RECHECK_MS * 2 + 1000);
    act(() => announce());
    await vi.advanceTimersByTimeAsync(1000);
    expect(native.start).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("a first key fetch answered late (after the 4 s wait): the leader starts as soon as it's there (Codex M1)", async () => {
    server.key = null;
    const { result, unmount } = render(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(native.start).not.toHaveBeenCalled();
    server.key = KEY;
    await vi.advanceTimersByTimeAsync(6000);
    await waitFor(() => expect(result.current.status).toBe('leading'));
    unmount();
  });

  it("removed from the band: the server's no stops the leader at once, it doesn't serve the old key until a later check (Claude round 8 on #283)", async () => {
    const { result, unmount } = render(true);
    await waitFor(() => expect(result.current.status).toBe('leading'));
    server.denied = true;
    act(() => announce());
    await waitFor(() => expect(native.stop).toHaveBeenCalled());
    await waitFor(() => expect(result.current.status).toBe('off'));
    await vi.advanceTimersByTimeAsync(KEY_RECHECK_MS * 2);
    expect(native.start).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("removed from the band: the server's no stops a member's search at once (Claude round 8 on #283)", async () => {
    const { result, unmount } = render(false);
    await waitFor(() => expect(result.current.status).toBe('searching'));
    server.denied = true;
    act(() => announce());
    await waitFor(() => expect(ble.stopLEScan).toHaveBeenCalled());
    await waitFor(() => expect(result.current.status).toBe('off'));
    const scans = ble.requestLEScan.mock.calls.length;
    await vi.advanceTimersByTimeAsync(KEY_RECHECK_MS * 2);
    expect(ble.requestLEScan.mock.calls.length).toBe(scans);
    unmount();
  });

  it("Bluetooth turned off and on after the server's no: the member's search never starts again with the key it had (Claude round 8 on #283)", async () => {
    const { result, unmount } = render(false);
    await waitFor(() => expect(result.current.status).toBe('searching'));
    const radio = (ble.startEnabledNotifications.mock.calls[0] as unknown as [(on: boolean) => void])[0];
    server.denied = true;
    act(() => radio(false));
    await waitFor(() => expect(result.current.status).toBe('bt-off'));
    const scans = ble.requestLEScan.mock.calls.length;
    act(() => radio(true));
    // Real time: the service id is a WebCrypto digest.
    await new Promise((r) => setTimeout(r, 1500));
    expect(ble.requestLEScan.mock.calls.length).toBe(scans);
    unmount();
  });

  it('a member hears of a new key and searches again under it', async () => {
    const { result, unmount } = render(false);
    await waitFor(() => expect(result.current.status).toBe('searching'));
    const scans = ble.requestLEScan.mock.calls.length;
    server.key = NEW_KEY;
    act(() => announce());
    await waitFor(() => expect(ble.requestLEScan.mock.calls.length).toBeGreaterThan(scans));
    const services = (ble.requestLEScan.mock.calls[ble.requestLEScan.mock.calls.length - 1] as unknown as [{ services: string[] }])[0].services;
    const first = (ble.requestLEScan.mock.calls[0] as unknown as [{ services: string[] }])[0].services;
    expect(services).not.toEqual(first);
    unmount();
  });
});
