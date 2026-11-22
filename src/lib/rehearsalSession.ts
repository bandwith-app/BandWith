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
  /** When it was first played (ms). Missing in sessions saved before #296 round 3. */
  at?: number;
}

/** A pause that is over: [from, to] in ms. */
export type PauseSpan = [number, number];

export interface SessionState {
  startedAt: number;
  /** Time spent in pauses that are over. */
  pausedMs: number;
  /** When the current pause began (null while running). */
  pausedAt: number | null;
  endedAt: number | null;
  /** Songs that were current while the session ran, in the order played. */
  played: PlayedSong[];
  /**
   * The pauses that are over, with their times (the gap after an End that
   * was resumed too), so two copies merge by union (#296 round 3). pausedMs
   * is their total, plus any paused time an older version saved without
   * times (missing: none known).
   */
  pauses?: PauseSpan[];
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
  pauses: [],
});

export const pauseSession = (s: SessionState, now: number): SessionState =>
  sessionStatus(s) === 'live' ? { ...s, pausedAt: Math.max(now, s.startedAt) } : s;

/** Back to running: after a pause, or after the end (the gap counts as a pause). */
export const resumeSession = (s: SessionState, now: number): SessionState => {
  const status = sessionStatus(s);
  if (status === 'paused') return { ...closePause(s, s.pausedAt!, now), pausedAt: null };
  if (status === 'ended') return { ...closePause(s, s.endedAt!, now), endedAt: null };
  return s;
};

/** A pause from `from` that ends at `to`: added to the spans and to pausedMs. */
const closePause = (s: SessionState, from: number, to: number): SessionState => {
  const end = Math.max(from, to);
  return { ...s, pausedMs: s.pausedMs + (end - from), pauses: [...(s.pauses ?? []), [from, end]] };
};

export const endSession = (s: SessionState, now: number): SessionState => {
  const status = sessionStatus(s);
  if (status === 'ended') return s;
  const end = Math.max(now, s.startedAt);
  const closed = status === 'paused' ? closePause(s, s.pausedAt!, end) : s;
  return { ...closed, endedAt: Math.max(end, closed.pausedAt ?? end), pausedAt: null };
};

/** Seconds rehearsed so far, pauses left out. */
export const elapsedSeconds = (s: SessionState, now: number): number => {
  const until = s.endedAt ?? s.pausedAt ?? now;
  return Math.max(0, Math.floor((until - s.startedAt - s.pausedMs) / 1000));
};

/** The current song counts as played (once) while the session runs; `now`: when (for merging copies by time). */
export const markPlayed = (s: SessionState, song: PlayedSong, now?: number): SessionState => {
  if (sessionStatus(s) !== 'live' || !song.id || s.played.some((p) => p.id === song.id)) return s;
  return { ...s, played: [...s.played, { id: song.id, title: song.title, ...(now === undefined ? {} : { at: now }) }] };
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
  /**
   * The pauses that are over (SessionState.pauses). Always there from this
   * version: migration 196 lets only a write that has it move a saved start
   * earlier (a merge), never an older build's Start.
   */
  pauses?: PauseSpan[];
}

export const buildSummary = (s: SessionState, total: number, now: number): SessionSummary => ({
  v: 1,
  durationS: elapsedSeconds(s, now),
  played: s.played.map((p) => ({ id: p.id, title: p.title, ...(p.at === undefined ? {} : { at: p.at }) })),
  total: Math.max(0, Math.floor(total)),
  pauses: unionSpans(s.pauses ?? []),
});

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

const parsePlayed = (v: unknown): PlayedSong[] =>
  Array.isArray(v)
    ? v.filter((p): p is PlayedSong => isObj(p) && typeof p.id === 'string' && !!p.id && typeof p.title === 'string')
        .map((p) => ({ id: p.id, title: p.title, ...(isTime(p.at) ? { at: p.at } : {}) }))
    : [];

const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const parsePauses = (v: unknown): PauseSpan[] =>
  Array.isArray(v)
    ? v.filter((p): p is PauseSpan => Array.isArray(p) && p.length === 2 && isTime(p[0]) && isTime(p[1]) && p[0] <= p[1]).map(([a, b]) => [a, b])
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
  const pauses = isObj(row.summary) ? parsePauses(row.summary.pauses) : [];
  return {
    startedAt,
    pausedMs: Math.max(pausedMs, spanMs(unionSpans(pauses))),
    pausedAt: ms(row.paused_at),
    endedAt: ms(row.ended_at),
    played: isObj(row.summary) ? parsePlayed(row.summary.played) : [],
    pauses,
  };
};

