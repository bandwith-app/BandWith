import { useCallback, useEffect, useRef, useState } from 'react';
import { BleClient, ConnectionPriority } from '@capacitor-community/bluetooth-le';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { StageBle, stageBleAvailable, stageKey } from '@/lib/stageBleNative';
import { STAGE_BLE_CHARACTERISTIC, decodeStageState, encodeStageState, seqBytes, stageServiceUuid, toBase64 } from '@/lib/stageBle';
import {
  BURST_GAP_MS,
  BURST_PINGS,
  BleClockBook,
  CLOCK_RESYNC_MS,
  STAGE_BLE_SYNC_CHARACTERISTIC,
  SYNC_PONG,
  decodePong,
} from '@/lib/stageBleSync';
import { bestSample, clockSample, nowMs, type ClockSample, type PeerClock } from '@/lib/stageClick';
import type { StageLiveState } from '@/lib/stageLive';

/**
 * - off: not running (web, demo, closed, no key);
 * - leading: the admin's phone is advertising;
 * - searching / connected: a member's phone looking for / linked to the leader;
 * - unavailable: Bluetooth off, not allowed, or not supported;
 * - outdated: linked, but the leader's setlist has other songs than the one
 *   on this phone (songs added or removed while it was offline).
 */
export type StageBleStatus = 'off' | 'leading' | 'searching' | 'connected' | 'unavailable' | 'outdated';

interface Options {
  eventId?: string;
  /** Saved setlist row ids, in saved order (the bytes refer to these). */
  savedIds: string[];
  open: boolean;
  isLeader: boolean;
  /** A checked state from the leader (members only). */
  onState: (state: StageLiveState) => void;
}

const RETRY_MS = 2000;
/** Calls to the plugin's clock when the leader sets its offset (the fastest wins). */
const CALIBRATE_CALLS = 3;

/** Leader: how far the app's clock is from the plugin's, so pongs carry the app's clock. */
async function calibrateClock(): Promise<number | null> {
  const samples: ClockSample[] = [];
  for (let i = 0; i < CALIBRATE_CALLS; i++) {
    const t0 = nowMs();
    const { now } = await StageBle.now();
    samples.push(clockSample(t0, now, nowMs()));
  }
  const best = bestSample(samples);
  // sample.offset is the plugin's clock minus the app's.
  return best ? -best.offset : null;
}

/**
 * Stage mode over Bluetooth, the offline twin of the Realtime channel in
 * useStageLive: the admin's phone serves the latest state as a Bluetooth
 * peripheral; members' phones find it by the gig's service UUID, subscribe
 * and read. Every state is checked with the gig's key (migration 087).
 *
 * Members also measure the leader's clock over the link (stageBleSync.ts):
 * a burst of pings on connecting, again every 30 s and on demand (`burst`,
 * e.g. when a click or a count-in starts). `clock` is the best measure,
 * tied to the leader's id from its states. A leader on an older app has no
 * sync characteristic: the song still syncs, `clock` stays null.
 */
