import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { saveStageOrder } from '@/lib/services/songs';
import { keepOrderOffline } from '@/lib/services/liveOutboxApi';
import { sessionUserId } from '@/lib/sessionUser';
import { notifySetlistSaved } from '@/lib/services/setlistNotify';
import { diffSetlist } from '@/lib/setlistChanges';
import { useStageBle } from './useStageBle';
import {
  applyOrder,
  indexOf,
  isNewer,
  moveItem,
  nextSeq,
  parseStageState,
  reorderRows,
  sameOrder,
  seqPlausible,
  SEQ_AHEAD_MAX,
  SEQ_AHEAD_MEASURED,
  stageClockTopic,
  stageTopic,
  stepOver,
  usableOffset,
  type StageLiveState,
} from '@/lib/stageLive';
import {
  bestSample,
  CLICK_EVENT,
  clockSample,
  MAX_CLOCK_RTT_MS,
  nowMs,
  parseClickState,
  clickWire,
  pickClock,
  PING_EVENT,
  PONG_EVENT,
  CLOCK_PONG_EVENT,
  START_LEAD_MS,
  type ClickState,
  type ClockSample,
  type PeerClock,
} from '@/lib/stageClick';
import { REGIA_EVENT } from '@/lib/stageRegia';
import { bleLinked as linkedOverBle } from '@/lib/stageBleNotice';
import { parsePlayheadState, PLAYHEAD_EVENT, stopPlayhead, type PlayheadState } from '@/lib/playhead';
import type { LiveEvent, LiveEvents } from '@/lib/stageBleSync';
import { STAGE_KEY_EVENT } from '@/lib/stageBleNative';

/** The broadcast 191's bw_stage_new_band_key sends on the stage topic. */
const STAGE_KEY_BROADCAST = 'stage-key';
import { COUNTIN_EVENT, parseCountInState, stopCountIn, type CountInState } from '@/lib/countIn';

/** Round trips measured when a click starts; the fastest sets the offset. */
const PINGS = 6;
const PING_GAP_MS = 200;
/** A round of pings with no answer is tried again after this (doubling, up to the max), plus up to PING_JITTER_MS. */
/** A ping is matched to its answer for this long (a slow network), then forgotten. */
const PING_FORGET_MS = 5_000;
const PING_RETRY_MS = 1_500;
const PING_RETRY_MAX_MS = 15_000;
const PING_JITTER_MS = 500;
/** After this many rounds with no answer (a leader on an older app never answers), one round a minute. */
const PING_FAST_ROUNDS = 5;
const PING_SLOW_MS = 60_000;
/** A fresh burst (count-in): quicker, it must land inside the 1.5 s lead. */
const FRESH_PING_GAP_MS = 110;
/** Measure again after this long (clocks drift slowly). */
const RESYNC_MS = 60_000;
/**
 * No internet, and the leader's phone out of Bluetooth reach this long: its
 * click and playhead stop showing (it closed Stage, or left). A shorter
 * dropout keeps the beat going on the shared clock.
 */
export const BLE_LEADER_GONE_MS = 10_000;
/** The leader answers at most this many pings per phone per window (a burst is 6). */
const PONGS_PER_WINDOW = 12;
/** And in all, whatever names the pings carry (any member may write the clock topic). */
const ALL_PONGS_PER_WINDOW = 40;
const PONG_WINDOW_MS = 2_000;

/** A setlist song as Stage mode gets it (setlist_songs row id, song id, set). */
export interface LiveSongRef {
  id?: string;
  songId?: string;
  setNumber?: number;
}

/** Channel event carrying the rehearsal session (useRehearsalSession). */
export const SESSION_EVENT = 'session';
/**
 * The leader's "still leading" beat on the live channel (only admins can
 * send there, migration 085), every LEAD_BEAT_MS once it has led. A Bluetooth
 * state (anyone with the band key can make one) is held back only while a
 * state or a beat came in the last LIVE_LEAD_FRESH_MS. Presence can't do
 * this: anyone on the channel can say "lead" in it.
 */
export const LEAD_BEAT_EVENT = 'lead-beat';
export const LEAD_BEAT_MS = 4_000;
export const LIVE_LEAD_FRESH_MS = 10_000;

/**
 * A rehearsal session riding on the live channel: what to do with one that
 * arrives, and (leader) the newest one to send to late arrivals.
 */
export interface StageSessionBridge {
  receive?: (payload: unknown) => void;
  latest?: () => unknown;
}

/**
 * The Regia (useStageRegia) riding on the live channel: states that arrive,
 * the newest one of ours for late arrivals, and who left the channel.
 */
export interface StageRegiaBridge {
  receive?: (payload: unknown) => void;
  latest?: () => unknown;
  left?: (clientId: string) => void;
}

interface Options<T extends LiveSongRef> {
  /** Gig id; band gigs only (the channel checks band membership). */
  eventId?: string;
  /** Rehearsal session (Live mode timer) carried on the same channel. */
  session?: { current: StageSessionBridge };
  /** The Regia (stage manager device), carried on the same channel. */
  regia?: { current: StageRegiaBridge };
  setlistId?: string;
  /** Saved setlist, in saved order. */
  songs: T[];
  /** Stage mode is open: the channel only exists while it is. */
  open: boolean;
  /** Band admin: leads (their moves reach everyone) and can reorder. */
  isLeader: boolean;
}

/** Where a state came from: 'bluetooth' is a band-key state (any member could make one), 'signed' carries the admins' signature. */
type StateSource = 'realtime' | 'bluetooth' | 'signed';

/** `waiting`: no signal, the order is kept on this phone and saved when back online. */
export type StageSaveState = 'idle' | 'saving' | 'saved' | 'error' | 'waiting';
/** A setlist_songs row as stored (row id, song, set). */
type StoredRow = { id: string; songId: string; setNumber: number };

/** Window event after Stage mode saved a new song order: detail `{ setlistId }`. */
export const SETLIST_ORDER_SAVED = 'bw:setlist-order-saved';

