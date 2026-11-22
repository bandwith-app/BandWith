/**
 * A rehearsal's session in Live mode (plan A1b): when it started, the time
 * spent paused, when it ended and the songs played. The band admin (the live
 * leader) runs it; it is saved in `rehearsal_sessions` (migration 131), one
 * row per rehearsal occurrence (recurring rehearsals share one event id, so
 * the key is event + date), and members see the same clock.
 *
 * Pure: every function takes `now` (ms) and returns a new state, or the same
 * object when nothing changes. No check-ins (dropped, plan 3.0).
 */

export interface PlayedSong {
  /** songs.id */
  id: string;
  title: string;
}

export interface SessionState {
  startedAt: number;
  /** Time spent in pauses that are over. */
  pausedMs: number;
  /** When the current pause began (null while running). */
  pausedAt: number | null;
  endedAt: number | null;
  /** Songs that were current while the session ran, in the order played. */
  played: PlayedSong[];
}

export type SessionStatus = 'idle' | 'live' | 'paused' | 'ended';

export const sessionStatus = (s: SessionState | null | undefined): SessionStatus =>
  !s ? 'idle' : s.endedAt !== null ? 'ended' : s.pausedAt !== null ? 'paused' : 'live';

export const startSession = (now: number): SessionState => ({
  startedAt: now,
  pausedMs: 0,
  pausedAt: null,
  endedAt: null,
  played: [],
});

export const pauseSession = (s: SessionState, now: number): SessionState =>
  sessionStatus(s) === 'live' ? { ...s, pausedAt: Math.max(now, s.startedAt) } : s;

/** Back to running: after a pause, or after the end (the gap counts as a pause). */
export const resumeSession = (s: SessionState, now: number): SessionState => {
  const status = sessionStatus(s);
  if (status === 'paused') return { ...s, pausedAt: null, pausedMs: s.pausedMs + Math.max(0, now - s.pausedAt!) };
  if (status === 'ended') return { ...s, endedAt: null, pausedMs: s.pausedMs + Math.max(0, now - s.endedAt!) };
  return s;
};

export const endSession = (s: SessionState, now: number): SessionState => {
  const status = sessionStatus(s);
  if (status === 'ended') return s;
  const end = Math.max(now, s.startedAt);
  return {
    ...s,
    endedAt: end,
    pausedAt: null,
    pausedMs: status === 'paused' ? s.pausedMs + Math.max(0, end - s.pausedAt!) : s.pausedMs,
  };
};

/** Seconds rehearsed so far, pauses left out. */
export const elapsedSeconds = (s: SessionState, now: number): number => {
  const until = s.endedAt ?? s.pausedAt ?? now;
  return Math.max(0, Math.floor((until - s.startedAt - s.pausedMs) / 1000));
};

/** The current song counts as played (once) while the session runs. */
export const markPlayed = (s: SessionState, song: PlayedSong): SessionState => {
  if (sessionStatus(s) !== 'live' || !song.id || s.played.some((p) => p.id === song.id)) return s;
  return { ...s, played: [...s.played, { id: song.id, title: song.title }] };
};

/** "47:23", or "1:05:09" past an hour. */
export const formatClock = (sec: number): string => {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
};

/** Hours and minutes (rounded to the minute) for "1 h 52 min". */
export const spanParts = (sec: number): { h: number; m: number } => {
  const total = Math.round(Math.max(0, sec) / 60);
  return { h: Math.floor(total / 60), m: total % 60 };
};

