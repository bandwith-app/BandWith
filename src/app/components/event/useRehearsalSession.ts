import { useCallback, useEffect, useRef, useState } from 'react';
import {
  endSession,
  fromRow,
  markPlayed,
  pauseSession,
  pickSession,
  resumeSession,
  sessionStatus,
  startSession,
  toRow,
  type PlayedSong,
  type SessionRow,
  type SessionState,
} from '@/lib/rehearsalSession';
import { fetchRehearsalSession, saveRehearsalSession } from '@/lib/services/rehearsalSessions';
import type { StageSessionBridge } from './useStageLive';

interface Options {
  /** Rehearsal sessions apply (a band rehearsal, flag on). */
  enabled: boolean;
  bandId?: string | null;
  eventId?: string | null;
  /** The occurrence's day, "YYYY-MM-DD". */
  date?: string | null;
  /** Live mode is open. */
  open: boolean;
  /** Band admin: runs the session (start, pause, end). */
  isLeader: boolean;
  /** The song on screen in Live mode (songs.id + title), for "songs played". */
  currentSong?: PlayedSong | null;
  /** Songs in the rehearsal's setlist. */
  total: number;
  /** The live channel is connected (a reconnect fetches the session again). */
  connected: boolean;
  /** Sends a session to everyone on the live channel (useStageLive().sendSession). */
  send?: (payload: unknown) => void;
  /** Shared with useStageLive({ session }): sessions arriving on the channel come here. */
  bridge: { current: StageSessionBridge };
}

/** What travels on the live channel: the whole row, for one occurrence. */
export interface SessionMessage {
  v: 1;
  eventId: string;
  date: string;
  row: SessionRow | null;
}

const storeKey = (eventId: string, date: string) => `bw-rehearsal-session:${eventId}|${date}`;
const readLocal = (key: string): { state: SessionState; dirty: boolean } | null => {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    const state = v ? fromRow(v.row) : null;
    return state ? { state, dirty: !!v.dirty } : null;
  } catch {
    return null;
  }
};
const writeLocal = (key: string, row: SessionRow | null, dirty: boolean) => {
  try {
    if (row) localStorage.setItem(key, JSON.stringify({ row, dirty }));
    else localStorage.removeItem(key);
  } catch {
    /* storage blocked: memory only */
  }
};

/** Wait after a song change before saving (Next tapped a few times, one save). */
const SONG_SAVE_DELAY_MS = 1500;
/** Try an unsaved session again this often while it is unsaved. */
const RETRY_MS = 20_000;

/**
 * A rehearsal's session in Live mode (plan A1b, migration 131): the leader
 * starts, pauses and ends it; members see the same clock (the live channel,
 * and the saved row when they open Live mode or reconnect). Offline, the
 * leader's changes are kept on the device and saved when back online.
 * The saved session also feeds the rehearsal's summary line in its detail.
 */
