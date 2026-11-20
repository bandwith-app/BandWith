import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nextSeq, stepOver } from '@/lib/stageLive';
import {
  parseRegiaState,
  REGIA_RESEND_MS,
  regiaReadiness,
  rowsWithInserted,
  takesOver,
  type RegiaReadiness,
  type RegiaState,
} from '@/lib/stageRegia';
import {
  cachedAudio,
  createRegiaPlayer,
  downloadAudio,
  playableUrl,
  type RegiaPlayer,
  type RegiaPlayerSnapshot,
} from '@/lib/regiaAudio';
import { stopPlayer } from '@/lib/audioPlayer';
import { currentAudioOutput, onAudioOutputChange, outputWarning, setPlaybackSession, type AudioOutput } from '@/lib/audioOutput';
import { addSongToSetlist, saveSetlistOrder } from '@/lib/services/songs';
import { SETLIST_ORDER_SAVED, type StageRegiaBridge } from './useStageLive';

/** A setlist song as the Regia needs it (setlist_songs row id, song id, its audio file). */
export interface RegiaSong {
  id?: string;
  songId?: string;
  setNumber?: number;
  title: string;
  /** songs.audio_url: a stored-file ref or an https link. */
  audio?: string;
}

/** A song from the repertoire, played off tonight's setlist. */
export interface RegiaExtraSong {
  id: string;
  title: string;
  audio?: string | null;
}

/** This device was the Regia for this gig (comes back as Regia after a restart, never playing). */
const onKey = (eventId: string) => `bw-regia:${eventId}`;
const readOn = (eventId?: string) => {
  if (!eventId) return false;
  try {
    return localStorage.getItem(onKey(eventId)) === '1';
  } catch {
    return false;
  }
};
const writeOn = (eventId: string | undefined, on: boolean) => {
  if (!eventId) return;
  try {
    if (on) localStorage.setItem(onKey(eventId), '1');
    else localStorage.removeItem(onKey(eventId));
  } catch {
    /* storage blocked: tonight only */
  }
};

const nowMs = () => Date.now();

interface Options {
  eventId?: string;
  setlistId?: string;
  /** Stage mode is open. */
  open: boolean;
  /** Band admins only can be the Regia. */
  isAdmin: boolean;
  /** First name shown to the others when this device takes the Regia. */
  myName?: string | null;
  /** useStageLive: this app's id, and the channel. */
  clientId: string;
  send: (payload: unknown) => void;
  bridge: { current: StageRegiaBridge };
  /** The setlist in its live order. */
  songs: RegiaSong[];
  currentId: string | null;
  skipped?: ReadonlySet<string>;
  /** useStageLive: make song `i` current (everyone follows). */
  select: (i: number) => void;
  /** useStageLive: make a new row current with this live order. */
  jumpTo: (id: string, order: string[]) => void;
  /** Tests: a fake player. */
  createPlayer?: () => RegiaPlayer;
}

const IDLE: RegiaPlayerSnapshot = { status: 'idle', positionMs: 0, durationMs: null };

/**
 * Stage manager mode ("Regia"): one admin device per gig plays the songs'
 * audio out to the mixer; Play on any song makes it everyone's current song.
 *
 * - On the Regia: the audio of tonight's songs is downloaded first (no
 *   network on stage), one player plays it, and a RegiaState goes to the
 *   band on play, pause, stop and every few seconds while playing.
 * - On every other device: no player is ever created; the newest Regia
 *   state shows as "Now playing · 1:12 / 3:58".
 * - A second admin turning it on takes it over (asked first in the UI);
 *   the first device stops its audio.
 */
