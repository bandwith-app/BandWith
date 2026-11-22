import { describe, it, expect } from 'vitest';
import {
  buildSummary,
  elapsedSeconds,
  endSession,
  formatClock,
  fromRow,
  markPlayed,
  mergeSessions,
  occurrenceDate,
  oldBuildResume,
  parseSummary,
  pauseSession,
  pickSession,
  resumeSession,
  sameSession,
  sessionStatus,
  spanParts,
  startSession,
  toRow,
  type SessionState,
} from '../rehearsalSession';

const T0 = Date.UTC(2026, 10, 18, 19, 0, 0);
const MIN = 60_000;

describe('rehearsal session: status', () => {
  it('none yet: idle', () => expect(sessionStatus(null)).toBe('idle'));
  it('started: live', () => expect(sessionStatus(startSession(T0))).toBe('live'));
  it('paused', () => expect(sessionStatus(pauseSession(startSession(T0), T0 + MIN))).toBe('paused'));
  it('ended', () => expect(sessionStatus(endSession(startSession(T0), T0 + MIN))).toBe('ended'));
});

describe('rehearsal session: the timer leaves pauses out', () => {
  it('counts from the start', () => {
    expect(elapsedSeconds(startSession(T0), T0 + 5 * MIN + 3000)).toBe(303);
  });

  it('stands still while paused', () => {
    const s = pauseSession(startSession(T0), T0 + 10 * MIN);
    expect(elapsedSeconds(s, T0 + 10 * MIN)).toBe(600);
    expect(elapsedSeconds(s, T0 + 25 * MIN)).toBe(600);
  });

  it('a resumed pause is left out', () => {
    let s = pauseSession(startSession(T0), T0 + 10 * MIN);
    s = resumeSession(s, T0 + 25 * MIN);
    expect(s.pausedMs).toBe(15 * MIN);
    expect(s.pausedAt).toBeNull();
    expect(elapsedSeconds(s, T0 + 30 * MIN)).toBe(15 * 60);
  });

  it('ending while paused closes the pause', () => {
    let s = pauseSession(startSession(T0), T0 + 10 * MIN);
    s = endSession(s, T0 + 20 * MIN);
    expect(s.pausedAt).toBeNull();
    expect(s.pausedMs).toBe(10 * MIN);
    expect(s.endedAt).toBe(T0 + 20 * MIN);
    expect(elapsedSeconds(s, T0 + 90 * MIN)).toBe(600);
  });

  it('resuming an ended session goes on, the gap counted as a pause', () => {
    let s = endSession(startSession(T0), T0 + 60 * MIN);
    s = resumeSession(s, T0 + 70 * MIN);
    expect(sessionStatus(s)).toBe('live');
    expect(s.endedAt).toBeNull();
    expect(elapsedSeconds(s, T0 + 80 * MIN)).toBe(70 * 60);
  });

  it('pause and end are no-ops when they do not apply', () => {
    const live = startSession(T0);
    expect(resumeSession(live, T0 + MIN)).toBe(live);
    const paused = pauseSession(live, T0 + MIN);
    expect(pauseSession(paused, T0 + 2 * MIN)).toBe(paused);
    const ended = endSession(live, T0 + MIN);
    expect(endSession(ended, T0 + 2 * MIN)).toBe(ended);
    expect(pauseSession(ended, T0 + 2 * MIN)).toBe(ended);
  });

  it('never negative (clock moved back)', () => {
    expect(elapsedSeconds(startSession(T0), T0 - MIN)).toBe(0);
  });
});

describe('rehearsal session: songs played', () => {
  const a = { id: 'song-a', title: 'Paper Boats' };
  const b = { id: 'song-b', title: 'Harbor Lights' };

  it('the current song counts once, in the order played', () => {
    let s = startSession(T0);
    s = markPlayed(s, a);
    s = markPlayed(s, b);
    s = markPlayed(s, a);
    expect(s.played).toEqual([a, b]);
  });

  it('not while paused or after the end', () => {
    const paused = pauseSession(startSession(T0), T0 + MIN);
    expect(markPlayed(paused, a)).toBe(paused);
    const ended = endSession(startSession(T0), T0 + MIN);
    expect(markPlayed(ended, a)).toBe(ended);
  });

  it('a song without an id is not counted', () => {
    const s = startSession(T0);
    expect(markPlayed(s, { id: '', title: 'Loose' })).toBe(s);
  });
});

