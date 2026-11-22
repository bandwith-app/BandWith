import { describe, it, expect } from 'vitest';
import {
  endSession,
  fromRow,
  markPlayed,
  mergeSessions,
  pauseSession,
  resumeSession,
  sameSession,
  sessionStatus,
  startSession,
  toRow,
  type SessionState,
} from '../rehearsalSession';

/**
 * #296 round 8 (Claude r7 B1, M-a): the merge is a union of what every copy
 * did, and the session is worked out from that alone, so merging is the same
 * in any order (commutative, associative) and merging again changes nothing,
 * with different starts, older builds' copies, times and saved rows too.
 */
const M = 60_000;
const CTX = { bandId: 'b', eventId: 'e', date: '2026-11-19' };
const X = { id: 'x', title: 'Paper Boats' };
const Y = { id: 'y', title: 'Superstition' };
const rt = (s: SessionState) => fromRow(toRow(s, CTX, 4, 0))!;

describe('#296 round 8: different starts merge the same on both devices (Claude r7 B1 repro)', () => {
  it('A starts 19:00 and ends 19:30; B started unread at 19:01 and paused at 19:35: both devices show the same', () => {
    const a = endSession(markPlayed(startSession(0), X, 0), 30 * M);
    const b = pauseSession(markPlayed(startSession(1 * M), Y, 1 * M), 35 * M);
    // B's device merges the saved A, and saves it.
    const onB = mergeSessions(b, a, { savedAt: 30 * M });
    const row = fromRow(toRow(onB, CTX, 2, 36 * M))!;
    // A gets B's message, or reads B's row.
    const onA = mergeSessions(a, row, { cutoff: 36 * M });
    const onA2 = mergeSessions(a, row, { savedAt: 36 * M });
    expect(sessionStatus(onA)).toBe(sessionStatus(onB));
    expect(sessionStatus(onA2)).toBe(sessionStatus(onB));
    expect(sessionStatus(mergeSessions(onB, a))).toBe(sessionStatus(onB));
    // A Pause after the End never undoes it.
    expect(sessionStatus(onB)).toBe('ended');
    expect(onB.endedAt).toBe(30 * M);
    expect(onB.startedAt).toBe(0);
  });
});

const mk = (seedInit: number) => {
  let seed = seedInit;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const songs = ['s1', 's2', 's3', 's4'].map((id) => ({ id, title: id }));
const gen = (rnd: () => number) => {
  const step = (s: SessionState, now: number): SessionState => {
    const r = rnd();
    if (r < 0.35) return markPlayed(s, songs[Math.floor(rnd() * 4)], now);
    if (r < 0.55) return pauseSession(s, now);
    if (r < 0.75) return resumeSession(s, now);
    return endSession(s, now);
  };
  return (s: SessionState, from: number, n: number): [SessionState, number] => {
    let t = from;
    for (let i = 0; i < n; i++) {
      t += Math.floor(rnd() * 5 * M) + Math.floor(rnd() * 1000);
      s = step(s, t);
    }
    return [s, t];
  };
};
/** An older build's copy: no log, no pause times, songs without times. */
const asOld = (s: SessionState): SessionState => ({
  startedAt: s.startedAt,
  pausedMs: s.pausedMs,
  pausedAt: s.pausedAt,
  endedAt: s.endedAt,
  played: s.played.map((p) => ({ id: p.id, title: p.title })),
});

function fuzz(label: string, opts: { diffStart?: boolean; viaRow?: boolean; three?: boolean; old?: number; times?: boolean }) {
  it(`fuzz: ${label}`, () => {
    const rnd = mk(0x777 + label.length);
    const walk = gen(rnd);
    const fails: string[] = [];
    for (let i = 0; i < 4000 && fails.length < 3; i++) {
      const [common, t0] = walk(startSession(0), 0, Math.floor(rnd() * 4));
      let [a] = walk(common, t0, 1 + Math.floor(rnd() * 5));
      let b0: SessionState;
      if (opts.diffStart && rnd() < 0.7) {
        const s0 = Math.max(1, t0 + Math.floor(rnd() * 20 * M) - 10 * M);
        [b0] = walk(startSession(s0), s0, 1 + Math.floor(rnd() * 5));
      } else [b0] = walk(common, t0, 1 + Math.floor(rnd() * 5));
      let b: SessionState = rnd() < (opts.old ?? 0.2) ? asOld(b0) : b0;
      // An older build's copy is known at a time (when saved or when its message came in).
      if (opts.times && !b.log) b = { ...b, untimedUntil: t0 + Math.floor(rnd() * 30 * M) };
      if (opts.viaRow) {
        a = rt(a);
        b = rt(b);
      }
      const ab = mergeSessions(a, b);
      const chk = (name: string, m: SessionState, ref = ab) => {
        if (!sameSession(m, ref)) fails.push(`${i} ${name}: ${JSON.stringify({ a, b, ref, m })}`);
      };
      chk('merge(b,a)', mergeSessions(b, a));
      chk('merge(ab,b)', mergeSessions(ab, b));
      chk('merge(b,ab)', mergeSessions(b, ab));
      chk('merge(ab,a)', mergeSessions(ab, a));
      chk('merge(a,ab)', mergeSessions(a, ab));
      chk('merge(ab,ab)', mergeSessions(ab, ab));
      chk('merge(rt(ab),b)', mergeSessions(rt(ab), b));
      chk('merge(b,rt(ab))', mergeSessions(b, rt(ab)));
      chk('rt(ab)', rt(ab));
      if (opts.three) {
        const [c0] = walk(common, t0, 1 + Math.floor(rnd() * 5));
        const c = rnd() < (opts.old ?? 0) ? asOld(c0) : c0;
        const l = mergeSessions(ab, c);
        chk('(ab)c = a(bc)', mergeSessions(a, mergeSessions(b, c)), l);
        chk('(ab)c = (ac)b', mergeSessions(mergeSessions(a, c), b), l);
        chk('(ab)c = c(ba)', mergeSessions(c, mergeSessions(b, a)), l);
      }
    }
    expect(fails).toEqual([]);
  });
}

describe('#296 round 8: the merge is a union (fixed seeds, 4000 cases each)', () => {
  fuzz('same start, new builds only', { old: 0 });
  fuzz('same start, 20% older builds', {});
  fuzz('same start, older builds known at a time', { times: true, old: 0.3 });
  fuzz('same start, through saved rows', { viaRow: true });
  fuzz('different starts', { diffStart: true, old: 0 });
  fuzz('different starts, older builds, through rows', { diffStart: true, viaRow: true, times: true });
  fuzz('three copies (associative)', { three: true, old: 0 });
  fuzz('three copies, older builds and different starts', { three: true, old: 0.25, diffStart: true, times: true });
});