export function useStageBle({ eventId, savedIds, open, isLeader, onState }: Options) {
  const [status, setStatus] = useState<StageBleStatus>('off');
  const [clock, setClock] = useState<PeerClock | null>(null);
  const burstRef = useRef<() => void>(() => {});
  /** Member: measure the leader's clock again now (a burst of pings). */
  const burst = useCallback(() => burstRef.current(), []);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  const savedRef = useRef(savedIds);
  savedRef.current = savedIds;
  const keyRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const pendingRef = useRef<StageLiveState | null>(null);

  const active = open && !!eventId && stageBleAvailable() && savedIds.length > 0;

  const push = useCallback(async (state: StageLiveState) => {
    const key = keyRef.current;
    if (!key || !startedRef.current) {
      pendingRef.current = state;
      return;
    }
    const bytes = await encodeStageState(state, savedRef.current, key);
    if (!bytes) return;
    try {
      await StageBle.update({ value: toBase64(bytes), notify: toBase64(seqBytes(state.seq)) });
    } catch {
      /* Bluetooth off: the next state goes out when it's back */
    }
  }, []);

  /** Leader: serve this state over Bluetooth too. */
  const publish = useCallback(
    (state: StageLiveState) => {
      if (!isLeader) return;
      void push(state);
    },
    [isLeader, push],
  );

  // Leader: advertise while Stage mode is open.
  useEffect(() => {
    if (!active || !isLeader || !eventId) return;
    let cancelled = false;
    let listener: PluginListenerHandle | null = null;
    let recalibrate: ReturnType<typeof setInterval> | undefined;
    const calibrate = async () => {
      try {
        const offset = await calibrateClock();
        if (offset !== null && !cancelled) await StageBle.setClock({ offset });
      } catch {
        /* the members' pongs then carry the plugin's clock: they keep their last measure */
      }
    };
    (async () => {
      const key = await stageKey(eventId);
      if (cancelled || !key) return;
      keyRef.current = key;
      const serviceUuid = await stageServiceUuid(key);
      const handle = await StageBle.addListener('stateChange', ({ state }) => {
        setStatus(state === 'on' ? 'leading' : state === 'unknown' ? 'off' : 'unavailable');
      });
      // Closed while the listener was being added: the cleanup has already run.
      if (cancelled) {
        void handle.remove();
        return;
      }
      listener = handle;
      try {
        // Empty until the first move; members ignore it. Asks for Bluetooth the first time.
        const { state } = await StageBle.start({
          serviceUuid,
          characteristicUuid: STAGE_BLE_CHARACTERISTIC,
          value: '',
          notify: '',
          syncUuid: STAGE_BLE_SYNC_CHARACTERISTIC,
          key,
        });
        if (cancelled) return;
        startedRef.current = true;
        // Pongs carry the app's clock (the one `startAt` uses); kept right as the two drift.
        await calibrate();
        if (cancelled) return;
        recalibrate = setInterval(() => void calibrate(), CLOCK_RESYNC_MS);
        setStatus(state === 'on' ? 'leading' : state === 'unknown' ? 'off' : 'unavailable');
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) void push(pending);
      } catch {
        if (!cancelled) setStatus('unavailable');
      }
    })();
    return () => {
      cancelled = true;
      clearInterval(recalibrate);
      startedRef.current = false;
      pendingRef.current = null;
      void listener?.remove();
      void StageBle.stop().catch(() => {});
      setStatus('off');
    };
  }, [active, isLeader, eventId, push]);

  // Member: find the leader, subscribe, read on every change.
  useEffect(() => {
    if (!active || isLeader || !eventId) return;
    let cancelled = false;
    let deviceId: string | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let serviceUuid = '';
    let key = '';
    // Clock over the link: kept across a dropped link (the click keeps its beat
    // meanwhile), started afresh for another leader's phone.
    const book = new BleClockBook();
    let bookDevice: string | null = null;
    let leaderFrom: string | null = null;
    let syncOn = false;
    let burstTimers: ReturnType<typeof setTimeout>[] = [];
    let resync: ReturnType<typeof setInterval> | undefined;

    const emitClock = () => {
      const sample = book.best(nowMs());
      if (sample) setClock({ from: leaderFrom, sample });
    };

    const onSync = (view: DataView) => {
      const t2 = nowMs();
      const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
      if (bytes[1] !== SYNC_PONG) return;
      void decodePong(bytes, key).then((pong) => {
        if (!pong || cancelled) return;
        if (book.pong(pong.nonce, pong.t1, t2)) emitClock();
      });
    };

    const pingOnce = async () => {
      const id = deviceId;
      if (!id || !syncOn || cancelled) return;
      const { bytes } = book.ping(nowMs());
      try {
        await BleClient.write(id, serviceUuid, STAGE_BLE_SYNC_CHARACTERISTIC, new DataView(bytes.buffer));
      } catch {
        /* a dropped link is handled by onDisconnect */
      }
    };

    const runBurst = () => {
      if (!syncOn || cancelled) return;
      burstTimers.forEach(clearTimeout);
      burstTimers = Array.from({ length: BURST_PINGS }, (_, i) => setTimeout(() => void pingOnce(), i * BURST_GAP_MS));
    };
    burstRef.current = runBurst;

    const startSync = async (id: string) => {
      if (bookDevice !== id) {
        book.clear();
        bookDevice = id;
      }
      try {
        await BleClient.startNotifications(id, serviceUuid, STAGE_BLE_SYNC_CHARACTERISTIC, onSync);
      } catch {
        // A leader on an older app: no clock over Bluetooth, the song still syncs.
        syncOn = false;
        return;
      }
      if (cancelled) return;
      syncOn = true;
      if (Capacitor.getPlatform() === 'android') {
        // Shorter connection interval: tighter round trips, a better clock.
        await BleClient.requestConnectionPriority(id, ConnectionPriority.CONNECTION_PRIORITY_HIGH).catch(() => {});
      }
      runBurst();
      clearInterval(resync);
      resync = setInterval(runBurst, CLOCK_RESYNC_MS);
    };

    const readNow = async () => {
      const id = deviceId;
      if (!id) return;
      try {
        const view = await BleClient.read(id, serviceUuid, STAGE_BLE_CHARACTERISTIC);
        const result = await decodeStageState(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), savedRef.current, key);
        if (cancelled) return;
        if (result.ok) {
          setStatus('connected');
          if (result.state.from !== leaderFrom) {
            leaderFrom = result.state.from;
            emitClock();
          }
          onStateRef.current(result.state);
        } else if (result.reason === 'setlist') {
          // Not silently "connected": this phone needs the setlist again (internet).
          setStatus('outdated');
        }
      } catch {
        /* a dropped link is handled by onDisconnect */
      }
    };

    const later = () => {
      clearTimeout(retry);
      if (!cancelled) retry = setTimeout(() => void scan(), RETRY_MS);
    };

    const onDisconnect = () => {
      deviceId = null;
      syncOn = false;
      clearInterval(resync);
      burstTimers.forEach(clearTimeout);
      if (cancelled) return;
      setStatus('searching');
      later();
    };

    const scan = async () => {
      if (cancelled) return;
      setStatus('searching');
      try {
        await BleClient.requestLEScan({ services: [serviceUuid] }, (result) => {
          if (deviceId || cancelled) return;
          const id = result.device.deviceId;
          deviceId = id;
          void (async () => {
            try {
              await BleClient.stopLEScan();
              await BleClient.connect(id, onDisconnect, { timeout: 10000 });
              await BleClient.startNotifications(id, serviceUuid, STAGE_BLE_CHARACTERISTIC, () => void readNow());
              if (cancelled) return;
              setStatus('connected');
              await readNow();
              await startSync(id);
            } catch {
              deviceId = null;
              void BleClient.disconnect(id).catch(() => {});
              later();
            }
          })();
        });
      } catch {
        if (!cancelled) setStatus('unavailable');
      }
    };

    // Bluetooth off or the key not fetched yet: try again a little later.
    const boot = async () => {
      if (cancelled) return;
      const k = key || (await stageKey(eventId));
      if (cancelled) return;
      if (!k) {
        retry = setTimeout(() => void boot(), 15000);
        return;
      }
      key = k;
      serviceUuid = await stageServiceUuid(k);
      try {
        // Asks for Bluetooth the first time; Android 12+ never uses it for location.
        await BleClient.initialize({ androidNeverForLocation: true });
      } catch {
        // Not allowed or not supported: don't ask again while Stage mode is open.
        if (!cancelled) setStatus('unavailable');
        return;
      }
      let enabled = false;
      try {
        enabled = await BleClient.isEnabled();
      } catch {
        /* treated as off */
      }
      if (cancelled) return;
      if (!enabled) {
        // Bluetooth off: look again in a moment (turning it on needs no prompt).
        setStatus('unavailable');
        retry = setTimeout(() => void boot(), 5000);
        return;
      }
      await scan();
    };
    void boot();

    return () => {
      cancelled = true;
      clearTimeout(retry);
      clearInterval(resync);
      burstTimers.forEach(clearTimeout);
      burstRef.current = () => {};
      setClock(null);
      void BleClient.stopLEScan().catch(() => {});
      if (deviceId) void BleClient.disconnect(deviceId).catch(() => {});
      setStatus('off');
    };
    // A reloaded setlist doesn't drop the link: reads use savedRef.
  }, [active, isLeader, eventId]);

  return { status, publish, clock, burst };
}
