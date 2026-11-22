import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
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
import { STAGE_BLE_LIVE_CHARACTERISTIC } from '@/lib/stageBleSync';
import { generateSigner, type StageKeyPair } from '@/lib/stageSign';
import { nextSeq, type StageLiveState } from '@/lib/stageLive';

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
 * - 'nopair': an admin on this app with no key pair yet (offline when it would
 *   have been made): the HMAC state and the live characteristic, nothing signed;
 * - `corrupt`: this many signed reads come back damaged (a read caught mid-change);
 * - `signer`: whose key signs its signed state (a member's own key = a forgery).
 */
type Kind = 'new' | 'old' | 'nopair';
const air = vi.hoisted(() => ({
  devices: new Map<
    string,
    {
      kind: 'new' | 'old' | 'nopair';
      state: unknown;
      signer?: { private: string; public: string };
      version?: number;
      corrupt?: number;
    }
  >(),
  /** This many service listings fail (discovery caught by a dropped packet). */
  servicesFail: 0,
  verifyCalls: 0,
  connects: [] as string[],
  connected: new Set<string>(),
  reads: [] as string[],
  /** The server's answer for the public key (what stageVerifyKey returns: the kept copy when offline). */
  verify: null as { public: string | null; version: number } | null,
  /** The copy kept on the phone (what Stage starts with). */
  kept: null as { public: string | null; version: number } | null,
  signer: null as { private: string; public: string; version: number } | null,
  started: [] as Record<string, unknown>[],
  updates: [] as { value: string; notify: string }[],
  signedUpdates: [] as { value: string; notify: string }[],
  goodbyes: new Map<string, () => void>(),
  /** The change-notice callback of each linked phone (fire it: the leader moved). */
  notify: new Map<string, (v: DataView) => void>(),
  /** Online, the server answered "nothing for you" (not offline): what fetchVerifyKey tells apart. */
  verifyDenied: false,
  /** Gigs whose kept keys the hook dropped. */
  forgotten: [] as string[],
  /** The band key the server hands out now (stageKey). */
  bandKey: '' as string,
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
      if (air.servicesFail > 0) {
        air.servicesFail--;
        throw new Error('discovery failed');
      }
      const d = air.devices.get(id);
      const chars =
        d?.kind === 'new'
          ? [STAGE_BLE_CHARACTERISTIC, STAGE_BLE_LIVE_CHARACTERISTIC, STAGE_BLE_SIGNED_CHARACTERISTIC]
          : d?.kind === 'nopair'
            ? [STAGE_BLE_CHARACTERISTIC, STAGE_BLE_LIVE_CHARACTERISTIC]
            : [STAGE_BLE_CHARACTERISTIC];
      return [{ uuid: 'any', characteristics: chars.map((uuid) => ({ uuid, properties: {}, descriptors: [] })) }];
    }),
    startNotifications: vi.fn(async (id: string, _s: string, char: string, cb: (v: DataView) => void) => {
      if (char === STAGE_BLE_SIGNED_CHARACTERISTIC && air.devices.get(id)?.kind !== 'new') throw new Error('Characteristic not found.');
      air.notify.set(id, cb);
    }),
    read: vi.fn(async (id: string, _s: string, char: string) => {
      air.reads.push(`${id}:${char.slice(0, 8)}`);
      const d = air.devices.get(id)!;
      const st = d.state as StageLiveState | null;
      if (char === STAGE_BLE_CHARACTERISTIC) {
        // Leading nothing yet (seq 0): the band-key state stays empty.
        if (!st || st.seq === 0) return new DataView(new ArrayBuffer(0));
        return new DataView((await encodeStageState(st, IDS, KEY))!.buffer);
      }
      if (char === STAGE_BLE_SIGNED_CHARACTERISTIC && d.kind === 'new') {
        if (!st || !d.signer) return new DataView(new ArrayBuffer(0));
        const frame = (await encodeSignedState(st, IDS, d.signer.private, d.version ?? 1))!;
        if (d.corrupt && d.corrupt-- > 0) frame[frame.length - 1] ^= 0xff;
        return new DataView(frame.buffer);
      }
      throw new Error('Characteristic not found.');
    }),
    startEnabledNotifications: vi.fn(async () => {}),
    stopEnabledNotifications: vi.fn(async () => {}),
  },
  BluetoothLe: { disconnect: vi.fn(async ({ deviceId }: { deviceId: string }) => void air.connected.delete(deviceId)) },
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
  stageKey: async () => air.bandKey || KEY,
  stageVerifyKey: async () => {
    air.verifyCalls++;
    return air.verify;
  },
  // A null answer is "offline" unless the test says the server answered it.
  fetchVerifyKey: async () => {
    air.verifyCalls++;
    return { answer: air.verify, server: air.verify !== null || air.verifyDenied };
  },
  forgetStageKeys: (id: string) => void air.forgotten.push(id),
  keptVerifyKey: () => air.kept,
  stageSigner: async () => air.signer,
}));

