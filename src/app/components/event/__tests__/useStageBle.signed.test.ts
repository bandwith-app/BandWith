import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  STAGE_BLE_CHARACTERISTIC,
  STAGE_BLE_SIGNED_CHARACTERISTIC,
  decodeSignedState,
  decodeStageState,
  encodeSignedState,
  encodeStageState,
  fromBase64,
  toBase64,
} from '@/lib/stageBle';
import { generateSigner, type StageKeyPair } from '@/lib/stageSign';
import type { StageLiveState } from '@/lib/stageLive';

// jsdom has no WebCrypto; the app runs where it does (WKWebView, Android WebView).
const nodeCrypto = 'node:crypto';
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = (await import(/* @vite-ignore */ nodeCrypto)) as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const KEY = toBase64(new Uint8Array(32).map((_, i) => i * 7));
const IDS = ['a1', 'b2', 'c3'];

/**
 * Phones advertising the gig (audit #1):
 * - 'new': an admin on this app, serving the HMAC state for older apps and the signed state;
 * - 'old': an admin on an app from before signing (HMAC state only);
 * - `signer`: whose key signs its signed state (a member's own key = a forgery).
 */
type Kind = 'new' | 'old';
const air = vi.hoisted(() => ({
  devices: new Map<string, { kind: 'new' | 'old'; state: unknown; signer?: { private: string; public: string }; version?: number }>(),
  connects: [] as string[],
  connected: new Set<string>(),
  reads: [] as string[],
  /** The server's answer for the public key (what stageVerifyKey returns: the kept copy when offline). */
  verify: null as { public: string; version: number } | null,
  /** The copy kept on the phone (what Stage starts with). */
  kept: null as { public: string; version: number } | null,
  signer: null as { private: string; public: string; version: number } | null,
  started: [] as Record<string, unknown>[],
  updates: [] as { value: string; notify: string }[],
  signedUpdates: [] as { value: string; notify: string }[],
  goodbyes: new Map<string, () => void>(),
}));

vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {
    initialize: vi.fn(async () => {}),
    isEnabled: vi.fn(async () => true),
    requestLEScan: vi.fn(async (_o: unknown, cb: (r: { device: { deviceId: string } }) => void) => {
      let i = 0;
      for (const id of air.devices.keys()) setTimeout(() => cb({ device: { deviceId: id } }), 5 * ++i);
    }),
    stopLEScan: vi.fn(async () => {}),
    connect: vi.fn(async (id: string, cb: () => void) => {
      air.goodbyes.set(id, cb);
      air.connects.push(id);
      air.connected.add(id);
    }),
    disconnect: vi.fn(async (id: string) => void air.connected.delete(id)),
    requestConnectionPriority: vi.fn(async () => {}),
    getServices: vi.fn(async (id: string) => {
      const d = air.devices.get(id);
      const chars = d?.kind === 'new' ? [STAGE_BLE_CHARACTERISTIC, STAGE_BLE_SIGNED_CHARACTERISTIC] : [STAGE_BLE_CHARACTERISTIC];
      return [{ uuid: 'any', characteristics: chars.map((uuid) => ({ uuid, properties: {}, descriptors: [] })) }];
    }),
    startNotifications: vi.fn(async (id: string, _s: string, char: string) => {
      if (char === STAGE_BLE_SIGNED_CHARACTERISTIC && air.devices.get(id)?.kind !== 'new') throw new Error('Characteristic not found.');
    }),
    read: vi.fn(async (id: string, _s: string, char: string) => {
      air.reads.push(`${id}:${char.slice(0, 8)}`);
      const d = air.devices.get(id)!;
      const st = d.state as StageLiveState | null;
      if (char === STAGE_BLE_CHARACTERISTIC) {
        if (!st) return new DataView(new ArrayBuffer(0));
        return new DataView((await encodeStageState(st, IDS, KEY))!.buffer);
      }
      if (char === STAGE_BLE_SIGNED_CHARACTERISTIC && d.kind === 'new') {
        if (!st || !d.signer) return new DataView(new ArrayBuffer(0));
        return new DataView((await encodeSignedState(st, IDS, d.signer.private, d.version ?? 1))!.buffer);
      }
      throw new Error('Characteristic not found.');
    }),
    startEnabledNotifications: vi.fn(async () => {}),
    stopEnabledNotifications: vi.fn(async () => {}),
  },
  ConnectionPriority: { CONNECTION_PRIORITY_HIGH: 1 },
}));

