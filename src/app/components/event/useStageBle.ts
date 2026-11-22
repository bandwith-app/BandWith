import { useCallback, useEffect, useRef, useState } from 'react';
import { BleClient, BluetoothLe, ConnectionPriority } from '@capacitor-community/bluetooth-le';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StageBle, stageBleAvailable, stageKey } from '@/lib/stageBleNative';
import { STAGE_BLE_CHARACTERISTIC, decodeStageState, encodeStageState, seqBytes, stageServiceUuid, toBase64 } from '@/lib/stageBle';
import {
  BURST_GAP_MS,
  BURST_READS,
  BleClockBook,
  CLOCK_RESYNC_MS,
  STAGE_BLE_CLOCK_CHARACTERISTIC,
  STAGE_BLE_LIVE_CHARACTERISTIC,
  decodeClock,
} from '@/lib/stageBleSync';
import { bestSample, clockSample, nowMs, type ClockSample, type PeerClock } from '@/lib/stageClick';
import { isNewer, seqPlausible, type StageLiveState } from '@/lib/stageLive';
import { bleProblem, type StageBleStatus } from '@/lib/stageBleNotice';

export type { StageBleStatus };

/** The leader plugin's state, as a status. */
const leaderStatus = (state: string): StageBleStatus =>
  state === 'on' ? 'leading' : state === 'off' ? 'bt-off' : state === 'unauthorized' ? 'denied' : state === 'unsupported' ? 'unsupported' : 'off';

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
/**
 * Members linked to a leader look this often for another admin's phone
 * advertising the same gig (two admins with Stage open): the one with the
 * newer state leads (seqs are time based). Sooner while the linked phone
 * has served nothing yet (an admin who opened Stage and never led).
 */
export const LEADER_CHECK_MS = 30_000;
export const IDLE_LEADER_CHECK_MS = 4_000;
/** Another address of the linked leader's phone is skipped this long, then probed again. */
export const SAME_LEADER_FORGET_MS = 5 * 60_000;
/** How long such a look scans. */
const LEADER_SCAN_MS = 2_000;
/** A look's short link to another phone: a phone out of range mustn't hold up the leader's reads. */
export const PROBE_TIMEOUT_MS = 2_000;
/** A probed phone is let go within this (a phone gone out of range would otherwise take the plugin's 5 s). */
export const PROBE_LET_GO_MS = 1_000;
/** What a leader's state says about how recent it is: enough to compare two leaders. */
type Heard = Pick<StageLiveState, 'seq' | 'from'>;
/** Searching with nothing found: start the scan again this often (the radio can end one by itself). */
export const SEARCH_RESTART_MS = 10_000;
/**
 * Android stops scanning without a word after 5 starts in 30 s: every path
 * that starts a scan (search, restart, retry, leader look) shares this budget.
 */
export const SCAN_STARTS_MAX = 4;
export const SCAN_WINDOW_MS = 30_000;
const scanStarts: number[] = [];
/** Milliseconds until a scan may start (0: now). */
const scanWaitMs = () => {
  const now = Date.now();
  while (scanStarts.length && scanStarts[0] <= now - SCAN_WINDOW_MS) scanStarts.shift();
  return scanStarts.length < SCAN_STARTS_MAX ? 0 : scanStarts[0] + SCAN_WINDOW_MS - now + 1;
};
/** Tests: a fresh budget. */
export const forgetScanStarts = () => void scanStarts.splice(0);
/**
 * Phones linked as the leader by a Stage session: a look never probes one
 * (connecting again would replace its goodbye handler) and a probe never lets
 * go of one (that would cut the link), also across closing and reopening Stage.
 */
const leaderLinks = new Set<string>();
/** A leader's change notice is just the 4-byte seq; full values (a read echoed on iOS) are longer. */
export const isChangeNotice = (v: DataView | undefined) => v?.byteLength === 4;
/** Calls to the plugin's clock when the leader sets its offset (the fastest wins). */
const CALIBRATE_CALLS = 3;

