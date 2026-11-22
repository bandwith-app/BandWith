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
  stageTopic,
  stepOver,
  type StageLiveState,
} from '@/lib/stageLive';
import {
  bestSample,
  CLICK_EVENT,
  clockSample,
  nowMs,
  parseClickState,
  clickWire,
  pickClock,
  PING_EVENT,
  PONG_EVENT,
  START_LEAD_MS,
  type ClickState,
  type ClockSample,
  type PeerClock,
} from '@/lib/stageClick';
import { REGIA_EVENT } from '@/lib/stageRegia';
import { parsePlayheadState, PLAYHEAD_EVENT, stopPlayhead, type PlayheadState } from '@/lib/playhead';
import type { LiveEvent, LiveEvents } from '@/lib/stageBleSync';

/** Round trips measured when a click starts; the fastest sets the offset. */
const PINGS = 6;
const PING_GAP_MS = 200;
/** Measure again after this long (clocks drift slowly). */
const RESYNC_MS = 60_000;
/**
 * No internet, and the leader's phone out of Bluetooth reach this long: its
 * click and playhead stop showing (it closed Stage, or left). A shorter
 * dropout keeps the beat going on the shared clock.
 */
export const BLE_LEADER_GONE_MS = 10_000;

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
  const samplesRef = useRef<{ peer: string; at: number; samples: ClockSample[] }>({ peer: '', at: 0, samples: [] });
  const pingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Follow the tempo (playhead.ts): the newest playhead state, ours or the leader's.
  const [playhead, setPlayheadState] = useState<PlayheadState | null>(null);
  const playheadRef = useRef<PlayheadState | null>(null);

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

  // Offline on stage: the same states over Bluetooth (native apps only).
  const ble = useStageBle({ eventId, savedIds, open: live, isLeader, onState: receive, onLive: onBleLive, farewell: bleFarewell });
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
   * Measure the leader's clock (click, playhead): a few pings, the fastest
   * round trip wins. `fresh`: measure again now, even if measured lately.
   */
  const syncWith = useCallback(
    (peer: string, fresh = false) => {
      const book = samplesRef.current;
      if (!fresh && book.peer === peer && nowMs() - book.at < RESYNC_MS && book.samples.length) return;
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
      .on('broadcast', { event: PLAYHEAD_EVENT }, (msg: { payload?: unknown }) => {
        const state = parsePlayheadState(msg?.payload);
        if (state) receivePlayhead(state);
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
      .on('presence', { event: 'join' }, (msg: { key?: string; newPresences?: Array<{ lead?: unknown }> }) => {
        if (msg?.key === clientId) return;
        const joined = msg?.key;
        if (joined && msg?.newPresences?.some((p) => p?.lead === true)) setRtLeaders((s) => (s.has(joined) ? s : new Set(s).add(joined)));
        // A leader (re)joined, maybe after reopening Stage mode with a new
        // clock: take its next state whatever seq it carries.
        if (!isLeader && msg?.newPresences?.some((p) => p?.lead === true)) lastRef.current = null;
        // A running click of ours reaches late arrivals too.
        if (clickRef.current?.from === clientId && clickRef.current.on && isLeader) {
          void channel.send({ type: 'broadcast', event: CLICK_EVENT, payload: clickWire(clickRef.current) });
        }
        // …and the playhead (Follow the tempo), so a late phone lands on the right bar.
        if (isLeader && playheadRef.current?.from === clientId && playheadRef.current.on) {
          void channel.send({ type: 'broadcast', event: PLAYHEAD_EVENT, payload: playheadRef.current });
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
        void channel.send({ type: 'broadcast', event: CLICK_EVENT, payload: clickWire(off) });
      }
      const head = playheadRef.current;
      if (isLeader && head?.from === clientId && head.on) {
        const off = stopPlayhead(head);
        playheadRef.current = off;
        void channel.send({ type: 'broadcast', event: PLAYHEAD_EVENT, payload: off });
      }
      channelRef.current = null;
      setConnected(false);
      setRtLeaders(new Set());
      void supabase.removeChannel(channel);
    };
  }, [live, eventId, clientId, isLeader, receive, receiveClick, receivePlayhead]);

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
      const { error, status } = await saveSetlistOrder(rows);
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
        // No signal at the venue, or the server busy for a moment: the new
        // order stands (on screen, over Bluetooth) and is saved as soon as
        // the server answers (plan §3.5).
        if (await keepOrderOffline(error, { setlistId: list, eventId: eventIdNow, rows, before }, status)) {
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
    playheadRef.current = null;
    setPlayheadState(null);
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
      if (isLeader) {
        send({ songId: id, order });
      } else if (followingRef.current) {
        // Stepping on your own: stop following until turned back on.
        setFollowingState(false);
      }
    },
    [ordered, isLeader, send, order, setPlayhead, clientId],
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
  // The playhead's sender is measured the same way (usually the same leader).
  const playheadPeer = playhead && playhead.from !== clientId ? playhead.from : null;
  const playheadOffset = pickClock(playheadPeer, [rtClock, ble.clock])?.offset ?? 0;

  // The leader's phone is reachable: on the channel, or linked over Bluetooth.
  const bleLinked = !isLeader && ble.status === 'connected';
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
  };
}

export type StageLive<T extends LiveSongRef = LiveSongRef> = ReturnType<typeof useStageLive<T>>;
