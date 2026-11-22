import { useCallback, useEffect, useRef, useState } from 'react';
import { BleClient, ConnectionPriority } from '@capacitor-community/bluetooth-le';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StageBle, keptVerifyKey, stageBleAvailable, stageKey, stageSigner, stageVerifyKey } from '@/lib/stageBleNative';
import {
  STAGE_BLE_CHARACTERISTIC,
  STAGE_BLE_SIGNED_CHARACTERISTIC,
  decodeSignedState,
  decodeStageState,
  encodeSignedState,
  encodeStageState,
  seqBytes,
  stageServiceUuid,
  toBase64,
} from '@/lib/stageBle';
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
import type { StageSigner, StageVerifyKey } from '@/lib/stageSign';
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
  /**
   * A checked state from the leader (members only). `signed`: it carries the
   * admins' signature, so it counts like a Realtime one (a band-key state,
   * which any member could make, never holds it back).
   */
  onState: (state: StageLiveState, signed?: boolean) => void;
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
/** How long such a look scans. */
const LEADER_SCAN_MS = 2_000;
/** A look's short link to another phone: a phone out of range mustn't hold up the leader's reads. */
export const PROBE_TIMEOUT_MS = 2_000;
/** Searching with nothing found: start the scan again this often (the radio can end one by itself). */
export const SEARCH_RESTART_MS = 10_000;
/** A phone whose states aren't the leader's (a failed signature) is skipped this long. */
export const DISTRUST_MS = 60_000;
/** A band-key phone refused once the admins signed is skipped this long. */
const REFUSED_SKIP_MS = 30_000;
/** A leader signing with a newer pair than this phone's: tried again this often (the key is asked for each time). */
const STALE_RETRY_MS = 5_000;
/** The public key is asked for again at most this often (a newer pair seen on a phone in range). */
const VERIFY_REFRESH_MS = 30_000;
/**
 * How good a phone is to follow: one that leads (signed above band-key),
 * then one leading a setlist this phone lacks (the member is told to get it),
 * then one that leads nothing (signed above band-key). The newer state breaks
 * a tie between two that lead.
 */
const leaderRank = (state: StageLiveState | null, signed: boolean, outdated: boolean) => (state ? (signed ? 4 : 3) : outdated ? 2 : signed ? 1 : 0);
/**
 * Band-key states (older apps, and anyone posing as one) are refused this long
 * after this phone last checked a signed state for the gig: the admins lead
 * with a signing app, so a band-key "leader" then is a member posing as one.
 */
