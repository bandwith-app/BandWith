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
  /**
   * The latest time any copy played it (ms), when later than `at` (#296
   * round 7): a merge keeps the earliest `at` and this, so a copy that
   * played it after the other copy's End or Pause still counts as running
   * when merged again.
   */
  last?: number;
  /**
   * Where a song an older build saved with no time goes (#296 round 8):
   * right after the song before it in that copy (that song's time + 1 ms),
   * kept so that every merge puts it in the same place. Only without `at`.
   */
  after?: number;
}

/** A pause that is over: [from, to] in ms. */
export type PauseSpan = [number, number];

/** One thing done on a copy, and when (ms): s Start, p Pause, r Resume, e End (#296 round 8). */
export type SessionEvent = ['s' | 'p' | 'r' | 'e', number];

/**
 * Paused time an older build reported with no times (#296 round 8): its
 * paused_ms, when that was known (the row's updated_at, or when its message
 * came in; null: not known) and its status then (r running, p paused, e ended).
 */
export type UntimedPause = [number, number | null, 'r' | 'p' | 'e'];

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
   * was resumed too). pausedMs is their total, plus any paused time an older
   * build reported without times (missing: an older build's copy).
   */
  pauses?: PauseSpan[];
  /**
   * Everything done on every copy merged into this one (#296 round 8). The
   * fields above are worked out from it (and from `played`, `untimed`) the
   * same way on every device, so two copies merge by union, in any order and
   * as often as they like, always to the same session. Missing: a copy from
   * an older build (or made by hand): rebuilt from the fields.
   */
  log?: SessionEvent[];
  /** Paused time older builds reported without times (#296 round 8). */
  untimed?: UntimedPause[];
  /**
   * When the paused time of a copy without a log (an older build's) was
   * known: when it was saved or came in. Read when that copy is merged; not
   * saved.
   */
  untimedUntil?: number;
}

export type SessionStatus = 'idle' | 'live' | 'paused' | 'ended';

export const sessionStatus = (s: SessionState | null | undefined): SessionStatus =>
  !s ? 'idle' : s.endedAt !== null ? 'ended' : s.pausedAt !== null ? 'paused' : 'live';

/** The newest time in a log (a device whose clock went back never writes before it). */
const lastAt = (log: SessionEvent[]): number => log.reduce((m, e) => Math.max(m, e[1]), -Infinity);

/**
 * One more thing done on this copy, always after the last one: a clock
 * behind the copy's newest event (another admin's clock ahead) writes just
 * after it, never at the same time, where the fixed order of kinds would put
 * a Resume before that End and undo it (#296 round 8, Claude r8 M1).
 */
const act = (s: SessionState, kind: SessionEvent[0], now: number): SessionState => {
  const ev = evidence(s);
  const last = lastAt(ev.log);
  return derive([...ev.log, [kind, now > last ? now : last + 1]], ev.untimed, s.played);
};

export const startSession = (now: number): SessionState => derive([['s', now]], [], []);

export const pauseSession = (s: SessionState, now: number): SessionState =>
  sessionStatus(s) === 'live' ? act(s, 'p', now) : s;

/** Back to running: after a pause, or after the end (the gap counts as a pause). */
export const resumeSession = (s: SessionState, now: number): SessionState => {
  const status = sessionStatus(s);
  return status === 'paused' || status === 'ended' ? act(s, 'r', now) : s;
};

/** Ended; a pause still open lasted until the end. */
export const endSession = (s: SessionState, now: number): SessionState =>
  sessionStatus(s) === 'ended' ? s : act(s, 'e', now);

/** Seconds rehearsed so far, pauses left out. */
export const elapsedSeconds = (s: SessionState, now: number): number => {
  const until = s.endedAt ?? s.pausedAt ?? now;
  return Math.max(0, Math.floor((until - s.startedAt - s.pausedMs) / 1000));
};

/** The current song counts as played (once) while the session runs; `now`: when (for merging copies by time). */
export const markPlayed = (s: SessionState, song: PlayedSong, now?: number): SessionState => {
  if (sessionStatus(s) !== 'live' || !song.id || s.played.some((p) => p.id === song.id)) return s;
  const at = now === undefined ? undefined : Math.max(now, lastAt(evidence(s).log));
  return { ...s, played: [...s.played, { id: song.id, title: song.title, ...(at === undefined ? {} : { at }) }] };
};