describe('rehearsal session: summary', () => {
  it('duration without pauses, songs played and the setlist size', () => {
    let s = startSession(T0);
    s = markPlayed(s, { id: 'a', title: 'A' });
    s = pauseSession(s, T0 + 30 * MIN);
    s = resumeSession(s, T0 + 40 * MIN);
    s = markPlayed(s, { id: 'b', title: 'B' });
    s = endSession(s, T0 + 100 * MIN);
    expect(buildSummary(s, 5, T0 + 200 * MIN)).toEqual({
      v: 1,
      durationS: 90 * 60,
      played: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
      total: 5,
      pauses: [[T0 + 30 * MIN, T0 + 40 * MIN]],
    });
  });

  it('parses what was saved, and refuses anything else', () => {
    const ok = { v: 1, durationS: 60, played: [{ id: 'a', title: 'A' }], total: 3 };
    expect(parseSummary(ok)).toEqual(ok);
    expect(parseSummary(null)).toBeNull();
    expect(parseSummary({})).toBeNull();
    expect(parseSummary({ v: 2, durationS: 60, played: [], total: 0 })).toBeNull();
    expect(parseSummary({ v: 1, durationS: -1, played: [], total: 0 })).toBeNull();
    // Bad entries in the list are dropped, not the whole summary.
    expect(parseSummary({ v: 1, durationS: 60, played: [{ id: 'a', title: 'A' }, { id: 3 }, 'x'], total: 3 })?.played).toEqual([
      { id: 'a', title: 'A' },
    ]);
  });

  it('spanParts splits a duration in hours and minutes (rounded)', () => {
    expect(spanParts(0)).toEqual({ h: 0, m: 0 });
    expect(spanParts(45 * 60 + 29)).toEqual({ h: 0, m: 45 });
    expect(spanParts(2 * 3600 + 15 * 60 + 31)).toEqual({ h: 2, m: 16 });
    expect(spanParts(3600 - 10)).toEqual({ h: 1, m: 0 });
  });

  it('formatClock: m:ss, h:mm:ss past an hour', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(47 * 60 + 23)).toBe('47:23');
    expect(formatClock(3600 + 5 * 60 + 9)).toBe('1:05:09');
  });
});

describe('rehearsal session: one per occurrence', () => {
  it('occurrence date is the day of the (recurring) rehearsal', () => {
    expect(occurrenceDate('2026-11-19')).toBe('2026-11-19');
    expect(occurrenceDate('2026-11-19T20:00:00')).toBe('2026-11-19');
    expect(occurrenceDate('')).toBeNull();
    expect(occurrenceDate(undefined)).toBeNull();
    expect(occurrenceDate('soon')).toBeNull();
  });
});

describe('rehearsal session: saved row', () => {
  const ctx = { bandId: 'band-1', eventId: 'event-1', date: '2026-11-19' };

  it('round-trips through the row', () => {
    let s: SessionState = startSession(T0);
    s = markPlayed(s, { id: 'a', title: 'A' });
    s = pauseSession(s, T0 + 10 * MIN);
    const row = toRow(s, ctx, 4, T0 + 12 * MIN);
    expect(row).toMatchObject({
      band_id: 'band-1',
      event_id: 'event-1',
      occurrence_date: '2026-11-19',
      started_at: new Date(T0).toISOString(),
      paused_ms: 0,
      paused_at: new Date(T0 + 10 * MIN).toISOString(),
      ended_at: null,
    });
    expect(row.summary).toEqual({ v: 1, durationS: 600, played: [{ id: 'a', title: 'A' }], total: 4, pauses: [] });
    expect(fromRow(row)).toEqual(s);
  });

  it('refuses a row it cannot read', () => {
    expect(fromRow(null)).toBeNull();
    expect(fromRow({ started_at: 'nope', paused_ms: 0 })).toBeNull();
    expect(fromRow({ started_at: new Date(T0).toISOString(), paused_ms: -5 })).toBeNull();
  });

  it('a change not saved yet wins over the server; otherwise the server does', () => {
    const local = startSession(T0);
    const server = pauseSession(startSession(T0), T0 + MIN);
    expect(pickSession({ state: local, dirty: true }, server)).toBe(local);
    expect(pickSession({ state: local, dirty: false }, server)).toBe(server);
    expect(pickSession(null, server)).toBe(server);
    // Saved before and gone from the server: someone deleted it.
    expect(pickSession({ state: local, dirty: false }, null)).toBeNull();
    expect(pickSession({ state: local, dirty: true }, null)).toBe(local);
  });
});