const stageBleHook = await import('../useStageBle');
const { useStageBle, LEADER_CHECK_MS, SIGNER_RECHECK_MS } = stageBleHook;

const lead = (from: string, seq: number, songId: string): StageLiveState => ({ seq, from, songId, order: null });
/** An admin's phone in Stage, leading nothing yet: its signed "here" (seq 0). */
const idle = (): StageLiveState => ({ seq: 0, from: '-', songId: null, order: null });
let admins: StageKeyPair;
const put = (id: string, kind: Kind, state: StageLiveState | null, signer?: StageKeyPair, version = 1, corrupt = 0) =>
  air.devices.set(id, { kind, state, signer, version, corrupt });
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
  air.servicesFail = 0;
  air.verifyCalls = 0;
  air.notify.clear();
  air.verifyDenied = false;
  air.forgotten = [];
  air.bandKey = '';
  (stageBleHook as { forgetSignedLeaders?: () => void }).forgetSignedLeaders?.();
  stageBleHook.forgetScanStarts();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

describe('useStageBle: only an admin can lead (audit #1)', () => {
  it('new leader + new member: the member follows the signed state, never the band-key one', async () => {
    put('admin', 'new', lead('a', 5, 'b2'), admins);
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a', songId: 'b2' }), true));
    expect(hook.result.current.status).toBe('connected');
    expect(air.reads.some((r) => r.endsWith(STAGE_BLE_CHARACTERISTIC.slice(0, 8)))).toBe(false);
    hook.unmount();
  });

  it("old leader + new member: the member still follows, with a plain note that the leader's app is out of date", async () => {
    put('admin', 'old', lead('a', 5, 'c3'));
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a', songId: 'c3' })));
    expect(onState).not.toHaveBeenCalledWith(expect.anything(), true);
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
    // Its signature fails three times in a few seconds (once or twice could be reads caught mid-change): it is left and skipped.
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
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' }), true));
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

  it("no public key yet on this phone (none made when it was online): it follows the band-key state, and says the leader isn't verified yet (Claude on #288)", async () => {
    air.verify = null;
    air.kept = null;
    put('admin', 'new', lead('a', 5, 'b2'), admins);
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ songId: 'b2' })));
    // Never plain "connected": the signed state it serves couldn't be checked.
    await waitFor(() => expect(hook.result.current.status).toBe('unverified'));
    hook.unmount();
  });

  it("an admin on this app with no key pair yet: followed, and the line says the leader isn't verified yet, not 'out of date' (Claude on #288)", async () => {
    put('admin', 'nopair', lead('a', 5, 'c3'));
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a', songId: 'c3' })));
    await waitFor(() => expect(hook.result.current.status).toBe('leader-unverified'));
    hook.unmount();
  });

  it("two failed checks in a row don't cut off the real leader (reads caught mid-change) (Claude on #288)", async () => {
    put('admin', 'new', lead('a', 5, 'b2'), admins, 1, 2);
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a', songId: 'b2' }), true), { timeout: 4000 });
    expect(hook.result.current.status).toBe('connected');
    expect(air.connects).toEqual(['admin']);
    hook.unmount();
  });

  it('new leader + old member: the leader serves the band-key state for older apps and the signed state', async () => {
    air.signer = { ...admins, version: 1 };
    const { result, unmount } = renderHook(() => useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: true, onState: () => {} }));
    await waitFor(() => expect(air.started.length).toBe(1));
    // Nothing is served on b7d50002 (the band-key clock builds from before #288 read).
    expect(Object.values(air.started[0])).not.toContain('b7d50002-5b1e-4c6a-9b3d-6e0a2f7c1d42');
    expect(air.started[0]).toMatchObject({
      clockUuid: 'b7d50005-5b1e-4c6a-9b3d-6e0a2f7c1d42',
      characteristicUuid: STAGE_BLE_CHARACTERISTIC,
      signedUuid: STAGE_BLE_SIGNED_CHARACTERISTIC,
      signKey: admins.private,
    });
    // The band key never goes to the plugin any more (nothing is signed with it natively).
    expect(air.started[0]).not.toHaveProperty('key');
    await waitFor(() => expect(result.current.status).toBe('leading'));
    result.current.publish(lead('a', 7, 'c3'));
    // The move (with its change notice), after the leader's signed "here".
    await waitFor(() => expect(air.signedUpdates.some((u) => u.notify !== '')).toBe(true));
    const move = air.signedUpdates.find((u) => u.notify !== '')!;
    // An older app reads b7d50001 as before.
    const old = await decodeStageState(fromBase64(air.updates[0].value), IDS, KEY);
    expect(old).toMatchObject({ ok: true, state: { songId: 'c3', seq: 7 } });
    const signed = await decodeSignedState(fromBase64(move.value), IDS, admins.public, 1);
    expect(signed).toMatchObject({ ok: true, state: { songId: 'c3', seq: 7 } });
    expect(move.notify).toBe(air.updates[0].notify);
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
    // The admin is told (Claude on #288): phones on this app can't check it yet.
    expect(result.current.unsigned).toBe(true);
    unmount();
  });

  it('an admin with a key pair leads signed, and is not told anything about it', async () => {
    air.signer = { ...admins, version: 1 };
    const { result, unmount } = renderHook(() => useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: true, onState: () => {} }));
    await waitFor(() => expect(result.current.status).toBe('leading'));
    expect(result.current.unsigned).toBe(false);
    unmount();
  });
});