/**
 * `saved` with the songs `other` played that it doesn't have, without their
 * times (#296 round 8, Claude B1b): a device that started over a rehearsal
 * that had already ended adds its songs to its log, and they can never
 * reopen it (a timed song after an End would).
 */
export const withSongsOf = (saved: SessionState, other: SessionState): SessionState => {
  const extra = other.played.filter((p) => p.id && !saved.played.some((q) => q.id === p.id)).map((p) => ({ id: p.id, title: p.title }));
  return extra.length ? { ...saved, played: [...saved.played, ...extra] } : saved;
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
   * version: migration 196 tells this build's writes from older builds' by it.
   */
  pauses?: PauseSpan[];
  /** SessionState.log (#296 round 8); 196 keeps it when an older build saves over it. */
  log?: SessionEvent[];
  /** SessionState.untimed, when there is any. */
  untimed?: UntimedPause[];
}

const playedOut = (p: PlayedSong): PlayedSong => ({
  id: p.id,
  title: p.title,
  ...(p.at === undefined ? {} : { at: p.at }),
  ...(p.last === undefined ? {} : { last: p.last }),
  ...(p.at === undefined && p.after !== undefined ? { after: p.after } : {}),
});

export const buildSummary = (s: SessionState, total: number, now: number): SessionSummary => {
  const ev = evidence(s);
  return {
    v: 1,
    durationS: elapsedSeconds(s, now),
    played: s.played.map(playedOut),
    total: Math.max(0, Math.floor(total)),
    pauses: unionSpans(s.pauses ?? []),
    log: canonLog(ev.log),
    ...(ev.untimed.length ? { untimed: canonUntimed(ev.untimed) } : {}),
  };
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const parsePlayed = (v: unknown): PlayedSong[] =>
  Array.isArray(v)
    ? v.filter((p): p is PlayedSong => isObj(p) && typeof p.id === 'string' && !!p.id && typeof p.title === 'string')
        .map((p) => ({
          id: p.id,
          title: p.title,
          ...(isTime(p.at) ? { at: p.at } : {}),
          ...(isTime(p.last) && (!isTime(p.at) || p.last > p.at) ? { last: p.last } : {}),
          ...(!isTime(p.at) && isTime(p.after) ? { after: p.after } : {}),
        }))
    : [];

const parsePauses = (v: unknown): PauseSpan[] =>
  Array.isArray(v)
    ? v.filter((p): p is PauseSpan => Array.isArray(p) && p.length === 2 && isTime(p[0]) && isTime(p[1]) && p[0] <= p[1]).map(([a, b]) => [a, b])
    : [];

const KINDS = ['s', 'p', 'r', 'e'] as const;
const parseLog = (v: unknown): SessionEvent[] | undefined =>
  Array.isArray(v)
    ? v
        .filter((e): e is SessionEvent => Array.isArray(e) && e.length === 2 && (KINDS as readonly unknown[]).includes(e[0]) && isTime(e[1]))
        .map(([k, t]) => [k, t] as SessionEvent)
    : undefined;

const parseUntimed = (v: unknown): UntimedPause[] =>
  Array.isArray(v)
    ? v
        .filter(
          (u): u is UntimedPause =>
            Array.isArray(u) && u.length === 3 && isCount(u[0]) && (u[1] === null || isTime(u[1])) && (u[2] === 'r' || u[2] === 'p' || u[2] === 'e'),
        )
        .map(([a, b, c]) => [a, b, c] as UntimedPause)
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

/**
 * A saved row (or a message's row). `at`: when it was known (a message: when
 * it came in); otherwise its updated_at. A row an older build wrote (no log,
 * or columns the log doesn't give: written over this build's row, 196 keeps
 * the log) is read as what that build did (#296 round 8).
 */
export const fromRow = (row: unknown, at?: number): SessionState | null => {
  if (!isObj(row)) return null;
  const startedAt = ms(row.started_at);
  const pausedMs = row.paused_ms === undefined || row.paused_ms === null ? 0 : Number(row.paused_ms);
  if (startedAt === null || !isCount(pausedMs)) return null;
  const summary = isObj(row.summary) ? row.summary : {};
  const known = at ?? ms(row.updated_at);
  const s: SessionState = {
    startedAt,
    pausedMs,
    pausedAt: ms(row.paused_at),
    endedAt: ms(row.ended_at),
    played: parsePlayed(summary.played),
    // No pause times at all: written by an older build (kept undefined, so a merge knows, #296 round 5).
    pauses: Array.isArray(summary.pauses) ? parsePauses(summary.pauses) : undefined,
  };
  const log = parseLog(summary.log);
  if (log?.length) {
    s.log = log;
    s.untimed = parseUntimed(summary.untimed);
  }
  if (known !== null) s.untimedUntil = known;
  const ev = evidence(s);
  return derive(ev.log, ev.untimed, s.played);
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
/** Spans cut at `until` (the part after it dropped). */
const clipSpans = (spans: PauseSpan[], until: number): PauseSpan[] =>
  spans.filter(([a]) => a < until).map(([a, b]) => [a, Math.min(b, until)] as PauseSpan);
/** The latest time a song was played on any copy merged into this one. */
const playedLast = (p: PlayedSong): number => Math.max(p.at ?? -Infinity, p.last ?? -Infinity);

// --------------------------------------------------------------- merge --

/**
 * How two copies of one occurrence's session merge (#296 round 8, after
 * rounds 2–7 patched one case at a time): everything either copy did is kept
 * as a set (the log of Starts, Pauses, Resumes and Ends; the songs with
 * their first and latest play; older builds' paused time without times),
 * merged by union, and the session is worked out from that set alone, in
 * time order. So a merge gives the same session whichever copy is whose, in
 * any order, and merging again changes nothing. In time order:
 *
 * - Start: the first one starts it; a later one (a copy started unread on
 *   another device) after a Pause or an End goes on running, the time in
 *   between a pause.
 * - Resume: after a Pause or an End, running again, the time in between a pause.
 * - A song played: running then. After a Pause it closes it there; after an
 *   End the copy that played it never heard the End, so it ran on (no pause).
 * - Pause: paused, if running (a stale Pause never undoes an End).
 * - End: ended (a pause still open lasted until it); a later End moves it.
 * - An older build's copy, running, known at a time (its message, its saved
 *   row), with more paused time than when it paused: its Resume. Of a Pause:
 *   it resumed at the pause + what it added (by that time at the latest). Of
 *   an End: only when what it added matches the time since the End (it saved
 *   its Resume right then, within 2 minutes), as migration 196 checks it: an
 *   offline older copy with more paused time of its own never undoes an End.
 * - Paused time without times (older builds) counts once, the part the timed
 *   pauses it could know of (up to when it was known) don't hold already.
 */
export interface MergeTimes {
  savedAt?: number;
  cutoff?: number;
}

/** What an older build's paused time needs to match the time since an End (ms). */
const RESUME_MATCH_MS = 2 * 60_000;
const ORDER: Record<string, number> = { s: 0, r: 1, g: 2, o: 3, p: 4, e: 5 };

const canonLog = (log: SessionEvent[]): SessionEvent[] => {
  const seen = new Set<string>();
  const out: SessionEvent[] = [];
  for (const [k, t] of log) {
    const id = `${k}${t}`;
    if (!seen.has(id)) {
      seen.add(id);
      out.push([k, t]);
    }
  }
  return out.sort((x, y) => x[1] - y[1] || ORDER[x[0]] - ORDER[y[0]]);
};

/** One per (when, status), the largest paused time. */
const canonUntimed = (list: UntimedPause[]): UntimedPause[] => {
  const by = new Map<string, UntimedPause>();
  for (const [u, k, st] of list) {
    const id = `${k}|${st}`;
    const had = by.get(id);
    if (!had || u > had[0]) by.set(id, [u, k, st]);
  }
  const key = (k: number | null) => (k === null ? Infinity : k);
  return [...by.values()].sort((x, y) => key(x[1]) - key(y[1]) || x[2].localeCompare(y[2]) || x[0] - y[0]);
};

/** The part of older builds' paused time the timed pauses don't hold (it could know of those up to when it was known). */
const untimedExtra = (spans: PauseSpan[], untimed: UntimedPause[], until = Infinity): number =>
  untimed.reduce(
    (m, [u, k]) => ((k ?? Infinity) <= until ? Math.max(m, u - spanMs(clipSpans(spans, k ?? Infinity))) : m),
    0,
  );

/** The session worked out from a copy's (or a merge's) evidence. */
const derive = (log0: SessionEvent[], untimed0: UntimedPause[], played: PlayedSong[]): SessionState => {
  const log = canonLog(log0);
  const untimed = canonUntimed(untimed0);
  type Ev = { t: number; k: string; u?: number };
  const evs: Ev[] = log.map(([k, t]) => ({ t, k }));
  for (const p of played) {
    for (const t of new Set([p.at, p.last])) if (isTime(t)) evs.push({ t, k: 'g' });
  }
  for (const [u, k, st] of untimed) if (st === 'r' && k !== null) evs.push({ t: k, k: 'o', u });
  evs.sort((x, y) => x.t - y.t || ORDER[x.k] - ORDER[y.k] || (x.u ?? 0) - (y.u ?? 0));

  let status: 'idle' | SessionStatus = 'idle';
  let since = 0;
  let startedAt = log.find((e) => e[0] === 's')?.[1] ?? log[0]?.[1] ?? 0;
  const spans: PauseSpan[] = [];
  const close = (to: number) => spans.push([since, Math.max(since, to)]);
  /** An older build's running copy known at `t` with paused time `u`: its Resume, the pause length; or null. */
  const oldResume = (t: number, u: number): number | null => {
    const total = spanMs(spans) + untimedExtra(spans, untimed, since);
    if (status === 'paused') {
      // Its own Pause (its message or row, right after it): what it had then; otherwise ours then.
      const own = untimed.filter(([, k, st]) => st === 'p' && k !== null && k >= since && k <= since + RESUME_MATCH_MS);
      const base = own.length ? Math.max(...own.map((x) => x[0])) : total;
      const d = u - base;
      return d > 0 ? Math.min(d, t - since) : null;
    }
    let best: number | null = null;
    for (const c of [total, ...untimed.filter(([, k]) => k !== null && k < t).map((x) => x[0])]) {
      const d = u - c;
      if (d <= 0 || Math.abs(since + d - t) > RESUME_MATCH_MS) continue;
      if (best === null || Math.abs(since + d - t) < Math.abs(since + best - t)) best = d;
    }
    return best === null ? null : Math.min(best, t - since);
  };
  for (const { t, k, u } of evs) {
    if (k === 's' || k === 'r') {
      if (status === 'idle') {
        status = 'live';
        startedAt = t;
      } else if (status === 'paused' || status === 'ended') {
        close(t);
        status = 'live';
      }
    } else if (k === 'g') {
      if (status === 'paused') close(t);
      if (status === 'paused' || status === 'ended') status = 'live';
    } else if (k === 'p') {
      if (status === 'live') {
        status = 'paused';
        since = t;
      }
    } else if (k === 'e') {
      if (status === 'live') since = t;
      else if (status === 'paused') {
        close(t);
        since = Math.max(since, t);
      } else if (status === 'ended') since = Math.max(since, t);
      if (status !== 'idle') status = 'ended';
    } else if (k === 'o' && (status === 'paused' || status === 'ended') && t > since) {
      const d = oldResume(t, u!);
      if (d !== null) {
        close(since + d);
        status = 'live';
      }
    }
  }
  return {
    startedAt,
    pausedMs: spanMs(spans) + untimedExtra(spans, untimed),
    pausedAt: status === 'paused' ? since : null,
    endedAt: status === 'ended' ? since : null,
    played,
    pauses: spans,
    log,
    untimed,
  };
};

/** A copy's fields, as evidence: what an older build's copy (no log) tells. */
const fieldEvidence = (s: SessionState, known: number | null): { log: SessionEvent[]; untimed: UntimedPause[] } => {
  const log: SessionEvent[] = [['s', s.startedAt]];
  for (const [a, b] of s.pauses ?? []) log.push(['p', a], ['r', b]);
  if (s.pausedAt !== null) log.push(['p', s.pausedAt]);
  if (s.endedAt !== null) log.push(['e', s.endedAt]);
  const st = s.endedAt !== null ? 'e' : s.pausedAt !== null ? 'p' : 'r';
  return { log, untimed: [[Math.max(0, s.pausedMs), known, st]] };
};

/** The fields a log gives are the ones the copy has. */
const sameFields = (a: SessionState, b: SessionState) =>
  a.startedAt === b.startedAt &&
  a.pausedMs === b.pausedMs &&
  a.pausedAt === b.pausedAt &&
  a.endedAt === b.endedAt &&
  a.pauses !== undefined &&
  JSON.stringify(unionSpans(a.pauses)) === JSON.stringify(unionSpans(b.pauses ?? []));

/**
 * Everything a copy tells. Its log, when its fields are what that log gives;
 * a copy without one (an older build's) by its fields; a log whose fields
 * were written over by an older build (196 keeps the log): both.
 */
const evidence = (s: SessionState): { log: SessionEvent[]; untimed: UntimedPause[] } => {
  const known = s.untimedUntil ?? null;
  if (!s.log) return fieldEvidence(s, known);
  const own = { log: s.log, untimed: s.untimed ?? [] };
  if (sameFields(s, derive(own.log, own.untimed, s.played))) return own;
  const f = fieldEvidence(s, known);
  return { log: [...own.log, ...f.log], untimed: [...own.untimed, ...f.untimed] };
};

/** Songs with no time get their place from the song before them in their own list. */
const placePlayed = (list: PlayedSong[], startedAt: number): PlayedSong[] => {
  let prev = startedAt;
  return list.map((p) => {
    if (p.at === undefined && p.after === undefined) {
      prev += 1;
      return { ...p, after: prev };
    }
    prev = p.at ?? p.after!;
    return p;
  });
};

/** Every song played on either copy: the first play, the latest, in the order played. */
const joinPlayed = (lists: PlayedSong[][]): PlayedSong[] => {
  const byId = new Map<string, PlayedSong>();
  const lo = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.min(a, b));
  for (const list of lists) {
    for (const p of list) {
      const had = byId.get(p.id);
      if (!had) {
        byId.set(p.id, playedOut({ ...p, last: Number.isFinite(playedLast(p)) && p.at !== undefined && playedLast(p) > p.at ? playedLast(p) : undefined }));
        continue;
      }
      const at = lo(had.at, p.at);
      const latest = Math.max(playedLast(had), playedLast(p));
      const title = had.title === p.title ? had.title : [had.title, p.title].filter(Boolean).sort()[0] ?? '';
      byId.set(
        p.id,
        playedOut({
          id: p.id,
          title,
          at,
          last: at !== undefined && Number.isFinite(latest) && latest > at ? latest : undefined,
          after: lo(had.after, p.after),
        }),
      );
    }
  }
  const key = (p: PlayedSong) => p.at ?? p.after ?? Infinity;
  return [...byId.values()].sort((x, y) => key(x) - key(y) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
};

/**
 * Two copies of one occurrence's session: this device's, and the saved one
 * that moved on meanwhile (another admin, a Start or End whose answer was
 * lost, a copy started unread elsewhere). Nothing is lost; the rule is above.
 * `times` (an older build's copy only, without a log): when the saved copy
 * was known (savedAt: its updated_at; cutoff: when a message came in).
 */
export const mergeSessions = (mine: SessionState, saved: SessionState, times?: number | MergeTimes): SessionState => {
  const known = typeof times === 'number' ? times : times?.cutoff ?? times?.savedAt;
  const theirs = known !== undefined && saved.untimedUntil === undefined ? { ...saved, untimedUntil: known } : saved;
  const a = evidence(mine);
  const b = evidence(theirs);
  const played = joinPlayed([placePlayed(mine.played, mine.startedAt), placePlayed(saved.played, saved.startedAt)]);
  return derive([...a.log, ...b.log], [...a.untimed, ...b.untimed], played);
};

/** The same evidence: nothing in one that the other lacks. */
export const sameEvidence = (a: SessionState, b: SessionState): boolean => {
  const x = evidence(a);
  const y = evidence(b);
  return (
    JSON.stringify(canonLog(x.log)) === JSON.stringify(canonLog(y.log)) &&
    JSON.stringify(canonUntimed(x.untimed)) === JSON.stringify(canonUntimed(y.untimed))
  );
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
    a.played.every(
      (p, i) =>
        p.id === b.played[i].id &&
        p.at === b.played[i].at &&
        playedLast(p) === playedLast(b.played[i]) &&
        (p.at !== undefined || p.after === b.played[i].after),
    ) &&
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
