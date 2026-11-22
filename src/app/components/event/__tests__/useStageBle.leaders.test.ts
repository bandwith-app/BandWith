import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { encodeStageState, toBase64, STAGE_BLE_CHARACTERISTIC } from '@/lib/stageBle';
import type { StageLiveState } from '@/lib/stageLive';

// jsdom has no WebCrypto; the app runs where it does (WKWebView, Android WebView).
const nodeCrypto = 'node:crypto';
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = (await import(/* @vite-ignore */ nodeCrypto)) as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const KEY = toBase64(new Uint8Array(32).map((_, i) => i * 5));
const IDS = ['a1', 'b2', 'c3'];

/**
 * Two admins' phones advertising the same gig (audit #10). `state` is what
 * each serves (null: Stage open, nothing led yet, an empty value).
 */
const air = vi.hoisted(() => ({
  devices: new Map<string, { state: unknown; advertising: boolean }>(),
  connects: [] as string[],
  connected: new Set<string>(),
}));

vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {
    initialize: vi.fn(async () => {}),
    isEnabled: vi.fn(async () => true),
    requestLEScan: vi.fn(async (_o: unknown, cb: (r: { device: { deviceId: string } }) => void) => {
      let i = 0;
      for (const [id, d] of air.devices) if (d.advertising) setTimeout(() => cb({ device: { deviceId: id } }), 5 * ++i);
    }),
    stopLEScan: vi.fn(async () => {}),
    connect: vi.fn(async (id: string) => {
      air.connects.push(id);
      air.connected.add(id);
    }),
    disconnect: vi.fn(async (id: string) => void air.connected.delete(id)),
    requestConnectionPriority: vi.fn(async () => {}),
    startNotifications: vi.fn(async () => {}),
    read: vi.fn(async (id: string, _s: string, char: string) => {
      if (char !== STAGE_BLE_CHARACTERISTIC) throw new Error('Characteristic not found.');
      const st = air.devices.get(id)?.state as StageLiveState | null;
      if (!st) return new DataView(new ArrayBuffer(0));
      const bytes = (await encodeStageState(st, IDS, KEY))!;
      return new DataView(bytes.buffer);
    }),
    startEnabledNotifications: vi.fn(async () => {}),
    stopEnabledNotifications: vi.fn(async () => {}),
  },
  ConnectionPriority: { CONNECTION_PRIORITY_HIGH: 1 },
}));

vi.mock('@/lib/stageBleNative', () => ({
  StageBle: {},
  stageBleAvailable: () => true,
  stageKey: async () => KEY,
  stageVerifyKey: async () => null,
  stageSigner: async () => null,
}));

const { useStageBle, LEADER_CHECK_MS, forgetSignedLeaders } = await import('../useStageBle');

const lead = (id: string, seq: number, songId: string): StageLiveState => ({ seq, from: id, songId, order: null });

beforeEach(() => {
  forgetSignedLeaders();
  air.devices.clear();
  air.connects = [];
  air.connected.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

describe('useStageBle: two admins in Stage (audit #10)', () => {
  it("an idle admin's phone (nothing led) does not keep the member: it moves to the admin who leads", async () => {
    air.devices.set('admin-b', { state: null, advertising: true });
    const onState = vi.fn();
    const { unmount } = renderHook(() => useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState }));
    await waitFor(() => expect(air.connects).toEqual(['admin-b']));
    // Admin A opens Stage and leads.
    air.devices.set('admin-a', { state: lead('a', 9, 'c3'), advertising: true });
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS);
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a', songId: 'c3' })));
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-a'])));
    unmount();
  });

  it('both have led: the member follows the one whose state is newer, and stays put otherwise', async () => {
    air.devices.set('admin-b', { state: lead('b', 3, 'a1'), advertising: true });
    const onState = vi.fn();
    const { unmount } = renderHook(() => useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState }));
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'b' })));
    // A's state is older than B's: stay with B.
    air.devices.set('admin-a', { state: lead('a', 2, 'b2'), advertising: true });
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS);
    await vi.advanceTimersByTimeAsync(3000);
    // Only a short look at A (read, then let go).
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-b'])));
    expect(air.connects.filter((d) => d === 'admin-a').length).toBe(1);
    expect(onState).not.toHaveBeenCalledWith(expect.objectContaining({ from: 'a' }));
    // Now A moves (newer): the member follows A.
    air.devices.get('admin-a')!.state = lead('a', 12, 'b2');
    // The next look (30 s after the last one, then a 2 s scan).
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a', seq: 12 })));
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-a'])));
    unmount();
  });

  it('one leader only: no extra connections', async () => {
    air.devices.set('admin-a', { state: lead('a', 4, 'a1'), advertising: true });
    const { unmount } = renderHook(() => useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState: () => {} }));
    await waitFor(() => expect(air.connects).toEqual(['admin-a']));
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS * 2);
    expect(air.connects).toEqual(['admin-a']);
    unmount();
  });
});
