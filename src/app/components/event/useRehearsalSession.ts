import { useCallback, useEffect, useRef, useState } from 'react';
import {
  endSession,
  fromRow,
  markPlayed,
  mergeSessions,
  oldBuildResume,
  pauseSession,
  pickSession,
  resumeSession,
  sameSession,
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
  /**
   * The saved revision the sender's session is built on (#296 round 4).
   * Missing from older builds: their messages are treated as older and
   * merged, never taken as they are.
   */
  rev?: string | null;
}

/** Their revision is newer than ours (a save this device hasn't read). Revisions are updated_at times. */
const newerRev = (theirs: unknown, ours: Rev): boolean => {
  if (typeof theirs !== 'string') return false;
  if (ours == null) return true;
  const a = Date.parse(theirs);
  const b = Date.parse(ours);
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
};

const storeKey = (eventId: string, date: string) => `bw-rehearsal-session:${eventId}|${date}`;
/** `rev`: the saved revision the device copy is based on (undefined: never read). */
type Rev = string | null | undefined;
const readLocal = (key: string): { state: SessionState; dirty: boolean; rev: Rev } | null => {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    const state = v ? fromRow(v.row) : null;
    return state ? { state, dirty: !!v.dirty, rev: typeof v.rev === 'string' || v.rev === null ? v.rev : undefined } : null;
  } catch {
    return null;
  }
};
const writeLocal = (key: string, row: SessionRow | null, dirty: boolean, rev?: Rev) => {
  try {
    if (row) localStorage.setItem(key, JSON.stringify({ row, dirty, rev }));
    else localStorage.removeItem(key);
  } catch {
    /* storage blocked: memory only */
  }
};

