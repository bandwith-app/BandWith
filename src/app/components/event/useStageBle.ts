import { useCallback, useEffect, useRef, useState } from 'react';
import { BleClient, ConnectionPriority } from '@capacitor-community/bluetooth-le';
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
  decodeLive,
  encodeLive,
  type LiveEvent,
  type LiveEvents,
} from '@/lib/stageBleSync';
import { bestSample, clockSample, nowMs, type ClockSample, type PeerClock } from '@/lib/stageClick';
import type { StageLiveState } from '@/lib/stageLive';
import { bleProblem, type StageBleStatus } from '@/lib/stageBleNotice';
import { useFlag } from '@/lib/appFlags';

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
  /**
   * Members: one of the leader's live events (click, playhead, count-in) from
   * the live frame, unchecked: the same parser as on the Realtime channel
   * checks it. Called again with the same payloads on every read.
   */
  onLive?: (event: LiveEvent, payload: unknown) => void;
  /**
   * Leader: the stopped states to send as the last live frame. 'closing':
   * Stage closes, before Bluetooth stops. 'off': the click and playhead over
   * Bluetooth were switched off mid-show (app_flags ble_live) while they run.
   */
  farewell?: (why: 'closing' | 'off') => LiveEvents;
}

const RETRY_MS = 2000;
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
export function useStageBle({ eventId, savedIds, open, isLeader, onState, onLive, farewell }: Options) {
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
  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;
  const farewellRef = useRef(farewell);
  farewellRef.current = farewell;
  /** Leader: the newest payload of each live event, all served in one frame. */
  const liveRef = useRef<LiveEvents>({});
  const liveSeqRef = useRef(0);
  /** Leader: Bluetooth stopping after the last frame went out; a new start waits for it. */
  const stoppingRef = useRef<Promise<void>>(Promise.resolve());
  const savedRef = useRef(savedIds);
  savedRef.current = savedIds;
  const keyRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  /** Leader: the newest state, served again whenever Bluetooth (re)starts while Stage is open. */
  const lastStateRef = useRef<StageLiveState | null>(null);
  /** Stage mode is open (read in cleanups: a restart while open is not a goodbye). */
  const openRef = useRef(open);
  openRef.current = open;
  /** The hook is going away (Stage closed with it). */
  const goneRef = useRef(false);
  /**
   * Click / playhead clock over Bluetooth (app_flags ble_live, docs/flags.md).
   * Read when the leader starts: off then, it serves only the song (no clock
   * or live characteristic). Turned off mid-show, the leader's service is NOT
   * restarted (that would drop every member's link): it stops recalibrating,
   * and members stop reading the clock (`clock` null, the click uses the
   * Realtime clock). Turned on mid-show: from the next time Stage opens.
   * The live frame (click, playhead, count-in) follows the switch as it is
   * now, on both sides: off, the leader sends one last frame saying they
   * stopped and then serves no more, and a member reads none.
   */
  const bleLive = useFlag('ble_live');
  const bleLiveRef = useRef(bleLive);
  bleLiveRef.current = bleLive;
  /** Member: start / stop the clock reads on the current link (set by the member effect). */
  const syncCtlRef = useRef<{ start: () => void; stop: () => void } | null>(null);

  const active = open && !!eventId && stageBleAvailable() && savedIds.length > 0;

  const push = useCallback(async (state: StageLiveState) => {
    lastStateRef.current = state;
    const key = keyRef.current;
    // Not started yet: served as soon as it is.
    if (!key || !startedRef.current) return;
    const bytes = await encodeStageState(state, savedRef.current, key);
    if (!bytes) return;
    try {
      await StageBle.update({ value: toBase64(bytes), notify: toBase64(seqBytes(state.seq)) });
    } catch {
      /* Bluetooth off: the next state goes out when it's back */
    }
  }, []);

  /** Leader: serve the live frame (every event's newest payload); subscribers are told its seq. */
  const pushLive = useCallback(async (events: LiveEvents = liveRef.current, lastWords = false) => {
    const key = keyRef.current;
    if (!key || !startedRef.current) return;
    // Switched off: nothing goes out, but the frame that says it stopped (`lastWords`).
    if (!bleLiveRef.current && !lastWords) return;
    const seq = ++liveSeqRef.current;
    const bytes = await encodeLive(seq, events, key);
    if (!bytes) return;
    try {
      await StageBle.updateLive({ value: toBase64(bytes), notify: toBase64(seqBytes(seq)) });
    } catch {
      /* Bluetooth off: members read the frame when they link again */
    }
  }, []);

  /** Leader: a live event (click, playhead, count-in) for phones linked over Bluetooth. */
  const publishLive = useCallback(
    (event: LiveEvent, payload: unknown) => {
      if (!isLeader) return;
      liveRef.current = { ...liveRef.current, [event]: payload };
      void pushLive();
    },
    [isLeader, pushLive],
  );

  /** Leader: serve this state over Bluetooth too. */
  const publish = useCallback(
    (state: StageLiveState) => {
      if (!isLeader) return;
      void push(state);
    },
    [isLeader, push],
  );

  // Replayed only within one Stage session (a Bluetooth restart mid-show).
  // Stage closed, another event, or no longer the leader: the old state is
  // not what the leader shows now, so it is never served again.
  useEffect(() => {
    if (!open) lastStateRef.current = null;
  }, [open]);
  useEffect(() => {
    lastStateRef.current = null;
  }, [eventId, isLeader]);

  // Declared before the leader's effect, so its cleanup runs first on unmount.
  useEffect(
    () => () => {
      goneRef.current = true;
    },
    [],
  );

  // Leader: advertise while Stage mode is open.
  useEffect(() => {
    if (!active || !isLeader || !eventId) return;
    let cancelled = false;
    let listener: PluginListenerHandle | null = null;
    let recalibrate: ReturnType<typeof setInterval> | undefined;
    // Read once: a flip mid-show must not restart the service (see bleLive above).
    const withClock = bleLiveRef.current;
    const calibrate = async () => {
      if (!bleLiveRef.current) return;
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
      // Stopping from a moment ago (its last frame still going out) first.
      await stoppingRef.current;
      if (cancelled) return;
      try {
        // Empty until the first move; members ignore it. Asks for Bluetooth the first time.
        const { state } = await StageBle.start({
          serviceUuid,
          characteristicUuid: STAGE_BLE_CHARACTERISTIC,
          value: '',
          notify: '',
          ...(withClock ? { clockUuid: STAGE_BLE_CLOCK_CHARACTERISTIC, liveUuid: STAGE_BLE_LIVE_CHARACTERISTIC } : {}),
          key,
        });
        if (cancelled) return;
        startedRef.current = true;
        setStatus(leaderStatus(state));
        if (withClock) {
          // Clock reads carry the app's clock (the one `startAt` uses); kept right as the two drift.
          await calibrate();
          if (cancelled) return;
          recalibrate = setInterval(() => void calibrate(), CLOCK_RESYNC_MS);
        }
        // The newest state, and a click or playhead already running: sent before
        // Bluetooth was up, or before it restarted (Bluetooth back on, allowed again).
        if (lastStateRef.current) void push(lastStateRef.current);
        if (Object.keys(liveRef.current).length) void pushLive();
      } catch (e) {
        if (!cancelled) setStatus(bleProblem(e));
      }
    })();
    return () => {
      cancelled = true;
      clearInterval(recalibrate);
      setFollowers(0);
      void listener?.remove();
      // Stage closing: the band's phones hear that the click and the playhead
      // stopped, then Bluetooth stops. A restart while Stage stays open says
      // nothing stopped, and serves the same again once it is back.
      const closing = goneRef.current || !openRef.current;
      // Switched off: the stop went out when it was (below), nothing is served since.
      const last = closing && bleLiveRef.current ? (farewellRef.current?.('closing') ?? {}) : {};
      const goodbye = Object.keys(last).length > 0 && startedRef.current;
      const sent = goodbye ? pushLive({ ...liveRef.current, ...last }) : Promise.resolve();
      stoppingRef.current = sent
        .catch(() => {})
        .then(() => {
          startedRef.current = false;
          return StageBle.stop();
        })
        .catch(() => {});
      if (!goodbye) startedRef.current = false;
      if (closing) {
        liveRef.current = {};
        lastStateRef.current = null;
      }
      setStatus('off');
    };
  }, [active, isLeader, eventId, push, pushLive, attempt]);

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
    /** The leader's app has the live characteristic (not an older one). */
    let liveOn = false;

    /** The leader's id, from its state or its live events: the clock is tied to it. */
    const learnLeader = (from: unknown) => {
      if (typeof from !== 'string' || !from || from === leaderFrom) return;
      leaderFrom = from;
      emitClock();
    };

    const emitClock = () => {
      // Switched off: a read still in flight, or a new leader id, brings no clock back.
      if (!bleLiveRef.current) return;
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
        view = await BleClient.read(id, serviceUuid, STAGE_BLE_CLOCK_CHARACTERISTIC);
      } catch (e) {
        // A dropped link is handled by onDisconnect; a missing characteristic is an older leader.
        return !/not found|no such|unknown characteristic/i.test(String((e as { message?: unknown })?.message ?? e));
      }
      const t2 = nowMs();
      const t1 = await decodeClock(new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice(), key);
      if (t1 === null || cancelled || deviceId !== id) return true;
      if (book.add(t0, t1, t2)) emitClock();
      return true;
    };

    const runBurst = () => {
      if (!syncOn || cancelled) return;
      burstTimers.forEach(clearTimeout);
      burstTimers = Array.from({ length: BURST_READS }, (_, i) =>
        setTimeout(() => {
          if (syncOn) void readClockOnce();
        }, i * BURST_GAP_MS),
      );
    };
    burstRef.current = runBurst;

    const startSync = async (id: string) => {
      // Clock over Bluetooth switched off: like a leader on an older app.
      if (!bleLiveRef.current) return;
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
        const view = await BleClient.read(id, serviceUuid, STAGE_BLE_CHARACTERISTIC);
        const result = await decodeStageState(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), savedRef.current, key);
        if (cancelled) return;
        if (result.ok) {
          setStatus('connected');
          learnLeader(result.state.from);
          onStateRef.current(result.state);
        } else if (result.reason === 'setlist') {
          // Not silently "connected": this phone needs the setlist again (internet).
          setStatus('outdated');
        }
      } catch {
        /* a dropped link is handled by onDisconnect */
      }
    };

    /** The live frame: the leader's click, playhead and count-in, as they are now. */
    const readLive = async (again = true) => {
      const id = deviceId;
      // Switched off (ble_live): the click and playhead don't come over Bluetooth, the song still does.
      if (!id || !liveOn || cancelled || !bleLiveRef.current) return;
      let view: DataView;
      try {
        view = await BleClient.read(id, serviceUuid, STAGE_BLE_LIVE_CHARACTERISTIC);
      } catch {
        return; /* a dropped link is handled by onDisconnect */
      }
      const frame = await decodeLive(new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice(), key);
      // Switched off while the read was on its way: it brings nothing.
      if (cancelled || deviceId !== id || !bleLiveRef.current) return;
      if (!frame) {
        // Read while the leader changed it (a long read in two parts): once more.
        if (again) setTimeout(() => void readLive(false), 100);
        return;
      }
      for (const [event, payload] of Object.entries(frame.events) as Array<[LiveEvent, unknown]>) {
        learnLeader((payload as { from?: unknown })?.from);
        onLiveRef.current?.(event, payload);
      }
    };

    const later = () => {
      clearTimeout(retry);
      if (!cancelled) retry = setTimeout(() => void scan(), RETRY_MS);
    };

    const onDisconnect = (gen: number) => {
      if (gen !== link) return;
      link++;
      deviceId = null;
      stopSync();
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
          const gen = ++link;
          void (async () => {
            try {
              await BleClient.stopLEScan();
              await BleClient.connect(id, () => onDisconnect(gen), { timeout: 10000 });
              await BleClient.startNotifications(id, serviceUuid, STAGE_BLE_CHARACTERISTIC, () => void readNow());
              // Click, playhead, count-in: a leader on an older app has none.
              liveOn = await BleClient.startNotifications(id, serviceUuid, STAGE_BLE_LIVE_CHARACTERISTIC, () => void readLive()).then(
                () => true,
                () => false,
              );
              // Closed, or Bluetooth went off meanwhile (that link is already dropped).
              if (cancelled || gen !== link) return;
              setStatus('connected');
              await readNow();
              // Where the band is right now: a phone that (re)connects mid-song lands on the beat.
              if (gen === link) await readLive();
              if (gen === link) await startSync(id);
            } catch {
              if (gen !== link) return;
              link++;
              deviceId = null;
              void BleClient.disconnect(id).catch(() => {});
              later();
            }
          })();
        });
      } catch (e) {
        if (!cancelled) setStatus(bleProblem(e) === 'unsupported' ? 'unsupported' : 'bt-off');
      }
    };

    syncCtlRef.current = {
      start: () => {
        if (deviceId && !syncOn) void startSync(deviceId);
        // Back on: where the band is now (frames meanwhile were not read).
        void readLive();
      },
      stop: () => {
        stopSync();
        book.clear();
        bookDevice = null;
        setClock(null);
      },
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
              deviceId = null;
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
      clearInterval(resync);
      burstTimers.forEach(clearTimeout);
      burstRef.current = () => {};
      syncCtlRef.current = null;
      setClock(null);
      if (watching) void BleClient.stopEnabledNotifications().catch(() => {});
      void BleClient.stopLEScan().catch(() => {});
      if (deviceId) void BleClient.disconnect(deviceId).catch(() => {});
      setStatus('off');
    };
    // A reloaded setlist doesn't drop the link: reads use savedRef.
  }, [active, isLeader, eventId, attempt]);

  // Member: the switch flipped while linked: stop (or start) the clock reads, the song link stays.
  useEffect(() => {
    if (isLeader) return;
    if (bleLive) syncCtlRef.current?.start();
    else syncCtlRef.current?.stop();
  }, [bleLive, isLeader]);

  // Leader: the switch flipped while serving. Off: one last frame says the click
  // and the playhead stopped (a phone that still reads them, its own switch not
  // read yet or with no signal, stops instead of running on what it last got),
  // then nothing more goes out. Back on: what runs now is served again.
  const wasLiveRef = useRef(bleLive);
  useEffect(() => {
    if (wasLiveRef.current === bleLive) return;
    wasLiveRef.current = bleLive;
    if (!isLeader || !startedRef.current) return;
    if (bleLive) {
      if (Object.keys(liveRef.current).length) void pushLive();
      return;
    }
    const last = farewellRef.current?.('off') ?? {};
    if (Object.keys(last).length) void pushLive({ ...liveRef.current, ...last }, true);
  }, [bleLive, isLeader, pushLive]);

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

  return { status, publish, publishLive, clock, burst, followers, fix };
}
