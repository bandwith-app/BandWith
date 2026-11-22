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
  // No pause times at all: written by an older build (kept undefined, so a merge knows, #296 round 5).
  const pauses = isObj(row.summary) && Array.isArray(row.summary.pauses) ? parsePauses(row.summary.pauses) : undefined;
  return {
    startedAt,
    pausedMs: Math.max(pausedMs, spanMs(unionSpans(pauses ?? []))),
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
 *   a copy still running is closed by the other's End only if it was last
 *   written before that End (`savedAt`: the saved copy's updated_at; this
 *   device's copy: its newest action), so it couldn't know; written after
 *   it, it is a real Resume and stays running. The time between the earlier
 *   copy's End and the later copy's Start is a pause.
 * - Songs: every song played on either, by when it was played (a song an
 *   older version saved, with no time, right after the timed one before it).
 */
/**
 * `savedAt`: when the saved copy was written (its updated_at). `cutoff`: the
 * latest moment the other copy can know of (savedAt, or when a message
 * came in): pauses after it are none of its paused time.
 */
export interface MergeTimes {
  savedAt?: number;
  cutoff?: number;
}

export const mergeSessions = (mine: SessionState, saved: SessionState, times?: number | MergeTimes): SessionState => {
  const { savedAt, cutoff = savedAt } = typeof times === 'number' ? { savedAt: times, cutoff: times } : times ?? {};
  const same = mine.startedAt === saved.startedAt;
  const both = [mine, saved];
  const other = (s: SessionState) => (s === mine ? saved : mine);
  const spans: PauseSpan[] = [...(mine.pauses ?? []), ...(saved.pauses ?? [])];
  if (!same) {
    const [early, late] = mine.startedAt < saved.startedAt ? [mine, saved] : [saved, mine];
    if (early.endedAt !== null && early.endedAt < late.startedAt) spans.push([early.endedAt, late.startedAt]);
  }
  const touched = (s: SessionState) => Math.max(lastRun(s), s.pausedAt ?? -Infinity);
  const ends = both.map((s) => s.endedAt).filter((e): e is number => e !== null);
  const lastEnd = ends.length ? Math.max(...ends) : null;
  // Same start: no Resume or song after the End; a copy with paused time it holds no times
  // for (an older build's Resume leaves no span) counts as written when it was saved (#296
  // round 5). A different start: the running copy was last written before the End (it can't
  // know about it, #296 round 4); written after it, it is a real Resume and stays running.
  const untimed = (s: SessionState) => s.pauses === undefined || untimedPauseMs(s) > 0;
  const writtenUntil = (s: SessionState) => (s === saved && savedAt !== undefined ? savedAt : touched(s));
  const runUntil = (s: SessionState) => (s === saved && savedAt !== undefined && untimed(s) ? Math.max(lastRun(s), savedAt) : lastRun(s));
  const ended =
    lastEnd !== null &&
    both.every((s) => s.endedAt !== null || (same ? runUntil(s) : writtenUntil(s)) <= lastEnd);
  // A pause still open on one copy is closed by the other copy's Resume or End after it
  // (#296 round 4). Still open on the copy that did the newest thing: the session is paused
  // since the earliest pause still open on either (two offline pauses at 19:10 and 19:12: 19:10).
  const newest = ended ? null : both.filter((s) => s.endedAt === null).sort((x, y) => touched(y) - touched(x))[0];
  const stillOpen: number[] = [];
  let newestPaused = false;
  for (const s of both) {
    if (s.endedAt !== null || s.pausedAt === null) continue;
    const o = other(s);
    const P = s.pausedAt;
    const closers = [...(o.pauses ?? []).map((p) => p[1]), ...(o.endedAt !== null ? [o.endedAt] : [])].filter((t) => t > P);
    if (closers.length) spans.push([P, Math.min(...closers)]);
    else {
      stillOpen.push(P);
      if (s === newest) newestPaused = true;
    }
  }
  let pausedAt: number | null = newestPaused ? Math.min(...stillOpen) : null;
  const pauses = unionSpans(spans);
  if (pausedAt !== null && pauses.length) pausedAt = Math.max(pausedAt, pauses[pauses.length - 1][1]);
  // Paused time (#296 round 5, Claude): a copy with no pause times holds every pause it knew
  // of in pausedMs; the part not covered by the spans it could have known (up to its cutoff)
  // is added once (the largest), never summed across copies.
  const untimedOf = (s: SessionState, until: number) =>
    (s.pauses ?? []).length ? untimedPauseMs(s) : Math.max(0, s.pausedMs - spanMs(clipSpans(pauses, until)));
  const pausedMs = spanMs(pauses) + Math.max(0, untimedOf(mine, Infinity), untimedOf(saved, cutoff ?? Infinity));
  return {
    startedAt: Math.min(mine.startedAt, saved.startedAt),
    pausedMs,
    pausedAt,
    endedAt: ended ? lastEnd : null,
    played: mergePlayed(saved.played, mine.played),
    pauses,
  };
};

/** Spans cut at `until` (the part after it dropped). */
const clipSpans = (spans: PauseSpan[], until: number): PauseSpan[] =>
  spans.filter(([a]) => a < until).map(([a, b]) => [a, Math.min(b, until)] as PauseSpan);

/**
 * A message from an older build (no revision, no pause times) that resumed:
 * running, with more paused time than ours while ours is paused or ended.
 * That is a real Resume (#296 round 5): its state is taken, our pause times
 * and songs are kept, and our open pause (or the time since our End) is
 * closed at its start + the paused time it added (by the time it came in at
 * the latest). Null: not one (a stale copy can't undo an End).
 */
export const oldBuildResume = (mine: SessionState, theirs: SessionState, receivedAt: number): SessionState | null => {
  if (mine.startedAt !== theirs.startedAt || theirs.pausedAt !== null || theirs.endedAt !== null) return null;
  const delta = theirs.pausedMs - mine.pausedMs;
  const from = mine.pausedAt ?? mine.endedAt;
  if (delta <= 0 || from === null) return null;
  const pauses = unionSpans([...(mine.pauses ?? []), ...(theirs.pauses ?? []), [from, Math.max(from, Math.min(from + delta, receivedAt))]]);
  return {
    startedAt: mine.startedAt,
    pausedMs: Math.max(theirs.pausedMs, spanMs(pauses)),
    pausedAt: null,
    endedAt: null,
    played: mergePlayed(mine.played, theirs.played),
    pauses,
  };
};

/**
 * Every song played on either copy, by when it was played. A song saved by
 * an older build (no time) keeps its place in its list: right after the
 * timed song before it (#296 round 4, Claude).
 */
const mergePlayed = (first: PlayedSong[], second: PlayedSong[]): PlayedSong[] => {
  const byId = new Map<string, { song: PlayedSong; key: number; order: number }>();
  let order = 0;
  for (const list of [first, second]) {
    let prev = -Infinity;
    for (const p of list) {
      const key = p.at ?? prev;
      prev = key;
      const had = byId.get(p.id);
      if (!had) byId.set(p.id, { song: { ...p }, key, order: order++ });
      else if (p.at !== undefined && (had.song.at === undefined || p.at < had.song.at)) {
        had.song.at = p.at;
        had.key = p.at;
      }
    }
  }
  return [...byId.values()].sort((x, y) => x.key - y.key || x.order - y.order).map((e) => e.song);
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