describe('rehearsal session: two copies of one rehearsal merge, nothing is lost (#296 round 2)', () => {
  const A = { id: 's1', title: 'Paper Boats' };
  const B = { id: 's2', title: 'Superstition' };
  const C = { id: 's3', title: 'Harbor Lights' };
  const live = { ...startSession(T0), played: [A] };

  it('the same start: the later end and every song played on either', () => {
    const mine = endSession({ ...live, played: [A, B] }, T0 + 40 * MIN);
    const saved = { ...live, played: [A, C] };
    const m = mergeSessions(mine, saved);
    expect(m.startedAt).toBe(T0);
    expect(m.endedAt).toBe(T0 + 40 * MIN);
    expect(m.played.map((p) => p.id)).toEqual(['s1', 's3', 's2']);
  });

  it('an end saved elsewhere stays, a stale pause does not undo it (the pause lasted until the end)', () => {
    const saved = endSession(live, T0 + 30 * MIN);
    const mine = pauseSession(live, T0 + 20 * MIN);
    const m = mergeSessions(mine, saved);
    expect(m.endedAt).toBe(T0 + 30 * MIN);
    expect(m.pausedAt).toBeNull();
    expect(m.pauses).toEqual([[T0 + 20 * MIN, T0 + 30 * MIN]]);
    expect(elapsedSeconds(m, T0 + 90 * MIN)).toBe(20 * 60);
  });

  it('both ended: the later end', () => {
    expect(mergeSessions(endSession(live, T0 + 50 * MIN), endSession(live, T0 + 30 * MIN)).endedAt).toBe(T0 + 50 * MIN);
    expect(mergeSessions(endSession(live, T0 + 30 * MIN), endSession(live, T0 + 50 * MIN)).endedAt).toBe(T0 + 50 * MIN);
  });

  it('a different start (started unread on another device): the earlier start, its songs are added; the End wins over a copy written before it', () => {
    const mine = endSession({ ...startSession(T0 + 5 * MIN), played: [B] }, T0 + 45 * MIN);
    const m = mergeSessions(mine, live);
    expect(m.startedAt).toBe(T0);
    expect(m.played.map((p) => p.id)).toEqual(['s1', 's2']);
    // The saved copy (nothing done since its start) can't know about this End (#296 round 4).
    expect(m.endedAt).toBe(T0 + 45 * MIN);
    const savedEnd = endSession(live, T0 + 30 * MIN);
    expect(mergeSessions(mine, savedEnd).endedAt).toBe(T0 + 45 * MIN);
  });

  it('nothing new on this device: the saved one as it is', () => {
    const saved = endSession({ ...live, played: [A, B] }, T0 + 30 * MIN);
    expect(mergeSessions(live, saved)).toEqual(saved);
  });
});