vi.mock('@/lib/stageBleNative', () => ({
  StageBle: {
    addListener: vi.fn(async () => ({ remove: async () => {} })),
    start: vi.fn(async (o: Record<string, unknown>) => {
      air.started.push(o);
      return { state: 'on' };
    }),
    update: vi.fn(async (o: { value: string; notify: string }) => void air.updates.push(o)),
    updateSigned: vi.fn(async (o: { value: string; notify: string }) => void air.signedUpdates.push(o)),
    updateLive: vi.fn(async () => {}),
    now: vi.fn(async () => ({ now: 1000 })),
    setClock: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  },
  stageBleAvailable: () => true,
  stageKey: async () => KEY,
  stageVerifyKey: async () => air.verify,
  keptVerifyKey: () => air.kept,
  stageSigner: async () => air.signer,
}));

const stageBleHook = await import('../useStageBle');
const { useStageBle, LEADER_CHECK_MS } = stageBleHook;

const lead = (from: string, seq: number, songId: string): StageLiveState => ({ seq, from, songId, order: null });
let admins: StageKeyPair;
const put = (id: string, kind: Kind, state: StageLiveState | null, signer?: StageKeyPair, version = 1) =>
  air.devices.set(id, { kind, state, signer, version });
const member = (onState = vi.fn()) => ({
  onState,
  hook: renderHook(() => useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState })),
});