describe("useStageBle: the leader re-checks it may sign (Claude on #288)", () => {
  const leader = () => renderHook(() => useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: true, onState: () => {} }));

  it('demoted while Stage is open (online): the next check stops the signed state and the clock', async () => {
    expect(SIGNER_RECHECK_MS).toBe(5 * 60_000);
    air.signer = { ...admins, version: 1 };
    const { result, unmount } = leader();
    await waitFor(() => expect(air.started.length).toBe(1));
    expect(air.started[0]).toHaveProperty('signKey', admins.private);
    // The server says no now (role changed): stageSigner returns null.
    air.signer = null;
    await vi.advanceTimersByTimeAsync(SIGNER_RECHECK_MS + 100);
    await waitFor(() => expect(air.started.length).toBe(2));
    expect(air.started[1]).not.toHaveProperty('signKey');
    air.signedUpdates = [];
    result.current.publish(lead('a', 7, 'c3'));
    await waitFor(() => expect(air.updates.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 200));
    expect(air.signedUpdates.length).toBe(0);
    unmount();
  });

  it('the same pair at the next check: Stage keeps running as it is', async () => {
    air.signer = { ...admins, version: 1 };
    const { unmount } = leader();
    await waitFor(() => expect(air.started.length).toBe(1));
    await vi.advanceTimersByTimeAsync(SIGNER_RECHECK_MS + 100);
    await new Promise((r) => setTimeout(r, 300));
    expect(air.started.length).toBe(1);
    unmount();
  });

  it("a private key that doesn't match the public one is never used to sign", async () => {
    const other = await generateSigner();
    air.signer = { public: admins.public, private: other.private, version: 1 };
    const { unmount } = leader();
    await waitFor(() => expect(air.started.length).toBe(1));
    expect(air.started[0]).not.toHaveProperty('signKey');
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
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' }), true));
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

  it('moving from a band-key leader to the signed one: the signed song is passed on as signed, so it applies with a lower seq', async () => {
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
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a', songId: 'b2' }), true));
    expect(hook.result.current.status).toBe('connected');
    hook.unmount();
  });

  it('offline with the old key: the leader is not followed, with no "band changed" line (anyone can claim a newer pair); online, the new key and the member follows at once (Claude on #288)', async () => {
    const before = await generateSigner();
    air.kept = { public: before.public, version: 1 };
    air.verify = air.kept; // offline: the kept copy
    put('admin', 'new', lead('a', 5, 'b2'), admins, 2);
    const { onState, hook } = member();
    const seen: string[] = [];
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(2_000);
      seen.push(hook.result.current.status);
    }
    expect(seen).not.toContain('stale-key');
    expect(onState).not.toHaveBeenCalled();
    // Back online: the new key (asked for at once), and the member follows without waiting out the skip.
    air.verify = { public: admins.public, version: 2 };
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(8_000);
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' }), true));
    await waitFor(() => expect(hook.result.current.status).toBe('connected'));
    hook.unmount();
  }, 30_000);

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

describe('useStageBle: keys that change while Stage is open (Codex + Claude on #288)', () => {
  const leader = () => renderHook(() => useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: true, onState: () => {} }));
  const online = () => window.dispatchEvent(new Event('online'));

  it('rotated, no new pair yet ("pending"): a band-key phone is refused, and the line says the band changed who can lead (Codex on #288, rule C)', async () => {
    air.verify = { public: null, version: 2 };
    air.kept = air.verify;
    put('old-admin', 'old', lead('x', 9, 'c3'));
    const { onState, hook } = member();
    await waitFor(() => expect(air.connects).toContain('old-admin'));
    await waitFor(() => expect(hook.result.current.status).toBe('stale-key'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(onState).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("pending, then an older key comes back (a slow answer from before the rotation): refused, the old pair's states aren't followed (Codex + Claude on #288)", async () => {
    air.verify = { public: null, version: 2 };
    air.kept = air.verify;
    // The demoted admin's phone, still signing with the old pair (version 1).
    put('demoted', 'new', lead('d', 9, 'c3'), admins, 1);
    const { onState, hook } = member();
    await waitFor(() => expect(hook.result.current.status).toBe('stale-key'));
    air.verify = { public: admins.public, version: 1 };
    const asked = air.verifyCalls;
    online();
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 6000);
    // The signature checks run in real time (WebCrypto).
    await new Promise((r) => setTimeout(r, 2000));
    // The old key was answered (before the fix it was taken, and the demoted phone followed).
    expect(air.verifyCalls).toBeGreaterThan(asked);
    expect(onState).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe('stale-key');
    hook.unmount();
  }, 20_000);

  it('pending, then the new key arrives (online): the member follows the signed leader right away (Codex on #288, rule C)', async () => {
    const next = await generateSigner();
    air.verify = { public: null, version: 2 };
    air.kept = air.verify;
    put('admin', 'new', lead('a', 9, 'c3'), next, 2);
    const { onState, hook } = member();
    await waitFor(() => expect(hook.result.current.status).toBe('stale-key'));
    expect(onState).not.toHaveBeenCalled();
    air.verify = { public: next.public, version: 2 };
    online();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a', seq: 9 }), true), { timeout: 8000 });
    hook.unmount();
  }, 20_000);

  it('a refresh that comes back with nothing (offline) keeps the key this phone checked with: still following signed, a band-key phone still refused (Codex on #288, rule C)', async () => {
    put('admin', 'new', lead('a', 9, 'c3'), admins);
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' }), true));
    air.verify = null;
    online();
    await vi.advanceTimersByTimeAsync(6000);
    // Not relinked to read the band-key state ("not verified"): the key it had still checks.
    expect(air.reads.filter((r) => r.endsWith(':b7d50001'))).toHaveLength(0);
    expect(hook.result.current.status).toBe('connected');
    put('member-x', 'old', lead('x', 99, 'b2'));
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    expect(onState).not.toHaveBeenCalledWith(expect.objectContaining({ from: 'x' }));
    expect(onState).not.toHaveBeenCalledWith(expect.anything(), false);
    hook.unmount();
  }, 20_000);

  it('online, the server says no while this phone holds the key (it may no longer see the gig): it stops following, its kept keys go (Codex on #288)', async () => {
    put('admin', 'new', lead('a', 9, 'c3'), admins);
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' }), true));
    air.verify = null;
    air.verifyDenied = true;
    online();
    await waitFor(() => expect(hook.result.current.status).toBe('off'));
    expect(air.forgotten).toContain('gig');
    onState.mockClear();
    put('admin', 'new', lead('a', 10, 'b2'), admins);
    air.notify.get('admin')?.(new DataView(new ArrayBuffer(4)));
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    await new Promise((r) => setTimeout(r, 1500));
    expect(onState).not.toHaveBeenCalled();
    expect(air.connected.size).toBe(0);
    expect(hook.result.current.status).toBe('off');
    hook.unmount();
  }, 20_000);

  it('the server says no with no key on this phone (no pair made yet): nothing changes, the leader with no pair is followed (Codex on #288)', async () => {
    air.verify = null;
    air.kept = null;
    air.verifyDenied = true;
    put('admin', 'nopair', lead('a', 9, 'c3'));
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a', songId: 'c3' })));
    expect(air.forgotten).toEqual([]);
    expect(hook.result.current.status).not.toBe('off');
    hook.unmount();
  });

  it('a rotation learnt mid-link ("pending" from a newer-pair claim): the signed state is no longer read with no key to check it (Codex on #288)', async () => {
    put('admin', 'new', lead('a', 9, 'c3'), admins, 1);
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' }), true));
    // The band rotated: the leader now signs with a new pair the server doesn't hand out yet.
    const next = await generateSigner();
    put('admin', 'new', lead('a', 10, 'b2'), next, 2);
    air.verify = { public: null, version: 2 };
    await vi.advanceTimersByTimeAsync(31_000);
    const asked = air.verifyCalls;
    air.notify.get('admin')!(new DataView(new ArrayBuffer(4)));
    await waitFor(() => expect(air.verifyCalls).toBeGreaterThan(asked), { timeout: 5000 });
    const from = air.reads.length;
    await vi.advanceTimersByTimeAsync(3000);
    await new Promise((r) => setTimeout(r, 1500));
    expect(air.reads.slice(from).filter((r) => r.endsWith(':b7d50004'))).toEqual([]);
    expect(onState).not.toHaveBeenCalledWith(expect.objectContaining({ songId: 'b2' }), expect.anything());
    hook.unmount();
  }, 20_000);

  it('a band key changed on the server (a member left, 191): the member starts again with the new one (Claude on #288)', async () => {
    put('admin', 'new', lead('a', 9, 'c3'), admins);
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' }), true));
    const links = air.connects.length;
    air.bandKey = 'bmV3LWJhbmQta2V5LTMyLWJ5dGVzLWxvbmctZm9yLXRlc3Q=';
    online();
    // Started again: the old link goes, a new search (on the new key's service) links again.
    await waitFor(() => expect(air.connects.length).toBeGreaterThan(links), { timeout: 5000 });
    hook.unmount();
  }, 20_000);

  it('a band key changed on the server: the leader starts again with the new one (Claude on #288)', async () => {
    air.signer = { ...admins, version: 1 };
    const l = leader();
    await waitFor(() => expect(l.result.current.status).toBe('leading'));
    const starts = air.started.length;
    air.bandKey = 'bmV3LWJhbmQta2V5LTMyLWJ5dGVzLWxvbmctZm9yLXRlc3Q=';
    online();
    await waitFor(() => expect(air.started.length).toBeGreaterThan(starts), { timeout: 5000 });
    l.unmount();
  }, 20_000);

  it('a refused band-key phone is tried again less and less often, at most once a minute (Claude on #288)', async () => {
    air.verify = { public: null, version: 2 };
    air.kept = air.verify;
    put('old-admin', 'old', lead('x', 9, 'c3'));
    const { hook } = member();
    await waitFor(() => expect(air.connects).toContain('old-admin'));
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(30_000);
    // 5 minutes: 30 s each time would be 10 tries; doubling to a minute, about 6.
    const tries = air.connects.filter((c) => c === 'old-admin').length;
    expect(tries).toBeLessThanOrEqual(7);
    expect(tries).toBeGreaterThanOrEqual(3);
    hook.unmount();
  }, 30_000);

  it('linked offline with no public key: once the key arrives (online), the member moves to the signed state', async () => {
    air.verify = null;
    air.kept = null;
    put('admin', 'new', lead('a', 5, 'b2'), admins);
    const { onState, hook } = member();
    await waitFor(() => expect(hook.result.current.status).toBe('unverified'));
    air.verify = { public: admins.public, version: 1 };
    online();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a', songId: 'b2' }), true));
    await waitFor(() => expect(hook.result.current.status).toBe('connected'));
    hook.unmount();
  });

  it('and without an online event: the member asks for the key again on a timer while Stage is open', async () => {
    air.verify = null;
    air.kept = null;
    put('admin', 'new', lead('a', 5, 'b2'), admins);
    const { onState, hook } = member();
    await waitFor(() => expect(hook.result.current.status).toBe('unverified'));
    air.verify = { public: admins.public, version: 1 };
    await vi.advanceTimersByTimeAsync(SIGNER_RECHECK_MS + 100);
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' }), true));
    hook.unmount();
  });

  it('the leader asks for its pair again as soon as the phone is back online (a rotation meanwhile)', async () => {
    air.signer = { ...admins, version: 1 };
    const { unmount } = leader();
    await waitFor(() => expect(air.started.length).toBe(1));
    const next = await generateSigner();
    air.signer = { ...next, version: 2 };
    online();
    await waitFor(() => expect(air.started.length).toBe(2));
    expect(air.started[1]).toHaveProperty('signKey', next.private);
    unmount();
  });

  it('Stage starting again with a new pair (a rotation) serves the current state at once, signed with the new pair and on the band-key state too, not an empty one (Codex on #288)', async () => {
    air.signer = { ...admins, version: 1 };
    const { result, unmount } = leader();
    await waitFor(() => expect(air.signedUpdates.length).toBe(1));
    result.current.publish(lead('a', 7, 'c3'));
    await waitFor(() => expect(air.updates.length).toBe(1));
    const next = await generateSigner();
    air.signer = { ...next, version: 2 };
    online();
    await waitFor(() => expect(air.started.length).toBe(2));
    await waitFor(() => expect(air.updates.length).toBe(2));
    const signedNow = air.signedUpdates[air.signedUpdates.length - 1];
    expect(await decodeSignedState(fromBase64(signedNow.value), IDS, next.public, 2)).toMatchObject({ ok: true, state: { seq: 7, songId: 'c3' } });
    expect(await decodeStageState(fromBase64(air.updates[1].value), IDS, KEY)).toMatchObject({ ok: true, state: { seq: 7 } });
    // A change notice: members linked meanwhile read it.
    expect(signedNow.notify).not.toBe('');
    unmount();
  });

  it('a signing leader says it is there (signed, leading nothing) as soon as Stage opens; nothing is signed again on a timer (no time in the frame, rule B)', async () => {
    air.signer = { ...admins, version: 1 };
    const { result, unmount } = leader();
    await waitFor(() => expect(air.signedUpdates.length).toBe(1));
    const first = await decodeSignedState(fromBase64(air.signedUpdates[0].value), IDS, admins.public, 1);
    expect(first).toMatchObject({ ok: true, state: { seq: 0 } });
    // Nothing on the band-key state: older apps see no leader yet.
    expect(air.updates.length).toBe(0);
    result.current.publish(lead('a', 7, 'c3'));
    await waitFor(() => expect(air.signedUpdates.length).toBe(2));
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    await new Promise((r) => setTimeout(r, 200));
    expect(air.signedUpdates.length).toBe(2);
    unmount();
  });

  it('a member linked to an admin leading nothing follows nothing, and refuses a band-key "leader" from then on', async () => {
    put('admin', 'new', idle(), admins);
    const { onState, hook } = member();
    await waitFor(() => expect(hook.result.current.status).toBe('connected'));
    put('member-x', 'old', lead('x', 99, 'c3'));
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    expect(onState).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('linked first to a band-key phone: one look at an admin leading nothing is enough to leave it', async () => {
    put('member-x', 'old', lead('x', 99, 'c3'));
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'x' })));
    put('admin', 'new', idle(), admins);
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    await waitFor(() => expect(air.connected.has('member-x')).toBe(false));
    hook.unmount();
  });

  it("a signed state older than one already followed from the same signer (a recording played back) isn't followed, and that phone is left (Codex on #288, rule B)", async () => {
    put('admin', 'new', lead('a', 9, 'b2'), admins);
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a', seq: 9 }), true));
    // The admin walks out of range; a phone nearby plays back a state it recorded earlier.
    air.devices.delete('admin');
    put('replayer', 'new', lead('a', 5, 'c3'), admins);
    act(() => air.goodbyes.get('admin')!());
    await waitFor(() => expect(air.connects).toContain('replayer'), { timeout: 8000 });
    await waitFor(() => expect(air.connected.has('replayer')).toBe(false), { timeout: 3000 });
    expect(onState).not.toHaveBeenCalledWith(expect.objectContaining({ seq: 5 }), expect.anything());
    expect(hook.result.current.status).not.toBe('connected');
    hook.unmount();
  }, 20_000);

  it("a signed state an hour ahead of this phone's clock isn't followed: more than 5 minutes off never counts, signed or not (main session's rule)", async () => {
    put('admin', 'new', lead('a', nextSeq(null, Date.now() + 60 * 60_000), 'b2'), admins);
    const { onState, hook } = member();
    await waitFor(() => expect(hook.result.current.status).toBe('clock-off'), { timeout: 3000 });
    expect(onState).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("a signed seq far ahead (a clock far off) isn't kept as the highest followed: the same leader's next real state is followed, not taken for a recording (main session's rule)", async () => {
    put('admin', 'new', lead('a', nextSeq(null, Date.now() + 60 * 60_000), 'b2'), admins);
    const { onState, hook } = member();
    await waitFor(() => expect(hook.result.current.status).toBe('clock-off'), { timeout: 3000 });
    put('admin', 'new', lead('a', nextSeq(null, Date.now()), 'c3'), admins);
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 6000);
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a', songId: 'c3' }), true), { timeout: 8000 });
    hook.unmount();
  }, 20_000);

  it('a signed state a few minutes ahead of this phone is followed (within the 5-minute limit)', async () => {
    put('admin', 'new', lead('a', nextSeq(null, Date.now() + 4 * 60_000), 'b2'), admins);
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a', songId: 'b2' }), true), { timeout: 3000 });
    expect(hook.result.current.status).toBe('connected');
    hook.unmount();
  });

  it("the leader's services can't be listed (a dropped packet): not followed as a plain band-key leader, tried again", async () => {
    air.servicesFail = 1;
    put('admin', 'new', lead('a', 5, 'b2'), admins);
    const { onState, hook } = member();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' }), true), { timeout: 8000 });
    expect(onState).not.toHaveBeenCalledWith(expect.anything());
    hook.unmount();
  });

  it('a phone claiming a newer pair with a made-up signature gets no "band changed who can lead" line: only the server says the band changed (Claude on #288)', async () => {
    const forger = await generateSigner();
    // Online, the server's key is version 1: nothing newer exists.
    put('member-x', 'new', lead('x', 9, 'c3'), forger, 2);
    const { onState, hook } = member();
    const seen: string[] = [];
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(2_000);
      seen.push(hook.result.current.status);
    }
    expect(seen).not.toContain('stale-key');
    expect(onState).not.toHaveBeenCalled();
    // It asked the server, which had nothing newer.
    expect(air.verifyCalls).toBeGreaterThan(0);
    hook.unmount();
  }, 30_000);

  it('linked to a signing admin leading nothing: after ten minutes a band-key phone still does not take over (each look reads the linked state again) (Claude on #288)', async () => {
    put('admin', 'new', idle(), admins);
    const { onState, hook } = member();
    await waitFor(() => expect(hook.result.current.status).toBe('connected'));
    put('member-x', 'old', lead('x', 99, 'c3'));
    for (let i = 0; i < 24; i++) await vi.advanceTimersByTimeAsync(30_000);
    expect(onState).not.toHaveBeenCalledWith(expect.objectContaining({ from: 'x' }));
    expect(air.connected.has('admin')).toBe(true);
    hook.unmount();
  }, 60_000);

  it('linked to a signing admin, a band-key phone in range is not probed on every look: skipped as a refused one (Claude on #288)', async () => {
    put('admin', 'new', idle(), admins);
    const { hook } = member();
    await waitFor(() => expect(hook.result.current.status).toBe('connected'));
    put('member-x', 'old', lead('x', 99, 'c3'));
    for (let i = 0; i < 24; i++) await vi.advanceTimersByTimeAsync(30_000);
    // 12 minutes: a look every LEADER_CHECK_MS would probe it each time; skipped, doubling to a minute, about 12.
    const probes = air.connects.filter((c) => c === 'member-x').length;
    expect(probes).toBeLessThanOrEqual(14);
    expect(probes).toBeGreaterThanOrEqual(1);
    hook.unmount();
  }, 60_000);
});