describe('#296 round 3: the merge rule (pauses by union, End only when it is the newest, the earlier start)', () => {
  const A = { id: 's1', title: 'Paper Boats' };
  const B = { id: 's2', title: 'Superstition' };
  const C = { id: 's3', title: 'Harbor Lights' };

  it('Codex B1: End saved but its answer lost, then Resume here: still running, no minute lost', () => {
    const live = startSession(T0);
    const savedEnd = endSession(live, T0 + 60 * MIN);
    // This device: the same End, then Resume 10 minutes later.
    const mine = resumeSession(endSession(live, T0 + 60 * MIN), T0 + 70 * MIN);
    const m = mergeSessions(mine, savedEnd);
    expect(sessionStatus(m)).toBe('live');
    expect(m.endedAt).toBeNull();
    // 80 minutes in: 60 before the end, 10 after the resume; the gap is a pause.
    expect(elapsedSeconds(m, T0 + 80 * MIN)).toBe(70 * 60);
    expect(m).toEqual(mergeSessions(savedEnd, mine));
  });

  it('a Resume older than the other copy’s End: ended', () => {
    const live = startSession(T0);
    const mine = resumeSession(pauseSession(live, T0 + 10 * MIN), T0 + 15 * MIN);
    const m = mergeSessions(mine, endSession(live, T0 + 60 * MIN));
    expect(sessionStatus(m)).toBe('ended');
    expect(elapsedSeconds(m, T0 + 90 * MIN)).toBe(55 * 60);
  });

  it('two separate pauses, one on each copy: both count (not the longer one only)', () => {
    const live = startSession(T0);
    const mine = resumeSession(pauseSession(live, T0 + 10 * MIN), T0 + 15 * MIN);
    const saved = resumeSession(pauseSession(live, T0 + 30 * MIN), T0 + 38 * MIN);
    const m = mergeSessions(mine, saved);
    expect(m.pauses).toEqual([
      [T0 + 10 * MIN, T0 + 15 * MIN],
      [T0 + 30 * MIN, T0 + 38 * MIN],
    ]);
    expect(m.pausedMs).toBe(13 * MIN);
    // The same pause on both (one copy sent to the other): counted once.
    expect(mergeSessions(saved, saved).pausedMs).toBe(8 * MIN);
  });

  it('a different start: never closed while it runs here; the time between the saved End and this Start is a pause', () => {
    const saved = endSession(startSession(T0), T0 + 30 * MIN);
    const mine = startSession(T0 + 40 * MIN);
    const m = mergeSessions(mine, saved);
    expect(m.startedAt).toBe(T0);
    expect(sessionStatus(m)).toBe('live');
    expect(elapsedSeconds(m, T0 + 50 * MIN)).toBe(40 * 60);
  });

  it('a different start, this one earlier (started offline first): the earlier start is kept', () => {
    const m = mergeSessions(startSession(T0), startSession(T0 + 5 * MIN));
    expect(m.startedAt).toBe(T0);
  });

  it('songs in the order they were played, on whichever copy', () => {
    let mine = startSession(T0);
    mine = markPlayed(mine, A, T0 + 1 * MIN);
    mine = markPlayed(mine, C, T0 + 30 * MIN);
    let saved = startSession(T0);
    saved = markPlayed(saved, A, T0 + 1 * MIN);
    saved = markPlayed(saved, B, T0 + 12 * MIN);
    expect(mergeSessions(mine, saved).played.map((p) => p.id)).toEqual(['s1', 's2', 's3']);
    expect(mergeSessions(saved, mine).played.map((p) => p.id)).toEqual(['s1', 's2', 's3']);
  });

  it('a row an older version saved (paused time, no pause times) keeps its paused time, never added to ours', () => {
    const old = { ...startSession(T0), pausedMs: 7 * MIN, pauses: undefined };
    const mine = resumeSession(pauseSession(startSession(T0), T0 + 40 * MIN), T0 + 45 * MIN);
    expect(mergeSessions(mine, old).pausedMs).toBe(7 * MIN);
    const row = toRow(mergeSessions(mine, old), { bandId: 'b', eventId: 'e', date: '2026-11-19' }, 3, T0 + 50 * MIN);
    expect(fromRow(row)?.pausedMs).toBe(7 * MIN);
  });
});

describe('#296 round 4: mixed builds and open pauses', () => {
  const A = { id: 's1', title: 'Paper Boats' };
  const B = { id: 's2', title: 'Superstition' };
  const X = { id: 's9', title: 'Harbor Lights' };

  it('Claude blocker: a new copy (pause 10–15) and an old build’s copy (paused_ms 8, no times): 8, and still 8 merged again and again', () => {
    const fresh = resumeSession(pauseSession(startSession(T0), T0 + 10 * MIN), T0 + 15 * MIN);
    const old = { ...startSession(T0), pausedMs: 8 * MIN, pauses: [] };
    let m = mergeSessions(fresh, old);
    expect(m.pausedMs).toBe(8 * MIN);
    for (let i = 0; i < 3; i++) {
      m = mergeSessions(m, old);
      m = mergeSessions(old, m);
      // What the old build writes back: the full paused_ms, no times.
      m = mergeSessions(m, { ...m, pauses: [] });
    }
    expect(m.pausedMs).toBe(8 * MIN);
  });

  it('Codex: paused 10, resumed 20, ended 30; the other copy still has the pause open: 20 minutes, not 10', () => {
    const live = startSession(T0);
    const done = endSession(resumeSession(pauseSession(live, T0 + 10 * MIN), T0 + 20 * MIN), T0 + 30 * MIN);
    const stale = pauseSession(live, T0 + 10 * MIN);
    for (const m of [mergeSessions(done, stale), mergeSessions(stale, done)]) {
      expect(sessionStatus(m)).toBe('ended');
      expect(elapsedSeconds(m, T0 + 60 * MIN)).toBe(20 * 60);
    }
    // Still running on the other copy: the pause there is closed by this copy's resume.
    const resumed = resumeSession(pauseSession(live, T0 + 10 * MIN), T0 + 20 * MIN);
    const m = mergeSessions(stale, resumed);
    expect(sessionStatus(m)).toBe('live');
    expect(elapsedSeconds(m, T0 + 40 * MIN)).toBe(30 * 60);
  });

  it('Claude: different starts, one copy ended: it wins over the running copy saved before that End, not over one saved after it', () => {
    const ended = endSession(startSession(T0), T0 + 60 * MIN);
    const running = startSession(T0 + 5 * MIN);
    // Saved at 0:50, before the End: it couldn't know.
    expect(sessionStatus(mergeSessions(ended, running, T0 + 50 * MIN))).toBe('ended');
    // Saved at 1:10, after the End: a real Resume, still running.
    expect(sessionStatus(mergeSessions(ended, running, T0 + 70 * MIN))).toBe('live');
  });

  it('Claude: a song an older build saved (no time) keeps its place, after the timed song before it', () => {
    const saved = { ...startSession(T0), played: [{ ...A, at: T0 + 1 * MIN }, X, { ...B, at: T0 + 30 * MIN }] };
    const mine = { ...startSession(T0), played: [{ ...A, at: T0 + 1 * MIN }, { id: 's3', title: 'Empire State of Mind', at: T0 + 10 * MIN }] };
    expect(mergeSessions(mine, saved).played.map((p) => p.id)).toEqual(['s1', 's9', 's3', 's2']);
  });
});

