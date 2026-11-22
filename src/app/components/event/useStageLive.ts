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
  stageClockTopic,
  stageTopic,
  stepOver,
  type StageLiveState,
} from '@/lib/stageLive';
import {
  bestSample,
  CLICK_EVENT,
  clockSample,
  MAX_CLOCK_RTT_MS,
  nowMs,
  parseClickState,
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
/** Measure again after this long (clocks drift slowly). */
const RESYNC_MS = 60_000;
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
export function useStageLive<T extends LiveSongRef>({ eventId, setlistId, songs, open, isLeader, session, regia }: Options<T>) {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const regiaRef = useRef(regia);
  regiaRef.current = regia;
  const clientId = useMemo(() => Math.random().toString(36).slice(2, 10), []);
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
  /** The clock topic: members' pings (the stage topic only takes the admins' broadcasts). */
  const clockRef = useRef<RealtimeChannel | null>(null);
  /** Newest state applied or sent (Lamport clock + what it said). */
  const lastRef = useRef<StageLiveState | null>(null);
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
  const [rtClock, setRtClock] = useState<PeerClock | null>(null);
  /** The measure of one peer's clock: its samples, and the t0 of each ping still unanswered. */
  const samplesRef = useRef<{ peer: string; at: number; samples: ClockSample[]; sent: number[] }>({ peer: '', at: 0, samples: [], sent: [] });
  const pingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** The clock topic joined: sent to only then (supabase-js would post a ping over HTTP otherwise). */
  const clockJoined = useRef(false);

  const live = !!eventId && open;
  const ordered = useMemo(() => applyOrder(songs, order), [songs, order]);
  const savedIds = useMemo(() => songs.map((s) => s.id).filter((id): id is string => !!id), [songs]);

  /** A leader's state from either path (Realtime or Bluetooth); the newest wins. */
  const receive = useCallback(
    (state: StageLiveState) => {
      if (state.from === clientId) return;
      // Clock moves on even for states we don't show (Lamport).
      if (!isNewer(state, lastRef.current)) return;
      lastRef.current = state;
      remoteRef.current = state;
      setLeaderSeen(true);
      // The order and the struck songs are the setlist's: they apply even when not following.
      if (state.order) setOrder(state.order);
      setSkipped(state.skipped ?? []);
      if (followingRef.current) setSongId(state.songId);
    },
    [clientId, setSkipped],
  );

  // Offline on stage: the same states over Bluetooth (native apps only).
  const ble = useStageBle({ eventId, savedIds, open: live, isLeader, onState: receive });
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
      const seq = nextSeq(lastRef.current?.seq);
      const state: StageLiveState = { seq, from: clientId, ...next, skipped: skippedRef.current };
      lastRef.current = state;
      ledRef.current = true;
      void channelRef.current?.send({ type: 'broadcast', event: 'state', payload: state });
      blePublish(state);
    },
    [clientId, blePublish],
  );

  const applyRemote = useCallback((state: StageLiveState) => {
    if (state.order) setOrder(state.order);
    if (state.songId !== undefined) setSongId(state.songId);
  }, []);

  /**
   * Measure the click leader's clock: a few pings, the fastest round trip wins.
   * A round with no answer (the leader's clock channel not in yet, or its
   * answers used up by a band starting together) is tried again, later each
   * time and at a random moment, for as long as that leader's click runs.
   */
  const syncWith = useCallback(
    (peer: string) => {
      const book = samplesRef.current;
      if (book.peer === peer && nowMs() - book.at < RESYNC_MS && book.samples.length) return;
      const fresh = { peer, at: nowMs(), samples: [] as ClockSample[], sent: [] as number[] };
      samplesRef.current = fresh;
      pingTimers.current.forEach(clearTimeout);
      pingTimers.current = [];
      const round = (attempt: number, delay: number) => {
        const timers = Array.from({ length: PINGS }, (_, i) =>
          setTimeout(() => {
            if (samplesRef.current !== fresh) return;
            const t0 = nowMs();
            // Only pongs to these pings count (anyone can write the clock topic in our name).
            fresh.sent.push(t0);
            // Pings older than any answer worth waiting for are of no use any more.
            fresh.sent = fresh.sent.filter((t) => t0 - t <= PING_FORGET_MS);
            const payload = { from: clientId, to: peer, t0 };
            if (clockJoined.current) void clockRef.current?.send({ type: 'broadcast', event: PING_EVENT, payload });
            // Admins may write the stage topic too: a leader on an older app listens only there.
            if (isLeader) void channelRef.current?.send({ type: 'broadcast', event: PING_EVENT, payload });
          }, delay + i * PING_GAP_MS),
        );
        // No answer to the whole round: again, while that leader's click runs.
        const check = setTimeout(
          () => {
            const running = clickRef.current;
            if (samplesRef.current !== fresh || fresh.samples.length || !running?.on || running.from !== peer) return;
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

  // The channel lives while Stage mode is open.
  useEffect(() => {
    if (!live || !eventId) return;
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
     * A bandmate measuring our clock: answer straight away with our time, on
     * the stage topic (admins only), so nobody else can pose as the leader's clock.
     */
    const answerPing = (raw: unknown, fromAdmin: boolean) => {
      const p = raw as { from?: unknown; to?: unknown; t0?: unknown } | undefined;
      if (!p || p.to !== clientId || typeof p.from !== 'string' || typeof p.t0 !== 'number') return;
      const now = nowMs();
      const ping = `${p.from}|${p.t0}`;
      if (seen.has(ping)) return;
      if (seen.size > 4 * ALL_PONGS_PER_WINDOW) for (const [k, t] of seen) if (now - t >= PONG_WINDOW_MS) seen.delete(k);
      allAnswered = allAnswered.filter((t) => now - t < PONG_WINDOW_MS);
      // The overall cap is for the clock topic, which any member may write; the
      // stage topic is admins only (their pings still count per name).
      if (!fromAdmin && allAnswered.length >= ALL_PONGS_PER_WINDOW) return;
      // Names nobody answered lately are forgotten (at most ALL_PONGS_PER_WINDOW stay).
      if (answered.size > ALL_PONGS_PER_WINDOW)
        for (const [name, times] of answered) if (!times.some((t) => now - t < PONG_WINDOW_MS)) answered.delete(name);
      const recent = (answered.get(p.from) ?? []).filter((t) => now - t < PONG_WINDOW_MS);
      if (recent.length >= PONGS_PER_WINDOW) return;
      recent.push(now);
      answered.set(p.from, recent);
      seen.set(ping, now);
      if (!fromAdmin) allAnswered.push(now);
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
        if (book.peer === running.from && book.samples.length) return;
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
      // An admin's ping (an older app pings here; admins may broadcast on this topic).
      .on('broadcast', { event: PING_EVENT }, (msg: { payload?: unknown }) => answerPing(msg?.payload, true))
      .on('broadcast', { event: PONG_EVENT }, (msg: { payload?: unknown }) => takePong(msg?.payload))
      .on('broadcast', { event: CLOCK_PONG_EVENT }, (msg: { payload?: unknown }) => takePong(msg?.payload))
      .on('presence', { event: 'join' }, (msg: { key?: string; newPresences?: Array<{ lead?: unknown }> }) => {
        if (msg?.key === clientId) return;
        // A leader (re)joined, maybe after reopening Stage mode with a new
        // clock: take its next state whatever seq it carries.
        if (!isLeader && msg?.newPresences?.some((p) => p?.lead === true)) lastRef.current = null;
        // The click's leader (re)joined while this phone has no measure of its clock (its
        // clock channel late, say): ping now, not at the next, backed-off, retry.
        const clickNow = clickRef.current;
        if (clickNow?.on && clickNow.from !== clientId && clickNow.from === msg?.key) {
          const book = samplesRef.current;
          if (!(book.peer === clickNow.from && book.samples.length)) {
            samplesRef.current = { peer: '', at: 0, samples: [], sent: [] };
            syncWith(clickNow.from);
          }
        }
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
        if (status === 'SUBSCRIBED') {
          void channel.track({ lead: isLeader }).catch(() => {});
        }
      });
    return () => {
      // Our running click stops on everyone's phone too.
      const running = clickRef.current;
      if (isLeader && running?.from === clientId && running.on) {
        const off: ClickState = { ...running, on: false, seq: nextSeq(running.seq) };
        clickRef.current = off;
        void channel.send({ type: 'broadcast', event: CLICK_EVENT, payload: off });
      }
      channelRef.current = null;
      clockRef.current = null;
      clockJoined.current = false;
      setConnected(false);
      void supabase.removeChannel(channel);
      void supabase.removeChannel(clock);
    };
  }, [live, eventId, clientId, isLeader, receive, receiveClick, syncWith]);

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
    remoteRef.current = null;
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