export function useStageRegia({
  eventId,
  setlistId,
  open,
  isAdmin,
  myName,
  clientId,
  send,
  bridge,
  songs,
  currentId,
  skipped,
  select,
  jumpTo,
  createPlayer = createRegiaPlayer,
}: Options) {
  const available = open && isAdmin && !!eventId;
  const [on, setOn] = useState(false);
  const [lostTo, setLostTo] = useState<string | null>(null);
  /** Someone else's Regia (what plays on the band's stage now). */
  const [remote, setRemote] = useState<{ state: RegiaState; receivedAt: number } | null>(null);
  const remoteRef = useRef(remote);
  remoteRef.current = remote;
  /** Our own newest state (sent and resent). */
  const mineRef = useRef<RegiaState | null>(null);
  const seenSeq = useRef(0);

  const playerRef = useRef<RegiaPlayer | null>(null);
  const [snap, setSnap] = useState<RegiaPlayerSnapshot>(IDLE);
  /** Row id of the song in the player. */
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const loadedRef = useRef<{ id: string; title: string } | null>(null);
  const [error, setError] = useState<'load' | 'insert' | null>(null);

  const [cached, setCached] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState<{ done: number; total: number } | null>(null);

  const ctx = useRef({ songs, currentId, setlistId, myName, select, jumpTo, send, clientId, skipped });
  ctx.current = { songs, currentId, setlistId, myName, select, jumpTo, send, clientId, skipped };

  // ── Sending ──────────────────────────────────────────────────────────
  const publish = useCallback((next: Partial<RegiaState> & { on: boolean }) => {
    const { send: sendNow, clientId: from, myName: name } = ctx.current;
    const p = playerRef.current?.snapshot() ?? IDLE;
    const loaded = loadedRef.current;
    const seq = nextSeq(Math.max(seenSeq.current, mineRef.current?.seq ?? 0));
    seenSeq.current = seq;
    const state: RegiaState = {
      seq,
      from,
      name: name?.trim() || null,
      songId: loaded?.id ?? null,
      title: loaded?.title ?? null,
      playing: p.status === 'playing',
      positionMs: p.positionMs,
      durationMs: p.durationMs,
      ...next,
    };
    mineRef.current = state;
    sendNow(state);
  }, []);

  const disposePlayer = useCallback(() => {
    playerRef.current?.dispose();
    playerRef.current = null;
    loadedRef.current = null;
    setLoadedId(null);
    setSnap(IDLE);
  }, []);

  // ── Receiving ────────────────────────────────────────────────────────
  useEffect(() => {
    bridge.current = {
      receive: (payload) => {
        const state = parseRegiaState(payload);
        if (!state || state.from === ctx.current.clientId) return;
        seenSeq.current = Math.max(seenSeq.current, state.seq);
        if (takesOver(state, mineRef.current)) {
          // Another admin took the Regia: our audio stops, theirs leads.
          mineRef.current = null;
          disposePlayer();
          setOn(false);
          writeOn(eventId, false);
          setLostTo(state.name ?? '');
        }
        const cur = remoteRef.current?.state;
        if (cur && cur.from === state.from && state.seq < cur.seq) return;
        if (!state.on) {
          if (!cur || cur.from === state.from) setRemote(null);
          return;
        }
        setRemote({ state, receivedAt: nowMs() });
      },
      latest: () => {
        const mine = mineRef.current;
        if (!mine?.on) return null;
        // Late arrival: where the song is right now.
        const p = playerRef.current?.snapshot();
        return p ? { ...mine, playing: p.status === 'playing', positionMs: p.positionMs, durationMs: p.durationMs } : mine;
      },
      left: (key) => {
        if (remoteRef.current?.state.from === key) setRemote(null);
      },
    };
  }, [bridge, disposePlayer, eventId]);

  // ── Turning it on and off ────────────────────────────────────────────
  const refs = useMemo(() => songs.map((s) => s.audio).filter((a): a is string => !!a), [songs]);
  const refsKey = refs.join('|');

  const preparing = useRef(false);
  const again = useRef<(() => Promise<void>) | null>(null);
  const prepare = useCallback(async (): Promise<void> => {
    // One pass at a time; songs added meanwhile get their own pass after it.
    if (preparing.current) {
      again.current = prepare;
      return;
    }
    preparing.current = true;
    try {
      const have = await cachedAudio(refs);
      setCached(have);
      const todo = [...new Set(refs)].filter((r) => !have.has(r));
      if (!todo.length) return;
      setDownloading({ done: 0, total: todo.length });
      let done = 0;
      for (const ref of todo) {
        if (await downloadAudio(ref)) {
          have.add(ref);
          setCached(new Set(have));
        }
        done += 1;
        setDownloading({ done, total: todo.length });
      }
      setDownloading(null);
    } finally {
      preparing.current = false;
      const next = again.current;
      again.current = null;
      if (next) void next();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsKey]);

  const turnOn = useCallback(() => {
    if (!available) return;
    stopPlayer();
    if (!playerRef.current) {
      const player = createPlayer();
      playerRef.current = player;
      player.subscribe(() => setSnap(player.snapshot()));
    }
    setOn(true);
    setLostTo(null);
    writeOn(eventId, true);
    publish({ on: true });
    // The audio download starts from the effect below (on + tonight's songs).
  }, [available, createPlayer, eventId, publish]);

  const turnOff = useCallback(() => {
    if (mineRef.current?.on) publish({ on: false, playing: false });
    mineRef.current = null;
    disposePlayer();
    setOn(false);
    writeOn(eventId, false);
  }, [publish, disposePlayer, eventId]);

  // Back as Regia after a restart mid-gig (never playing).
  useEffect(() => {
    if (available && !on && readOn(eventId)) turnOn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, eventId]);

  // Stage mode closed (or not an admin any more): the audio stops, the band is told.
  useEffect(() => {
    if (available || !on) return;
    if (mineRef.current?.on) publish({ on: false, playing: false });
    mineRef.current = null;
    disposePlayer();
    setOn(false);
  }, [available, on, publish, disposePlayer]);
  useEffect(() => () => playerRef.current?.dispose(), []);

  // Where the sound goes (most tablets have no jack: USB-C to the mixer).
  // A cable pulled out moves it to the speaker: the bar shows it at once.
  const [output, setOutput] = useState<AudioOutput | null>(null);
  useEffect(() => {
    if (!on) {
      setOutput(null);
      return;
    }
    let live = true;
    void setPlaybackSession(true).then(() => currentAudioOutput()).then((o) => live && setOutput(o));
    const off = onAudioOutputChange((o) => live && setOutput(o));
    return () => {
      live = false;
      off();
      void setPlaybackSession(false);
    };
  }, [on]);

  // New songs in tonight's setlist while on: fetch their audio too.
  useEffect(() => {
    if (on) void prepare();
  }, [on, prepare]);

  // While playing: tell the band where the song is every few seconds.
  const playing = snap.status === 'playing';
  useEffect(() => {
    if (!on || !playing) return;
    const id = window.setInterval(() => publish({ on: true }), REGIA_RESEND_MS);
    return () => window.clearInterval(id);
  }, [on, playing, publish]);

  // Play / pause / end reach the band at once.
  const lastStatus = useRef(snap.status);
  useEffect(() => {
    const prev = lastStatus.current;
    lastStatus.current = snap.status;
    if (!on || prev === snap.status) return;
    if (['playing', 'paused', 'ended', 'ready'].includes(snap.status)) publish({ on: true });
  }, [on, snap.status, publish]);

  // ── Playing ──────────────────────────────────────────────────────────
  const start = useCallback(
    async (song: { id: string; title: string; audio?: string | null }) => {
      const player = playerRef.current;
      if (!player) return false;
      setError(null);
      if (loadedRef.current?.id !== song.id || ['idle', 'error'].includes(player.snapshot().status)) {
        if (!song.audio) {
          // No audio: the band still moves to it; nothing plays.
          loadedRef.current = { id: song.id, title: song.title };
          setLoadedId(song.id);
          await player.stop(0);
          publish({ on: true, playing: false, positionMs: 0, durationMs: null });
          return false;
        }
        const src = await playableUrl(song.audio);
        if (!src || !(await player.load(src.url))) {
          setError('load');
          return false;
        }
        loadedRef.current = { id: song.id, title: song.title };
        setLoadedId(song.id);
      }
      return player.play();
    },
    [publish],
  );

  /** Play song `i` of the live order: it becomes everyone's current song, and its audio plays here. */
  const play = useCallback(
    async (i: number) => {
      const song = ctx.current.songs[i];
      if (!on || !song?.id) return;
      ctx.current.select(i);
      await start({ id: song.id, title: song.title, audio: song.audio });
    },
    [on, start],
  );

  /** Play / pause the song in the player (or play the current song when none is loaded). */
  const toggle = useCallback(async () => {
    const player = playerRef.current;
    if (!on || !player) return;
    const s = player.snapshot().status;
    if (s === 'playing') {
      player.pause();
      return;
    }
    const { songs: list, currentId: cur } = ctx.current;
    // A song is loaded but the band moved on: play the current song instead.
    if (loadedRef.current && loadedRef.current.id === cur && s !== 'idle' && s !== 'error') {
      await player.play();
      return;
    }
    const i = Math.max(0, list.findIndex((x) => x.id === cur));
    await play(i);
  }, [on, play]);

  const stop = useCallback(async () => {
    await playerRef.current?.stop();
  }, []);

  /** The song after the one loaded (or the current one), struck-off songs skipped. */
  const nextIndex = useMemo(() => {
    const at = songs.findIndex((s) => s.id === (loadedId ?? currentId));
    if (at < 0) return null;
    const n = stepOver(songs, at, 1, skipped ?? new Set());
    return n === at ? null : n;
  }, [songs, loadedId, currentId, skipped]);

  /**
   * Play a song from the repertoire that isn't in tonight's setlist: it is
   * added to the gig's setlist right after the current song (saved, so it
   * also shows in the gig afterwards), everyone jumps to it, and it plays.
   */
  const playExtra = useCallback(
    async (song: RegiaExtraSong) => {
      const { setlistId: list, songs: ordered, currentId: cur, jumpTo: jump } = ctx.current;
      if (!on || !list) return false;
      setError(null);
      const saved = ordered.filter((s) => s.id && s.songId).map((s) => ({ id: s.id!, songId: s.songId!, setNumber: s.setNumber }));
      const at = saved.findIndex((s) => s.id === cur);
      const { data, error: addError } = await addSongToSetlist(list, song.id, saved.length + 1, saved[at]?.setNumber ?? 1);
      if (addError || !data?.id) {
        setError('insert');
        return false;
      }
      const order = saved.map((s) => s.id);
      const rows = rowsWithInserted(list, saved, order, cur, { id: data.id, songId: song.id });
      const liveOrder = rows ? rows.map((r) => r.id) : [...order, data.id];
      jump(data.id, liveOrder);
      if (rows) void saveSetlistOrder(rows);
      try {
        window.dispatchEvent(new CustomEvent(SETLIST_ORDER_SAVED, { detail: { setlistId: list } }));
      } catch {
        /* no window */
      }
      return start({ id: data.id, title: song.title, audio: song.audio });
    },
    [on, start],
  );

  const readiness: RegiaReadiness = useMemo(() => regiaReadiness(songs, cached), [songs, cached]);
  const otherRegia = remote && remote.state.on ? remote : null;

  return {
    /** This device can be the Regia (an admin in Stage mode of a band gig). */
    available,
    on,
    turnOn,
    turnOff,
    /** Name of the admin whose device is the Regia now (when it isn't this one). */
    heldBy: on ? null : otherRegia ? otherRegia.state.name ?? '' : null,
    /** The Regia passed to this admin (shown once on this device). */
    lostTo,
    dismissLost: () => setLostTo(null),
    readiness,
    downloading,
    cached,
    error,
    /** Where this device's sound comes out (native apps; null in a browser). */
    output,
    /** The output isn't fit for a gig: the device's speaker, or Bluetooth. */
    outputWarning: outputWarning(output),
    /** The player on this device. */
    status: snap.status,
    positionMs: snap.positionMs,
    durationMs: snap.durationMs,
    loadedId,
    nextIndex,
    play,
    toggle,
    stop,
    playExtra,
    /** What the Regia (another device) is playing, for the musicians' "Now playing". */
    nowPlaying: !on && otherRegia && otherRegia.state.songId ? otherRegia : null,
  };
}

export type StageRegia = ReturnType<typeof useStageRegia>;