describe('#296 round 5: older builds and open pauses', () => {
  it('Claude (a): an old copy’s 0:10–0:17 (no times) and a new offline 0:40–0:45: 12 minutes, the same merged again', () => {
    const old = { ...startSession(T0), pausedMs: 7 * MIN, pauses: undefined };
    const fresh = resumeSession(pauseSession(startSession(T0), T0 + 40 * MIN), T0 + 45 * MIN);
    let m = mergeSessions(fresh, old, { savedAt: T0 + 20 * MIN, cutoff: T0 + 20 * MIN });
    expect(m.pausedMs).toBe(12 * MIN);
    for (let i = 0; i < 3; i++) m = mergeSessions(m, old, { savedAt: T0 + 20 * MIN, cutoff: T0 + 20 * MIN });
    expect(m.pausedMs).toBe(12 * MIN);
    // The round-4 case is unchanged: 10–15 and an old paused_ms 8 that knew it: 8.
    const a = resumeSession(pauseSession(startSession(T0), T0 + 10 * MIN), T0 + 15 * MIN);
    expect(mergeSessions(a, { ...startSession(T0), pausedMs: 8 * MIN, pauses: undefined }, { cutoff: T0 + 20 * MIN }).pausedMs).toBe(8 * MIN);
  });

  it('Codex: two pauses still open offline (19:10 and 19:12): paused since 19:10', () => {
    const live = startSession(T0);
    const m = mergeSessions(pauseSession(live, T0 + 10 * MIN), pauseSession(live, T0 + 12 * MIN));
    expect(m.pausedAt).toBe(T0 + 10 * MIN);
    expect(mergeSessions(pauseSession(live, T0 + 12 * MIN), pauseSession(live, T0 + 10 * MIN)).pausedAt).toBe(T0 + 10 * MIN);
  });

  it('Claude: same start, an older build’s copy with paused time it has no times for, saved after our End: its Resume counts', () => {
    const live = startSession(T0);
    const ended = endSession(live, T0 + 30 * MIN);
    // The old build resumed (paused_ms grew, no span) and saved at 0:40.
    const old = { ...live, pausedMs: 5 * MIN, pauses: undefined };
    expect(sessionStatus(mergeSessions(ended, old, { savedAt: T0 + 40 * MIN }))).toBe('live');
    // Nothing untimed and nothing done after the End: still ended.
    expect(sessionStatus(mergeSessions(ended, { ...live, pauses: [] }, { savedAt: T0 + 40 * MIN }))).toBe('ended');
  });

  it('Claude blocker: an older build’s Resume message (more paused time, no times) closes our pause by what it added', () => {
    const paused = pauseSession(startSession(T0), T0 + 10 * MIN);
    const theirs = { ...startSession(T0), pausedMs: 4 * MIN, pauses: undefined };
    const r = oldBuildResume(paused, theirs, T0 + 20 * MIN)!;
    expect(sessionStatus(r)).toBe('live');
    expect(r.pauses).toEqual([[T0 + 10 * MIN, T0 + 14 * MIN]]);
    expect(elapsedSeconds(r, T0 + 20 * MIN)).toBe(16 * 60);
    // After our End: running again, the gap is a pause, no minute lost.
    const ended = endSession(startSession(T0), T0 + 30 * MIN);
    const back = oldBuildResume(ended, { ...startSession(T0), pausedMs: 6 * MIN, pauses: undefined }, T0 + 40 * MIN)!;
    expect(sessionStatus(back)).toBe('live');
    expect(elapsedSeconds(back, T0 + 40 * MIN)).toBe(34 * 60);
    // A stale message (no more paused time) is not a Resume, and can't undo the End.
    expect(oldBuildResume(ended, { ...startSession(T0), pauses: undefined }, T0 + 40 * MIN)).toBeNull();
    expect(sessionStatus(mergeSessions(ended, { ...startSession(T0), pauses: undefined }, { cutoff: T0 + 40 * MIN }))).toBe('ended');
  });
});