/** The rehearsal occurrence's day ("YYYY-MM-DD"), the session key with the event id. */
export const occurrenceDate = (date: string | null | undefined): string | null => {
  const m = (date || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

// ------------------------------------------------------------- summary --

export interface SessionSummary {
  v: 1;
  /** Rehearsed time, pauses left out. */
  durationS: number;
  played: PlayedSong[];
  /** Songs in the rehearsal's setlist. */
  total: number;
}

export const buildSummary = (s: SessionState, total: number, now: number): SessionSummary => ({
  v: 1,
  durationS: elapsedSeconds(s, now),
  played: s.played.map((p) => ({ id: p.id, title: p.title })),
  total: Math.max(0, Math.floor(total)),
});

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

const parsePlayed = (v: unknown): PlayedSong[] =>
  Array.isArray(v)
    ? v.filter((p): p is PlayedSong => isObj(p) && typeof p.id === 'string' && !!p.id && typeof p.title === 'string')
        .map((p) => ({ id: p.id, title: p.title }))
    : [];

export const parseSummary = (v: unknown): SessionSummary | null => {
  if (!isObj(v) || v.v !== 1 || !isCount(v.durationS) || !isCount(v.total)) return null;
  return { v: 1, durationS: Math.floor(v.durationS), played: parsePlayed(v.played), total: Math.floor(v.total) };
};

// ----------------------------------------------------------------- row --

export interface SessionRow {
  band_id: string;
  event_id: string;
  occurrence_date: string;
  started_at: string;
  paused_ms: number;
  paused_at: string | null;
  ended_at: string | null;
  summary: SessionSummary;
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const ms = (v: unknown): number | null => {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

export const toRow = (
  s: SessionState,
  ctx: { bandId: string; eventId: string; date: string },
  total: number,
  now: number,
): SessionRow => ({
  band_id: ctx.bandId,
  event_id: ctx.eventId,
  occurrence_date: ctx.date,
  started_at: iso(s.startedAt)!,
  paused_ms: Math.round(s.pausedMs),
  paused_at: iso(s.pausedAt),
  ended_at: iso(s.endedAt),
  // Kept up to date while running: what was played survives a restart.
  summary: buildSummary(s, total, now),
});

export const fromRow = (row: unknown): SessionState | null => {
  if (!isObj(row)) return null;
  const startedAt = ms(row.started_at);
  const pausedMs = row.paused_ms === undefined || row.paused_ms === null ? 0 : Number(row.paused_ms);
  if (startedAt === null || !isCount(pausedMs)) return null;
  return {
    startedAt,
    pausedMs,
    pausedAt: ms(row.paused_at),
    endedAt: ms(row.ended_at),
    played: isObj(row.summary) ? parsePlayed(row.summary.played) : [],
  };
};

/**
 * Two copies of one occurrence's session: this device's, and the saved one
 * that moved on meanwhile (another admin, a Start whose answer was lost, an
 * edit kept by an older version). Nothing is lost (#296): every song played
 * on either is kept (the saved order first). The same start (our own row):
 * an end on either stays (the later one), and this device's pause counts
 * while it still runs. A different start (started here unread): the saved
 * session's times stay as they are (196 skips another start), only the
 * songs are added.
 */
export const mergeSessions = (mine: SessionState, saved: SessionState): SessionState => {
  const same = mine.startedAt === saved.startedAt;
  const played = [...saved.played, ...mine.played.filter((p) => !saved.played.some((q) => q.id === p.id))];
  if (!same) return { ...saved, played };
  const ends = [mine.endedAt, saved.endedAt].filter((e): e is number => e !== null);
  const endedAt = ends.length ? Math.max(saved.startedAt, ...ends) : null;
  const pausedMs = Math.max(mine.pausedMs, saved.pausedMs);
  let pausedAt: number | null = null;
  if (endedAt === null) {
    if (saved.pausedMs > mine.pausedMs) pausedAt = saved.pausedAt;
    else if (mine.pausedMs > saved.pausedMs) pausedAt = mine.pausedAt;
    else pausedAt = mine.pausedAt ?? saved.pausedAt;
  }
  return { startedAt: saved.startedAt, pausedMs, pausedAt, endedAt, played };
};

/** The same session, field by field. */
export const sameSession = (a: SessionState | null, b: SessionState | null): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.startedAt === b.startedAt &&
    a.pausedMs === b.pausedMs &&
    a.pausedAt === b.pausedAt &&
    a.endedAt === b.endedAt &&
    a.played.length === b.played.length &&
    a.played.every((p, i) => p.id === b.played[i].id));

/**
 * Which session to show: a change on this device not saved yet (offline)
 * wins; otherwise the saved one. Saved before and now gone from the server
 * means someone deleted it.
 */
export const pickSession = (
  local: { state: SessionState; dirty: boolean } | null,
  server: SessionState | null,
): SessionState | null => (local?.dirty ? local.state : server);