/** Leader: how far the app's clock is from the plugin's, so clock reads carry the app's clock. */
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
 * a burst of clock reads on connecting, again every 30 s and on demand
 * (`burst`, e.g. when a click or a count-in starts). `clock` is the best
 * measure, tied to the leader's id from its states. A leader on an older app
 * has no clock characteristic: the song still syncs, `clock` stays null.
 * Bluetooth turned off stops the reads at once (no crash, the clock is kept).
 */
export function useStageBle({ eventId, savedIds, open, isLeader, onState }: Options) {
  const [status, setStatus] = useState<StageBleStatus>('off');
  const [clock, setClock] = useState<PeerClock | null>(null);
  /** Leader: phones linked to it. */
  const [followers, setFollowers] = useState(0);
  /** Bumped to start Bluetooth again (permission granted, Bluetooth turned on). */
  const [attempt, setAttempt] = useState(0);
  const statusRef = useRef(status);
  statusRef.current = status;
  /** Android: the permission was asked again once from the button; next time, open Settings. */
  const askedAgainRef = useRef(false);
  /** The button sent the user to Settings: check again when they're back. */
  const toSettingsRef = useRef(false);
  const burstRef = useRef<() => void>(() => {});
  /** Member: measure the leader's clock again now (a burst of reads). */
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
      await StageBle.update({
        value: toBase64(bytes),
        notify: toBase64(seqBytes(state.seq)),
      });
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
        /* the clock reads then carry the plugin's clock: members keep their last measure */
      }
    };
    (async () => {
      const key = await stageKey(eventId);
      if (cancelled || !key) return;
      keyRef.current = key;
      const serviceUuid = await stageServiceUuid(key);
      const handle = await StageBle.addListener('stateChange', ({ state, subscribers }) => {
        setStatus(leaderStatus(state));
        setFollowers(state === 'on' ? subscribers ?? 0 : 0);
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
          clockUuid: STAGE_BLE_CLOCK_CHARACTERISTIC,
          liveUuid: STAGE_BLE_LIVE_CHARACTERISTIC,
          key,
        });
        if (cancelled) return;
        startedRef.current = true;
        setStatus(leaderStatus(state));
        // Clock reads carry the app's clock (the one `startAt` uses); kept right as the two drift.
        await calibrate();
        if (cancelled) return;
        recalibrate = setInterval(() => void calibrate(), CLOCK_RESYNC_MS);
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) void push(pending);
      } catch (e) {
        if (!cancelled) setStatus(bleProblem(e));
      }
    })();
    return () => {
      cancelled = true;
      clearInterval(recalibrate);
      setFollowers(0);
      startedRef.current = false;
      pendingRef.current = null;
      void listener?.remove();
      void StageBle.stop().catch(() => {});
      setStatus('off');
    };
  }, [active, isLeader, eventId, push, attempt]);

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
    let watching = false;
    /** Bumped for every new link, so a late goodbye from an old one is ignored. */
    let link = 0;
    /** The newest valid state from the linked phone (null: it has served none). */
    let linkState: StageLiveState | null = null;
    /** The newest state the linked phone served, this phone's setlist or not (null: none). */
    let linkHeard: Heard | null = null;
    let checkTimer: ReturnType<typeof setTimeout> | undefined;
    /** Looks in a row that found nothing while the linked phone served nothing: they slow down. */
    let idleChecks = 0;
    /** Song and clock reads under way (a look waits for them: the radio does one thing at a time). */
    let reads = 0;
    /** A clock burst runs until then (a look doesn't probe meanwhile). */
    let burstUntil = 0;
    /** Other addresses of the linked leader's phone (Android rotates them), when seen: not probed again for a while. */
    let sameLeader = new Map<string, number>();
    const knownSame = (id: string) => Date.now() - (sameLeader.get(id) ?? -Infinity) < SAME_LEADER_FORGET_MS;
    /** The linked phone's last state was dropped for a seq ahead of this phone's clock: read again once its clock is measured. */
    let clockDropped = false;
    /**
     * A seq that could come from the linked leader's clock: judged with the
     * offset measured over the link (a leader's phone set an hour ahead is
     * still followed), with none for any other phone.
     */
    const plausibleFrom = (seq: number, id: string | null) => {
      const offset = id && bookDevice === id ? (book.best(nowMs())?.offset ?? 0) : 0;
      return seqPlausible(seq, Date.now() + offset);
    };
    const radioBusy = () => reads > 0 || nowMs() < burstUntil;
    /** The linked phone; leaderLinks follows it. */
    const setDevice = (id: string | null) => {
      if (deviceId) leaderLinks.delete(deviceId);
      deviceId = id;
      if (id) leaderLinks.add(id);
    };
    /** A look's scan is running (the search for a lost leader takes it over). */
    let lookScanning = false;
    /** This session's waits, cleared when Stage closes, so a late one can't touch the next session's scan. */
    const waits = new Set<ReturnType<typeof setTimeout>>();
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          waits.delete(t);
          resolve();
        }, ms);
        waits.add(t);
      });

    const emitClock = () => {
      const sample = book.best(nowMs());
      if (sample) setClock({ from: leaderFrom, sample });
    };

    const stopSync = () => {
      syncOn = false;
      clearInterval(resync);
      burstTimers.forEach(clearTimeout);
      burstTimers = [];
    };

    /** One reading of the leader's clock; false if the leader has none (older app). */
    const readClockOnce = async (): Promise<boolean> => {
      const id = deviceId;
      if (!id || cancelled) return true;
      const t0 = nowMs();
      let view: DataView;
      try {
        reads++;
        view = await BleClient.read(id, serviceUuid, STAGE_BLE_CLOCK_CHARACTERISTIC);
      } catch (e) {
        // A dropped link is handled by onDisconnect; a missing characteristic is an older leader.
        return !/not found|no such|unknown characteristic/i.test(String((e as { message?: unknown })?.message ?? e));
      } finally {
        reads--;
      }
      const t2 = nowMs();
      const t1 = await decodeClock(new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice(), key);
      if (t1 === null || cancelled || deviceId !== id) return true;
      if (book.add(t0, t1, t2)) {
        emitClock();
        // Its state may be plausible now that its clock is known.
        if (clockDropped) {
          clockDropped = false;
          void readNow();
        }
      }
      return true;
    };

    const runBurst = () => {
      if (!syncOn || cancelled) return;
      burstTimers.forEach(clearTimeout);
      burstUntil = nowMs() + BURST_READS * BURST_GAP_MS + 200;
      burstTimers = Array.from({ length: BURST_READS }, (_, i) =>
        setTimeout(() => {
          if (syncOn) void readClockOnce();
        }, i * BURST_GAP_MS),
      );
    };
    burstRef.current = runBurst;

    const startSync = async (id: string) => {
      if (bookDevice !== id) {
        book.clear();
        bookDevice = id;
      }
      // The first reading tells whether the leader's app has the clock at all.
      syncOn = true;
      if (!(await readClockOnce())) {
        // A leader on an older app: no clock over Bluetooth, the song still syncs.
        syncOn = false;
        return;
      }
      if (cancelled || !syncOn) return;
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
        reads++;
        let view: DataView;
        try {
          view = await BleClient.read(id, serviceUuid, STAGE_BLE_CHARACTERISTIC);
        } finally {
          reads--;
        }
        const result = await decodeStageState(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), savedRef.current, key);
        if (cancelled) return;
        // Far ahead of the leader's clock: made up (anyone with the band key can), never followed.
        // Not silently "connected": the clocks may just be far apart.
        const seq = result.ok ? result.state.seq : result.reason === 'setlist' ? result.seq : null;
        if (seq !== null && !plausibleFrom(seq, id)) {
          if (deviceId === id) {
            clockDropped = true;
            setStatus('clock-off');
          }
          return;
        }
        if (deviceId === id && (result.ok || result.reason === 'setlist')) {
          const heard = result.ok ? result.state : result;
          if (isNewer(heard, linkHeard)) linkHeard = { seq: heard.seq, from: heard.from };
        }
        if (result.ok) {
          if (deviceId === id && (!linkState || isNewer(result.state, linkState))) linkState = result.state;
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

    /**
     * Another phone advertising the gig, over a short link: what it leads
     * (seq and leader id), with its state when this phone has that setlist
     * (none: it leads a setlist this phone doesn't have yet), or nothing valid.
     */
    const probe = async (id: string): Promise<{ heard: Heard; state: StageLiveState | null } | null> => {
      // A phone linked as the leader (this session's, or a reopened one's): connecting again would replace its goodbye.
      if (leaderLinks.has(id)) return null;
      try {
        await BleClient.connect(id, () => {}, { timeout: PROBE_TIMEOUT_MS });
        // Short as well: the radio does one thing at a time, the leader's reads wait meanwhile.
        const view = await BleClient.read(id, serviceUuid, STAGE_BLE_CHARACTERISTIC, { timeout: PROBE_TIMEOUT_MS });
        const result = await decodeStageState(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), savedRef.current, key);
        if (result.ok) return plausibleFrom(result.state.seq, id) ? { heard: result.state, state: result.state } : null;
        if (result.reason === 'setlist' && plausibleFrom(result.seq, id)) return { heard: { seq: result.seq, from: result.from }, state: null };
        return null;
      } catch {
        return null;
      } finally {
        // Let go fully before anything links to it, unless something linked to it meanwhile (that link stays).
        // Through the plugin itself, with a short timeout: its queue (the leader's reads) never waits on a phone gone out of range.
        if (!leaderLinks.has(id)) await BluetoothLe.disconnect({ deviceId: id, timeout: PROBE_LET_GO_MS } as { deviceId: string }).catch(() => {});
      }
    };

    const scheduleCheck = () => {
      clearTimeout(checkTimer);
      // Sooner while the linked phone has served nothing, slowing down if that lasts.
      const idle = Math.min(IDLE_LEADER_CHECK_MS * 2 ** idleChecks, LEADER_CHECK_MS);
      if (!cancelled && deviceId) checkTimer = setTimeout(() => void checkLeaders(), linkHeard ? LEADER_CHECK_MS : idle);
    };

    /** Two admins in Stage: follow the one that leads (the newer state), not the first one found. */
    const checkLeaders = async () => {
      const current = deviceId;
      if (cancelled || !current) return;
      // Scans used up for now: look again when there's room.
      if (scanWaitMs() > 0) {
        clearTimeout(checkTimer);
        checkTimer = setTimeout(() => void checkLeaders(), scanWaitMs());
        return;
      }
      const found: string[] = [];
      try {
        lookScanning = true;
        scanStarts.push(Date.now());
        await BleClient.requestLEScan({ services: [serviceUuid] }, (r) => {
          const id = r.device.deviceId;
          if (id !== current && !knownSame(id) && !found.includes(id)) found.push(id);
        });
        await wait(LEADER_SCAN_MS);
        // Ended in every case (unless the search for a lost leader took it over),
        // or the next scan is refused as "already scanning".
        const mine = lookScanning;
        lookScanning = false;
        if (cancelled) return;
        if (mine) await BleClient.stopLEScan();
        if (deviceId !== current) return;
      } catch {
        lookScanning = false;
        /* Bluetooth off meanwhile: its own handler takes over */
      }
      // Every phone found, then the newest of them: not the first one newer than ours.
      let best: { id: string; heard: Heard } | null = null;
      for (const id of found) {
        // Never while the leader's song or clock reads wait (the radio does one thing at a time).
        while (radioBusy() && !cancelled && deviceId === current) await wait(100);
        if (cancelled || deviceId !== current) return;
        const theirs = await probe(id);
        if (cancelled || deviceId !== current) return;
        if (!theirs) continue;
        // The linked leader itself at another address (Android rotates it): the same leader id in its state.
        // Newer there than over the link: read the link again first (a change
        // on its way); still behind, the link is stuck and that phone is followed.
        if (linkHeard && theirs.heard.from === linkHeard.from) {
          if (isNewer(theirs.heard, linkHeard)) await readNow();
          if (cancelled || deviceId !== current) return;
          if (!linkHeard || !isNewer(theirs.heard, linkHeard)) {
            sameLeader.set(id, Date.now());
            continue;
          }
        }
        if (!best || isNewer(theirs.heard, best.heard)) best = { id, heard: theirs.heard };
      }
      // The newest leader wins, whether or not this phone has its setlist
      // (then the member is told to get it); only a strictly newer one takes
      // the link, so two admins on a setlist this phone lacks don't take turns.
      const next = best && isNewer(best.heard, linkHeard) ? best.id : null;
      if (next) {
        // Leave the old link quietly (its goodbye is ignored), then follow this one.
        link++;
        setDevice(null);
        linkState = null;
        linkHeard = null;
        stopSync();
        await BleClient.disconnect(current).catch(() => {});
        if (cancelled) return;
        linkTo(next);
        return;
      }
      if (!linkHeard) idleChecks++;
      scheduleCheck();
    };

    const later = () => {
      clearTimeout(retry);
      if (!cancelled) retry = setTimeout(() => void scan(), RETRY_MS);
    };

    const onDisconnect = (gen: number) => {
      if (gen !== link) return;
      link++;
      setDevice(null);
      linkState = null;
      linkHeard = null;
      clearTimeout(checkTimer);
      stopSync();
      if (cancelled) return;
      setStatus('searching');
      later();
    };

    const scan = async () => {
      if (cancelled) return;
      setStatus('searching');
      try {
        // A look's scan still running (the leader dropped mid-look): this search takes over.
        if (lookScanning) {
          lookScanning = false;
          await BleClient.stopLEScan().catch(() => {});
        }
        // Scans used up for now (Android would stop scanning without a word): start when there's room.
        const room = scanWaitMs();
        if (room > 0) {
          clearTimeout(retry);
          retry = setTimeout(() => void scan(), room);
          return;
        }
        scanStarts.push(Date.now());
        await BleClient.requestLEScan({ services: [serviceUuid] }, (result) => {
          if (deviceId || cancelled) return;
          linkTo(result.device.deviceId);
        });
        // Nothing found for a while: scan again (the radio, or an old look, may have ended this one).
        clearTimeout(retry);
        retry = setTimeout(() => {
          if (cancelled || deviceId) return;
          void BleClient.stopLEScan()
            .catch(() => {})
            .then(() => {
              if (!cancelled && !deviceId) void scan();
            });
        }, SEARCH_RESTART_MS);
      } catch (e) {
        if (cancelled) return;
        // A scan left running: the plugin stops it as it refuses this one, so try again shortly.
        if (/already scanning/i.test(String((e as { message?: unknown })?.message ?? e))) {
          later();
          return;
        }
        setStatus(bleProblem(e) === 'unsupported' ? 'unsupported' : 'bt-off');
      }
    };

    /** Link to this leader's phone: subscribe, read, measure its clock, keep an eye out for another admin. */
    function linkTo(id: string) {
      clearTimeout(retry);
      setDevice(id);
      linkState = null;
      linkHeard = null;
      idleChecks = 0;
      sameLeader = new Map();
      clockDropped = false;
      if (bookDevice !== id) {
        // Another phone: the last one's clock isn't this one's (and an older app has none to replace it).
        book.clear();
        bookDevice = id;
        leaderFrom = null;
        setClock(null);
      }
      const gen = ++link;
      void (async () => {
        try {
          await BleClient.stopLEScan();
          await BleClient.connect(id, () => onDisconnect(gen), {
            timeout: 10000,
          });
          // Only a change notice (the 4-byte seq) reads: on iOS the plugin also
          // hands every read's value to this callback, which would read forever.
          await BleClient.startNotifications(id, serviceUuid, STAGE_BLE_CHARACTERISTIC, (v) => {
            if (isChangeNotice(v)) void readNow();
          });
          // Closed, or Bluetooth went off meanwhile (that link is already dropped).
          if (cancelled || gen !== link) return;
          setStatus('connected');
          await readNow();
          if (gen === link) scheduleCheck();
          if (gen === link) await startSync(id);
        } catch {
          if (gen !== link) return;
          link++;
          setDevice(null);
          void BleClient.disconnect(id).catch(() => {});
          later();
        }
      })();
    }

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
      } catch (e) {
        // Not allowed or not supported: wait for the button (or a return from Settings).
        if (!cancelled) setStatus(bleProblem(e));
        return;
      }
      if (!watching) {
        watching = true;
        // Bluetooth turned off mid-song: stop talking to the radio at once (on
        // Android a call in flight then can take the app down), keep the clock.
        try {
          await BleClient.startEnabledNotifications((on) => {
            if (cancelled) return;
            clearTimeout(retry);
            if (!on) {
              // The link is gone with the radio (Android often never calls back): drop it here.
              const id = deviceId;
              link++;
              setDevice(null);
              linkState = null;
              linkHeard = null;
              clearTimeout(checkTimer);
              stopSync();
              if (id) void BleClient.disconnect(id).catch(() => {});
              setStatus('bt-off');
            } else if (!deviceId) {
              void boot();
            }
          });
        } catch {
          /* not available: Bluetooth off is still seen by the next scan */
        }
        if (cancelled) return;
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
        setStatus('bt-off');
        retry = setTimeout(() => void boot(), 5000);
        return;
      }
      await scan();
    };
    void boot();

    return () => {
      cancelled = true;
      clearTimeout(retry);
      clearTimeout(checkTimer);
      waits.forEach(clearTimeout);
      waits.clear();
      clearInterval(resync);
      burstTimers.forEach(clearTimeout);
      burstRef.current = () => {};
      setClock(null);
      if (watching) void BleClient.stopEnabledNotifications().catch(() => {});
      void BleClient.stopLEScan().catch(() => {});
      if (deviceId) {
        leaderLinks.delete(deviceId);
        void BleClient.disconnect(deviceId).catch(() => {});
      }
      setStatus('off');
    };
    // A reloaded setlist doesn't drop the link: reads use savedRef.
  }, [active, isLeader, eventId, attempt]);

  // Back from Settings (sent by the button): start again by itself. Not on any
  // resume: closing the system permission dialog resumes the app too, and
  // asking again then would show the dialog twice.
  useEffect(() => {
    if (!active) return;
    let handle: PluginListenerHandle | null = null;
    let gone = false;
    void App.addListener('resume', () => {
      if (!toSettingsRef.current) return;
      toSettingsRef.current = false;
      if (statusRef.current === 'denied' || statusRef.current === 'bt-off') setAttempt((n) => n + 1);
    })
      .then((h) => {
        if (gone) void h.remove();
        else handle = h;
      })
      .catch(() => {});
    return () => {
      gone = true;
      void handle?.remove();
    };
  }, [active]);

  /**
   * The one button of the status line: allow Bluetooth (asked again on
   * Android, else the app's Settings) or turn it on (Android).
   */
  const fix = useCallback(async () => {
    const android = Capacitor.getPlatform() === 'android';
    try {
      if (statusRef.current === 'bt-off') {
        if (android) await BleClient.requestEnable();
      } else if (statusRef.current === 'denied') {
        if (!android || askedAgainRef.current) {
          toSettingsRef.current = true;
          await BleClient.openAppSettings();
          return;
        }
        askedAgainRef.current = true;
      } else {
        return;
      }
    } catch {
      /* declined: the line stays */
      return;
    }
    setAttempt((n) => n + 1);
  }, []);

  return { status, publish, clock, burst, followers, fix };
}
