import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { toBase64 } from '@/lib/stageBle';

// jsdom has no WebCrypto; the app runs where it does (WKWebView, Android WebView).
const nodeCrypto = 'node:crypto';
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = (await import(/* @vite-ignore */ nodeCrypto)) as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const KEY = toBase64(new Uint8Array(32).map((_, i) => i * 5));
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
  BluetoothLe: { disconnect: vi.fn(async () => {}) },
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

vi.mock('@/lib/stageBleNative', () => ({ STAGE_KEY_EVENT: 'bw:stage-key', StageBle: native, stageBleAvailable: () => true, stageKey: async () => KEY, stageVerifyKey: async () => null, fetchVerifyKey: async () => ({ answer: null, server: false }), forgetStageKeys: () => {}, keptVerifyKey: () => null, stageSigner: async () => null, signerRefused: () => false, previousStageKey: () => null, }));

const { useStageBle, forgetSignedLeaders, forgetScanStarts } = await import('../useStageBle');

const render = (isLeader: boolean) =>
  renderHook(() => useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader, onState: () => {} }));

beforeEach(() => {
  forgetSignedLeaders();
  forgetScanStarts();
  Object.assign(env, { platform: 'ios', initError: null, enabled: true, startState: 'on', stateCb: null, resumeCb: null });
  vi.clearAllMocks();
});

describe('useStageBle status in plain terms', () => {
  it('member without permission: "denied"; on iPhone the button opens Settings', async () => {
    env.initError = 'BLE permission denied';
    const { result, unmount } = render(false);
    await waitFor(() => expect(result.current.status).toBe('denied'));
    await act(() => result.current.fix());
    expect(ble.openAppSettings).toHaveBeenCalled();
    unmount();
  });

  it('member, permission granted in Settings: back in the app, it starts by itself', async () => {
    env.initError = 'BLE permission denied';
    const { result, unmount } = render(false);
    await waitFor(() => expect(result.current.status).toBe('denied'));
    await act(() => result.current.fix());
    env.initError = null;
    act(() => env.resumeCb?.());
    await waitFor(() => expect(result.current.status).toBe('searching'));
    unmount();
  });

  it('closing the system permission dialog (the app resumes) does not ask a second time', async () => {
    env.platform = 'android';
    env.initError = 'Permission denied.';
    const { result, unmount } = render(false);
    await waitFor(() => expect(result.current.status).toBe('denied'));
    const asked = ble.initialize.mock.calls.length;
    act(() => env.resumeCb?.());
    await new Promise((r) => setTimeout(r, 100));
    expect(ble.initialize.mock.calls.length).toBe(asked);
    expect(result.current.status).toBe('denied');
    unmount();
  });

  it('member on Android without permission: the button asks again first', async () => {
    env.platform = 'android';
    env.initError = 'Permission denied.';
    const { result, unmount } = render(false);
    await waitFor(() => expect(result.current.status).toBe('denied'));
    env.initError = null;
    await act(() => result.current.fix());
    await waitFor(() => expect(result.current.status).toBe('searching'));
    expect(ble.openAppSettings).not.toHaveBeenCalled();
    unmount();
  });

  it('a phone without Bluetooth LE: "unsupported", no button', async () => {
    env.initError = 'BLE unsupported';
    const { result, unmount } = render(false);
    await waitFor(() => expect(result.current.status).toBe('unsupported'));
    unmount();
  });

  it('Bluetooth off: "bt-off"; on Android the button turns it on', async () => {
    env.platform = 'android';
    env.enabled = false;
    const { result, unmount } = render(false);
    await waitFor(() => expect(result.current.status).toBe('bt-off'));
    await act(() => result.current.fix());
    expect(ble.requestEnable).toHaveBeenCalled();
    await waitFor(() => expect(result.current.status).toBe('searching'));
    unmount();
  });

  it('leader: counts the phones linked to it', async () => {
    const { result, unmount } = render(true);
    await waitFor(() => expect(result.current.status).toBe('leading'));
    act(() => env.stateCb?.({ state: 'on', subscribers: 3 }));
    expect(result.current.followers).toBe(3);
    act(() => env.stateCb?.({ state: 'off', subscribers: 0 }));
    expect(result.current.status).toBe('bt-off');
    unmount();
  });

  it('leader without permission: "denied"; on Android the button asks again', async () => {
    env.platform = 'android';
    env.startState = 'unauthorized';
    const { result, unmount } = render(true);
    await waitFor(() => expect(result.current.status).toBe('denied'));
    env.startState = 'on';
    await act(() => result.current.fix());
    await waitFor(() => expect(result.current.status).toBe('leading'));
    expect(native.start).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('leader on a phone that cannot lead: "unsupported"', async () => {
    env.startState = 'unsupported';
    const { result, unmount } = render(true);
    await waitFor(() => expect(result.current.status).toBe('unsupported'));
    unmount();
  });
});