/** Wait after a song change before saving (Next tapped a few times, one save). */
const SONG_SAVE_DELAY_MS = 1500;
/** Try an unsaved session again this often while it is unsaved. */
const RETRY_MS = 20_000;
/** Another admin's change arrived: read its new revision once it is saved. */
const REFRESH_AFTER_MS = 2500;
/** A first read still not back (weak signal): Start is allowed anyway, as a new row only. */
const FIRST_READ_MS = 4000;

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
  /**
   * The saved row's revision this device's session is based on (audit 06
   * #3/#4): undefined = not read yet, null = nothing saved. A save is
   * written only on top of it; otherwise the saved session wins.
   */
  const revRef = useRef<Rev>(undefined);
  const readyRef = useRef(false);
  const flushing = useRef<Promise<void> | null>(null);
  const flushAgain = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
      return c.eventId && c.date ? { v: 1, eventId: c.eventId, date: c.date, row: rowOf(s), rev: revRef.current ?? null } : null;
    },
    [rowOf],
  );

  /**
   * The saved session moved on (another admin, a session already there when
   * this device started one unread, our own Start whose answer was lost, an
   * edit kept by the previous version): read it and merge this device's
   * session into it (mergeSessions: nothing is lost, an end stays). Shown
   * here and sent to the band; saved again on top of it when it adds
   * anything. True: save again now.
   */
  const resolveConflict = useCallback(
    async (c: typeof ctxRef.current): Promise<boolean> => {
      if (!c.key || !c.eventId || !c.date) return false;
      const saved = await fetchRehearsalSession(c.eventId, c.date);
      if (ctxRef.current.key !== c.key) return false;
      if (saved === undefined) {
        // Can't read it now: still unsaved, the next try asks again.
        markUnsaved(true);
        return false;
      }
      const mine = stateRef.current;
      if (!saved) {
        // Gone from the server (deleted meanwhile): this device's goes in as a new row.
        revRef.current = null;
        return !!mine;
      }
      revRef.current = saved.rev ?? null;
      // When the saved copy was written (its revision is updated_at): an End made here wins over a copy written before it.
      const savedAt = saved.rev ? Date.parse(saved.rev) : NaN;
      const merged = mine ? mergeSessions(mine, saved.state, Number.isFinite(savedAt) ? savedAt : undefined) : saved.state;
      const adds = !sameSession(merged, saved.state);
      versionRef.current += 1;
      clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
      setState(merged);
      writeLocal(c.key, rowOf(merged), adds, revRef.current);
      markUnsaved(adds);
      const msg = message(merged);
      if (msg) c.send?.(msg);
      return adds;
    },
    [setState, rowOf, message, markUnsaved],
  );

  /** One save of the newest state, on top of the revision it is based on. 'again': merged after a conflict, save that. */
  const saveOnce = useCallback(async (): Promise<'done' | 'again'> => {
    const c = ctxRef.current;
    const row = rowOf(stateRef.current);
    if (!c.isLeader || !c.key || !row) return 'done';
    const version = versionRef.current;
    const res = await saveRehearsalSession(row, revRef.current ?? null);
    if (ctxRef.current.key !== c.key) return 'done';
    if (res.conflict) return (await resolveConflict(c)) ? 'again' : 'done';
    if (res.error) {
      markUnsaved(true);
      return 'done';
    }
    if (res.rev !== undefined) revRef.current = res.rev;
    if (versionRef.current === version) {
      writeLocal(c.key, row, false, revRef.current);
      markUnsaved(false);
    } else writeLocal(c.key, rowOf(stateRef.current), true, revRef.current);
    return 'done';
  }, [rowOf, markUnsaved, resolveConflict]);

  /** Save the newest state now (leader), one save at a time. The device copy stays "unsaved" until it is. */
  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    if (flushing.current) {
      // A save is on its way: the newest state goes right after it, on its new revision.
      flushAgain.current = true;
      return flushing.current;
    }
    const run = (async () => {
      // A few merges in a row at most (two admins saving at the same moment); then the retry timer.
      for (let merges = 0; ; ) {
        flushAgain.current = false;
        const next = await saveOnce();
        if (next === 'again' && ++merges <= 3) continue;
        if (!flushAgain.current) break;
      }
    })().finally(() => {
      flushing.current = null;
    });
    flushing.current = run;
    return run;
  }, [saveOnce]);

  /** The leader changed the session: show it, keep it on the device, send it, save it. */
  const commit = useCallback(
    (next: SessionState, delay = 0) => {
      const c = ctxRef.current;
      if (!c.isLeader || !c.key) return;
      versionRef.current += 1;
      setState(next);
      writeLocal(c.key, rowOf(next), true, revRef.current);
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
    if (local && !stateRef.current) {
      setState(local.state);
      // Changes made here (offline too) are saved on top of the revision this copy was read at.
      if (revRef.current === undefined) revRef.current = local.rev;
      // A change made here not saved yet: unsaved from now (a message from the band merges into it, #296 round 3).
      if (local.dirty) markUnsaved(true);
    }
    // A change made here while this read is on its way is newer than what it brings back (#296 round 3).
    const version = versionRef.current;
    const slow = setTimeout(() => {
      if (ctxRef.current.key !== c.key || readyRef.current) return;
      readyRef.current = true;
      setReady(true);
    }, FIRST_READ_MS);
    const saved = await fetchRehearsalSession(c.eventId, c.date);
    clearTimeout(slow);
    if (ctxRef.current.key !== c.key) return;
    readyRef.current = true;
    setReady(true);
    if (saved === undefined) return; // offline: keep what we have
    if (versionRef.current !== version) {
      // Started (or changed) here meanwhile, after the 4 s: that change's own save decides; this answer is old.
      if (unsavedRef.current) void flush();
      return;
    }
    // A change made here meanwhile is newer than what was just read.
    const inMemory = c.isLeader && !!stateRef.current && unsavedRef.current;
    const mine = inMemory ? { state: stateRef.current!, dirty: true } : local;
    const picked = pickSession(mine, saved?.state ?? null);
    setState(picked);
    if (mine?.dirty) void flush();
    else {
      revRef.current = saved?.rev ?? null;
      if (c.isLeader) writeLocal(c.key, rowOf(picked), false, revRef.current);
    }
  }, [setState, flush, rowOf, markUnsaved]);

  const loadRef = useRef(load);
  loadRef.current = load;

  // A different rehearsal (or the flag): start over.
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    clearTimeout(refreshTimer.current);
    stateRef.current = null;
    revRef.current = undefined;
    readyRef.current = false;
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
      clearTimeout(refreshTimer.current);
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
    const next = markPlayed(s, { id: songId, title: songTitle ?? '' }, Date.now());
    if (next !== s) commit(next, SONG_SAVE_DELAY_MS);
  }, [isLeader, open, songId, songTitle, state, commit]);

  // The live channel: everyone takes the running session, another admin's
  // device too (audit 06 #3: no "Start rehearsal" over one already ended);
  // the leader answers late arrivals.
  bridge.current.receive = (payload: unknown) => {
    const c = ctxRef.current;
    const msg = payload as Partial<SessionMessage> | null;
    if (!c.key || !msg || msg.v !== 1 || msg.eventId !== c.eventId || msg.date !== c.date) return;
    const next = msg.row ? fromRow(msg.row) : null;
    const mine = stateRef.current;
    const receivedAt = Date.now();
    // An older build's Resume (no revision, no pause times, more paused time): a real one,
    // taken with our pause times kept (#296 round 5).
    const resumed = !('rev' in msg) && mine && next ? oldBuildResume(mine, next, receivedAt) : null;
    /** Merged with what this message brings (it can't know of pauses after it came in). */
    const mergeIn = (): SessionState => resumed ?? mergeSessions(mine!, next!, { cutoff: receivedAt });
    /**
     * Taken as it is only when it is built on a newer save than ours, and it
     * doesn't turn a saved, ended session back to running (#296 round 4: a
     * delayed "running" message must not undo the End). Otherwise merged:
     * a stale copy adds what it has and can't reopen it (mergeSessions).
     */
    const takes = (): boolean =>
      !resumed &&
      (!mine || !next || (newerRev(msg.rev, revRef.current) && !(sessionStatus(mine) === 'ended' && sessionStatus(next) !== 'ended')));
    if (!c.isLeader) {
      if (takes()) {
        setState(next);
        if (typeof msg.rev === 'string') revRef.current = msg.rev;
      } else setState(mergeIn());
      return;
    }
    if (unsavedRef.current) {
      // A change of ours not saved yet (offline, on its way): never overwritten, the other
      // admin's change merges into it (#296 round 3) and both are saved together.
      if (!next || !mine) return;
      const merged = mergeIn();
      if (sameSession(merged, mine)) return;
      versionRef.current += 1;
      setState(merged);
      writeLocal(c.key, rowOf(merged), true, revRef.current);
      void flush();
      return;
    }
    let shown = next;
    if (takes()) {
      if (typeof msg.rev === 'string') revRef.current = msg.rev;
    } else {
      shown = mergeIn();
      if (sameSession(shown, mine)) return;
    }
    setState(shown);
    writeLocal(c.key, shown ? rowOf(shown) : null, false, revRef.current);
    // The other admin saves it a moment later: then read its revision.
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      if (!unsavedRef.current) void loadRef.current();
    }, REFRESH_AFTER_MS);
  };
  bridge.current.latest = () => (ctxRef.current.isLeader && stateRef.current ? message(stateRef.current) : null);

  const start = useCallback(() => {
    // Not before the saved session has been read (audit 06 #4): a fresh
    // device must not start over one that is already there.
    if (!readyRef.current) return;
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