export const SIGNED_TRUST_MS = 10 * 60_000;
/** When this phone last checked a signed state, per gig (kept across closing Stage). */
const signedSeen = new Map<string, number>();
/** Tests: start with no signed leader seen. */
export const forgetSignedLeaders = () => signedSeen.clear();
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
/** The characteristics a leader's phone serves (lower case), or none if they can't be listed. */
async function servedBy(id: string): Promise<string[]> {
  try {
    const services = await BleClient.getServices(id);
    return services.flatMap((s) => s.characteristics.map((c) => c.uuid.toLowerCase()));
  } catch {
    return [];
  }
}

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
 * and read.
 *
 * Who may lead (audit #1): the leader signs its state and its clock with the
 * gig's private key, which only admins get (migration 190); members check it
 * with the public key, so a member can't pose as the leader. For apps from
 * before that, the leader also serves the old state, made with the band key
 * (migration 087). A member facing a leader on such an app still follows it
 * (status 'old-leader': the line asks to update the leader's app); a signed
 * leader always wins over one of those.
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
  const signerRef = useRef<StageSigner | null>(null);
  const startedRef = useRef(false);
  const pendingRef = useRef<StageLiveState | null>(null);

  const active = open && !!eventId && stageBleAvailable() && savedIds.length > 0;

  const push = useCallback(async (state: StageLiveState) => {
    const key = keyRef.current;
    if (!key || !startedRef.current) {
      pendingRef.current = state;
      return;
    }
    const signer = signerRef.current;
    const bytes = await encodeStageState(state, savedRef.current, key);
    const signed = signer ? await encodeSignedState(state, savedRef.current, signer.private, signer.version) : null;
    const notify = toBase64(seqBytes(state.seq));
    try {
      // Older apps read the band-key state; this app the signed one.
      if (bytes) await StageBle.update({ value: toBase64(bytes), notify });
      if (signed) await StageBle.updateSigned({ value: toBase64(signed), notify });
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
      // No key pair on this phone (offline before it was made): it leads as
      // older apps do, members on this app show the "update" line.
      const signer = await stageSigner(eventId);
      if (cancelled) return;
      keyRef.current = key;
      signerRef.current = signer;
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
          liveUuid: STAGE_BLE_LIVE_CHARACTERISTIC,
          // The clock is signed by the leader too: no key pair, no clock.
          ...(signer
            ? {
                clockUuid: STAGE_BLE_CLOCK_CHARACTERISTIC,
                signedUuid: STAGE_BLE_SIGNED_CHARACTERISTIC,
                signKey: signer.private,
              }
            : {}),
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
    const gig = eventId;
    let cancelled = false;
    let deviceId: string | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let serviceUuid = '';
    let key = '';
    /** The gig's public key and its version (null: none made yet when this phone was online). */
    let verify: StageVerifyKey | null = null;
    let verifyAskedAt = -Infinity;
    /** The server's public key (online), or the kept copy (offline); `force`: even if asked lately. */
    const refreshVerify = async (force = false) => {
      if (!force && nowMs() - verifyAskedAt < VERIFY_REFRESH_MS) return;
      verifyAskedAt = nowMs();
      const fresh = await stageVerifyKey(gig);
      if (!cancelled) verify = fresh;
    };
    /** The leader signs with a newer pair than this phone has: it needs one trip online. */
    let staleKey = false;
    /** The linked phone serves the signed state, and this phone can check it. */
    let signedLink = false;
    /** Phones that served a state with a wrong signature, until when they're skipped. */
    const distrusted = new Map<string, number>();
    const trusted = (id: string) => (distrusted.get(id) ?? 0) <= nowMs();
    /** Failed checks in a row on this link (a read caught mid-change fails once). */
    let authFails = 0;
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
    let checkTimer: ReturnType<typeof setTimeout> | undefined;
    /** Looks in a row that found nothing while the linked phone served nothing: they slow down. */
    let idleChecks = 0;
    /** Song and clock reads under way (a look waits for them: the radio does one thing at a time). */
    let reads = 0;
    /** A clock burst runs until then (a look doesn't probe meanwhile). */
    let burstUntil = 0;
    /** Other addresses of the linked leader's phone (Android rotates them): not probed again. */
    let sameLeader = new Set<string>();
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
      // Only the leader's signed clock counts: none from an older leader.
      if (!signedLink || !verify) return false;
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
      const t1 = await decodeClock(new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice(), verify.public);
      if (t1 === null || cancelled || deviceId !== id) return true;
      if (book.add(t0, t1, t2)) emitClock();
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

    /** A phone's state: the signed one if it serves it (and this phone can check it), else the band-key one. */
    const readState = async (id: string, signed: boolean, timeout?: number) => {
      const view = await BleClient.read(
        id,
        serviceUuid,
        signed ? STAGE_BLE_SIGNED_CHARACTERISTIC : STAGE_BLE_CHARACTERISTIC,
        timeout ? { timeout } : undefined,
      );
      const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      if (!signed || !verify) return decodeStageState(bytes, savedRef.current, key);
      const result = await decodeSignedState(bytes, savedRef.current, verify.public, verify.version);
      // The admins' signature checked (a setlist this phone lacks included): band-key states are refused for a while.
      if (result.ok || result.reason === 'setlist') signedSeen.set(gig, Date.now());
      return result;
    };

    /** Band-key states are refused: this phone can check signatures and saw the admins sign lately. */
    const legacyRefused = () => !!verify && Date.now() - (signedSeen.get(gig) ?? -Infinity) < SIGNED_TRUST_MS;
    /** The linked phone leads a setlist this phone doesn't have. */
    let linkOutdated = false;

    /** Leave the linked phone (its goodbye is ignored), skip it for `skipMs`, and search again. */
    const dropLink = (id: string, skipMs: number) => {
      distrusted.set(id, nowMs() + skipMs);
      link++;
      setDevice(null);
      linkState = null;
      clearTimeout(checkTimer);
      stopSync();
      void BleClient.disconnect(id).catch(() => {});
      setStatus('searching');
      later();
    };

    /** Linked to an older app's leader (no signed state): 'old-leader', the line asks to update it. */
    let oldLeader = false;
    const linkedStatus = (): StageBleStatus => (staleKey ? 'stale-key' : oldLeader ? 'old-leader' : 'connected');

    const readNow = async () => {
      const id = deviceId;
      if (!id) return;
      try {
        reads++;
        let result: Awaited<ReturnType<typeof readState>>;
        try {
          result = await readState(id, signedLink);
        } finally {
          reads--;
        }
        if (cancelled || deviceId !== id) return;
        if (!result.ok && result.reason === 'stale') {
          // A newer pair than this phone's (an admin stopped being one since): not a forger. Online, the server has it.
          const had = verify?.version;
          await refreshVerify(true);
          if (cancelled || deviceId !== id) return;
          if (verify && verify.version !== had) {
            void readNow();
            return;
          }
          // Offline: say so plainly, and try this phone again shortly.
          staleKey = true;
          dropLink(id, STALE_RETRY_MS);
          setStatus('stale-key');
          return;
        }
        if (!result.ok && result.reason === 'auth') {
          // Once: maybe a read caught mid-change. Twice: not the leader (a
          // member posing as one): leave it, skip it for a while.
          if (++authFails < 2) {
            setTimeout(() => void readNow(), 300);
            return;
          }
          dropLink(id, DISTRUST_MS);
          return;
        }
        // A band-key state once the admins signed: not followed (see SIGNED_TRUST_MS).
        if (!signedLink && legacyRefused()) {
          dropLink(id, REFUSED_SKIP_MS);
          return;
        }
        // Far ahead of the clock: made up (anyone with the band key can), never followed.
        if (result.ok && !seqPlausible(result.state.seq)) return;
        if (result.ok) {
          authFails = 0;
          linkOutdated = false;
          staleKey = false;
          if (!linkState || isNewer(result.state, linkState)) linkState = result.state;
          setStatus(linkedStatus());
          if (result.state.from !== leaderFrom) {
            leaderFrom = result.state.from;
            emitClock();
          }
          if (signedLink) onStateRef.current(result.state, true);
          else onStateRef.current(result.state);
        } else if (result.reason === 'setlist') {
          linkOutdated = true;
          // Not silently "connected": this phone needs the setlist again (internet).
          setStatus('outdated');
        }
      } catch {
        /* a dropped link is handled by onDisconnect */
      }
    };

    /**
     * Another phone advertising the gig, over a short link: its state (signed
     * or band-key), or `outdated` (it leads a setlist this phone doesn't have
     * yet), or nothing valid.
     */
    const probe = async (id: string): Promise<{ state: StageLiveState; signed: boolean } | { outdated: true; signed: boolean } | null> => {
      // A phone linked as the leader (this session's, or a reopened one's): connecting again would replace its goodbye.
      if (leaderLinks.has(id)) return null;
      try {
        await BleClient.connect(id, () => {}, { timeout: PROBE_TIMEOUT_MS });
        const signed = !!verify && (await servedBy(id)).includes(STAGE_BLE_SIGNED_CHARACTERISTIC);
        // Short as well: the radio does one thing at a time, the leader's reads wait meanwhile.
        const result = await readState(id, signed, PROBE_TIMEOUT_MS);
        if (result.ok) return seqPlausible(result.state.seq) ? { state: result.state, signed } : null;
        // A newer pair on that phone: this one's key may be out of date.
        if (result.reason === 'stale') void refreshVerify();
        return result.reason === 'setlist' ? { outdated: true, signed } : null;
      } catch {
        return null;
      } finally {
        // Let go fully before anything links to it, unless something linked to it meanwhile (that link stays).
        if (!leaderLinks.has(id)) await BleClient.disconnect(id).catch(() => {});
      }
    };

    const scheduleCheck = () => {
      clearTimeout(checkTimer);
      // Sooner while the linked phone has served nothing, slowing down if that lasts.
      const idle = Math.min(IDLE_LEADER_CHECK_MS * 2 ** idleChecks, LEADER_CHECK_MS);
      if (!cancelled && deviceId) checkTimer = setTimeout(() => void checkLeaders(), linkState ? LEADER_CHECK_MS : idle);
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
          if (id !== current && trusted(id) && !sameLeader.has(id) && !found.includes(id)) found.push(id);
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
      // Every phone found, then the best of them: not the first one better than ours.
      const candidates: { id: string; state: StageLiveState | null; signed: boolean }[] = [];
      for (const id of found) {
        // Never while the leader's song or clock reads wait (the radio does one thing at a time).
        while (radioBusy() && !cancelled && deviceId === current) await wait(100);
        if (cancelled || deviceId !== current) return;
        const theirs = await probe(id);
        if (cancelled || deviceId !== current) return;
        // The linked leader itself at another address (Android rotates it): the same leader id in its state.
        if (theirs && 'state' in theirs && linkState && theirs.state.from === linkState.from) {
          sameLeader.add(id);
          continue;
        }
        if (theirs) candidates.push({ id, state: 'state' in theirs ? theirs.state : null, signed: theirs.signed });
      }
      // After the probes: one of them may just have shown the admins' signature.
      const refused = legacyRefused();
      let best: (typeof candidates)[number] | null = null;
      let bestRank = -1;
      for (const c of candidates) {
        if (!c.signed && refused) continue;
        const r = leaderRank(c.state, c.signed, !c.state);
        if (r > bestRank || (r === bestRank && c.state && best?.state && isNewer(c.state, best.state))) {
          best = c;
          bestRank = r;
        }
      }
      const ours = !signedLink && refused ? -1 : leaderRank(linkState, signedLink, linkOutdated);
      const next = best && (bestRank > ours || (bestRank === ours && best.state && linkState && isNewer(best.state, linkState))) ? best.id : null;
      if (!next && ours < 0) {
        // Linked to a band-key phone once the admins signed, and no one better: leave it.
        dropLink(current, REFUSED_SKIP_MS);
        return;
      }
      if (next) {
        // Leave the old link quietly (its goodbye is ignored), then follow this one.
        link++;
        setDevice(null);
        linkState = null;
        stopSync();
        await BleClient.disconnect(current).catch(() => {});
        if (cancelled) return;
        linkTo(next);
        return;
      }
      if (!linkState) idleChecks++;
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
      clearTimeout(checkTimer);
      stopSync();
      if (cancelled) return;
      setStatus('searching');
      later();
    };

    const scan = async () => {
      if (cancelled) return;
      setStatus(staleKey ? 'stale-key' : 'searching');
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
          if (deviceId || cancelled || !trusted(result.device.deviceId)) return;
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
      idleChecks = 0;
      sameLeader = new Set();
      if (bookDevice !== id) {
        // Another phone: the last one's clock isn't this one's (and an older app has none to replace it).
        book.clear();
        bookDevice = id;
        leaderFrom = null;
        setClock(null);
      }
      signedLink = false;
      oldLeader = false;
      linkOutdated = false;
      authFails = 0;
      const gen = ++link;
      void (async () => {
        try {
          await BleClient.stopLEScan();
          await BleClient.connect(id, () => onDisconnect(gen), {
            timeout: 10000,
          });
          // The public key, if this phone has none yet (online now, say).
          if (!verify) await refreshVerify(true);
          const served = await servedBy(id);
          if (cancelled || gen !== link) return;
          const signs = served.includes(STAGE_BLE_SIGNED_CHARACTERISTIC);
          signedLink = signs && !!verify;
          // An older app's leader (characteristics listed, none signed).
          oldLeader = served.length > 0 && !signs;
          // Once the admins signed, a band-key phone isn't followed (see SIGNED_TRUST_MS).
          if (!signedLink && legacyRefused()) {
            dropLink(id, REFUSED_SKIP_MS);
            return;
          }
          // Only a change notice (the 4-byte seq) reads: on iOS the plugin also
          // hands every read's value to this callback, which would read forever.
          await BleClient.startNotifications(id, serviceUuid, signedLink ? STAGE_BLE_SIGNED_CHARACTERISTIC : STAGE_BLE_CHARACTERISTIC, (v) => {
            if (isChangeNotice(v)) void readNow();
          });
          // Closed, or Bluetooth went off meanwhile (that link is already dropped).
          if (cancelled || gen !== link) return;
          setStatus(linkedStatus());
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
      if (!verify) {
        // The kept copy at once (offline on stage), the server's meanwhile (a rotated pair).
        verify = keptVerifyKey(gig);
        if (verify) void refreshVerify(true);
        else await refreshVerify(true);
      }
      if (cancelled) return;
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
