import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { encodeStageState, toBase64, STAGE_BLE_CHARACTERISTIC } from '@/lib/stageBle';
import { STAGE_BLE_CLOCK_CHARACTERISTIC, encodeClock } from '@/lib/stageBleSync';
import { nowMs } from '@/lib/stageClick';
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
 * Admins' phones advertising the gig (review of #280). Closer to the real
 * plugin than the leaders test: one scan at a time (a new requestLEScan
 * replaces the callback, stopLEScan ends it), phones that start advertising
 * later are seen only by a scan running then, a disconnect that takes a
 * while, and an ordered log of what the member does.
 */
const air = vi.hoisted(() => ({
  devices: new Map<string, { state: unknown; advertising: boolean; clockAhead?: number; readMs?: number; ids?: string[] }>(),
  /** Probes' let-go timeouts (the plugin's own disconnect). */
  letGoTimeouts: [] as Array<{ id: string; timeout?: number }>,
  scanCb: null as null | ((r: { device: { deviceId: string } }) => void),
  log: [] as string[],
  connected: new Set<string>(),
  connectTimeouts: [] as number[],
  pendingReads: 0,
  goodbyes: new Map<string, () => void>(),
  /** When (Date.now) each clock read and each connect happened. */
  clockReadsAt: [] as number[],
  connectsAt: [] as { id: string; at: number }[],
  scansAt: [] as number[],
}));

const goodbye = async (id: string) => {
  air.log.push(`disconnect:${id}`);
  await new Promise((r) => setTimeout(r, 30));
  air.connected.delete(id);
  air.log.push(`disconnected:${id}`);
};

const appear = (id: string, state: StageLiveState | null, extra: { clockAhead?: number; ids?: string[] } = {}) => {
  air.devices.set(id, { state, advertising: true, ...extra });
  air.scanCb?.({ device: { deviceId: id } });
};

vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {
    initialize: vi.fn(async () => {}),
    isEnabled: vi.fn(async () => true),
    requestLEScan: vi.fn(async (_o: unknown, cb: (r: { device: { deviceId: string } }) => void) => {
      // Like the plugin: one scan at a time; a second one is refused and the first is stopped.
      air.scansAt.push(Date.now());
      if (air.scanCb) {
        air.scanCb = null;
        air.log.push('scan-refused');
        throw new Error('Already scanning. Stopping now.');
      }
      air.scanCb = cb;
      air.log.push('scan');
      let i = 0;
      for (const [id, d] of air.devices) if (d.advertising) setTimeout(() => air.scanCb === cb && cb({ device: { deviceId: id } }), 5 * ++i);
    }),
    stopLEScan: vi.fn(async () => {
      air.scanCb = null;
      air.log.push('stop-scan');
    }),
    connect: vi.fn(async (id: string, cb: () => void, o?: { timeout?: number }) => {
      air.log.push(`connect:${id}`);
      air.connectsAt.push({ id, at: Date.now() });
      air.goodbyes.set(id, cb);
      air.connectTimeouts.push(o?.timeout ?? 0);
      air.connected.add(id);
    }),
    disconnect: vi.fn(async (id: string) => goodbye(id)),
    requestConnectionPriority: vi.fn(async () => {}),
    startNotifications: vi.fn(async () => {}),
    read: vi.fn(async (id: string, _s: string, char: string) => {
      const d = air.devices.get(id);
      if (char === STAGE_BLE_CLOCK_CHARACTERISTIC) {
        if (d?.clockAhead === undefined) throw new Error('Characteristic not found.');
        air.clockReadsAt.push(Date.now());
        return new DataView((await encodeClock(nowMs() + d.clockAhead, KEY)).buffer);
      }
      if (char !== STAGE_BLE_CHARACTERISTIC) throw new Error('Characteristic not found.');
      air.pendingReads++;
      try {
        if (d?.readMs) await new Promise((r) => setTimeout(r, d.readMs));
        const st = d?.state as StageLiveState | null;
        if (!st) return new DataView(new ArrayBuffer(0));
        return new DataView((await encodeStageState(st, d?.ids ?? IDS, KEY))!.buffer);
      } finally {
        air.pendingReads--;
      }
    }),
    startEnabledNotifications: vi.fn(async () => {}),
    stopEnabledNotifications: vi.fn(async () => {}),
  },
  BluetoothLe: {
    disconnect: vi.fn(async ({ deviceId, timeout }: { deviceId: string; timeout?: number }) => {
      air.letGoTimeouts.push({ id: deviceId, timeout });
      await goodbye(deviceId);
    }),
  },
  ConnectionPriority: { CONNECTION_PRIORITY_HIGH: 1 },
}));