/** Pause spans merged where they overlap, in time order. */
export const unionSpans = (spans: PauseSpan[]): PauseSpan[] => {
  const out: PauseSpan[] = [];
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
};
const spanMs = (spans: PauseSpan[]) => spans.reduce((n, [a, b]) => n + (b - a), 0);
/** Paused time an older version saved without times (it can't be placed, so it is kept as it is). */
const untimedPauseMs = (s: SessionState) => Math.max(0, s.pausedMs - spanMs(unionSpans(s.pauses ?? [])));
/** The newest thing that keeps this copy running: its start, a Resume, a song played (a pause doesn't undo an End). */
const lastRun = (s: SessionState): number =>
  Math.max(s.startedAt, ...(s.pauses ?? []).map((p) => p[1]), ...s.played.map((p) => p.at ?? -Infinity));

/**
 * Two copies of one occurrence's session: this device's, and the saved one
 * that moved on meanwhile (another admin, a Start or End whose answer was
 * lost, a copy started unread elsewhere). Nothing is lost (#296 round 3):
 *
 * - Pauses: the union of both copies' pauses (two separate pauses both count).
 * - End: ended only if the newest action on either copy is an End (no Resume
 *   or song after it); a Resume later than the other copy's End wins and the
 *   gap counts as a pause, so the duration loses no minutes. A pause still
 *   open from before the End lasted until it.
 * - A different start (started unread on two devices): the earlier start;
 *   ended only if both copies are (a session running here is never closed by
 *   the saved one's End); the time between the earlier copy's End and the
 *   later copy's Start is a pause.
 * - Songs: every song played on either, by when it was played (songs saved
 *   by older versions, with no time, first, in their order).
 */
export const mergeSessions = (mine: SessionState, saved: SessionState): SessionState => {
  const same = mine.startedAt === saved.startedAt;
  const both = [mine, saved];
  const spans: PauseSpan[] = [...(mine.pauses ?? []), ...(saved.pauses ?? [])];
  if (!same) {
    const [early, late] = mine.startedAt < saved.startedAt ? [mine, saved] : [saved, mine];
    if (early.endedAt !== null && early.endedAt < late.startedAt) spans.push([early.endedAt, late.startedAt]);
  }
  const ends = both.map((s) => s.endedAt).filter((e): e is number => e !== null);
  const lastEnd = ends.length ? Math.max(...ends) : null;
  const ended =
    lastEnd !== null && (same ? both.every((s) => s.endedAt !== null || lastRun(s) <= lastEnd) : ends.length === 2);
  let pausedAt: number | null = null;
  if (ended) {
    // A pause still open on a copy that didn't see the End: it lasted until the End.
    for (const s of both) if (s.endedAt === null && s.pausedAt !== null && s.pausedAt < lastEnd!) spans.push([s.pausedAt, lastEnd!]);
  } else {
    // The copy that is still running and did the newest thing says whether it is paused now.
    const touched = (s: SessionState) => Math.max(lastRun(s), s.pausedAt ?? -Infinity);
    const newest = both.filter((s) => s.endedAt === null).sort((x, y) => touched(y) - touched(x))[0];
    pausedAt = newest?.pausedAt ?? null;
  }
  const pauses = unionSpans(spans);
  if (pausedAt !== null && pauses.length) pausedAt = Math.max(pausedAt, pauses[pauses.length - 1][1]);
  const byId = new Map<string, PlayedSong>();
  for (const p of [...saved.played, ...mine.played]) {
    const had = byId.get(p.id);
    if (!had) byId.set(p.id, { ...p });
    else if (p.at !== undefined && (had.at === undefined || p.at < had.at)) had.at = p.at;
  }
  // Stable: songs with no time keep their order, first.
  const played = [...byId.values()].sort((x, y) => (x.at ?? -Infinity) - (y.at ?? -Infinity) || 0);
  return {
    startedAt: Math.min(mine.startedAt, saved.startedAt),
    pausedMs: spanMs(pauses) + Math.max(untimedPauseMs(mine), untimedPauseMs(saved)),
    pausedAt,
    endedAt: ended ? lastEnd : null,
    played,
    pauses,
  };
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
    a.played.every((p, i) => p.id === b.played[i].id && p.at === b.played[i].at) &&
    JSON.stringify(unionSpans(a.pauses ?? [])) === JSON.stringify(unionSpans(b.pauses ?? [])));

/**
 * Which session to show: a change on this device not saved yet (offline)
 * wins; otherwise the saved one. Saved before and now gone from the server
 * means someone deleted it.
 */
export const pickSession = (
  local: { state: SessionState; dirty: boolean } | null,
  server: SessionState | null,
): SessionState | null => (local?.dirty ? local.state : server);
