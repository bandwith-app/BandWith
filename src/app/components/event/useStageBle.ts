import { useCallback, useEffect, useRef, useState } from 'react';
import { BleClient, BluetoothLe, ConnectionPriority } from '@capacitor-community/bluetooth-le';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import {
  STAGE_KEY_EVENT,
  StageBle,
  fetchStageKey,
  fetchVerifyKey,
  forgetStageKeys,
  keptVerifyKey,
  previousStageKey,
  signerRefused,
  stageBleAvailable,
  stageSigner,
} from '@/lib/stageBleNative';
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
  decodeLive,
  encodeLive,
  type LiveEvent,
  type LiveEvents,
} from '@/lib/stageBleSync';
import { bestSample, clockSample, nowMs, type ClockSample, type PeerClock } from '@/lib/stageClick';
import { isNewer, seqPlausible, SEQ_AHEAD_MEASURED, usableOffset, type StageLiveState } from '@/lib/stageLive';
import { pairMatches, type StageSigner, type StageVerifyAnswer, type StageVerifyKey } from '@/lib/stageSign';
import { bleProblem, type StageBleStatus } from '@/lib/stageBleNotice';
import { useFlag } from '@/lib/appFlags';
import { forgetAllSignedMemory, noteSignedSeen, noteSignedTop, signedMemory } from '@/lib/stageSignedMemory';

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
  /**
   * Members: one of the leader's live events (click, playhead, count-in) from
   * the live frame, unchecked: the same parser as on the Realtime channel
   * checks it. Called again with the same payloads on every read.
   * The count-in also gets `signed`: the frame was read from a phone whose
   * state carried the admins' signature, checked on this link (the frame
   * itself is checked with the band key, which every member has). The click
   * and the playhead are handed on as before, with no third argument.
   */
  onLive?: (event: LiveEvent, payload: unknown, signed?: boolean) => void;
  /**
   * Leader: the stopped states to send as the last live frame. 'closing':
   * Stage closes, before Bluetooth stops. 'off': the click and playhead over
   * Bluetooth were switched off mid-show (app_flags ble_live) while they run.
   */
  farewell?: (why: 'closing' | 'off') => LiveEvents;
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
/** "Newer pair" failures in a row, offline, before the line asks for one trip online. */
export const NEWER_FAILS_STALE = 3;
/** How long a leader's first state waits for its clock to be measured (then the 5-minute rule). */
export const CLOCK_HOLD_MS = 3_000;
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
/** A phone whose states aren't the leader's (a failed signature) is skipped this long. */
export const DISTRUST_MS = 60_000;
/**
 * The leader asks the server this often whether it may still sign (still an
 * admin, the same pair): a demoted admin's phone stops signing at the next
 * check while online. Offline it keeps the kept pair (members with the new
 * pair refuse it, see migration 190's rotation).
 */
export const SIGNER_RECHECK_MS = 5 * 60_000;
/** What a signing leader serves before its first move: "here, leading nothing" (seq 0, signed only). */
const IDLE_STATE: StageLiveState = { seq: 0, from: '-', songId: null, order: null };
/** Seq 0: a leader saying it's there, leading nothing (its signature still counts). */
const leadsNothing = (seq: number) => seq === 0;
/** Failed signature checks within AUTH_FAIL_WINDOW_MS that make a phone "not the leader". */
const AUTH_FAILS_MAX = 3;
const AUTH_FAIL_WINDOW_MS = 10_000;
/** A band-key phone refused once the admins signed is skipped this long. */
const REFUSED_SKIP_MS = 30_000;
/** Skips double for each refusal in a row (REFUSED_SKIP_MS, STALE_RETRY_MS), up to this. */
const SKIP_MAX_MS = 60_000;
const backoff = (base: number, streak: number) => Math.min(base * 2 ** streak, SKIP_MAX_MS);
/** A leader signing with a newer pair than this phone's: tried again this often (the key is asked for each time). */
const STALE_RETRY_MS = 5_000;
/** The public key is asked for again at most this often (a newer pair seen on a phone in range). */
const VERIFY_REFRESH_MS = 30_000;
/**
 * How good a phone is to follow: one that leads (signed above band-key),
 * this phone's setlist or not (on another, the member is told to get it),
 * then one that leads nothing (signed above band-key). The newer state
 * breaks a tie between two that lead.
 */
const leaderRank = (leads: boolean, signed: boolean) => (leads ? (signed ? 3 : 2) : signed ? 1 : 0);
/**
 * Band-key states (older apps, and anyone posing as one) are refused this long
 * after this phone last checked a signed state for the gig: the admins lead
 * with a signing app, so a band-key "leader" then is a member posing as one.
 */
export const SIGNED_TRUST_MS = 10 * 60_000;
/** Tests: start with no signed leader seen (what each gig remembers: src/lib/stageSignedMemory.ts). */
export const forgetSignedLeaders = () => forgetAllSignedMemory();
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
/**
 * The characteristics a leader's phone serves (lower case), or null if they
 * can't be listed (a dropped packet): unknown, never "none signed", or the
 * phone would be followed as a band-key leader.
 */
/** Which of these services a linked phone serves (the first found), or null when it can't tell. */
async function servedService(id: string, services: string[]): Promise<string | null> {
  try {
    const found = (await BleClient.getServices(id)).map((s) => s.uuid.toLowerCase());
    return services.find((s) => found.includes(s.toLowerCase())) ?? null;
  } catch {
    return null;
  }
}