export function useRehearsalSession({ enabled, bandId, eventId, date, open, isLeader, currentSong, total, connected, send, bridge }: Options) {
  const key = enabled && bandId && eventId && date ? storeKey(eventId, date) : null;
  const [state, setStateRaw] = useState<SessionState | null>(null);
  const [ready, setReady] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  /** The session ended while Live mode was open here: show the summary. */
  const [justEnded, setJustEnded] = useState(false);
  const stateRef = useRef<SessionState | null>(null);
  /** Bumped on every change by the leader: a save clears "unsaved" only if nothing changed meanwhile. */
  const versionRef = useRef(0);
  const ctxRef = useRef({ bandId, eventId, date, total, send, isLeader, key });
  ctxRef.current = { bandId, eventId, date, total, send, isLeader, key };
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  const markUnsaved = useCallback((v: boolean) => {
    unsavedRef.current = v;
    setUnsaved(v);
  }, []);

  const setState = useCallback((next: SessionState | null) => {
    const prev = stateRef.current;
    stateRef.current = next;
    setStateRaw(next);
    if (sessionStatus(next) !== 'ended') setJustEnded(false);
    else if (prev && sessionStatus(prev) !== 'ended') setJustEnded(true);
  }, []);

  const rowOf = useCallback((s: SessionState | null): SessionRow | null => {
    const c = ctxRef.current;
    if (!s || !c.bandId || !c.eventId || !c.date) return null;
    return toRow(s, { bandId: c.bandId, eventId: c.eventId, date: c.date }, c.total, Date.now());
  }, []);

  const message = useCallback(
    (s: SessionState | null): SessionMessage | null => {
      const c = ctxRef.current;
      return c.eventId && c.date ? { v: 1, eventId: c.eventId, date: c.date, row: rowOf(s) } : null;
    },
    [rowOf],
  );

  /** Save the newest state now (leader). The device copy stays "unsaved" until it is. */
  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    const c = ctxRef.current;
    const row = rowOf(stateRef.current);
    if (!c.isLeader || !c.key || !row) return;
    const version = versionRef.current;
    const { error } = await saveRehearsalSession(row);
    if (error) {
      markUnsaved(true);
      return;
    }
    if (versionRef.current === version && ctxRef.current.key === c.key) {
      writeLocal(c.key, row, false);
      markUnsaved(false);
    }
  }, [rowOf, markUnsaved]);

  /** The leader changed the session: show it, keep it on the device, send it, save it. */
  const commit = useCallback(
    (next: SessionState, delay = 0) => {
      const c = ctxRef.current;
      if (!c.isLeader || !c.key) return;
      versionRef.current += 1;
      setState(next);
      writeLocal(c.key, rowOf(next), true);
      markUnsaved(true);
      const msg = message(next);
      if (msg) c.send?.(msg);
      clearTimeout(saveTimer.current);
      if (delay > 0) saveTimer.current = setTimeout(() => void flush(), delay);
      else void flush();
    },
    [setState, rowOf, message, flush, markUnsaved],
  );

  /** The device copy at once (leader), then the saved row. */
  const load = useCallback(async () => {
    const c = ctxRef.current;
    if (!c.key || !c.eventId || !c.date) return;
    const local = c.isLeader ? readLocal(c.key) : null;
    if (local && !stateRef.current) setState(local.state);
    const saved = await fetchRehearsalSession(c.eventId, c.date);
    if (ctxRef.current.key !== c.key) return;
    setReady(true);
    if (saved === undefined) return; // offline: keep what we have
    // A change made here meanwhile is newer than what was just read.
    const mine = c.isLeader && stateRef.current && unsavedRef.current ? { state: stateRef.current, dirty: true } : local;
    const picked = pickSession(mine, saved?.state ?? null);
    setState(picked);
    if (mine?.dirty) void flush();
    else if (c.isLeader) writeLocal(c.key, rowOf(picked), false);
  }, [setState, flush, rowOf]);

  // A different rehearsal (or the flag): start over.
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    stateRef.current = null;
    setStateRaw(null);
    setReady(false);
    markUnsaved(false);
    setJustEnded(false);
    if (key) void load();
  }, [key, load]);

  // Opening Live mode fetches it again (the leader may have moved on), and so does a reconnect.
  useEffect(() => {
    if (!key) return;
    if (open) void load();
    else setJustEnded(false);
  }, [key, open, load]);
  const wasConnected = useRef(false);
  const lost = useRef(false);
  useEffect(() => {
    if (!open) {
      wasConnected.current = false;
      lost.current = false;
      return;
    }
    if (!connected && wasConnected.current) lost.current = true;
    if (connected && lost.current) {
      lost.current = false;
      void load();
    }
    wasConnected.current = connected;
  }, [open, connected, load]);

  // Unsaved (offline): try again when the network is back, and every so often.
  useEffect(() => {
    if (!unsaved || !isLeader) return;
    const retry = () => void flush();
    window.addEventListener('online', retry);
    const id = window.setInterval(retry, RETRY_MS);
    return () => {
      window.removeEventListener('online', retry);
      window.clearInterval(id);
    };
  }, [unsaved, isLeader, flush]);

  // Leaving with a song change waiting for its save: save it now.
  useEffect(
    () => () => {
      if (saveTimer.current) void flush();
    },
    [flush],
  );

  // Songs played: the leader's current song while the session runs.
  const songId = currentSong?.id;
  const songTitle = currentSong?.title;
  useEffect(() => {
    const s = stateRef.current;
    if (!isLeader || !open || !s || !songId) return;
    const next = markPlayed(s, { id: songId, title: songTitle ?? '' });
    if (next !== s) commit(next, SONG_SAVE_DELAY_MS);
  }, [isLeader, open, songId, songTitle, state, commit]);

  // The live channel: members take the leader's session; the leader answers late arrivals.
  bridge.current.receive = (payload: unknown) => {
    const c = ctxRef.current;
    const msg = payload as Partial<SessionMessage> | null;
    if (c.isLeader || !c.key || !msg || msg.v !== 1 || msg.eventId !== c.eventId || msg.date !== c.date) return;
    setState(msg.row ? fromRow(msg.row) : null);
  };
  bridge.current.latest = () => (ctxRef.current.isLeader && stateRef.current ? message(stateRef.current) : null);

  const start = useCallback(() => {
    const s = stateRef.current;
    commit(s ? resumeSession(s, Date.now()) : startSession(Date.now()));
  }, [commit]);
  const pause = useCallback(() => {
    if (stateRef.current) commit(pauseSession(stateRef.current, Date.now()));
  }, [commit]);
  const resume = useCallback(() => {
    if (stateRef.current) commit(resumeSession(stateRef.current, Date.now()));
  }, [commit]);
  const end = useCallback(() => {
    if (stateRef.current) commit(endSession(stateRef.current, Date.now()));
  }, [commit]);
  const dismissSummary = useCallback(() => setJustEnded(false), []);

  return {
    /** Sessions apply to this event. */
    enabled: !!key,
    /** The saved session has been read once (or failed: offline). */
    ready,
    state,
    status: sessionStatus(state),
    /** The leader's last change isn't saved yet (offline). */
    unsaved,
    /** Ended while Live mode was open here: the summary is up. */
    justEnded,
    dismissSummary,
    /** This user runs the session (band admin). */
    canControl: isLeader && !!key,
    start,
    pause,
    resume,
    end,
  };
}

export type RehearsalSessionControls = ReturnType<typeof useRehearsalSession>;
