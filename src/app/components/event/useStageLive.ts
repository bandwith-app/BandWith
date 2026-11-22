import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { saveSetlistOrder } from '@/lib/services/songs';
import { keepOrderOffline } from '@/lib/services/liveOutboxApi';
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
  stageTopic,
  stepOver,
  usableOffset,
  type StageLiveState,
} from '@/lib/stageLive';
import {
  bestSample,
  CLICK_EVENT,
  clockSample,
  nowMs,
  parseClickState,
  pickClock,
  PING_EVENT,
  PONG_EVENT,
  START_LEAD_MS,
  type ClickState,
  type ClockSample,
  type PeerClock,
} from '@/lib/stageClick';
import { REGIA_EVENT } from '@/lib/stageRegia';

/** Round trips measured when a click starts; the fastest sets the offset. */
const PINGS = 6;
const PING_GAP_MS = 200;
/** Measure again after this long (clocks drift slowly). */
const RESYNC_MS = 60_000;

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

/** `waiting`: no signal, the order is kept on this phone and saved when back online. */
/** Where a leader's state came from: the live channel (admins only), or Bluetooth (anyone with the band key). */
type StateSource = 'realtime' | 'bluetooth';

export type StageSaveState = 'idle' | 'saving' | 'saved' | 'error' | 'waiting';

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
  const samplesRef = useRef<{ peer: string; at: number; samples: ClockSample[] }>({ peer: '', at: 0, samples: [] });
  const pingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

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
   * Bluetooth states (anyone with the band key can make one):
   * - while a leader leads on the live channel (a state or a beat in the last
   *   LIVE_LEAD_FRESH_MS) they're held back, the newest applying once it goes quiet;
   * - one never holds back a Realtime state: a Realtime state newer than the
   *   last Realtime one applies even when a Bluetooth one had a higher seq;
   * - a seq far ahead of the clock is dropped (useStageBle drops them too).
   * A live leader not heard before, once the one followed has gone quiet
   * (Stage reopened, maybe on a phone with an earlier clock), is taken
   * whatever its seq.
   */
  const receive = useCallback(
    (state: StageLiveState, source: StateSource = 'realtime') => {
      if (state.from === clientId) return;
      const bluetooth = source === 'bluetooth';
      const at = Date.now();
      if (bluetooth) {
        // Judged with that leader's clock, when one was measured (a phone set an hour ahead still leads).
        // Measured more than 5 minutes off: that phone's states never count (MAX_CLOCK_OFFSET_MS).
        const offset = leaderOffsetRef.current(state.from);
        if (offset === null || !seqPlausible(state.seq, at + offset)) return;
        if (leadingOnline(at)) {
          if (isNewer(state, heldBleRef.current)) heldBleRef.current = state;
          return;
        }
      }
      let newLeader = false;
      if (!bluetooth) {
        const lead = liveLeadRef.current;
        const followed = trustedRef.current?.from;
        // This phone leading itself counts as a leader online (its own states are in trustedRef).
        const followedFresh = followed === clientId ? ledRef.current : !!followed && at - (lead.get(followed) ?? -Infinity) < LIVE_LEAD_FRESH_MS;
        newLeader = !lead.has(state.from) && !followedFresh;
      }
      // Clock moves on even for states we don't show (Lamport).
      const overBluetooth = !bluetooth && lastFromBluetoothRef.current && isNewer(state, trustedRef.current);
      if (!isNewer(state, lastRef.current) && !overBluetooth && !newLeader) return;
      // Taken: only now is its sender a live leader (a refused state marks nothing, Codex on #288).
      if (!bluetooth) {
        liveLeadRef.current.set(state.from, at);
        armQuiet();
      }
      // Another leader's newer state: this phone no longer leads (its beats stop).
      ledRef.current = false;
      lastRef.current = state;
      lastFromBluetoothRef.current = bluetooth;
      if (!bluetooth) trustedRef.current = state;
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

  /** The live leaders went quiet (or the channel dropped): a held Bluetooth state applies. */
  const releaseHeld = () => {
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
  const receiveBle = useCallback((state: StageLiveState) => receive(state, 'bluetooth'), [receive]);
  const ble = useStageBle({ eventId, savedIds, open: live, isLeader, onState: receiveBle });
  /**
   * A leader's clock offset, measured over Bluetooth or Realtime (0 when none
   * was), read from the refs set at once; null when it is more than 5 minutes
   * off (MAX_CLOCK_OFFSET_MS).
   */
  const bleClockRef = ble.clockRef;
  const offsetOf = (from: string) => {
    const b = bleClockRef?.current ?? null;
    const r = rtClockRef.current;
    const measured = (b?.from === from ? b.sample?.offset : r?.from === from ? r.sample?.offset : 0) ?? 0;
    return usableOffset(measured);
  };
  const leaderOffsetRef = useRef(offsetOf);
  leaderOffsetRef.current = offsetOf;
  const blePublish = ble.publish;
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
      const seq = nextSeq(Math.max(lastRef.current?.seq ?? 0, (eventId && ownSeqs.get(eventId)) || 0));
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

  /** Measure the click leader's clock: a few pings, the fastest round trip wins. */
  const syncWith = useCallback(
    (peer: string) => {
      const book = samplesRef.current;
      if (book.peer === peer && nowMs() - book.at < RESYNC_MS && book.samples.length) return;
      samplesRef.current = { peer, at: nowMs(), samples: [] };
      pingTimers.current.forEach(clearTimeout);
      pingTimers.current = Array.from({ length: PINGS }, (_, i) =>
        setTimeout(() => {
          void channelRef.current?.send({ type: 'broadcast', event: PING_EVENT, payload: { from: clientId, to: peer, t0: nowMs() } });
        }, i * PING_GAP_MS),
      );
    },
    [clientId],
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

  // The channel lives while Stage mode is open.
  useEffect(() => {
    if (!live || !eventId) return;
    const channel = supabase.channel(stageTopic(eventId), {
      config: { private: true, broadcast: { self: false }, presence: { key: clientId } },
    });
    channelRef.current = channel;
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
      .on('broadcast', { event: PING_EVENT }, (msg: { payload?: { from?: unknown; to?: unknown; t0?: unknown } }) => {
        // A bandmate measuring our clock: answer straight away with our time.
        const p = msg?.payload;
        if (!p || p.to !== clientId || typeof p.from !== 'string' || typeof p.t0 !== 'number') return;
        void channel.send({ type: 'broadcast', event: PONG_EVENT, payload: { from: clientId, to: p.from, t0: p.t0, t1: nowMs() } });
      })
      .on('broadcast', { event: PONG_EVENT }, (msg: { payload?: { from?: unknown; to?: unknown; t0?: unknown; t1?: unknown } }) => {
        const p = msg?.payload;
        if (!p || p.to !== clientId || typeof p.from !== 'string' || typeof p.t0 !== 'number' || typeof p.t1 !== 'number') return;
        const book = samplesRef.current;
        if (book.peer !== p.from) return;
        book.samples.push(clockSample(p.t0, p.t1, nowMs()));
        const best = bestSample(book.samples);
        if (best) setRtClock({ from: p.from, sample: best });
      })
      .on('broadcast', { event: LEAD_BEAT_EVENT }, (msg: { payload?: { from?: unknown } }) => {
        // Only admins can send here: a leader still leading online.
        const from = msg?.payload?.from;
        if (typeof from !== 'string' || from === clientId || !liveLeadRef.current.has(from)) return;
        liveLeadRef.current.set(from, Date.now());
        armQuiet();
      })
      .on('presence', { event: 'join' }, (msg: { key?: string }) => {
        if (msg?.key === clientId) return;
        // (A reopened leader's next state is taken by receive: a leader not heard before.)
        // A running click of ours reaches late arrivals too.
        if (clickRef.current?.from === clientId && clickRef.current.on && isLeader) {
          void channel.send({ type: 'broadcast', event: CLICK_EVENT, payload: clickRef.current });
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
        if (msg?.key && msg.key !== clientId) regiaRef.current?.current.left?.(msg.key);
        // The click's leader left (closed Stage mode or lost the network): stop showing its click.
        const running = clickRef.current;
        if (!msg?.key || !running || running.from === clientId || running.from !== msg.key) return;
        clickRef.current = null;
        setClick(null);
      })
      .subscribe((status: string) => {
        setConnected(status === 'SUBSCRIBED');
        // Off the channel: no leader reaches this phone online, Bluetooth takes over at once.
        if (status !== 'SUBSCRIBED') {
          liveLeadRef.current.clear();
          releaseRef.current();
        }
        if (status === 'SUBSCRIBED') {
          // (Released apps still read "lead" from presence; this app no longer trusts it.)
          void channel.track({ lead: isLeader }).catch(() => {});
        }
      });
    // Once it has led: "still leading", so members hold Bluetooth states back.
    const beat = setInterval(() => {
      if (ledRef.current) void channel.send({ type: 'broadcast', event: LEAD_BEAT_EVENT, payload: { from: clientId } });
    }, LEAD_BEAT_MS);
    return () => {
      // Our running click stops on everyone's phone too.
      const running = clickRef.current;
      if (isLeader && running?.from === clientId && running.on) {
        const off: ClickState = { ...running, on: false, seq: nextSeq(running.seq) };
        clickRef.current = off;
        void channel.send({ type: 'broadcast', event: CLICK_EVENT, payload: off });
      }
      clearInterval(beat);
      clearTimeout(quietTimer.current);
      channelRef.current = null;
      liveLeadRef.current.clear();
      heldBleRef.current = null;
      setConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [live, eventId, clientId, isLeader, receive, receiveClick]);

  /**
   * Save the pending order now. `closing`: Stage mode is closing, so only the
   * save itself runs (no status, nothing sent).
   */
  const flushSave = useCallback(
    async (closing: boolean) => {
      clearTimeout(saveTimer.current);
      const ids = pendingOrder.current;
      pendingOrder.current = null;
      const { songs: current, setlistId: list } = saveCtx.current;
      if (!ids || !list) return;
      const saved = current.filter((s) => s.id && s.songId).map((s) => ({ id: s.id!, songId: s.songId!, setNumber: s.setNumber }));
      const byId = new Map(saved.map((s) => [s.id, s]));
      const inOrder = ids.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
      if (inOrder.length !== saved.length) {
        if (!closing) setSaveState('error');
        return;
      }
      const rows = reorderRows(list, saved, inOrder);
      const { error } = await saveSetlistOrder(rows);
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
        const before = saved.map((s) => ({ songId: s.songId, setNumber: s.setNumber }));
        const eventIdNow = saveCtx.current.eventId;
        // No signal at the venue: the new order stands (on screen, over
        // Bluetooth) and is saved when back online (plan §3.5).
        if (await keepOrderOffline(error, { setlistId: list, eventId: eventIdNow, rows, before })) {
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
    [send],
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
    heldBleRef.current = null;
    ledRef.current = false;
    clickRef.current = null;
    setClick(null);
    setRtClock(null);
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
    (on: boolean, opts?: { bpm: number; beats: number; bars?: number | null }) => {
      const prev = clickRef.current;
      const state: ClickState = {
        seq: nextSeq(prev?.seq),
        from: clientId,
        on,
        bpm: opts?.bpm ?? prev?.bpm ?? 120,
        beats: opts?.beats ?? prev?.beats ?? 4,
        bars: opts?.bars ?? null,
        startAt: nowMs() + (isLeader && on ? START_LEAD_MS : 0),
        songId: songId ?? ordered[index]?.id ?? null,
      };
      clickRef.current = state;
      setClick(state);
      if (isLeader) void channelRef.current?.send({ type: 'broadcast', event: CLICK_EVENT, payload: state });
    },
    [clientId, isLeader, songId, ordered, index],
  );

  /** Make song `i` (in the live order) the current one. */
  const select = useCallback(
    (i: number) => {
      const clamped = Math.min(Math.max(0, i), Math.max(0, ordered.length - 1));
      const id = ordered[clamped]?.id ?? null;
      setFallbackIndex(clamped);
      setSongId(id);
      if (isLeader) {
        send({ songId: id, order });
      } else if (followingRef.current) {
        // Stepping on your own: stop following until turned back on.
        setFollowingState(false);
      }
    },
    [ordered, isLeader, send, order],
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
      setOrder(ids);
      send({ songId: songId ?? ordered[index]?.id ?? null, order: ids });
      setSaveState('saving');
      pendingOrder.current = ids;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flushSave(false), SAVE_DELAY_MS);
    },
    [isLeader, setlistId, ordered, send, songId, index, flushSave],
  );

  /**
   * Leader: make row `id` the current song with this live `order` (a song
   * just added on stage, whose row the others are still loading).
   */
  const jumpTo = useCallback(
    (id: string, nextOrder: string[]) => {
      if (!isLeader) return;
      setOrder(nextOrder);
      setSongId(id);
      send({ songId: id, order: nextOrder });
    },
    [isLeader, send],
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
  const bestClock = pickClock(clickLeader, [rtClock, ble.clock]);
  const clickOffset = bestClock?.offset ?? 0;

  return {
    /** The setlist in its live order. */
    songs: ordered,
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
    /** The live channel is connected. */
    connected,
    /** Bluetooth link (native apps): leading, searching, connected… */
    bluetooth: ble.status,
    /** Leader: phones linked over Bluetooth. */
    bluetoothFollowers: ble.followers,
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
  };
}

export type StageLive<T extends LiveSongRef = LiveSongRef> = ReturnType<typeof useStageLive<T>>;