async function servedBy(id: string): Promise<string[] | null> {
  try {
    const services = await BleClient.getServices(id);
    const chars = services.flatMap((s) => s.characteristics.map((c) => c.uuid.toLowerCase()));
    return chars.length ? chars : null;
  } catch {
    return null;
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
/** While Stage is open, the band key is asked for again this often (191 changes it when someone may no longer see the gig). */
export const KEY_RECHECK_MS = 60_000;
/** And this often while there is none yet (a first fetch answered late, or offline). */
export const KEY_WAIT_MS = 5_000;

export function useStageBle({ eventId, savedIds, open, isLeader, onState, onLive, farewell }: Options) {
  const [status, setStatus] = useState<StageBleStatus>('off');
  const [clock, setClockState] = useState<PeerClock | null>(null);
  /** The same clock, set at once: a state read right after a clock sample is judged with it (no render in between). */
  const clockRef = useRef<PeerClock | null>(null);
  const setClock = useCallback((c: PeerClock | null) => {
    clockRef.current = c;
    setClockState(c);
  }, []);
  /** Leader: phones linked to it. */
  const [followers, setFollowers] = useState(0);
  /** Leading with no key pair: phones on this app can't check the leader (the notice says so). */
  const [unsigned, setUnsigned] = useState(false);
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
  /** Leader: a frame is due at the end of this turn (states set together go out as one). */
  const liveDueRef = useRef(false);
  /** Leader: Bluetooth stopping after the last frame went out; a new start waits for it. */
  const stoppingRef = useRef<Promise<void>>(Promise.resolve());
  const savedRef = useRef(savedIds);
  savedRef.current = savedIds;
  const keyRef = useRef<string | null>(null);
  const signerRef = useRef<StageSigner | null>(null);
  /** The band key Bluetooth runs with now (leader or member; null: none yet). */
  const inUseKeyRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const pendingRef = useRef<StageLiveState | null>(null);
  /** Leader: the last state served this Stage session (null: none yet), served again when Stage starts again (a new pair). */
  const lastPushedRef = useRef<StageLiveState | null>(null);
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

  /**
   * The server said no to the band key (this account may no longer see the
   * gig, 191): Bluetooth stops at once, leader and member, and starts again
   * only if a later check gets a key (Claude round 8 on #283).
   */
  const [keyDenied, setKeyDenied] = useState(false);
  const keyDeniedRef = useRef(false);
  keyDeniedRef.current = keyDenied;
  useEffect(() => setKeyDenied(false), [eventId]);
  const ready = open && !!eventId && stageBleAvailable() && savedIds.length > 0;
  const active = ready && !keyDenied;

  const push = useCallback(async (state: StageLiveState) => {
    lastStateRef.current = state;
    const key = keyRef.current;
    if (!key || !startedRef.current) {
      pendingRef.current = state;
      return;
    }
    lastPushedRef.current = state;
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

  /** Leader: serve the live frame (every event's newest payload); subscribers are told its seq. */
  const pushLive = useCallback(async (events: LiveEvents = liveRef.current, lastWords = false) => {
    const key = keyRef.current;
    if (!key || !startedRef.current) return;
    // Switched off: nothing goes out, but the frame that says it stopped (`lastWords`).
    if (!bleLiveRef.current && !lastWords) return;
    const seq = ++liveSeqRef.current;
    let bytes = await encodeLive(seq, events, key);
    // Too long for one value with the count-in in it: the click and the playhead still go out
    // (tested never to happen with what the app makes: src/lib/__tests__/countInBle.test.ts).
    if (!bytes && events.countin !== undefined) bytes = await encodeLive(seq, { ...events, countin: undefined }, key);
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
      // States set in the same turn go out as one frame, with one change notice: a count-in start
      // is the count, the playhead at bar 1 and the running click, and a phone that read between
      // two of them would have the count without the bar it leads to.
      if (liveDueRef.current) return;
      liveDueRef.current = true;
      queueMicrotask(() => {
        liveDueRef.current = false;
        // Stage closed meanwhile: its last frame went out, nothing is served after it.
        if (Object.keys(liveRef.current).length) void pushLive();
      });
    },
    [isLeader, pushLive],
  );

  /**
   * Leader, as Stage (re)starts: the last state served (Stage starting again
   * with a new pair, or after a role check), signed with the pair it has now
   * and on the band-key state too, with a change notice; before any move,
   * "here, leading nothing", signed only (members then refuse band-key phones).
   */
  const sayHere = useCallback(async () => {
    const last = lastPushedRef.current;
    if (last) return push(last);
    const signer = signerRef.current;
    if (!signer || !startedRef.current) return;
    const signed = await encodeSignedState(IDLE_STATE, savedRef.current, signer.private, signer.version);
    if (!signed || !startedRef.current || signerRef.current !== signer) return;
    try {
      await StageBle.updateSigned({ value: toBase64(signed), notify: '' });
    } catch {
      /* Bluetooth off: the first move serves the state */
    }
  }, [push]);

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
    let recheck: ReturnType<typeof setInterval> | undefined;
    let onOnline: (() => void) | null = null;
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
      const answer = await fetchStageKey(eventId);
      if (cancelled) return;
      if (answer.denied) {
        inUseKeyRef.current = null;
        setKeyDenied(true);
        return;
      }
      const key = answer.key;
      inUseKeyRef.current = key;
      // No key yet: the key watch below starts again once there is one.
      if (!key) return;
      // No key pair on this phone (offline before it was made): it leads as
      // older apps do, members on this app show the "update" line.
      const fetched = await stageSigner(eventId);
      // A pair whose private key doesn't match its public one would sign frames nobody accepts.
      const signer = fetched && (await pairMatches(fetched)) ? fetched : null;
      if (cancelled) return;
      // The server said this account is no longer an admin: it still serves (older apps may follow),
      // and is told another admin needs to lead (Claude on #288).
      const notAdmin = !fetched && signerRefused(eventId);
      const asLeader = (state: string): StageBleStatus => {
        const st = leaderStatus(state);
        return notAdmin && st === 'leading' ? 'not-admin' : st;
      };
      keyRef.current = key;
      signerRef.current = signer;
      setUnsigned(!signer);
      const serviceUuid = await stageServiceUuid(key);
      const handle = await StageBle.addListener('stateChange', ({ state, subscribers }) => {
        setStatus(asLeader(state));
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
          // Click and playhead over Bluetooth: only with their switch on at start (ble_live).
          ...(withClock ? { liveUuid: STAGE_BLE_LIVE_CHARACTERISTIC } : {}),
          // The clock is signed by the leader too: no key pair, no clock. Nor with the switch off.
          ...(signer
            ? {
                ...(withClock ? { clockUuid: STAGE_BLE_CLOCK_CHARACTERISTIC } : {}),
                signedUuid: STAGE_BLE_SIGNED_CHARACTERISTIC,
                signKey: signer.private,
              }
            : {}),
        });
        if (cancelled) return;
        startedRef.current = true;
        setStatus(asLeader(state));
        // Bluetooth restarted while Stage stayed open (Bluetooth back on, allowed again, the setlist
        // back): the newest state goes out again, as the move waiting.
        if (!pendingRef.current && !lastPushedRef.current && lastStateRef.current) pendingRef.current = lastStateRef.current;
        // "Here" at once: the current state, or leading nothing (a move waiting goes out below instead).
        if (!pendingRef.current) void sayHere();
        if (withClock) {
          // Clock reads carry the app's clock (the one `startAt` uses); kept right as the two drift.
          await calibrate();
          if (cancelled) return;
          recalibrate = setInterval(() => void calibrate(), CLOCK_RESYNC_MS);
        }
        // Still allowed to sign? Demoted, or a new pair: start again with what the server says.
        // Every few minutes, and as soon as the phone is back online (a rotation meanwhile).
        // The band key too: it changes when someone may no longer see the gig (191).
        const recheckSigner = () => {
          void Promise.all([stageSigner(eventId), fetchStageKey(eventId)]).then(([fresh, band]) => {
            if (cancelled) return;
            // The server's no on the band key: stop leading now (Claude round 8 on #288).
            if (band.denied) {
              inUseKeyRef.current = null;
              setKeyDenied(true);
              return;
            }
            // No answer and nothing kept (offline, storage full) is not a change: keep leading.
            if (
              (fresh?.public ?? null) !== (fetched?.public ?? null) ||
              (fresh?.version ?? null) !== (fetched?.version ?? null) ||
              (!fresh && signerRefused(eventId)) !== notAdmin ||
              (band.key && band.key !== key)
            )
              setAttempt((n) => n + 1);
          });
        };
        recheck = setInterval(recheckSigner, SIGNER_RECHECK_MS);
        onOnline = recheckSigner;
        window.addEventListener('online', onOnline);
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) void push(pending);
        // A click or playhead already running: sent before Bluetooth was up, or before it restarted.
        if (Object.keys(liveRef.current).length) void pushLive();
      } catch (e) {
        if (!cancelled) setStatus(bleProblem(e));
      }
    })();
    return () => {
      cancelled = true;
      clearInterval(recalibrate);
      clearInterval(recheck);
      if (onOnline) window.removeEventListener('online', onOnline);
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
      // A move still waiting for Bluetooth: not kept for the next start (the newest state is, while Stage stays open).
      pendingRef.current = null;
      if (closing) {
        liveRef.current = {};
        lastStateRef.current = null;
      }
      setStatus('off');
    };
  }, [active, isLeader, eventId, push, pushLive, sayHere, attempt]);

  // Stage closed: the next session starts with nothing served.
  useEffect(() => {
    if (!active) lastPushedRef.current = null;
  }, [active]);

  // Member: find the leader, subscribe, read on every change.
  useEffect(() => {
    if (!active || isLeader || !eventId) return;
    const gig = eventId;
    let cancelled = false;
    let deviceId: string | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let serviceUuid = '';
    /**
     * The service of the key a change replaced (#283 keeps it for the gig day):
     * a leader that missed the change still advertises under it. Found and
     * followed, signed states only (the one who left may know that key).
     */
    let prevService = '';
    /** The service each phone linked or probed serves (the previous key's, or this one's). */
    const serviceOf = new Map<string, string>();
    const svcOf = (id: string) => serviceOf.get(id) ?? serviceUuid;
    const scanFor = () => (prevService ? [serviceUuid, prevService] : [serviceUuid]);
    /** On the previous key's service: only a signed state may be followed. */
    const onPrevKey = (id: string) => !!prevService && serviceOf.get(id) === prevService;
    /** With a previous key kept, which one this phone serves (asked once per link or probe). */
    const learnService = async (id: string) => {
      if (!prevService) return;
      const svc = await servedService(id, [serviceUuid, prevService]);
      if (svc) serviceOf.set(id, svc);
      else serviceOf.delete(id);
    };
    let key = '';
    /** The gig's public key and its version (null: none made yet when this phone was online). */
    let verify: StageVerifyKey | null = null;
    /**
     * Rotated, the new pair not made yet (migration 190): its version, until
     * the new key arrives. Band-key states are refused meanwhile, and signed
     * ones can't be checked (rule C): never taken for a gig with no pair.
     */
    let pending: number | null = null;
    /** Phones skipped for a key reason (refused band-key, a newer pair): tried again at once when the key changes. */
    const keySkips = new Set<string>();
    let refusedStreak = 0;
    let staleStreak = 0;
    /** An answer for the key: a key, "pending", or nothing (offline with no copy, or a no): nothing keeps what this phone had. */
    const take = (answer: StageVerifyAnswer | null) => {
      if (!answer) return;
      const before = `${verify?.public ?? ''}|${verify?.version ?? ''}|${pending ?? ''}`;
      if (answer.public === null) {
        // Older than the key this phone checks with: nothing new.
        if (!verify || verify.version < answer.version) {
          // No key to check the signed state with: a signed link is never read as a band-key one,
          // it's left and found again (refused while the rotation is pending) (Codex on #288).
          const linked = signedLink ? deviceId : null;
          verify = null;
          signedLink = false;
          pending = answer.version;
          if (linked) queueMicrotask(() => {
            if (!cancelled && deviceId === linked) dropLink(linked, 0);
          });
        }
      } else if (answer.version >= Math.max(verify?.version ?? 0, pending ?? 0)) {
        // Never below the key or the "pending" version this phone knows: a slow answer from
        // before a rotation would bring back the old pair (Codex + Claude on #288).
        verify = answer;
        if (pending !== null && answer.version >= pending) pending = null;
      }
      if (before === `${verify?.public ?? ''}|${verify?.version ?? ''}|${pending ?? ''}`) return;
      // Another key: the phones skipped for the old one are tried again now.
      for (const id of keySkips) distrusted.delete(id);
      keySkips.clear();
      newerFails = 0;
      refusedStreak = 0;
      staleStreak = 0;
    };
    let verifyAskedAt = -Infinity;
    /** The last ask for the key reached the server (false: offline, the kept copy). */
    let verifyReached = true;
    /** "Newer pair" claims in a row the kept key couldn't check (reset by a good read or a new key). */
    let newerFails = 0;
    let verifyAsks = 0;
    let verifyTaken = 0;
    /** The server's public key (online), or the kept copy (offline); `force`: even if asked lately. */
    const refreshVerify = async (force = false) => {
      if (!force && nowMs() - verifyAskedAt < VERIFY_REFRESH_MS) return;
      verifyAskedAt = nowMs();
      // Numbered: an answer that arrives after a later one's is dropped (Codex on #288).
      const n = ++verifyAsks;
      const { answer, denied, server } = await fetchVerifyKey(gig);
      if (cancelled || n < verifyTaken) return;
      verifyTaken = n;
      verifyReached = server;
      // The server's no (190: SQL NULL is only ever a no; "no pair yet" is version 0): this
      // account lost the gig, its kept keys are gone (fetchVerifyKey), nothing more is followed.
      // Offline keeps the copy (Codex on #288).
      if (denied) {
        lose();
        return;
      }
      take(answer);
    };
    /** The leader signs with a newer pair than this phone has: it needs one trip online. */
    let staleKey = false;
    /** The linked phone serves the signed state, and this phone can check it. */
    let signedLink = false;
    /** Phones that served a state with a wrong signature, until when they're skipped. */
    const distrusted = new Map<string, number>();
    const trusted = (id: string) => (distrusted.get(id) ?? 0) <= nowMs();
    /** When checks failed on this link lately (a read caught mid-change fails now and then); a good one clears them. */
    let authFails: number[] = [];
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
    /** The link (its number) on which a state with the admins' signature was checked: -1, none yet. */
    let checkedLink = -1;

    /** The leader's id, from its state or its live events: the clock is tied to it. */
    const learnLeader = (from: unknown) => {
      if (typeof from !== 'string' || !from || from === leaderFrom) return;
      leaderFrom = from;
      emitClock();
    };
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
    /** Phones a probe let go of whose let-go timed out (maybe still connected). */
    const letGoPending = new Set<string>();
    const knownSame = (id: string) => Date.now() - (sameLeader.get(id) ?? -Infinity) < SAME_LEADER_FORGET_MS;
    /** The linked phone's last state was dropped or held for its clock: read again once its clock is measured. */
    let clockDropped = false;
    /** Whether the linked leader serves a clock: asking (first reads), has (measured), none (an older app). */
    let linkClock: 'asking' | 'has' | 'none' = 'asking';
    /** Until then a state from a leader with a clock waits for that clock (then the 5-minute rule). */
    let clockHoldUntil = 0;
    let holdArmed = false;
    /**
     * A seq that could come from the linked leader's clock: judged with the
     * offset measured over the link, and then only ~30 s beyond it (a leader's
     * phone set a few minutes ahead is still followed); with none measured,
     * at most 5 minutes ahead of this phone's clock.
     */
    const plausibleFrom = (seq: number, id: string | null) => {
      const sample = id && bookDevice === id ? book.best(nowMs()) : null;
      if (!sample) return seqPlausible(seq, Date.now());
      // A clock more than 5 minutes off never counts (MAX_CLOCK_OFFSET_MS).
      const offset = usableOffset(sample.offset);
      return offset !== null && seqPlausible(seq, Date.now() + offset, SEQ_AHEAD_MEASURED);
    };
    /**
     * The first state waits for the leader's clock (Codex on #280): judged
     * before it, a clock minutes off would be followed. A leader on an older
     * app (no clock) or a clock that can't be measured in CLOCK_HOLD_MS is
     * judged by the 5-minute rule.
     */
    const clockPending = (id: string) =>
      id === deviceId && linkClock === 'asking' && !(bookDevice === id && book.best(nowMs())) && nowMs() < clockHoldUntil;
    const holdForClock = (id: string) => {
      if (!clockPending(id)) return false;
      clockDropped = true;
      if (!holdArmed) {
        holdArmed = true;
        void wait(Math.max(0, clockHoldUntil - nowMs()) + 10).then(() => {
          holdArmed = false;
          if (cancelled || deviceId !== id || !clockDropped) return;
          clockDropped = false;
          void readNow();
        });
      }
      return true;
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
      // Switched off: a read still in flight, or a new leader id, brings no clock back.
      if (!bleLiveRef.current) return;
      const sample = book.best(nowMs());
      if (!sample) return;
      // More than 5 minutes off: not used for the click either, and the member is told.
      if (usableOffset(sample.offset) === null) {
        setClock(null);
        setStatus('clock-off');
        return;
      }
      setClock({ from: leaderFrom, sample });
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
        view = await BleClient.read(id, svcOf(id), STAGE_BLE_CLOCK_CHARACTERISTIC);
      } catch (e) {
        // A dropped link is handled by onDisconnect; a missing characteristic is an older leader.
        const older = /not found|no such|unknown characteristic/i.test(String((e as { message?: unknown })?.message ?? e));
        if (older && deviceId === id) {
          linkClock = 'none';
          // Its held state applies now (no clock to wait for).
          if (clockDropped) {
            clockDropped = false;
            void readNow();
          }
        }
        return !older;
      } finally {
        reads--;
      }
      const t2 = nowMs();
      const t1 = await decodeClock(new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice(), verify.public);
      if (t1 === null || cancelled || deviceId !== id) return true;
      if (book.add(t0, t1, t2)) {
        linkClock = 'has';
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

    /** A phone's state: the signed one if it serves it (and this phone can check it), else the band-key one. */
    const readState = async (id: string, signed: boolean, timeout?: number) => {
      // The key this read is checked with, taken now: a rotation learnt meanwhile fails it closed.
      const checkWith = verify;
      if (signed && !checkWith) return { ok: false as const, reason: 'rotated' as const };
      // Under the previous key, a band-key state is never read (only signed ones count there).
      if (!signed && onPrevKey(id)) return { ok: false as const, reason: 'auth' as const };
      const view = await BleClient.read(
        id,
        svcOf(id),
        signed ? STAGE_BLE_SIGNED_CHARACTERISTIC : STAGE_BLE_CHARACTERISTIC,
        timeout ? { timeout } : undefined,
      );
      const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      if (!signed) return decodeStageState(bytes, savedRef.current, key);
      // Signed bytes are never read as a band-key state (Codex on #288).
      if (!checkWith || verify !== checkWith) return { ok: false as const, reason: 'rotated' as const };
      const result = await decodeSignedState(bytes, savedRef.current, checkWith.public, checkWith.version);
      if (verify !== checkWith) return { ok: false as const, reason: 'rotated' as const };
      if (!result.ok && result.reason !== 'setlist') return result;
      // Stage closed meanwhile (a look's read finishing late): nothing is noted for the next opening.
      if (cancelled) return result;
      // Below a seq already followed from this signer: a recording played back, not the leader now.
      const seq = result.ok ? result.state.seq : result.seq;
      const from = result.ok ? result.state.from : result.from;
      if (!leadsNothing(seq)) {
        const highest = signedMemory(gig).tops[from];
        if (highest !== undefined && seq < highest) return { ok: false as const, reason: 'replay' as const };
        // Only a seq that counts is kept as the highest: one from a clock far off (dropped by the
        // caller) would make every later real state look like a recording.
        // Not while the linked leader's clock is still being measured (judged then, on the read after).
        if (!clockPending(id) && plausibleFrom(seq, id)) noteSignedTop(gig, from, seq);
      }
      // The admins' signature checked (a setlist this phone lacks included): band-key states are refused for a while.
      noteSignedSeen(gig);
      return result;
    };

    /** Band-key states are refused: a rotation's key is pending, or this phone can check signatures and saw the admins sign lately. */
    const legacyRefused = () => pending !== null || (!!verify && Date.now() - (signedMemory(gig).seen || -Infinity) < SIGNED_TRUST_MS);

    /** Leave the linked phone (its goodbye is ignored), skip it for `skipMs`, and search again. */
    const dropLink = (id: string, skipMs: number) => {
      distrusted.set(id, nowMs() + skipMs);
      link++;
      setDevice(null);
      linkState = null;
      linkHeard = null;
      clearTimeout(checkTimer);
      stopSync();
      void BleClient.disconnect(id).catch(() => {});
      setStatus(staleKey ? 'stale-key' : 'searching');
      later();
    };

    /** A band-key phone refused: skipped longer each time in a row; pending, the line asks for one trip online and the key is asked for. */
    const refuse = (id: string) => {
      if (pending !== null) {
        staleKey = true;
        void refreshVerify();
      }
      keySkips.add(id);
      dropLink(id, backoff(REFUSED_SKIP_MS, refusedStreak++));
    };

    /**
     * What the linked phone's state can be checked against:
     * - signed: the admins' signature, checked;
     * - unverified: it signs, but this phone has no key to check it yet;
     * - no-pair: an admin on this app with no key pair yet (it serves the live
     *   characteristic, nothing signed);
     * - old: an older app's leader (before signing): the line asks to update it.
     */
    let linkKind: 'signed' | 'unverified' | 'no-pair' | 'old' = 'signed';
    const linkedStatus = (): StageBleStatus =>
      staleKey
        ? 'stale-key'
        : linkKind === 'old'
          ? 'old-leader'
          : linkKind === 'no-pair'
            ? 'leader-unverified'
            : linkKind === 'unverified'
              ? 'unverified'
              : 'connected';

    /**
     * This account lost the gig (the server's no to a phone holding its key):
     * the kept keys go, the link and the search stop, nothing more is
     * followed until Stage opens again (Codex on #288).
     */
    function lose() {
      if (cancelled) return;
      cancelled = true;
      verify = null;
      pending = null;
      signedLink = false;
      forgetStageKeys(gig);
      const id = deviceId;
      link++;
      setDevice(null);
      linkState = null;
      linkHeard = null;
      clearTimeout(retry);
      clearTimeout(checkTimer);
      stopSync();
      setClock(null);
      void BleClient.stopLEScan().catch(() => {});
      if (id) void BleClient.disconnect(id).catch(() => {});
      setStatus('off');
    }

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
        // The admins' signature checked on this link (a setlist this phone lacks included): what
        // its live frame says about the count-in counts as the leader's (see onLive).
        if (signedLink && (result.ok || result.reason === 'setlist')) checkedLink = link;
        // The key changed during the read (a rotation, say): this link is left and found again
        // under what the phone knows now (Codex on #288).
        if (!result.ok && result.reason === 'rotated') {
          dropLink(id, 0);
          return;
        }
        if (!result.ok && result.reason === 'auth' && result.newer) {
          // Maybe a newer pair than this phone's (an admin stopped being one since), maybe made up: only the server can tell.
          const had = verify?.version;
          // At most every VERIFY_REFRESH_MS: a phone claiming newer pairs can't make this one ask on every read.
          await refreshVerify();
          if (cancelled || deviceId !== id) return;
          if (verify && verify.version !== had) {
            void readNow();
            return;
          }
          // Nothing newer on the server (or offline): a failed check like any other. Online, no "the band
          // changed" line (that one only when the server says so: "pending"), since anyone can write a
          // version number. Offline, after a few in a row, the line asks for one trip online: only the
          // server can tell (Claude on #288). Skipped for the key: tried again at once if a newer key arrives.
          if (++newerFails >= NEWER_FAILS_STALE && !verifyReached) {
            staleKey = true;
            setStatus(linkedStatus());
          }
          keySkips.add(id);
        }
        if (!result.ok && result.reason === 'auth') {
          // A few: maybe reads caught mid-change (the leader moving fast).
          // AUTH_FAILS_MAX within AUTH_FAIL_WINDOW_MS: not the leader (a
          // member posing as one): leave it, skip it for a while.
          const now = nowMs();
          authFails = [...authFails.filter((t) => now - t < AUTH_FAIL_WINDOW_MS), now];
          if (authFails.length < AUTH_FAILS_MAX) {
            // One of this session's waits: Stage closing clears it (Claude on #288).
            void wait(300 * authFails.length).then(() => {
              if (!cancelled) void readNow();
            });
            return;
          }
          dropLink(id, DISTRUST_MS);
          return;
        }
        // A recording played back (below a seq this signer was followed at): not the leader, leave it.
        if (!result.ok && result.reason === 'replay') {
          dropLink(id, DISTRUST_MS);
          return;
        }
        // A band-key state once the admins signed: not followed (see SIGNED_TRUST_MS).
        if (!signedLink && legacyRefused()) {
          refuse(id);
          return;
        }
        // "Here, leading nothing": the link is fine, there's nothing to follow (nor a setlist to ask for).
        if ((result.ok && leadsNothing(result.state.seq)) || (!result.ok && result.reason === 'setlist' && leadsNothing(result.seq))) {
          authFails = [];
          staleKey = false;
          setStatus(linkedStatus());
          return;
        }
        // A seq far ahead of the leader's clock (band-key: made up, as anyone with the band key can; signed:
        // a clock more than 5 minutes off, main session's rule), never followed.
        // Not silently "connected": the clocks may just be far apart.
        const seq = result.ok ? result.state.seq : result.reason === 'setlist' ? result.seq : null;
        if (seq !== null && !plausibleFrom(seq, id)) {
          clockDropped = true;
          setStatus('clock-off');
          return;
        }
        if (deviceId === id && (result.ok || result.reason === 'setlist')) {
          const heard = result.ok ? result.state : result;
          if (isNewer(heard, linkHeard)) linkHeard = { seq: heard.seq, from: heard.from };
        }
        // Known to the looks (what this link serves), but not applied before the leader's clock is.
        if (seq !== null && deviceId === id && holdForClock(id)) return;
        if (result.ok) {
          authFails = [];
          staleKey = false;
          newerFails = 0;
          refusedStreak = 0;
          staleStreak = 0;
          if (!linkState || isNewer(result.state, linkState)) linkState = result.state;
          setStatus(linkedStatus());
          if (result.state.from !== leaderFrom) {
            leaderFrom = result.state.from;
            emitClock();
          }
          if (signedLink) onStateRef.current(result.state, true);
          else onStateRef.current(result.state);
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
      // Counted like the song and clock reads: a look for another leader waits for it.
      reads++;
      try {
        view = await BleClient.read(id, serviceUuid, STAGE_BLE_LIVE_CHARACTERISTIC);
      } catch {
        return; /* a dropped link is handled by onDisconnect */
      } finally {
        reads--;
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
        // The count-in is only the leader's from a phone checked as an admin's on this link.
        if (event === 'countin') onLiveRef.current?.(event, payload, signedLink && checkedLink === link);
        else onLiveRef.current?.(event, payload);
      }
    };

    /**
     * Another phone advertising the gig, over a short link: what it leads
     * (seq and leader id), with its state when this phone has that setlist
     * (none: it leads a setlist this phone doesn't have yet), signed or
     * band-key, or nothing valid.
     */
    const probe = async (id: string): Promise<{ heard: Heard; state: StageLiveState | null; signed: boolean } | null> => {
      // A phone linked as the leader (this session's, or a reopened one's): connecting again would replace its goodbye.
      if (leaderLinks.has(id)) return null;
      try {
        await BleClient.connect(id, () => {}, { timeout: PROBE_TIMEOUT_MS });
        await learnService(id);
        const served = verify ? await servedBy(id) : [];
        // Not listed: unknown, not ranked (a band-key guess could put it above the leader).
        if (!served) return null;
        const signed = !!verify && served.includes(STAGE_BLE_SIGNED_CHARACTERISTIC);
        // Short as well: the radio does one thing at a time, the leader's reads wait meanwhile.
        const result = await readState(id, signed, PROBE_TIMEOUT_MS);
        // Leading nothing (seq 0): not a leader to move to (its signature was still noted, readState).
        // Judged with the clock, signed or not (a clock more than 5 minutes off never counts).
        const plausible = (seq: number) => plausibleFrom(seq, id);
        if (result.ok) return plausible(result.state.seq) && !leadsNothing(result.state.seq) ? { heard: result.state, state: result.state, signed } : null;
        // A newer pair on that phone: this one's key may be out of date.
        if (result.reason === 'auth' && result.newer) void refreshVerify();
        if (result.reason === 'setlist' && plausible(result.seq) && !leadsNothing(result.seq)) return { heard: { seq: result.seq, from: result.from }, state: null, signed };
        return null;
      } catch {
        return null;
      } finally {
        // Let go fully before anything links to it, unless something linked to it meanwhile (that link stays).
        // Through the plugin itself, with a short timeout: its queue (the leader's reads) never waits on a phone gone out of range.
        // Timed out: still connected, maybe ending later (its end would then drop a link made to it since): see linkTo.
        if (!leaderLinks.has(id))
          await BluetoothLe.disconnect({ deviceId: id, timeout: PROBE_LET_GO_MS } as { deviceId: string }).catch(() => {
            letGoPending.add(id);
          });
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
      // The linked signed state, read again: an admin leading nothing sends no change notice, and this
      // keeps "the admins signed lately" fresh (else after SIGNED_TRUST_MS a band-key phone would take over).
      if (signedLink) {
        await readNow();
        if (cancelled || deviceId !== current) return;
      }
      const found: string[] = [];
      try {
        lookScanning = true;
        scanStarts.push(Date.now());
        await BleClient.requestLEScan({ services: scanFor() }, (r) => {
          const id = r.device.deviceId;
          if (id !== current && trusted(id) && !knownSame(id) && !found.includes(id)) found.push(id);
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
      const candidates: { id: string; heard: Heard; signed: boolean }[] = [];
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
        candidates.push({ id, heard: theirs.heard, signed: theirs.signed });
      }
      // After the probes: one of them may just have shown the admins' signature.
      const refused = legacyRefused();
      let best: (typeof candidates)[number] | null = null;
      let bestRank = -1;
      for (const c of candidates) {
        if (!c.signed && refused) continue;
        const r = leaderRank(true, c.signed);
        if (r > bestRank || (r === bestRank && best && isNewer(c.heard, best.heard))) {
          best = c;
          bestRank = r;
        }
      }
      // Ours: what the linked phone served, followable or not (a setlist this phone lacks).
      const ours = !signedLink && refused ? -1 : leaderRank(!!linkHeard, signedLink);
      // Only a strictly better one takes the link, so two admins on a setlist this phone lacks don't take turns.
      const next = best && (bestRank > ours || (bestRank === ours && isNewer(best.heard, linkHeard))) ? best.id : null;
      if (!next && ours < 0) {
        // Linked to a band-key phone once the admins signed, and no one better: leave it.
        refuse(current);
        return;
      }
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
        await BleClient.requestLEScan({ services: scanFor() }, (result) => {
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
    /** Link to this leader's phone: subscribe, read, measure its clock, keep an eye out for another admin. */
    function linkTo(id: string) {
      clearTimeout(retry);
      setDevice(id);
      linkState = null;
      linkHeard = null;
      idleChecks = 0;
      sameLeader = new Map();
      clockDropped = false;
      // Clock over Bluetooth switched off (ble_live): none is read, so there is none to wait for (like an older app).
      linkClock = !bleLiveRef.current ? 'none' : bookDevice === id && book.best(nowMs()) ? 'has' : 'asking';
      clockHoldUntil = nowMs() + CLOCK_HOLD_MS;
      if (bookDevice !== id) {
        // Another phone: the last one's clock isn't this one's (and an older app has none to replace it).
        book.clear();
        bookDevice = id;
        leaderFrom = null;
        setClock(null);
      }
      signedLink = false;
      linkKind = 'signed';
      authFails = [];
      const gen = ++link;
      void (async () => {
        try {
          await BleClient.stopLEScan();
          // A probe's let-go that timed out: end it fully first, so its late end can't drop this link.
          if (letGoPending.delete(id)) await BleClient.disconnect(id).catch(() => {});
          if (cancelled || gen !== link) return;
          await BleClient.connect(id, () => onDisconnect(gen), {
            timeout: 10000,
          });
          // The public key, if this phone has none yet (online now, say).
          if (!verify) await refreshVerify(true);
          await learnService(id);
          const served = await servedBy(id);
          if (cancelled || gen !== link) return;
          // Not listed (a dropped packet): try again, never guess "an older app" and follow its band-key state.
          if (!served) throw new Error('services not listed');
          const signs = served.includes(STAGE_BLE_SIGNED_CHARACTERISTIC);
          signedLink = signs && !!verify;
          // Only a signed leader's clock is read: a band-key link has none to wait for.
          if (!signedLink) linkClock = 'none';
          // Characteristics listed, none signed: this app with no pair yet (it has the live one), or an older app.
          linkKind = signs
            ? verify
              ? 'signed'
              : 'unverified'
            : served.includes(STAGE_BLE_LIVE_CHARACTERISTIC)
              ? 'no-pair'
              : 'old';
          // Once the admins signed, a band-key phone isn't followed (see SIGNED_TRUST_MS); nor is one
          // under the previous key, ever (the one who left may know it).
          if (!signedLink && (legacyRefused() || onPrevKey(id))) {
            refuse(id);
            return;
          }
          // Only a change notice (the 4-byte seq) reads: on iOS the plugin also
          // hands every read's value to this callback, which would read forever.
          await BleClient.startNotifications(id, svcOf(id), signedLink ? STAGE_BLE_SIGNED_CHARACTERISTIC : STAGE_BLE_CHARACTERISTIC, (v) => {
            if (isChangeNotice(v)) void readNow();
          });
          // Click, playhead, count-in: a leader on an older app has none. Only a change notice reads, as above.
          liveOn = await BleClient.startNotifications(id, serviceUuid, STAGE_BLE_LIVE_CHARACTERISTIC, (v) => {
            if (isChangeNotice(v)) void readLive();
          }).then(
            () => true,
            () => false,
          );
          // Closed, or Bluetooth went off meanwhile (that link is already dropped).
          if (cancelled || gen !== link) return;
          setStatus(linkedStatus());
          await readNow();
          // Where the band is right now: a phone that (re)connects mid-song lands on the beat.
          if (gen === link) await readLive();
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
      // The server's key first (it changes when someone may no longer see the gig, 191); the kept one offline.
      const answer = await fetchStageKey(eventId);
      if (cancelled) return;
      // The server's no: never the key this phone had before it (Claude round 8 on #283).
      if (answer.denied) {
        key = '';
        inUseKeyRef.current = null;
        setKeyDenied(true);
        return;
      }
      const k = answer.key || key;
      inUseKeyRef.current = k || null;
      if (!k) {
        retry = setTimeout(() => void boot(), 15000);
        return;
      }
      key = k;
      if (!verify) {
        // The kept copy at once (offline on stage), the server's meanwhile (a rotated pair).
        take(keptVerifyKey(gig));
        if (verify) void refreshVerify(true);
        else await refreshVerify(true);
      }
      if (cancelled) return;
      serviceUuid = await stageServiceUuid(k);
      // The key a change replaced, kept for the gig day (Claude on #288).
      const prev = previousStageKey(gig);
      prevService = prev && prev !== k ? await stageServiceUuid(prev) : '';
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

    /**
     * The public key asked for again while Stage is open: every few minutes,
     * and as soon as the phone is back online. A key that arrived (this phone
     * linked offline with none) or changed (a rotation): link again to the same
     * phone, so it is checked (and followed) on its signed state.
     */
    const reverify = async () => {
      const before = verify;
      await refreshVerify(true);
      if (cancelled || !key) return;
      // Another band key (someone may no longer see the gig, 191): another service, start again (Claude on #288).
      // Only the server's no stops it: no answer and nothing kept (offline, storage full) keeps
      // following with the key in use (Claude round 7 on #288).
      const { key: nowKey, denied } = await fetchStageKey(gig);
      if (cancelled) return;
      if (denied) {
        lose();
        // Bluetooth stays stopped until a later check gets a key again.
        inUseKeyRef.current = null;
        setKeyDenied(true);
        return;
      }
      if (nowKey && nowKey !== key) {
        setAttempt((n) => n + 1);
        return;
      }
      const id = deviceId;
      if ((before?.public ?? null) === (verify?.public ?? null) && (before?.version ?? null) === (verify?.version ?? null)) return;
      // Not linked (a phone skipped for the old key): the search tries it again now (take cleared the skip).
      if (!id) {
        later();
        return;
      }
      link++;
      setDevice(null);
      linkState = null;
      linkHeard = null;
      clearTimeout(checkTimer);
      stopSync();
      await BleClient.disconnect(id).catch(() => {});
      if (!cancelled && !deviceId) linkTo(id);
    };
    const reverifyTimer = setInterval(() => void reverify(), SIGNER_RECHECK_MS);
    const onOnline = () => void reverify();
    window.addEventListener('online', onOnline);

    return () => {
      cancelled = true;
      clearInterval(reverifyTimer);
      window.removeEventListener('online', onOnline);
      clearTimeout(retry);
      clearTimeout(checkTimer);
      waits.forEach(clearTimeout);
      waits.clear();
      clearInterval(resync);
      burstTimers.forEach(clearTimeout);
      burstRef.current = () => {};
      syncCtlRef.current = null;
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

  // The band key changed on the server (191: someone may no longer see the
  // gig): start again with the new one, so the leader stops serving the old
  // key's service and members search under the new one (Codex + Claude on
  // 642676fc). Asked when Realtime says so (STAGE_KEY_EVENT), back online,
  // every minute, and every few seconds while there is none yet.
  useEffect(() => {
    if (!ready || !eventId) return;
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let asking = false;
    const check = async () => {
      if (asking) return;
      asking = true;
      try {
        const { key: now, denied } = await fetchStageKey(eventId);
        if (gone) return;
        // The server's no stops Bluetooth now, not at a later check (Claude round 8 on #283).
        if (denied) {
          inUseKeyRef.current = null;
          setKeyDenied(true);
          return;
        }
        if (now && keyDeniedRef.current) setKeyDenied(false);
        else if (now && now !== inUseKeyRef.current) setAttempt((n) => n + 1);
      } finally {
        asking = false;
      }
    };
    const schedule = () => {
      timer = setTimeout(
        () => {
          void check().then(() => {
            if (!gone) schedule();
          });
        },
        inUseKeyRef.current || keyDeniedRef.current ? KEY_RECHECK_MS : KEY_WAIT_MS,
      );
    };
    schedule();
    const onKey = (e: Event) => {
      if ((e as CustomEvent<string>).detail === eventId) void check();
    };
    const onOnline = () => void check();
    window.addEventListener(STAGE_KEY_EVENT, onKey);
    window.addEventListener('online', onOnline);
    return () => {
      gone = true;
      clearTimeout(timer);
      window.removeEventListener(STAGE_KEY_EVENT, onKey);
      window.removeEventListener('online', onOnline);
    };
  }, [ready, eventId, attempt]);

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

  return { status, publish, publishLive, clock, clockRef, burst, followers, unsigned: unsigned && isLeader && open, fix };
}