vi.mock('@/lib/stageBleNative', () => ({
  StageBle: {},
  stageBleAvailable: () => true,
  stageKey: async () => KEY,
}));

const stageBleHook = await import('../useStageBle');
const { useStageBle, LEADER_CHECK_MS } = stageBleHook;

const lead = (id: string, seq: number, songId: string): StageLiveState => ({ seq, from: id, songId, order: null });
const member = (onState: (s: StageLiveState) => void = () => {}) =>
  renderHook(() => useStageBle({ eventId: 'gig', savedIds: IDS, open: true, isLeader: false, onState }));

beforeEach(() => {
  air.devices.clear();
  air.scanCb = null;
  air.log = [];
  air.connected.clear();
  air.connectTimeouts = [];
  air.pendingReads = 0;
  air.goodbyes.clear();
  air.clockReadsAt = [];
  air.connectsAt = [];
  air.scansAt = [];
  air.letGoTimeouts = [];
  (stageBleHook as { forgetScanStarts?: () => void }).forgetScanStarts?.();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

describe('useStageBle: looking for the admin who leads (review of #280)', () => {
  it("Stage closed and reopened during a leader look: the old look doesn't end the new search, and a leader who shows up later is found", async () => {
    appear('admin-b', lead('b', 3, 'a1'));
    const first = member();
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-b'])));
    // The 30 s look starts its 2 s scan…
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 500);
    expect(air.log.filter((l) => l === 'scan').length).toBe(2);
    // …and Stage is closed and opened again meanwhile; admin B has gone.
    first.unmount();
    air.devices.delete('admin-b');
    const onState = vi.fn();
    const second = member(onState);
    await waitFor(() => expect(second.result.current.status).toBe('searching'));
    // The old look's timer ends here: it must not stop the new search.
    await vi.advanceTimersByTimeAsync(3000);
    // Admin A opens Stage now.
    appear('admin-a', lead('a', 9, 'c3'));
    await vi.advanceTimersByTimeAsync(20_000);
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' })));
    second.unmount();
  });

  it('searching with nothing found keeps looking: a leader who starts advertising after a stopped scan is still found', async () => {
    const onState = vi.fn();
    const m = member(onState);
    await waitFor(() => expect(m.result.current.status).toBe('searching'));
    // The radio ended the scan on its own (iOS does in the background, Android after 30 min).
    air.scanCb = null;
    air.devices.set('admin-a', { state: lead('a', 2, 'b2'), advertising: true });
    await vi.advanceTimersByTimeAsync(20_000);
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' })));
    m.unmount();
  });

  it('three admins: the member goes straight to the newest, not the first one newer than its leader', async () => {
    appear('admin-x', lead('x', 10, 'a1'));
    const onState = vi.fn();
    const m = member(onState);
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'x' })));
    appear('admin-y', lead('y', 11, 'b2'));
    appear('admin-z', lead('z', 50, 'c3'));
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-z'])));
    expect(onState).not.toHaveBeenCalledWith(expect.objectContaining({ from: 'y' }));
    m.unmount();
  });

  it('a probe lets go of a phone before linking to it (a late disconnect would drop the new link)', async () => {
    appear('admin-b', lead('b', 3, 'a1'));
    const m = member();
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-b'])));
    appear('admin-a', lead('a', 9, 'c3'));
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-a'])));
    const a = air.log.filter((l) => l.endsWith(':admin-a'));
    // probe connect, its disconnect done, then the link.
    expect(a.slice(0, 4)).toEqual(['connect:admin-a', 'disconnect:admin-a', 'disconnected:admin-a', 'connect:admin-a']);
    m.unmount();
  });

  it('probes are short, and never while a song read from the leader is under way', async () => {
    appear('admin-b', lead('b', 3, 'a1'));
    const m = member();
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-b'])));
    appear('admin-a', lead('a', 1, 'c3'));
    // The leader's reads are slow now (a song change arrives as the look starts).
    air.devices.get('admin-b')!.readMs = 4000;
    const { BleClient } = await import('@capacitor-community/bluetooth-le');
    const notify = vi.mocked(BleClient.startNotifications).mock.calls[vi.mocked(BleClient.startNotifications).mock.calls.length - 1][3] as (v: DataView) => void;
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 1500);
    notify(new DataView(new ArrayBuffer(4)));
    const probeConnects: number[] = [];
    const before = air.log.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(air.pendingReads).toBe(1);
    expect(air.log.slice(before).filter((l) => l === 'connect:admin-a')).toEqual(probeConnects);
    await vi.advanceTimersByTimeAsync(8000);
    // Once the read is done, the look goes on, with a short connect.
    await waitFor(() => expect(air.log.includes('connect:admin-a')).toBe(true));
    expect(Math.max(...air.connectTimeouts.slice(1))).toBeLessThanOrEqual(2000);
    m.unmount();
  });

  it('an idle leader and an idle admin: the looks slow down instead of probing every 4 s all gig long', async () => {
    appear('admin-b', null);
    const m = member();
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-b'])));
    appear('admin-c', null);
    await vi.advanceTimersByTimeAsync(120_000);
    // Every 4 s would be ~20 probes in 2 minutes.
    expect(air.log.filter((l) => l === 'connect:admin-c').length).toBeLessThanOrEqual(6);
    m.unmount();
  });

  it("moving to another admin's phone drops the old leader's clock (an older app has none to replace it)", async () => {
    appear('admin-b', lead('b', 3, 'a1'), { clockAhead: 800 });
    const m = member();
    await waitFor(() => expect(m.result.current.clock?.from).toBe('b'));
    // Admin A leads on an older app: no clock characteristic.
    appear('admin-a', lead('a', 9, 'c3'));
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-a'])));
    await vi.advanceTimersByTimeAsync(1000);
    expect(m.result.current.clock).toBeNull();
    m.unmount();
  });

  it('the leader drops out during a look: the look ends its scan, and the member finds the leader again', async () => {
    appear('admin-b', lead('b', 3, 'a1'));
    const m = member();
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-b'])));
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 500);
    expect(air.scanCb).not.toBeNull();
    // The link drops mid-look (B is still there, advertising).
    air.connected.delete('admin-b');
    air.goodbyes.get('admin-b')!();
    await vi.advanceTimersByTimeAsync(15_000);
    await waitFor(() => expect(m.result.current.status).toBe('connected'));
    expect(air.log.filter((l) => l === 'connect:admin-b').length).toBe(2);
    m.unmount();
  });

  it('a scan refused as "already scanning" is tried again, not taken for Bluetooth off', async () => {
    air.scanCb = () => {}; // a scan left running (by another screen, or the radio)
    const onState = vi.fn();
    const m = member(onState);
    await waitFor(() => expect(air.log).toContain('scan-refused'));
    expect(m.result.current.status).not.toBe('bt-off');
    appear('admin-a', lead('a', 2, 'b2'));
    await vi.advanceTimersByTimeAsync(5000);
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' })));
    m.unmount();
  });

  it("an admin who leads with a setlist this phone doesn't have wins over an idle one: the member is told to get the setlist", async () => {
    appear('admin-b', null);
    const m = member();
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-b'])));
    air.devices.set('admin-a', { state: lead('a', 5, 'x9'), advertising: true, ids: ['a1', 'b2', 'c3', 'x9'] });
    air.scanCb?.({ device: { deviceId: 'admin-a' } });
    await vi.advanceTimersByTimeAsync(10_000);
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-a'])));
    await waitFor(() => expect(m.result.current.status).toBe('outdated'));
    m.unmount();
  });

  it('a probe read is short too: a stalled phone cannot hold up the leader for long', async () => {
    const { BleClient } = await import('@capacitor-community/bluetooth-le');
    vi.mocked(BleClient.read).mockClear();
    appear('admin-b', lead('b', 3, 'a1'));
    const m = member();
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-b'])));
    appear('admin-a', lead('a', 1, 'c3'));
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    const probeReads = vi.mocked(BleClient.read).mock.calls.filter((c) => c[0] === 'admin-a');
    expect(probeReads.length).toBeGreaterThan(0);
    for (const c of probeReads) expect((c[3] as { timeout?: number } | undefined)?.timeout ?? Infinity).toBeLessThanOrEqual(2000);
    m.unmount();
  });

  it('a state with a seq far ahead of the clock (anyone with the band key can make one) never takes the member', async () => {
    appear('admin-b', lead('b', 3, 'a1'));
    const onState = vi.fn();
    const m = member(onState);
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'b' })));
    appear('forger', lead('x', 0xffffffff, 'c3'));
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    await new Promise((r) => setTimeout(r, 300));
    expect(onState).not.toHaveBeenCalledWith(expect.objectContaining({ from: 'x' }));
    expect(air.connected).toEqual(new Set(['admin-b']));
    m.unmount();
  });

  it('alone, such a phone is linked but never followed', async () => {
    appear('forger', lead('x', 0xffffffff, 'c3'));
    const onState = vi.fn();
    const m = member(onState);
    await waitFor(() => expect(air.connected).toEqual(new Set(['forger'])));
    await new Promise((r) => setTimeout(r, 300));
    expect(onState).not.toHaveBeenCalled();
    m.unmount();
  });

  it("a probe never cuts a fresh link to the same phone (the leader dropped, the search linked to the probed one)", async () => {
    appear('admin-b', lead('b', 3, 'a1'));
    const m = member();
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-b'])));
    // Admin A's reads are slow: the probe of A is still under way when B drops and the search links to A.
    air.devices.set('admin-a', { state: lead('a', 9, 'c3'), advertising: true, readMs: 6000 });
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 2200);
    expect(air.log).toContain('connect:admin-a');
    air.devices.delete('admin-b');
    air.connected.delete('admin-b');
    air.goodbyes.get('admin-b')!();
    await vi.advanceTimersByTimeAsync(4_000);
    await waitFor(() => expect(air.log.filter((l) => l === 'connect:admin-a').length).toBe(2));
    // The probe's slow read ends after the link to A: its "let go" must not cut that link.
    await vi.advanceTimersByTimeAsync(8_000);
    await new Promise((r) => setTimeout(r, 800));
    await vi.advanceTimersByTimeAsync(1_000);
    const linked = air.log.lastIndexOf('connect:admin-a');
    expect(air.log.slice(linked)).not.toContain('disconnect:admin-a');
    expect(air.connected.has('admin-a')).toBe(true);
    m.unmount();
  });

  it("probes wait for the leader's clock burst (the radio does one thing at a time)", async () => {
    appear('admin-b', lead('b', 3, 'a1'), { clockAhead: 0 });
    const m = member();
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-b'])));
    appear('admin-a', lead('a', 1, 'c3'));
    // A count-in asks for a burst just as the look's scan ends.
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 1800);
    air.clockReadsAt = [];
    m.result.current.burst();
    await vi.advanceTimersByTimeAsync(10_000);
    const burstEnd = Math.max(...air.clockReadsAt);
    const burstStart = Math.min(...air.clockReadsAt);
    expect(air.clockReadsAt.length).toBeGreaterThanOrEqual(6);
    const probes = air.connectsAt.filter((c) => c.id === 'admin-a');
    expect(probes.length).toBeGreaterThan(0);
    for (const p of probes) expect(p.at < burstStart || p.at > burstEnd).toBe(true);
    m.unmount();
  });

  it('the leader seen again at another address (Android rotates it) is probed once, not every look, and not switched to', async () => {
    appear('admin-b', lead('b', 3, 'a1'));
    const m = member();
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-b'])));
    // The same phone (same leader id in its state), at a new address, a newer state.
    air.devices.set('admin-b-2', { state: lead('b', 4, 'a1'), advertising: true });
    for (let look = 0; look < 3; look++) {
      await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 3000);
      await new Promise((r) => setTimeout(r, 400));
    }
    expect(air.log.filter((l) => l === 'connect:admin-b-2').length).toBe(1);
    expect(air.connected.has('admin-b')).toBe(true);
    m.unmount();
  });

  it('scans start at most 4 times in 30 s, whatever restarts them (Android silently stops scanning after 5)', async () => {
    air.scanCb = () => {}; // a scan left running: every start is refused and retried
    const m = member();
    await waitFor(() => expect(air.scansAt.length).toBeGreaterThan(0));
    // Refused starts clear the plugin's scan; keep one "left running" each time, so every start is refused.
    const { BleClient } = await import('@capacitor-community/bluetooth-le');
    const real = vi.mocked(BleClient.requestLEScan).getMockImplementation()!;
    vi.mocked(BleClient.requestLEScan).mockImplementation(async (o, cb) => {
      air.scanCb = () => {};
      return real(o, cb);
    });
    for (let i = 0; i < 12; i++) await vi.advanceTimersByTimeAsync(5_000);
    const starts = air.scansAt;
    expect(starts.length).toBeGreaterThan(2);
    for (const t of starts) expect(starts.filter((u) => u >= t && u < t + 30_000).length).toBeLessThanOrEqual(4);
    m.unmount();
    // The tests after this one scan normally.
    vi.mocked(BleClient.requestLEScan).mockImplementation(real);
  });

  it("admin A leads this phone's setlist, admin B then leads with a song added (a newer state): the member moves to B and is told to get the setlist (Codex on #280)", async () => {
    appear('admin-a', lead('a', 10, 'b2'));
    const onState = vi.fn();
    const m = member(onState);
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' })));
    appear('admin-b', lead('b', 20, 'x9'), { ids: [...IDS, 'x9'] });
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-b'])));
    await waitFor(() => expect(m.result.current.status).toBe('outdated'));
    m.unmount();
  });

  it("an older admin leading a setlist this phone lacks doesn't take it from the newer one it follows", async () => {
    appear('admin-a', lead('a', 20, 'b2'));
    const onState = vi.fn();
    const m = member(onState);
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ from: 'a' })));
    appear('admin-b', lead('b', 10, 'x9'), { ids: [...IDS, 'x9'] });
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    await waitFor(() => expect(air.log).toContain('disconnected:admin-b'));
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-a'])));
    expect(m.result.current.status).toBe('connected');
    m.unmount();
  });

  it('two admins both leading a setlist this phone lacks: the member stays with the one it has, no flipping every look (Codex + Claude on #280)', async () => {
    const ids = [...IDS, 'x9'];
    appear('admin-a', lead('a', 5, 'x9'), { ids });
    const m = member();
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-a'])));
    await waitFor(() => expect(m.result.current.status).toBe('outdated'));
    appear('admin-b', lead('b', 4, 'x9'), { ids });
    const links = () => air.log.filter((l) => l === 'connect:admin-b').length;
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      expect(air.connected.has('admin-a')).toBe(true);
    }
    // Probed, never linked: each look's probe connects and lets go.
    expect(links()).toBeGreaterThan(0);
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-a'])));
    m.unmount();
  });

  it("a probed phone is let go with a short timeout, outside the plugin's queue: a stalled goodbye can't hold up the leader's songs (Codex on #280)", async () => {
    const { BleClient } = await import('@capacitor-community/bluetooth-le');
    appear('admin-b', lead('b', 3, 'a1'));
    const m = member();
    await waitFor(() => expect(air.connected).toEqual(new Set(['admin-b'])));
    appear('admin-a', lead('a', 1, 'c3'));
    vi.mocked(BleClient.disconnect).mockClear();
    await vi.advanceTimersByTimeAsync(LEADER_CHECK_MS + 5000);
    await waitFor(() => expect(air.letGoTimeouts.some((l) => l.id === 'admin-a')).toBe(true));
    for (const l of air.letGoTimeouts) expect(l.timeout ?? Infinity).toBeLessThanOrEqual(1000);
    expect(vi.mocked(BleClient.disconnect).mock.calls.filter((c) => c[0] === 'admin-a')).toEqual([]);
    m.unmount();
  });
});

