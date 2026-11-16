import { describe, it, expect, vi } from 'vitest';
import { applyVoteOverlay, overlayMatches, PollVoteSync, type PollLike, type VoteStep } from '@/lib/pollVoteSync';

const ME = 'me';

const makePoll = (voted: Record<string, boolean> = {}, declined = false): PollLike => ({
  id: 'p1',
  declined_all: declined,
  unavailable: declined ? [{ user_id: ME, profile: null }] : [],
  options: ['a', 'b', 'c'].map((id) => ({
    id,
    poll_id: 'p1',
    proposed_date: '2026-12-01',
    start_time: '20:00',
    created_at: '',
    has_voted: !!voted[id],
    vote_count: (voted[id] ? 1 : 0) + 1,
    votes: [
      { id: `v-other-${id}`, poll_id: 'p1', option_id: id, user_id: 'other', created_at: '' },
      ...(voted[id] ? [{ id: `v-me-${id}`, poll_id: 'p1', option_id: id, user_id: ME, created_at: '', profile: { id: ME, full_name: 'Me Myself' } }] : []),
    ],
  })),
});

/** A writer whose calls resolve when the test says so. */
const manualWriter = () => {
  const calls: { step: VoteStep; resolve: (error?: unknown) => void }[] = [];
  const write = vi.fn(
    (step: VoteStep) =>
      new Promise<{ error: unknown }>((res) => calls.push({ step, resolve: (error) => res({ error: error ?? null }) }))
  );
  return { write, calls };
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('applyVoteOverlay', () => {
  it('shows a tapped vote at once: has_voted, count and the voter', () => {
    const shown = applyVoteOverlay(makePoll(), { votes: { a: true } }, ME);
    const a = shown.options.find((o) => o.id === 'a')!;
    expect(a.has_voted).toBe(true);
    expect(a.vote_count).toBe(2);
    expect(a.votes?.map((v) => v.user_id)).toEqual(['other', ME]);
  });

  it('takes a vote back and keeps the other voters', () => {
    const shown = applyVoteOverlay(makePoll({ b: true }), { votes: { b: false } }, ME);
    const b = shown.options.find((o) => o.id === 'b')!;
    expect(b.has_voted).toBe(false);
    expect(b.vote_count).toBe(1);
    expect(b.votes?.map((v) => v.user_id)).toEqual(['other']);
  });

  it('marks "None work" with the viewer\'s own profile', () => {
    const shown = applyVoteOverlay(makePoll({ a: true }), { votes: { a: false }, declined: true }, ME);
    expect(shown.declined_all).toBe(true);
    expect(shown.unavailable).toEqual([{ user_id: ME, profile: { id: ME, full_name: 'Me Myself' } }]);
  });

  it('returns the poll itself when nothing was tapped', () => {
    const poll = makePoll();
    expect(applyVoteOverlay(poll, { votes: {} }, ME)).toBe(poll);
  });
});

describe('overlayMatches', () => {
  it('is true once the fetched poll shows the tapped answers', () => {
    expect(overlayMatches(makePoll({ a: true }), { votes: { a: true, b: false } })).toBe(true);
    expect(overlayMatches(makePoll(), { votes: { a: true } })).toBe(false);
    expect(overlayMatches(makePoll({}, true), { votes: {}, declined: true })).toBe(true);
    expect(overlayMatches(makePoll(), { votes: {}, declined: true })).toBe(false);
  });
});

describe('PollVoteSync', () => {
  it('shows the tap before the write resolves and sends a set, not a toggle', async () => {
    const { write, calls } = manualWriter();
    const change = vi.fn();
    const sync = new PollVoteSync(write, { change });
    const poll = makePoll();
    sync.toggle(poll, 'a');
    expect(change).toHaveBeenCalled();
    expect(sync.shown(poll, 'a')).toBe(true);
    expect(calls.map((c) => c.step)).toEqual([{ kind: 'vote', optionId: 'a', voted: true }]);
  });

  it('rapid taps end in the last chosen state, one write at a time', async () => {
    const { write, calls } = manualWriter();
    const saved = vi.fn();
    const sync = new PollVoteSync(write, { saved });
    const poll = makePoll();
    sync.toggle(poll, 'a'); // on  (write 1 in flight)
    sync.toggle(poll, 'a'); // off
    sync.toggle(poll, 'a'); // on
    sync.toggle(poll, 'a'); // off: the last choice
    expect(write).toHaveBeenCalledTimes(1);
    expect(sync.shown(poll, 'a')).toBe(false);
    calls[0].resolve();
    await flush();
    // The server got "on"; the last tap was "off": one more write sets it off.
    expect(calls.map((c) => c.step)).toEqual([
      { kind: 'vote', optionId: 'a', voted: true },
      { kind: 'vote', optionId: 'a', voted: false },
    ]);
    calls[1].resolve();
    await flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('taps that cancel out before the write starts send nothing more', async () => {
    const { write, calls } = manualWriter();
    const sync = new PollVoteSync(write);
    const poll = makePoll();
    sync.toggle(poll, 'a');
    sync.toggle(poll, 'b');
    sync.toggle(poll, 'b');
    calls[0].resolve();
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('a stale refetch mid-write does not flip the pad back; the matching one clears the overlay', async () => {
    const { write, calls } = manualWriter();
    const sync = new PollVoteSync(write);
    sync.toggle(makePoll(), 'a');
    // A realtime refetch from before the insert lands.
    sync.reconcile(makePoll());
    expect(sync.shown(makePoll(), 'a')).toBe(true);
    calls[0].resolve();
    await flush();
    // Saved, but the poll still shows the old answer: the tap still wins.
    sync.reconcile(makePoll());
    expect(sync.shown(makePoll(), 'a')).toBe(true);
    // The refetch with the vote: the overlay is dropped (no double toggle).
    sync.reconcile(makePoll({ a: true }));
    expect(sync.overlay).toEqual({ votes: {} });
    expect(sync.shown(makePoll({ a: true }), 'a')).toBe(true);
  });

  it('rolls back on a failed write and reports it', async () => {
    const { write, calls } = manualWriter();
    const failed = vi.fn();
    const saved = vi.fn();
    const sync = new PollVoteSync(write, { failed, saved });
    const poll = makePoll({ b: true });
    sync.toggle(poll, 'a');
    sync.toggle(poll, 'b');
    calls[0].resolve(new Error('offline'));
    await flush();
    expect(failed).toHaveBeenCalledWith({ kind: 'vote', optionId: 'a', voted: true }, expect.any(Error));
    expect(saved).not.toHaveBeenCalled();
    expect(sync.overlay).toEqual({ votes: {} });
    expect(sync.shown(poll, 'a')).toBe(false);
    expect(sync.shown(poll, 'b')).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('a thrown write counts as a failure', async () => {
    const failed = vi.fn();
    const sync = new PollVoteSync(() => Promise.reject(new Error('boom')), { failed });
    sync.toggle(makePoll(), 'a');
    await flush();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(sync.busy).toBe(false);
  });

  it('"None work" clears the shown votes at once and writes once', async () => {
    const { write, calls } = manualWriter();
    const sync = new PollVoteSync(write);
    const poll = makePoll({ a: true, c: true });
    sync.noneWork(poll);
    expect(sync.overlay).toEqual({ votes: { a: false, b: false, c: false }, declined: true });
    calls[0].resolve();
    await flush();
    expect(calls.map((c) => c.step)).toEqual([{ kind: 'none' }]);
  });

  it('a date tapped after "None work" drops that answer with the vote', async () => {
    const { write, calls } = manualWriter();
    const sync = new PollVoteSync(write);
    const poll = makePoll({}, true);
    sync.toggle(poll, 'a');
    expect(sync.overlay.declined).toBe(false);
    calls[0].resolve();
    await flush();
    expect(calls.map((c) => c.step)).toEqual([{ kind: 'vote', optionId: 'a', voted: true }]);
  });

  it('a date tapped on and off after "None work" still drops that answer', async () => {
    const { write, calls } = manualWriter();
    const sync = new PollVoteSync(write);
    const poll = makePoll({ b: true });
    sync.noneWork(poll); // write 1: none
    sync.toggle(poll, 'a'); // on
    sync.toggle(poll, 'a'); // off again
    calls[0].resolve();
    await flush();
    expect(calls.map((c) => c.step)).toEqual([{ kind: 'none' }, { kind: 'undecline' }]);
  });

  it('expire drops the overlay only once the writes are done', async () => {
    const { write, calls } = manualWriter();
    const sync = new PollVoteSync(write);
    sync.toggle(makePoll(), 'a');
    sync.expire();
    expect(sync.overlay.votes).toEqual({ a: true });
    calls[0].resolve();
    await flush();
    sync.expire();
    expect(sync.overlay).toEqual({ votes: {} });
  });
});