describe('#296 round 6: open pauses and untimed paused time', () => {
  const M = 60_000;
  const CTX6 = { bandId: 'b', eventId: 'e', date: '2026-11-19' };

  it('Codex r7 #4: our Pause saved but its answer lost, then an older build resumed 5 min later: one closed pause, live, 5 min (never 10)', () => {
    const paused = pauseSession(startSession(0), 10 * M);
    // The server: the older build read our pause and resumed at 15 (196 carries pauses: []).
    const savedPauses = fromRow({ ...toRow(paused, CTX6, 3, 10 * M), paused_at: null, paused_ms: 5 * M })!;
    // ... and the same, saved before 196 carried anything (no pause times at all).
    const savedNoArray = fromRow({ ...toRow(paused, CTX6, 3, 10 * M), paused_at: null, paused_ms: 5 * M, summary: { v: 1, durationS: 0, played: [], total: 3 } })!;
    for (const saved of [savedPauses, savedNoArray]) {
      const m = mergeSessions(paused, saved, 15 * M + 500);
      expect(sessionStatus(m)).toBe('live');
      expect(m.pausedMs).toBe(5 * M);
      expect(m.pauses).toEqual([[10 * M, 15 * M]]);
      // A later pause and resume add only themselves.
      const later = resumeSession(pauseSession(m, 20 * M), 22 * M);
      expect(later.pausedMs).toBe(7 * M);
    }
  });

  it('Codex r7 #4: an older build’s untimed paused time from before our pause (we knew it too) does not close it', () => {
    const mine: SessionState = { ...pauseSession(startSession(0), 30 * M), pausedMs: 7 * M, pauses: undefined };
    const saved: SessionState = { ...startSession(0), pausedMs: 7 * M, pauses: undefined };
    const m = mergeSessions(mine, saved, 25 * M);
    expect(sessionStatus(m)).toBe('paused');
    expect(m.pausedMs).toBe(7 * M);
  });

  it('Claude r5 #2: our copy built from an older build (0:10–0:17, 7 min, no times) + a new admin’s [[40,45]]: 12', () => {
    const mine: SessionState = { ...startSession(0), pausedMs: 7 * M, pauses: undefined, untimedUntil: 20 * M };
    const theirs: SessionState = { ...startSession(0), pausedMs: 5 * M, pauses: [[40 * M, 45 * M]] };
    const m = mergeSessions(mine, theirs, { cutoff: 50 * M });
    expect(m.pausedMs).toBe(12 * M);
    // Merged again: still 12.
    expect(mergeSessions(m, theirs, { cutoff: 51 * M }).pausedMs).toBe(12 * M);
    expect(mergeSessions(theirs, m, { cutoff: 51 * M }).pausedMs).toBe(12 * M);
  });

  it('Claude r5 #3: our open pause came from an older build’s Pause: its Resume closes it whatever our paused time', () => {
    // Ours: the new admin's pause 20–25, then the older build's Pause at 30 (it never knew 20–25; its paused time 0).
    const mine: SessionState = { ...startSession(0), pausedMs: 5 * M, pauses: [[20 * M, 25 * M]], pausedAt: 30 * M };
    const theirs: SessionState = { ...startSession(0), pausedMs: 3 * M, pauses: undefined };
    expect(oldBuildResume(mine, theirs, 34 * M)).toBeNull();
    const r = oldBuildResume(mine, theirs, 34 * M, 0)!;
    expect(sessionStatus(r)).toBe('live');
    expect(r.pausedMs).toBe(8 * M);
    expect(r.pauses).toEqual([[20 * M, 25 * M], [30 * M, 33 * M]]);
  });
});