beforeEach(async () => {
  admins ??= await generateSigner();
  air.devices.clear();
  air.connects = [];
  air.connected.clear();
  air.reads = [];
  air.verify = { public: admins.public, version: 1 };
  air.kept = air.verify;
  air.signer = null;
  air.started = [];
  air.updates = [];
  air.signedUpdates = [];
  air.goodbyes.clear();
  (stageBleHook as { forgetSignedLeaders?: () => void }).forgetSignedLeaders?.();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

describe('useStageBle: only an admin can lead (audit #1)', () => {
  it('new leader + new member: the member follows the signed state, never the band-key one', async () => {
    put('admin', 'new', lead('a', 5, 'b2'), admins);
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a', songId: 'b2' })));
    expect(hook.result.current.status).toBe('connected');
    expect(air.reads.some((r) => r.endsWith(STAGE_BLE_CHARACTERISTIC.slice(0, 8)))).toBe(false);
    hook.unmount();
  });

  it("old leader + new member: the member still follows, with a plain note that the leader's app is out of date", async () => {
    put('admin', 'old', lead('a', 5, 'c3'));
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a', songId: 'c3' })));
    await waitFor(() => expect(hook.result.current.status).toBe('old-leader'));
    hook.unmount();
  });

  it('a member with only the public key cannot pose as the leader', async () => {
    // A member's own key pair (it can make one, but not the admins' private key).
    const own = await generateSigner();
    put('member-x', 'new', lead('x', 50, 'c3'), own);
    const { onState, hook } = member();
    await waitFor(() => expect(air.connects).toContain('member-x'));
    await vi.advanceTimersByTimeAsync(3000);
    // Its signature fails twice (once could be a read caught mid-change): it is left and skipped.
    await waitFor(() => expect(hook.result.current.status).toBe('searching'));
    await waitFor(() => expect(air.connected.size).toBe(0));
    await vi.advanceTimersByTimeAsync(5000);
    expect(air.connects).toEqual(['member-x']);
    expect(onState).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("a member posing as an old leader (band key) never wins over the admins' signed leader", async () => {
    put('admin', 'new', lead('a', 5, 'a1'), admins);
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' })));
    // A newer state, made with the band key every member holds.
    put('member-x', 'old', lead('x', 99, 'c3'));
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    expect(onState).not.toHaveBeenCalledWith(expect.objectContaining({ from: 'x' }));
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin'])));
    hook.unmount();
  });

  it('the signed leader wins over an old leader found first', async () => {
    put('old-admin', 'old', lead('o', 9, 'a1'));
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'o' })));
    put('admin', 'new', lead('a', 4, 'b2'), admins);
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    // Its seq is lower: it applies all the same (a reset).
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' }), true));
    await waitFor(() => expect(hook.result.current.status).toBe('connected'));
    hook.unmount();
  });

  it('no public key yet on this phone (none made when it was online): it follows the band-key state, no note', async () => {
    air.verify = null;
    air.kept = null;
    put('admin', 'new', lead('a', 5, 'b2'), admins);
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ songId: 'b2' })));
    expect(hook.result.current.status).toBe('connected');
    hook.unmount();
  });

  it('new leader + old member: the leader serves the band-key state for older apps and the signed state', async () => {
    air.signer = { ...admins, version: 1 };
    const { result, unmount } = renderHook(() => useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: true, onState: () => {} }));
    await waitFor(() => expect(air.started.length).toBe(1));
    expect(air.started[0]).toMatchObject({
      characteristicUuid: STAGE_BLE_CHARACTERISTIC,
      signedUuid: STAGE_BLE_SIGNED_CHARACTERISTIC,
      signKey: admins.private,
    });
    // The band key never goes to the plugin any more (nothing is signed with it natively).
    expect(air.started[0]).not.toHaveProperty('key');
    await waitFor(() => expect(result.current.status).toBe('leading'));
    result.current.publish(lead('a', 7, 'c3'));
    await waitFor(() => expect(air.signedUpdates.length).toBe(1));
    // An older app reads b7d50001 as before.
    const old = await decodeStageState(fromBase64(air.updates[0].value), IDS, KEY);
    expect(old).toMatchObject({ ok: true, state: { songId: 'c3', seq: 7 } });
    const signed = await decodeSignedState(fromBase64(air.signedUpdates[0].value), IDS, admins.public, 1);
    expect(signed).toMatchObject({ ok: true, state: { songId: 'c3', seq: 7 } });
    expect(air.signedUpdates[0].notify).toBe(air.updates[0].notify);
    unmount();
  });

  it('an admin offline before the key pair was made still leads older-style: no signed state, no clock', async () => {
    air.signer = null;
    const { result, unmount } = renderHook(() => useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: true, onState: () => {} }));
    await waitFor(() => expect(air.started.length).toBe(1));
    expect(air.started[0]).not.toHaveProperty('signedUuid');
    expect(air.started[0]).not.toHaveProperty('clockUuid');
    result.current.publish(lead('a', 7, 'c3'));
    await waitFor(() => expect(air.updates.length).toBe(1));
    expect(air.signedUpdates.length).toBe(0);
    unmount();
  });
});

/** Real time for WebCrypto (fake timers don't wait for it): long enough for a link and a read. */
const settle = async () => {
  await waitFor(() => expect(air.connects).toContain('member-x'));
  await new Promise((r) => setTimeout(r, 600));
};

/** A phone walks out of range: its link drops. */
const gone = (id: string) => {
  air.devices.delete(id);
  air.connected.delete(id);
  air.goodbyes.get(id)?.();
};