/** The leader's struck-off songs for a gig, kept on the device (survives a restart mid-gig). */
const skippedKey = (eventId: string) => `bw-stage-skipped:${eventId}`;
const readSkipped = (eventId: string | undefined): string[] => {
  if (!eventId) return [];
  try {
    const v = JSON.parse(localStorage.getItem(skippedKey(eventId)) || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const writeSkipped = (eventId: string | undefined, ids: string[]) => {
  if (!eventId) return;
  try {
    if (ids.length) localStorage.setItem(skippedKey(eventId), JSON.stringify(ids));
    else localStorage.removeItem(skippedKey(eventId));
  } catch {
    /* storage blocked: tonight only */
  }
};

/** Wait after the last move before saving the order (several taps, one save). */
const SAVE_DELAY_MS = 700;

/**
 * Live Stage mode for everyone in the band ("follow the leader").
 *
 * - The admin moves to another song or reorders the setlist; their app sends
 *   the state on the gig's private channel (migration 085) and saves the new
 *   order in setlist_songs, so it also reaches apps that open later.
 * - Everyone else follows the newest state while "follow" is on. A member who
 *   steps through the songs on their own stops following until they turn it
 *   back on.
 * - Someone opening Stage mode joins the channel's presence; the leader's app
 *   then sends its state again so late arrivals catch up.
 */
/** The highest seq this phone sent per gig (kept across closing Stage): its next ones never go below it (Claude on #280). */
const ownSeqs = new Map<string, number>();
/**
 * The last state, unless its seq is far ahead of now (a clock that ran fast,
 * since fixed): then it counts as none, so the next state (ours, or that
 * leader's) applies at once instead of waiting for the clock to catch up
 * (Claude on #280).
 */
const recent = (s: StageLiveState | null): StageLiveState | null => (s && seqPlausible(s.seq) ? s : null);

export function useStageLive<T extends LiveSongRef>({ eventId, setlistId, songs, open, isLeader, session, regia }: Options<T>) {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const regiaRef = useRef(regia);
  regiaRef.current = regia;
  // A new leader id for every Stage opening (Codex on #280): a phone that reopens
  // with its clock fixed is a new leader for members, not an old one gone back.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const clientId = useMemo(() => Math.random().toString(36).slice(2, 10), [eventId, open]);
  const [order, setOrder] = useState<string[] | null>(null);
  const [songId, setSongId] = useState<string | null>(null);
  const [fallbackIndex, setFallbackIndex] = useState(0);
  const [following, setFollowingState] = useState(true);
  const [leaderSeen, setLeaderSeen] = useState(false);
  /** Leaders' phones in Stage mode on the Realtime channel (presence). */
  const [rtLeaders, setRtLeaders] = useState<ReadonlySet<string>>(() => new Set());
  const [connected, setConnected] = useState(false);
  const [saveState, setSaveState] = useState<StageSaveState>('idle');
  // Struck off for tonight: the leader's choice, shown to the whole band.
  const [skipped, setSkippedState] = useState<string[]>(() => (isLeader ? readSkipped(eventId) : []));
  const skippedRef = useRef(skipped);
  const setSkipped = useCallback((ids: string[]) => {
    skippedRef.current = ids;
    setSkippedState(ids);
  }, []);

  const channelRef = useRef<RealtimeChannel | null>(null);
  /** The clock topic: members' pings (the stage topic only takes the admins' broadcasts). */
  const clockRef = useRef<RealtimeChannel | null>(null);
  /** Newest state applied or sent (Lamport clock + what it said). */
  const lastRef = useRef<StageLiveState | null>(null);
  /** Newest state from the live channel (only admins can send there). */
  const trustedRef = useRef<StageLiveState | null>(null);
  /** lastRef came over Bluetooth. */
  const lastFromBluetoothRef = useRef(false);
  /** When each leader last sent a state or a beat on the live channel (by its id). */
  const liveLeadRef = useRef(new Map<string, number>());
  /** The newest Bluetooth state held back while a leader leads online: it applies once they go quiet. */
  const heldBleRef = useRef<StageLiveState | null>(null);
  /**
   * Another admin's newest live state refused while the followed leader led
   * online (an older seq), with when that admin was last heard: applied when
   * the leader goes quiet, if that admin still leads (Codex on #280).
   */
  const refusedRef = useRef(new Map<string, { state: StageLiveState; at: number }>());
  const quietTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Newest leader state received, kept while not following. */
  const remoteRef = useRef<StageLiveState | null>(null);
  /** This app has led (sent) at least once: only then it answers late joiners. */
  const ledRef = useRef(false);
  const followingRef = useRef(following);
  followingRef.current = following;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Order waiting for its save (several moves, one save); flushed on close. */
  const pendingOrder = useRef<string[] | null>(null);
  /**
   * The setlist as stored after a song added on stage (`rows`), and that
   * song's row (`added`), while the reload with it is on the way: orders
   * are made and saved against these rows until `songs` has the new row.
   */
  const addedBase = useRef<{ rows: StoredRow[]; added: Set<string> } | null>(null);
  /** Songs being added on stage (useStageRegia): order saves wait meanwhile. */
  const addsInFlight = useRef(0);
  const saveCtx = useRef({ songs, setlistId, eventId });
  saveCtx.current = { songs, setlistId, eventId };

  // Visual metronome (stageClick.ts): the newest click state, and the leader's clock offset.
  const [click, setClick] = useState<ClickState | null>(null);
  const clickRef = useRef<ClickState | null>(null);
  /** The click leader's clock measured over Realtime (Bluetooth has its own, in useStageBle). */
  const [rtClock, setRtClockState] = useState<PeerClock | null>(null);
  /** The same clock, set at once (states arriving before the next render are judged with it). */
  const rtClockRef = useRef<PeerClock | null>(null);
  const setRtClock = useCallback((c: PeerClock | null) => {
    rtClockRef.current = c;
    setRtClockState(c);
  }, []);
  /** The measure of one peer's clock: its samples, and the t0 of each ping still unanswered. */
  const samplesRef = useRef<{ peer: string; at: number; samples: ClockSample[]; sent: number[] }>({ peer: '', at: 0, samples: [], sent: [] });
  const pingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Follow the tempo (playhead.ts): the newest playhead state, ours or the leader's.
  const [playhead, setPlayheadState] = useState<PlayheadState | null>(null);
  const playheadRef = useRef<PlayheadState | null>(null);
  /** The clock topic joined: sent to only then (supabase-js would post a ping over HTTP otherwise). */
  const clockJoined = useRef(false);
  /** The stage topic joined: the same for what this phone sends there unasked (pings). */
  const stageJoined = useRef(false);
  // Count-in (countIn.ts): the newest one, ours or the leader's.
  const [countIn, setCountInState] = useState<CountInState | null>(null);
  const countInRef = useRef<CountInState | null>(null);

  const live = !!eventId && open;
  const ordered = useMemo(() => applyOrder(songs, order), [songs, order]);
  const savedIds = useMemo(() => songs.map((s) => s.id).filter((id): id is string => !!id), [songs]);

  /**
   * The leader followed on the live channel sent a state or a beat just now.
   * Only that leader counts (Codex on #280): another admin still online but no
   * longer leading holds nothing back.
   */
  const leadingOnline = useCallback((at: number = Date.now()) => {
    const leader = trustedRef.current?.from;
    return !!leader && leader !== clientId && at - (liveLeadRef.current.get(leader) ?? -Infinity) < LIVE_LEAD_FRESH_MS;
  }, [clientId]);

  /**
   * A leader's state from either path; the newest wins, with limits on
   * band-key Bluetooth states ('bluetooth': anyone with the band key can make one):
   * - while a leader leads on the live channel (a state or a beat in the last
   *   LIVE_LEAD_FRESH_MS) they're held back, the newest applying once it goes quiet;
   * - one never holds back a trusted state (Realtime, or Bluetooth signed by the
   *   admins): one newer than the last trusted state applies even when a
   *   band-key one had a higher seq;
   * - a Bluetooth seq (band-key or signed) far ahead of that leader's clock is
   *   dropped, and so is every state of a leader whose clock was measured more
   *   than 5 minutes off (useStageBle drops them too).
   * A live leader not heard before, once the one followed has gone quiet
   * (Stage reopened, maybe on a phone with an earlier clock), is taken
   * whatever its seq.
   */
  const receive = useCallback(
    (state: StageLiveState, source: StateSource = 'realtime') => {
      if (state.from === clientId) return;
      const bluetooth = source === 'bluetooth';
      const at = Date.now();
      const realtime = source === 'realtime';
      if (!realtime) {
        // A Bluetooth seq (band-key or signed) is judged with that leader's clock, when one was
        // measured, and then only ~30 s beyond it (a phone set a few minutes ahead still leads);
        // none measured, at most 5 minutes ahead. Measured more than 5 minutes off: that phone's
        // states never count (MAX_CLOCK_OFFSET_MS, main session's rule).
        const clock = leaderOffsetRef.current(state.from);
        if (!clock || !seqPlausible(state.seq, at + clock.offset, clock.measured ? SEQ_AHEAD_MEASURED : SEQ_AHEAD_MAX)) return;
        if (bluetooth && leadingOnline(at)) {
          if (isNewer(state, heldBleRef.current)) heldBleRef.current = state;
          return;
        }
      }
      // Only the live channel tells who leads online (only admins can send there).
      let newLeader = false;
      if (realtime) {
        const last = lastRef.current;
        // The live copy of the state already applied from Bluetooth (band-key or signed): its
        // sender leads online, recorded before the duplicate is dropped (Codex on #288).
        if (last && last.from === state.from && last.seq === state.seq) {
          liveLeadRef.current.set(state.from, at);
          trustedRef.current = state;
          lastFromBluetoothRef.current = false;
          refusedRef.current.delete(state.from);
          armQuiet();
          return;
        }
        const lead = liveLeadRef.current;
        const followed = trustedRef.current?.from;
        // This phone leading itself counts as a leader online (its own states are in trustedRef).
        const followedFresh = followed === clientId ? ledRef.current : !!followed && at - (lead.get(followed) ?? -Infinity) < LIVE_LEAD_FRESH_MS;
        // The followed leader gone quiet: another admin's state is taken whatever its seq. The
        // leader followed, heard now on the live channel (it led this phone over Bluetooth), is the
        // same leader, compared by seq like any of its states (Codex on #288).
        newLeader = state.from !== followed && !followedFresh;
      }
      // Clock moves on even for states we don't show (Lamport).
      // Trusted (Realtime, or signed over Bluetooth) over a band-key state: applies whatever that one's seq.
      const overBluetooth = !bluetooth && lastFromBluetoothRef.current && isNewer(state, recent(trustedRef.current));
      if (!isNewer(state, recent(lastRef.current)) && !overBluetooth && !newLeader) {
        if (realtime) {
          const kept = refusedRef.current.get(state.from);
          if (!kept || isNewer(state, kept.state)) refusedRef.current.set(state.from, { state, at });
          else kept.at = at;
        }
        return;
      }
      // Taken: only now is its sender a live leader (a refused state marks nothing, Codex on #288).
      // Only the live channel says who leads online: a signed Bluetooth state doesn't.
      if (realtime) {
        liveLeadRef.current.set(state.from, at);
        refusedRef.current.delete(state.from);
        armQuiet();
      }
      // Another leader's newer state: this phone no longer leads (its beats stop).
      ledRef.current = false;
      lastRef.current = state;
      lastFromBluetoothRef.current = bluetooth;
      if (!bluetooth) trustedRef.current = state;
      // A signed leader taken: band-key changes held back meanwhile never apply (Codex on #288).
      if (source === 'signed') heldBleRef.current = null;
      remoteRef.current = state;
      setLeaderSeen(true);
      // The order and the struck songs are the setlist's: they apply even when not following.
      if (state.order) setOrder(state.order);
      setSkipped(state.skipped ?? []);
      if (followingRef.current) setSongId(state.songId);
    },
    // armQuiet is stable (refs only).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientId, setSkipped, leadingOnline],
  );

  // Click, playhead, count-in over Bluetooth: checked like the channel's, then the same receivers.
  const bleLiveRef = useRef<(event: LiveEvent, payload: unknown) => void>(() => {});
  const onBleLive = useCallback((event: LiveEvent, payload: unknown) => bleLiveRef.current(event, payload), []);
  /**
   * Leader: the stopped click and playhead, for phones linked over Bluetooth.
   * 'closing': Stage closes. 'off': the click and playhead over Bluetooth were
   * switched off mid-show (app_flags ble_live) while they run. A phone with no
   * internet then stops. A phone online would stop too (the stop is newer than
   * what the channel told it), so what runs is sent again on the channel,
   * newer still and with the same start: it keeps the beat it had.
   */
  const bleFarewell = useCallback(
    (why: 'closing' | 'off' = 'closing'): LiveEvents => {
      const out: LiveEvents = {};
      const running = clickRef.current;
      if (isLeader && running?.from === clientId && running.on) {
        const stopped = { ...running, on: false, seq: nextSeq(running.seq) };
        out[CLICK_EVENT] = clickWire(stopped);
        if (why === 'off') {
          const again: ClickState = { ...running, seq: nextSeq(stopped.seq) };
          clickRef.current = again;
          setClick(again);
          const wire = clickWire(again);
          void channelRef.current?.send({ type: 'broadcast', event: CLICK_EVENT, payload: wire });
          // Kept as the newest, served again if the switch comes back on (not sent while off).
          blePublishLiveRef.current(CLICK_EVENT, wire);
        }
      }
      const head = playheadRef.current;
      if (isLeader && head?.from === clientId && head.on) {
        const stopped = stopPlayhead(head);
        out[PLAYHEAD_EVENT] = stopped;
        if (why === 'off') {
          const again: PlayheadState = { ...head, seq: nextSeq(stopped.seq) };
          playheadRef.current = again;
          setPlayheadState(again);
          void channelRef.current?.send({ type: 'broadcast', event: PLAYHEAD_EVENT, payload: again });
          blePublishLiveRef.current(PLAYHEAD_EVENT, again);
        }
      }
      return out;
    },
    [isLeader, clientId],
  );
  /** useStageBle's publishLive, for bleFarewell (made before the hook below returns it). */
  const blePublishLiveRef = useRef<(event: LiveEvent, payload: unknown) => void>(() => {});

  /**
   * The live leader went quiet (or the channel dropped): another admin's
   * refused state applies if that admin still leads, then a held Bluetooth state.
   */
  const releaseHeld = () => {
    if (leadingOnline()) return;
    const at = Date.now();
    let next: { state: StageLiveState; at: number } | null = null;
    refusedRef.current.forEach((r) => {
      if (at - r.at < LIVE_LEAD_FRESH_MS && (!next || r.at > next.at)) next = r;
    });
    refusedRef.current.clear();
    if (next) receiveRef.current((next as { state: StageLiveState }).state, 'realtime');
    const held = heldBleRef.current;
    if (!held || leadingOnline()) return;
    heldBleRef.current = null;
    receiveRef.current(held, 'bluetooth');
  };
  const releaseRef = useRef(releaseHeld);
  releaseRef.current = releaseHeld;
  const receiveRef = useRef(receive);
  receiveRef.current = receive;
  function armQuiet() {
    clearTimeout(quietTimer.current);
    quietTimer.current = setTimeout(() => releaseRef.current(), LIVE_LEAD_FRESH_MS + 50);
  }

  // Offline on stage: the same states over Bluetooth (native apps only).
  const receiveBle = useCallback((state: StageLiveState, signed?: boolean) => receive(state, signed ? 'signed' : 'bluetooth'), [receive]);
  const ble = useStageBle({ eventId, savedIds, open: live, isLeader, onState: receiveBle, onLive: onBleLive, farewell: bleFarewell });
  /**
   * A leader's clock offset, measured over Bluetooth or Realtime (0 when none
   * was), read from the refs set at once; null when it is more than 5 minutes
   * off (MAX_CLOCK_OFFSET_MS).
   */
  const bleClockRef = ble.clockRef;
  const offsetOf = (from: string): { offset: number; measured: boolean } | null => {
    const b = bleClockRef?.current ?? null;
    const r = rtClockRef.current;
    const sample = b?.from === from ? b.sample : r?.from === from ? r.sample : null;
    if (!sample) return { offset: 0, measured: false };
    // Measured: only ~30 s beyond that clock (Claude on #280).
    const offset = usableOffset(sample.offset);
    return offset === null ? null : { offset, measured: true };
  };
  const leaderOffsetRef = useRef(offsetOf);
  leaderOffsetRef.current = offsetOf;
  const blePublish = ble.publish;
  const blePublishLive = ble.publishLive;
  blePublishLiveRef.current = blePublishLive;
  const bleBurst = ble.burst;
  const hasIds = ordered.length > 0 && ordered.every((s) => !!s.id);
  // A song the setlist hasn't caught up with yet (played off the setlist on
  // stage, its row still on its way): stay on the last song found meanwhile.
  const lastIndexRef = useRef(0);
  const found = !songId || ordered.some((s) => s.id === songId);
  const index = hasIds
    ? found
      ? indexOf(ordered, songId)
      : Math.min(lastIndexRef.current, ordered.length - 1)
    : Math.min(fallbackIndex, Math.max(0, ordered.length - 1));
  if (hasIds && found) lastIndexRef.current = index;

  // The saved order caught up with the live one: drop the override.
  useEffect(() => {
    if (!order) return;
    const saved = songs.map((s) => s.id ?? '');
    if (sameOrder(saved, order)) setOrder(null);
  }, [songs, order]);

  const send = useCallback(
    (next: { songId: string | null; order: string[] | null }) => {
      // A seq kept from a clock far ahead (since fixed) is dropped: a new start from now (Codex + Claude on #280).
      const kept = (eventId && ownSeqs.get(eventId)) || 0;
      const own = seqPlausible(kept) ? kept : 0;
      const seq = nextSeq(Math.max(recent(lastRef.current)?.seq ?? 0, own));
      const state: StageLiveState = { seq, from: clientId, ...next, skipped: skippedRef.current };
      if (eventId) ownSeqs.set(eventId, seq);
      lastRef.current = state;
      // Its own state too: an admin heard for the first time with an older one is compared by seq (Codex on #280).
      trustedRef.current = state;
      ledRef.current = true;
      void channelRef.current?.send({ type: 'broadcast', event: 'state', payload: state });
      blePublish(state);
    },
    [clientId, blePublish, eventId],
  );

  const applyRemote = useCallback((state: StageLiveState) => {
    if (state.order) setOrder(state.order);
    if (state.songId !== undefined) setSongId(state.songId);
  }, []);

  /**
   * Measure the leader's clock (click, playhead): a few pings, the fastest
   * round trip wins. `again`: measure now, even if measured lately.
   * A round with no answer (the leader's clock channel not in yet, or its
   * answers used up by a band starting together) is tried again, later each
   * time and at a random moment, for as long as that leader's click or
   * playhead runs.
   */
  const syncWith = useCallback(
    (peer: string, again = false) => {
      const book = samplesRef.current;
      if (!again && book.peer === peer && nowMs() - book.at < RESYNC_MS && bestSample(book.samples)) return;
      const fresh = { peer, at: nowMs(), samples: [] as ClockSample[], sent: [] as number[] };
      samplesRef.current = fresh;
      pingTimers.current.forEach(clearTimeout);
      pingTimers.current = [];
      // A burst asked for again (the count-in, #290): quicker, it must land inside the 1.5 s lead.
      const gap = again ? FRESH_PING_GAP_MS : PING_GAP_MS;
      const round = (attempt: number, delay: number) => {
        const done = (t: ReturnType<typeof setTimeout>) => {
          // A timer that has run is no handle to keep (Codex on #283).
          pingTimers.current = pingTimers.current.filter((x) => x !== t);
        };
        const timers: ReturnType<typeof setTimeout>[] = Array.from({ length: PINGS }, (_, i) => {
          const t = setTimeout(() => {
            done(t);
            if (samplesRef.current !== fresh) return;
            const t0 = nowMs();
            // Only pongs to these pings count (anyone can write the clock topic in our name).
            fresh.sent.push(t0);
            // Pings older than any answer worth waiting for are of no use any more.
            fresh.sent = fresh.sent.filter((t) => t0 - t <= PING_FORGET_MS);
            const payload = { from: clientId, to: peer, t0 };
            if (clockJoined.current) void clockRef.current?.send({ type: 'broadcast', event: PING_EVENT, payload });
            // Admins may write the stage topic too: a leader on an older app listens only there.
            if (isLeader && stageJoined.current) void channelRef.current?.send({ type: 'broadcast', event: PING_EVENT, payload });
          }, delay + i * gap);
          return t;
        });
        // No answer to the whole round: again, while that leader's click runs.
        const check: ReturnType<typeof setTimeout> = setTimeout(
          () => {
            done(check);
            const running = clickRef.current;
            const head = playheadRef.current;
            // What needs that leader's clock: its click, or its playhead (follow the tempo).
            const needed = (running?.on && running.from === peer) || (head?.on && head.from === peer);
            // Answers that came back but none usable (too few slow ones): not a measure, tried again (Codex on #283).
            if (samplesRef.current !== fresh || bestSample(fresh.samples) || !needed) return;
            // This round's timers have all run: not kept (the list would grow for as long as the click runs).
            pingTimers.current = [];
            const wait = attempt + 1 < PING_FAST_ROUNDS ? Math.min(PING_RETRY_MS * 2 ** attempt, PING_RETRY_MAX_MS) : PING_SLOW_MS;
            round(attempt + 1, wait + Math.random() * PING_JITTER_MS);
          },
          delay + PINGS * PING_GAP_MS + MAX_CLOCK_RTT_MS,
        );
        pingTimers.current.push(...timers, check);
      };
      // A random start: phones that got the click together don't all ping at once.
      round(0, Math.random() * PING_JITTER_MS);
    },
    [clientId, isLeader],
  );

  const receiveClick = useCallback(
    (state: ClickState) => {
      if (state.from === clientId) return;
      // The leader's click always replaces one this phone runs on its own.
      if (clickRef.current && clickRef.current.from !== clientId && !isNewer(state, clickRef.current)) return;
      clickRef.current = state;
      setClick(state);
      if (state.on) {
        syncWith(state.from);
        // A fresh measure over Bluetooth too: the better of the two paths is used.
        bleBurst();
      }
    },
    [clientId, syncWith, bleBurst],
  );

  const receivePlayhead = useCallback(
    (state: PlayheadState) => {
      if (state.from === clientId) return;
      if (playheadRef.current && !isNewer(state, playheadRef.current)) return;
      playheadRef.current = state;
      setPlayheadState(state);
      if (state.on) {
        syncWith(state.from);
        bleBurst();
      }
    },
    [clientId, syncWith, bleBurst],
  );

  const receiveCountIn = useCallback(
    (state: CountInState) => {
      if (state.from === clientId) return;
      if (countInRef.current && !isNewer(state, countInRef.current)) return;
      countInRef.current = state;
      setCountInState(state);
      // Measure the leader's clock again now, over Realtime and Bluetooth: the count must be on the beat.
      if (state.on) {
        syncWith(state.from, true);
        bleBurst();
      }
    },
    [clientId, syncWith, bleBurst],
  );

  bleLiveRef.current = (event, payload) => {
    if (event === CLICK_EVENT) {
      const state = parseClickState(payload);
      if (state) receiveClick(state);
    } else if (event === PLAYHEAD_EVENT) {
      const state = parsePlayheadState(payload);
      if (state) receivePlayhead(state);
    }
    // D1's count-in ('countin') arrives here too: parse it and hand it to its receiver.
  };

  // The channel lives while Stage mode is open.
  useEffect(() => {
    if (!live || !eventId) return;
    /** This channel joined (SUBSCRIBED); unasked sends wait for it. */
    let joined = false;
    const channel = supabase.channel(stageTopic(eventId), {
      config: { private: true, broadcast: { self: false }, presence: { key: clientId } },
    });
    channelRef.current = channel;
    /**
     * Pongs sent per phone lately, and in all: a flood of pings gets a few answers, not one each.
     * Per claimed name, not per account: a Realtime broadcast carries no
     * verified sender, so one member writing pings in 40 names can use up the
     * overall cap for 2 s (the click keeps its last measure meanwhile). An
     * admin's copy on the stage topic is the same ping (`seen`) and counts once.
     */
    const answered = new Map<string, number[]>();
    let allAnswered: number[] = [];
    /** Pings answered lately, by name and t0: an admin's copy on the other topic isn't answered twice. */
    const seen = new Map<string, number>();
    /**
     * Names in Stage (the stage topic's presence): their pings are answered
     * even when made-up names used up the overall cap (Claude on #283), each
     * still within its own cap. Presence can be claimed too, but each name
     * there takes a join of its own (a band member's), not one message.
     */
    const present = new Set<string>();
    /**
     * A bandmate measuring our clock: answer straight away with our time, on
     * the stage topic (admins only), so nobody else can pose as the leader's clock.
     */
    const answerPing = (raw: unknown, fromAdmin: boolean) => {
      const p = raw as { from?: unknown; to?: unknown; t0?: unknown } | undefined;
      if (!p || p.to !== clientId || typeof p.from !== 'string' || typeof p.t0 !== 'number') return;
      // Answers go on the stage topic: not joined (Realtime reconnecting), supabase-js would post
      // them over HTTP. None is sent, and none counts against the caps (Claude on #283).
      if (!stageJoined.current) return;
      const now = nowMs();
      const ping = `${p.from}|${p.t0}`;
      if (seen.has(ping)) return;
      if (seen.size > 4 * ALL_PONGS_PER_WINDOW) for (const [k, t] of seen) if (now - t >= PONG_WINDOW_MS) seen.delete(k);
      allAnswered = allAnswered.filter((t) => now - t < PONG_WINDOW_MS);
      // The overall cap is for the clock topic, which any member may write; the
      // stage topic is admins only (their pings still count per name).
      const inStage = present.has(p.from);
      if (!fromAdmin && !inStage && allAnswered.length >= ALL_PONGS_PER_WINDOW) return;
      // Names nobody answered lately are forgotten (at most ALL_PONGS_PER_WINDOW stay).
      if (answered.size > ALL_PONGS_PER_WINDOW)
        for (const [name, times] of answered) if (!times.some((t) => now - t < PONG_WINDOW_MS)) answered.delete(name);
      const recent = (answered.get(p.from) ?? []).filter((t) => now - t < PONG_WINDOW_MS);
      if (recent.length >= PONGS_PER_WINDOW) return;
      recent.push(now);
      answered.set(p.from, recent);
      seen.set(ping, now);
      if (!fromAdmin && !inStage) allAnswered.push(now);
      // A member's ping (clock topic) gets the new answer: released apps would take a click-pong in their name.
      void channel.send({ type: 'broadcast', event: fromAdmin ? PONG_EVENT : CLOCK_PONG_EVENT, payload: { from: clientId, to: p.from, t0: p.t0, t1: now } });
    };
    /** The leader's answer to one of this phone's pings (either event). */
    const takePong = (raw: unknown) => {
      const p = raw as { from?: unknown; to?: unknown; t0?: unknown; t1?: unknown } | undefined;
      if (!p || p.to !== clientId || typeof p.from !== 'string' || typeof p.t0 !== 'number' || typeof p.t1 !== 'number') return;
      const book = samplesRef.current;
      if (book.peer !== p.from) return;
      // An answer to a ping this phone sent, once: not one written in our name, nor a replay.
      const asked = book.sent.indexOf(p.t0);
      const t2 = nowMs();
      if (asked < 0 || p.t0 > t2 || !Number.isFinite(p.t1)) return;
      book.sent.splice(asked, 1);
      // Older than any answer worth waiting for (PING_FORGET_MS): no time can be told by it, whatever
      // else came back (Codex on #283). Slower ones under it stay: see below.
      if (t2 - p.t0 > PING_FORGET_MS) return;
      // Slow ones are kept: bestSample prefers answers under MAX_CLOCK_RTT_MS (a late
      // one may be our old ping re-sent by someone else) and takes the fastest slow
      // one only when several came back slow (a slow network).
      book.samples.push(clockSample(p.t0, p.t1, t2));
      const best = bestSample(book.samples);
      if (best) setRtClock({ from: p.from, sample: best });
    };
    // Members' pings (migration 191): everyone in the band may write this topic.
    const clock = supabase.channel(stageClockTopic(eventId), { config: { private: true, broadcast: { self: false } } });
    clockRef.current = clock;
    clock
      .on('broadcast', { event: PING_EVENT }, (msg: { payload?: unknown }) => answerPing(msg?.payload, false))
      .subscribe((status: string) => {
        clockJoined.current = status === 'SUBSCRIBED';
        // Joined (or back after a reconnect) with a leader's click running and no
        // measure yet: the pings sent meanwhile went nowhere, measure again.
        const running = clickRef.current;
        if (status !== 'SUBSCRIBED' || !running?.on || running.from === clientId) return;
        const book = samplesRef.current;
        if (book.peer === running.from && bestSample(book.samples)) return;
        samplesRef.current = { peer: '', at: 0, samples: [], sent: [] };
        syncWith(running.from);
      });
    channel
      .on('broadcast', { event: 'state' }, (msg: { payload?: unknown }) => {
        const state = parseStageState(msg?.payload);
        if (state) receive(state);
      })
      .on('broadcast', { event: SESSION_EVENT }, (msg: { payload?: unknown }) => {
        sessionRef.current?.current.receive?.(msg?.payload);
      })
      .on('broadcast', { event: REGIA_EVENT }, (msg: { payload?: unknown }) => {
        regiaRef.current?.current.receive?.(msg?.payload);
      })
      .on('broadcast', { event: CLICK_EVENT }, (msg: { payload?: unknown }) => {
        const state = parseClickState(msg?.payload);
        if (state) receiveClick(state);
      })
      .on('broadcast', { event: PLAYHEAD_EVENT }, (msg: { payload?: unknown }) => {
        const state = parsePlayheadState(msg?.payload);
        if (state) receivePlayhead(state);
      })
      .on('broadcast', { event: COUNTIN_EVENT }, (msg: { payload?: unknown }) => {
        const state = parseCountInState(msg?.payload);
        if (state) receiveCountIn(state);
      })
      // An admin's ping (an older app pings here; admins may broadcast on this topic).
      .on('broadcast', { event: PING_EVENT }, (msg: { payload?: unknown }) => answerPing(msg?.payload, true))
      .on('broadcast', { event: PONG_EVENT }, (msg: { payload?: unknown }) => takePong(msg?.payload))
      .on('broadcast', { event: CLOCK_PONG_EVENT }, (msg: { payload?: unknown }) => takePong(msg?.payload))
      .on('broadcast', { event: LEAD_BEAT_EVENT }, (msg: { payload?: { from?: unknown; seq?: unknown } }) => {
        // Only admins can send here: a leader still leading online.
        const from = msg?.payload?.from;
        if (typeof from !== 'string' || from === clientId) return;
        const refused = refusedRef.current.get(from);
        if (refused) refused.at = Date.now();
        if (!liveLeadRef.current.has(from)) return;
        liveLeadRef.current.set(from, Date.now());
        // Only the followed leader's beat keeps things as they are (Codex on #280).
        if (from !== trustedRef.current?.from) return;
        armQuiet();
        // Its beat names its newest seq: the Bluetooth copy of a live update this phone
        // missed is that leader's latest, and applies (Codex on #280).
        const seq = msg?.payload?.seq;
        const held = heldBleRef.current;
        if (typeof seq === 'number' && held && held.from === from && held.seq === seq && isNewer(held, recent(lastRef.current))) {
          heldBleRef.current = null;
          receiveRef.current(held, 'realtime');
        }
      })
      // The server's word that the band key changed (191: someone left, a gig moved or was hidden).
      // Only a hint: Bluetooth fetches the key again and restarts if it really changed.
      .on('broadcast', { event: STAGE_KEY_BROADCAST }, (msg: { payload?: unknown }) => {
        const p = msg?.payload as { event_id?: unknown } | undefined;
        if (p?.event_id !== eventId || typeof window === 'undefined') return;
        window.dispatchEvent(new CustomEvent(STAGE_KEY_EVENT, { detail: eventId }));
      })
      .on('presence', { event: 'join' }, (msg: { key?: string; newPresences?: Array<{ lead?: unknown }> }) => {
        if (msg?.key === clientId) return;
        if (msg?.key) present.add(msg.key);
        const joined = msg?.key;
        if (joined && msg?.newPresences?.some((p) => p?.lead === true)) setRtLeaders((s) => (s.has(joined) ? s : new Set(s).add(joined)));
        // (A reopened leader's next state is taken by receive: a leader not heard before.)
        // The click's leader (re)joined while this phone has no measure of its clock (its
        // clock channel late, say): ping now, not at the next, backed-off, retry.
        const clickNow = clickRef.current;
        if (clickNow?.on && clickNow.from !== clientId && clickNow.from === msg?.key) {
          const book = samplesRef.current;
          if (!(book.peer === clickNow.from && bestSample(book.samples))) {
            samplesRef.current = { peer: '', at: 0, samples: [], sent: [] };
            syncWith(clickNow.from);
          }
        }
        // A running click of ours reaches late arrivals too.
        if (clickRef.current?.from === clientId && clickRef.current.on && isLeader) {
          void channel.send({ type: 'broadcast', event: CLICK_EVENT, payload: clickWire(clickRef.current) });
        }
        // …and the playhead (Follow the tempo), so a late phone lands on the right bar.
        if (isLeader && playheadRef.current?.from === clientId && playheadRef.current.on) {
          void channel.send({ type: 'broadcast', event: PLAYHEAD_EVENT, payload: playheadRef.current });
        }
        // …and a count-in still running: the late phone joins on the right beat.
        if (isLeader && countInRef.current?.from === clientId && countInRef.current.on) {
          void channel.send({ type: 'broadcast', event: COUNTIN_EVENT, payload: countInRef.current });
        }
        // So does the rehearsal session (timer) the leader runs.
        const sessionNow = isLeader ? sessionRef.current?.current.latest?.() : null;
        if (sessionNow) void channel.send({ type: 'broadcast', event: SESSION_EVENT, payload: sessionNow });
        // …and the Regia's song (what plays, where it is).
        const regiaNow = regiaRef.current?.current.latest?.();
        if (regiaNow) void channel.send({ type: 'broadcast', event: REGIA_EVENT, payload: regiaNow });
        if (!ledRef.current || !lastRef.current) return;
        if (lastRef.current.from !== clientId) return;
        void channel.send({ type: 'broadcast', event: 'state', payload: lastRef.current });
      })
      .on('presence', { event: 'leave' }, (msg: { key?: string }) => {
        if (msg?.key) present.delete(msg.key);
        const gone = msg?.key;
        if (gone) setRtLeaders((s) => (s.has(gone) ? new Set([...s].filter((k) => k !== gone)) : s));
        if (msg?.key && msg.key !== clientId) regiaRef.current?.current.left?.(msg.key);
        // The click's leader left (closed Stage mode or lost the network): stop showing its click.
        const running = clickRef.current;
        if (!msg?.key || !running || running.from === clientId || running.from !== msg.key) return;
        clickRef.current = null;
        setClick(null);
      })
      .subscribe((status: string) => {
        setConnected(status === 'SUBSCRIBED');
        joined = status === 'SUBSCRIBED';
        stageJoined.current = status === 'SUBSCRIBED';
        // Off the channel: no leader reaches this phone online, Bluetooth takes over at once.
        if (status !== 'SUBSCRIBED') {
          liveLeadRef.current.clear();
          // Bluetooth takes over now, not another admin's older live state.
          refusedRef.current.clear();
          releaseRef.current();
        }
        if (status === 'SUBSCRIBED') {
          // (Released apps still read "lead" from presence; this app no longer trusts it.)
          void channel.track({ lead: isLeader }).catch(() => {});
        }
      });
    // Once it has led: "still leading", so members hold Bluetooth states back.
    // Only while joined: off it, supabase-js would post the beat over HTTP.
    const beat = setInterval(() => {
      const seq = lastRef.current?.from === clientId ? lastRef.current.seq : undefined;
      if (ledRef.current && joined) void channel.send({ type: 'broadcast', event: LEAD_BEAT_EVENT, payload: { from: clientId, seq } });
    }, LEAD_BEAT_MS);
    return () => {
      // Our running click stops on everyone's phone too.
      const running = clickRef.current;
      if (isLeader && running?.from === clientId && running.on) {
        const off: ClickState = { ...running, on: false, seq: nextSeq(running.seq) };
        clickRef.current = off;
        void channel.send({ type: 'broadcast', event: CLICK_EVENT, payload: clickWire(off) });
      }
      const count = countInRef.current;
      if (isLeader && count?.from === clientId && count.on) {
        const off = stopCountIn(count);
        countInRef.current = off;
        void channel.send({ type: 'broadcast', event: COUNTIN_EVENT, payload: off });
      }
      const head = playheadRef.current;
      if (isLeader && head?.from === clientId && head.on) {
        const off = stopPlayhead(head);
        playheadRef.current = off;
        void channel.send({ type: 'broadcast', event: PLAYHEAD_EVENT, payload: off });
      }
      clearInterval(beat);
      clearTimeout(quietTimer.current);
      channelRef.current = null;
      liveLeadRef.current.clear();
      refusedRef.current.clear();
      heldBleRef.current = null;
      clockRef.current = null;
      clockJoined.current = false;
      stageJoined.current = false;
      setConnected(false);
      setRtLeaders(new Set());
      void supabase.removeChannel(channel);
      void supabase.removeChannel(clock);
    };
  }, [live, eventId, clientId, isLeader, receive, receiveClick, receivePlayhead, receiveCountIn, syncWith]);

  /** The rows after a song added on stage, while `current` (the songs loaded) doesn't have its row yet. */
  const baseRows = useCallback((current: readonly { id?: string }[]): StoredRow[] | null => {
    const base = addedBase.current;
    if (!base) return null;
    const have = new Set(current.map((s) => s.id));
    if ([...base.added].some((id) => !have.has(id))) return base.rows;
    addedBase.current = null; // reloaded (or fresher): the songs loaded are the setlist now
    return null;
  }, []);
  const rememberAdded = useCallback((rows: StoredRow[]) => {
    const have = new Set(saveCtx.current.songs.map((s) => s.id));
    const added = new Set(rows.map((r) => r.id).filter((id) => !have.has(id)));
    addedBase.current = added.size ? { rows, added } : null;
  }, []);

  /**
   * Save the pending order now. `closing`: Stage mode is closing, so only the
   * save itself runs (no status, nothing sent).
   */
  const flushSave = useCallback(
    async (closing: boolean) => {
      clearTimeout(saveTimer.current);
      // A song being added on stage: its save changes the rows this order is
      // checked against, so the order is saved once that answer is in.
      if (!closing && addsInFlight.current > 0 && pendingOrder.current) {
        saveTimer.current = setTimeout(() => void flushRef.current(false), SAVE_DELAY_MS);
        return;
      }
      const ids = pendingOrder.current;
      pendingOrder.current = null;
      const { songs: current, setlistId: list } = saveCtx.current;
      if (!ids || !list) return;
      const base = baseRows(current);
      const saved = base ?? current.filter((s) => s.id && s.songId).map((s) => ({ id: s.id!, songId: s.songId!, setNumber: s.setNumber }));
      const byId = new Map(saved.map((s) => [s.id, s]));
      const inOrder = ids.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
      if (inOrder.length !== saved.length) {
        if (!closing) setSaveState('error');
        return;
      }
      const rows = reorderRows(list, saved, inOrder);
      const owner = await sessionUserId(); // queued offline only for this account
      const { error } = await saveStageOrder(list, rows, saved);
      // The gig open behind Stage mode reloads its setlist in the new order.
      if (!error) {
        // The same one summary push as a save in the gig overview (107), to
        // the lineup, also for who isn't in Stage mode.
        void notifySetlistSaved({
          setlistId: list,
          eventId: saveCtx.current.eventId,
          change: diffSetlist(
            saved.map((s) => ({ songId: s.songId, setNumber: s.setNumber })),
            rows.map((r) => ({ songId: r.song_id, setNumber: r.set_number })),
          ),
        });
        try {
          window.dispatchEvent(new CustomEvent(SETLIST_ORDER_SAVED, { detail: { setlistId: list } }));
        } catch {
          /* no window */
        }
      }
      if (error) {
        const before = saved.map((s) => ({ id: s.id, songId: s.songId, setNumber: s.setNumber }));
        const eventIdNow = saveCtx.current.eventId;
        // No signal at the venue, or the server busy for a moment: the new
        // order stands (on screen, over Bluetooth) and is saved as soon as
        // the server answers (plan §3.5).
        if (await keepOrderOffline(error, { setlistId: list, eventId: eventIdNow, rows, before }, owner)) {
          if (!closing) setSaveState('waiting');
          return;
        }
      }
      if (closing) return;
      if (error) {
        // Back to the saved order, for everyone.
        setSaveState('error');
        setOrder(null);
        send({ songId: lastRef.current?.songId ?? null, order: saved.map((s) => s.id) });
        return;
      }
      setSaveState('saved');
    },
    [send, baseRows],
  );
  const flushRef = useRef(flushSave);
  flushRef.current = flushSave;

  // An order kept on this phone (no signal) was sent once back online
  // (liveOutboxApi): "Saved on this phone" becomes "Saved".
  useEffect(() => {
    if (!setlistId) return;
    const onSaved = (e: Event) => {
      if ((e as CustomEvent<{ setlistId?: string }>).detail?.setlistId !== setlistId) return;
      setSaveState((s) => (s === 'waiting' ? 'saved' : s));
    };
    window.addEventListener(SETLIST_ORDER_SAVED, onSaved);
    return () => window.removeEventListener(SETLIST_ORDER_SAVED, onSaved);
  }, [setlistId]);

  // Closing Stage mode forgets the live state; the saved order stands
  // (a move still waiting for its save is saved now, not dropped).
  useEffect(() => {
    if (open) return;
    if (pendingOrder.current) void flushRef.current(true);
    clearTimeout(saveTimer.current);
    setOrder(null);
    setSongId(null);
    setFallbackIndex(0);
    setFollowingState(true);
    setLeaderSeen(false);
    setSaveState('idle');
    lastRef.current = null;
    trustedRef.current = null;
    lastFromBluetoothRef.current = false;
    remoteRef.current = null;
    liveLeadRef.current.clear();
    refusedRef.current.clear();
    heldBleRef.current = null;
    ledRef.current = false;
    clickRef.current = null;
    setClick(null);
    setRtClock(null);
    playheadRef.current = null;
    setPlayheadState(null);
    countInRef.current = null;
    setCountInState(null);
    pingTimers.current.forEach(clearTimeout);
  }, [open]);

  useEffect(
    () => () => {
      if (pendingOrder.current) void flushRef.current(true);
      clearTimeout(saveTimer.current);
      pingTimers.current.forEach(clearTimeout);
    },
    [],
  );

  /**
   * Start or stop the click on the current song. The leader's reaches the
   * whole band; anyone else's stays on their own phone.
   */
  const setClickOn = useCallback(
    (on: boolean, opts?: { bpm: number; beats: number; bars?: number | null; groups?: number[] | null; startAt?: number }) => {
      const prev = clickRef.current;
      const state: ClickState = {
        seq: nextSeq(prev?.seq),
        from: clientId,
        on,
        bpm: opts?.bpm ?? prev?.bpm ?? 120,
        beats: opts?.beats ?? prev?.beats ?? 4,
        bars: opts?.bars ?? null,
        ...(opts?.groups?.length ? { groups: opts.groups } : !opts && prev?.groups ? { groups: prev.groups } : {}),
        startAt: opts?.startAt ?? nowMs() + (isLeader && on ? START_LEAD_MS : 0),
        songId: songId ?? ordered[index]?.id ?? null,
      };
      clickRef.current = state;
      setClick(state);
      if (isLeader) {
        // The same message on both paths (the members' parser reads the wire form, clickWire).
        const wire = clickWire(state);
        void channelRef.current?.send({ type: 'broadcast', event: CLICK_EVENT, payload: wire });
        blePublishLive(CLICK_EVENT, wire);
      }
    },
    [clientId, isLeader, songId, ordered, index, blePublishLive],
  );

  /**
   * Leader: a new playhead state (start, re-align, Hold, Stop), worked out
   * with playhead.ts; it reaches every phone in Stage mode. Anyone else's
   * stays on their own phone.
   */
  const setPlayhead = useCallback(
    (next: PlayheadState) => {
      const state = { ...next, from: clientId };
      playheadRef.current = state;
      setPlayheadState(state);
      if (isLeader) {
        void channelRef.current?.send({ type: 'broadcast', event: PLAYHEAD_EVENT, payload: state });
        blePublishLive(PLAYHEAD_EVENT, state);
      }
    },
    [clientId, isLeader, blePublishLive],
  );

  /** Leader: a count-in (start or Stop) on every phone; anyone else's stays on their phone. */
  const setCountIn = useCallback(
    (next: CountInState) => {
      const state = { ...next, from: clientId };
      countInRef.current = state;
      setCountInState(state);
      if (isLeader) void channelRef.current?.send({ type: 'broadcast', event: COUNTIN_EVENT, payload: state });
    },
    [clientId, isLeader],
  );

  /** Make song `i` (in the live order) the current one. */
  const select = useCallback(
    (i: number) => {
      const clamped = Math.min(Math.max(0, i), Math.max(0, ordered.length - 1));
      const id = ordered[clamped]?.id ?? null;
      setFallbackIndex(clamped);
      setSongId(id);
      // Another song: the playhead stops (for everyone, when the leader moves).
      const head = playheadRef.current;
      if (head?.on && head.songId !== id && (isLeader || head.from === clientId)) setPlayhead(stopPlayhead(head));
      const count = countInRef.current;
      if (count?.on && count.songId !== id && (isLeader || count.from === clientId)) setCountIn(stopCountIn(count));
      if (isLeader) {
        send({ songId: id, order });
      } else if (followingRef.current) {
        // Stepping on your own: stop following until turned back on.
        setFollowingState(false);
      }
    },
    [ordered, isLeader, send, order, setPlayhead, setCountIn, clientId],
  );

  const skippedSet = useMemo(() => new Set(skipped), [skipped]);
  // Prev / Next step over the songs struck off.
  const go = useCallback((delta: number) => select(stepOver(ordered, index, delta, skippedSet)), [select, ordered, index, skippedSet]);

  /** Leader: strike song `i` off tonight's set (or bring it back). Not saved to the setlist. */
  const toggleSkip = useCallback(
    (i: number) => {
      const id = ordered[i]?.id;
      if (!isLeader || !id) return;
      const next = skippedRef.current.includes(id) ? skippedRef.current.filter((x) => x !== id) : [...skippedRef.current, id];
      setSkipped(next);
      writeSkipped(eventId, next);
      send({ songId: songId ?? ordered[index]?.id ?? null, order });
    },
    [ordered, isLeader, setSkipped, eventId, send, songId, index, order],
  );

  const setFollowing = useCallback(
    (on: boolean) => {
      setFollowingState(on);
      const remote = remoteRef.current;
      if (on && remote) applyRemote(remote);
    },
    [applyRemote],
  );

  /** Leader: move a song in the setlist; saved shortly after the last move. */
  const move = useCallback(
    (from: number, to: number) => {
      if (!isLeader || !setlistId) return;
      const next = moveItem(ordered, from, to);
      if (next === ordered) return;
      const ids = next.map((s) => s.id).filter((id): id is string => !!id);
      if (ids.length !== next.length) return;
      // A song just added on stage isn't shown until the reload: it keeps its
      // place (after the song before it in the live order) in what is sent and saved.
      if (baseRows(saveCtx.current.songs) && order) {
        const shown = new Set(ids);
        order.forEach((id, i) => {
          if (shown.has(id) || !addedBase.current?.added.has(id)) return;
          const before = order.slice(0, i).reverse().find((x) => shown.has(x));
          ids.splice(before ? ids.indexOf(before) + 1 : 0, 0, id);
          shown.add(id);
        });
      }
      setOrder(ids);
      send({ songId: songId ?? ordered[index]?.id ?? null, order: ids });
      setSaveState('saving');
      pendingOrder.current = ids;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flushSave(false), SAVE_DELAY_MS);
    },
    [isLeader, setlistId, ordered, order, send, songId, index, flushSave, baseRows],
  );

  /**
   * Leader: make row `id` the current song with this live `order` (a song
   * just added on stage, whose row the others are still loading).
   */
  const jumpTo = useCallback(
    (id: string, nextOrder: string[], rows?: StoredRow[]) => {
      if (!isLeader) return;
      if (rows) rememberAdded(rows);
      setOrder(nextOrder);
      setSongId(id);
      send({ songId: id, order: nextOrder });
    },
    [isLeader, send, rememberAdded],
  );

  /** A song is being added on stage: order saves wait until the returned release is called. */
  const holdOrderSaves = useCallback(() => {
    addsInFlight.current += 1;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      addsInFlight.current = Math.max(0, addsInFlight.current - 1);
    };
  }, []);

  /** The last move's order not saved yet (null: none). */
  const pendingOrderNow = useCallback(() => pendingOrder.current, []);
  /**
   * The order was saved another way (the Regia's added song): its pending
   * save is dropped, only if it is still `ids` (what was pending when that
   * save started); a move made since is still saved.
   */
  const dropPendingOrder = useCallback((ids: string[] | null) => {
    if (!ids || pendingOrder.current !== ids) return;
    clearTimeout(saveTimer.current);
    pendingOrder.current = null;
    setSaveState((s) => (s === 'saving' ? 'saved' : s));
  }, []);
  /**
   * A move made while a song added on stage was saving: its order (with the
   * new row in it) is saved against `rows`, the setlist as stored after the
   * add, not the songs loaded before it.
   */
  const rebasePendingOrder = useCallback(
    (ids: string[], rows: StoredRow[]) => {
      if (!isLeader) return;
      rememberAdded(rows);
      pendingOrder.current = ids;
      setSaveState('saving');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flushSave(false), SAVE_DELAY_MS);
    },
    [isLeader, flushSave, rememberAdded],
  );

  /** Send the Regia's state to everyone in Stage mode. */
  const sendRegia = useCallback((payload: unknown) => {
    void channelRef.current?.send({ type: 'broadcast', event: REGIA_EVENT, payload });
  }, []);

  /** Send the rehearsal session to everyone in Live mode (leader). */
  const sendSession = useCallback((payload: unknown) => {
    void channelRef.current?.send({ type: 'broadcast', event: SESSION_EVENT, payload });
  }, []);

  // The click leader's clock: Realtime or Bluetooth, whichever measured it with the shorter round trip.
  const clickLeader = click && click.from !== clientId ? click.from : null;
  const bestClock = pickClock(clickLeader, rtClock, ble.clock);
  const clickOffset = bestClock?.offset ?? 0;
  // The playhead's sender is measured the same way (usually the same leader).
  const playheadPeer = playhead && playhead.from !== clientId ? playhead.from : null;
  const playheadOffset = pickClock(playheadPeer, rtClock, ble.clock)?.offset ?? 0;
  const countInPeer = countIn && countIn.from !== clientId ? countIn.from : null;
  const countInOffset = pickClock(countInPeer, rtClock, ble.clock)?.offset ?? 0;

  // The leader's phone is reachable: on the channel, or linked over Bluetooth.
  // Linked in any of its states (signed, an older app's, not checkable yet: #288).
  const bleLinked = !isLeader && linkedOverBle(ble.status);
  const leaderOnline = rtLeaders.size > 0;
  const leaderHere = !isLeader && (leaderOnline || bleLinked);

  // No internet path to the leader, and its Bluetooth link gone a while: stop
  // showing its click and playhead (like the channel does when it leaves).
  // Cleared, not stopped, so the leader back in reach catches up at once.
  const remoteRunning = !!(click && click.from !== clientId && click.on) || !!(playhead && playhead.from !== clientId && playhead.on);
  useEffect(() => {
    if (isLeader || leaderOnline || bleLinked || !remoteRunning) return;
    const timer = setTimeout(() => {
      if (clickRef.current && clickRef.current.from !== clientId) {
        clickRef.current = null;
        setClick(null);
      }
      if (playheadRef.current && playheadRef.current.from !== clientId) {
        playheadRef.current = null;
        setPlayheadState(null);
      }
    }, BLE_LEADER_GONE_MS);
    return () => clearTimeout(timer);
  }, [isLeader, leaderOnline, bleLinked, remoteRunning, clientId]);

  return {
    /** The setlist in its live order. */
    songs: ordered,
    /** The setlist as stored (its saved order). */
    savedSongs: songs,
    pendingOrder: pendingOrderNow,
    dropPendingOrder,
    rebasePendingOrder,
    holdOrderSaves,
    sendSession,
    /** This app's id on the channel (one per Stage mode session). */
    clientId,
    sendRegia,
    jumpTo,
    /** The current song's row id (null before the first song). */
    currentId: ordered[index]?.id ?? null,
    index,
    select,
    go,
    following,
    setFollowing,
    /** A leader's state has arrived since Stage mode opened. */
    leaderSeen,
    /** Members: the leader's phone is in Stage mode and reachable (channel or Bluetooth), song picked or not. */
    leaderHere,
    /** The live channel is connected. */
    connected,
    /** Bluetooth link (native apps): leading, searching, connected… */
    bluetooth: ble.status,
    /** Leader: phones linked over Bluetooth. */
    bluetoothFollowers: ble.followers,
    /** Leader: leading over Bluetooth with no key pair (the status line says so). */
    bluetoothUnsigned: ble.unsigned,
    /** Allow Bluetooth / turn it on (the status line's button). */
    fixBluetooth: ble.fix,
    isLeader,
    /** Reordering needs saved rows (a band setlist with row ids). */
    canReorder: isLeader && !!setlistId && hasIds && ordered.every((s) => !!s.songId),
    move,
    saveState,
    /** Songs struck off tonight (row ids). */
    skipped: skippedSet,
    /** The leader can strike songs off (saved rows with ids). */
    canStrike: isLeader && hasIds,
    toggleSkip,
    /** Visual metronome: the newest click, whose it is, and the clock offset to use. */
    click: {
      state: click,
      mine: !!click && click.from === clientId,
      offset: click && click.from !== clientId ? clickOffset : 0,
      setOn: setClickOn,
    },
    /**
     * Follow the tempo: the newest playhead (playhead.ts), whose it is, the
     * clock offset to use with it, and (leader) how to send a new one.
     */
    playhead: {
      state: playhead,
      mine: !!playhead && playhead.from === clientId,
      offset: playheadOffset,
      set: setPlayhead,
      clientId,
    },
    /** The count-in (countIn.ts): newest state, whose, offset, and (leader) send. */
    countIn: {
      state: countIn,
      mine: !!countIn && countIn.from === clientId,
      offset: countInOffset,
      set: setCountIn,
    },
  };
}

export type StageLive<T extends LiveSongRef = LiveSongRef> = ReturnType<typeof useStageLive<T>>;