describe('#296 round 7 (Claude r6 B1): merging again changes nothing', () => {
  const M = 60_000;
  const X = { id: 'x', title: 'Paper Boats' };

  it('B ended at 25 after X at 24; A played X at 32: merge(A,B), merge(merge(A,B),B) and merge(B,merge(A,B)) are all live', () => {
    const base = startSession(0);
    const b = endSession(markPlayed(base, X, 24 * M), 25 * M);
    const a = markPlayed(base, X, 32 * M);
    const ab = mergeSessions(a, b);
    expect(sessionStatus(ab)).toBe('live');
    expect(sessionStatus(mergeSessions(ab, b))).toBe('live');
    expect(sessionStatus(mergeSessions(b, ab))).toBe('live');
    // Through the saved row too (what A saves and B reads).
    const CTX7 = { bandId: 'b', eventId: 'e', date: '2026-11-19' };
    const saved = fromRow(toRow(ab, CTX7, 3, 33 * M))!;
    expect(sessionStatus(mergeSessions(b, saved))).toBe('live');
    expect(sessionStatus(mergeSessions(saved, b))).toBe('live');
    expect(ab.played).toEqual([{ id: 'x', title: 'Paper Boats', at: 24 * M, last: 32 * M }]);
  });

  it('the same with a Pause: B paused at 28 (X first at 23); A played X at 31: live, whichever way and however often', () => {
    const base = startSession(0);
    const b = pauseSession(markPlayed(base, X, 23 * M), 28 * M);
    const a = markPlayed(base, X, 31 * M);
    const ab = mergeSessions(a, b);
    const want = sessionStatus(ab);
    for (const m of [mergeSessions(ab, b), mergeSessions(b, ab), mergeSessions(mergeSessions(ab, b), b), mergeSessions(ab, a)]) {
      expect(sessionStatus(m)).toBe(want);
      expect(m.pausedAt).toBe(ab.pausedAt);
    }
  });

  it('fuzz (fixed seed, 3000 pairs, some from older builds): merge is commutative and merging again changes nothing', () => {
    let seed = 0x296;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const songs = ['s1', 's2', 's3', 's4'].map((id) => ({ id, title: id }));
    const step = (s: SessionState, now: number): SessionState => {
      const r = rnd();
      if (r < 0.35) return markPlayed(s, songs[Math.floor(rnd() * songs.length)], now);
      if (r < 0.55) return pauseSession(s, now);
      if (r < 0.75) return resumeSession(s, now);
      return endSession(s, now);
    };
    const walk = (s: SessionState, from: number, n: number): [SessionState, number] => {
      let t = from;
      for (let i = 0; i < n; i++) {
        t += Math.floor(rnd() * 5 * M) + Math.floor(rnd() * 1000);
        s = step(s, t);
      }
      return [s, t];
    };
    const fails: string[] = [];
    for (let i = 0; i < 3000 && fails.length < 3; i++) {
      const [common, t0] = walk(startSession(0), 0, Math.floor(rnd() * 4));
      const [a] = walk(common, t0, 1 + Math.floor(rnd() * 5));
      const [b0] = walk(common, t0, 1 + Math.floor(rnd() * 5));
      // Now and then an older build's copy: no pause times.
      const b: SessionState = rnd() < 0.2 ? { ...b0, pauses: undefined } : b0;
      const ab = mergeSessions(a, b);
      const checks: [string, SessionState][] = [
        ['merge(b,a)', mergeSessions(b, a)],
        ['merge(ab,b)', mergeSessions(ab, b)],
        ['merge(b,ab)', mergeSessions(b, ab)],
        ['merge(ab,a)', mergeSessions(ab, a)],
        ['merge(a,ab)', mergeSessions(a, ab)],
        ['merge(ab,ab)', mergeSessions(ab, ab)],
      ];
      for (const [label, m] of checks) {
        if (!sameSession(m, ab)) fails.push(`${i} ${label}: ${JSON.stringify({ a, b, ab, m })}`);
      }
    }
    expect(fails).toEqual([]);
  });
});