describe('useStageBle: band-key states once the admins signed (Codex on #288)', () => {
  it('after a signed leader, a band-key phone is refused, even with the admin out of range', async () => {
    put('admin', 'new', lead('a', 5, 'a1'), admins);
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' })));
    gone('admin');
    put('member-x', 'old', lead('x', 99, 'c3'));
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(onState).not.toHaveBeenCalledWith(expect.objectContaining({ from: 'x' }));
    expect(hook.result.current.status).toBe('searching');
    hook.unmount();
  });

  it('the refusal lasts across closing and opening Stage again', async () => {
    put('admin', 'new', lead('a', 5, 'a1'), admins);
    const first = member();
    await waitFor(() => expect(first.onState).toHaveBeenCalled());
    first.hook.unmount();
    gone('admin');
    put('member-x', 'old', lead('x', 99, 'c3'));
    const { onState, hook } = member();
    await settle();
    expect(onState).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe('searching');
    hook.unmount();
  });

  it('ten minutes with no signed state: an older-app leader is followed again (with the update note)', async () => {
    put('admin', 'new', lead('a', 5, 'a1'), admins);
    const first = member();
    await waitFor(() => expect(first.onState).toHaveBeenCalled());
    first.hook.unmount();
    gone('admin');
    vi.setSystemTime(Date.now() + stageBleHook.SIGNED_TRUST_MS + 1000);
    put('old-admin', 'old', lead('o', 99, 'c3'));
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'o' })));
    await waitFor(() => expect(hook.result.current.status).toBe('old-leader'));
    hook.unmount();
  });

  it('moving from a band-key leader to the signed one asks for a reset: the signed song applies with a lower seq', async () => {
    put('old-admin', 'old', lead('o', 9, 'a1'));
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'o' })));
    put('admin', 'new', lead('a', 4, 'b2'), admins);
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a', seq: 4 }), true));
    hook.unmount();
  });

  it('a signed admin who leads nothing does not keep the member from a band-key leader (none signed seen yet)', async () => {
    put('admin', 'new', null, admins);
    const { onState, hook } = member();
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin'])));
    put('old-admin', 'old', lead('o', 9, 'c3'));
    await vi.advanceTimersByTimeAsync(20_000);
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'o' })));
    hook.unmount();
  });
});

describe('useStageBle: the pair rotated after an admin stopped being one (Codex on #288)', () => {
  it('this phone kept the old public key: online, it fetches the new one and follows', async () => {
    const before = await generateSigner();
    air.kept = { public: before.public, version: 1 };
    air.verify = { public: admins.public, version: 2 };
    put('admin', 'new', lead('a', 5, 'b2'), admins, 2);
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a', songId: 'b2' })));
    expect(hook.result.current.status).toBe('connected');
    hook.unmount();
  });

  it('offline with the old key: the leader is not taken for a forger, and one line asks to go online once', async () => {
    const before = await generateSigner();
    air.kept = { public: before.public, version: 1 };
    air.verify = air.kept; // offline: the kept copy
    put('admin', 'new', lead('a', 5, 'b2'), admins, 2);
    const { onState, hook } = member();
    await waitFor(() => expect(hook.result.current.status).toBe('stale-key'));
    // It stays (not flashing back to "searching"), and the leader is tried again, not skipped for a minute.
    await vi.advanceTimersByTimeAsync(12_000);
    expect(hook.result.current.status).toBe('stale-key');
    expect(air.connects.filter((c) => c === 'admin').length).toBeGreaterThan(1);
    expect(onState).not.toHaveBeenCalled();
    // Back online: the new key, and the member follows.
    air.verify = { public: admins.public, version: 2 };
    await vi.advanceTimersByTimeAsync(8_000);
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' })));
    await waitFor(() => expect(hook.result.current.status).toBe('connected'));
    hook.unmount();
  });

  it("a demoted admin's phone, signing with the pair from before, is refused by members with the new key", async () => {
    const before = await generateSigner();
    air.kept = { public: admins.public, version: 2 };
    air.verify = air.kept;
    put('ex-admin', 'new', lead('e', 50, 'c3'), before, 1);
    const { onState, hook } = member();
    await waitFor(() => expect(air.connects).toContain('ex-admin'));
    await vi.advanceTimersByTimeAsync(3000);
    await waitFor(() => expect(air.connected.size).toBe(0));
    await vi.advanceTimersByTimeAsync(5000);
    expect(onState).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe('searching');
    hook.unmount();
  });

  it("the leader signs with its pair's version", async () => {
    air.signer = { ...admins, version: 7 };
    const { result, unmount } = renderHook(() => useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: true, onState: () => {} }));
    await waitFor(() => expect(result.current.status).toBe('leading'));
    result.current.publish(lead('a', 7, 'c3'));
    await waitFor(() => expect(air.signedUpdates.length).toBe(1));
    expect(await decodeSignedState(fromBase64(air.signedUpdates[0].value), IDS, admins.public, 7)).toMatchObject({ ok: true });
    unmount();
  });
});
