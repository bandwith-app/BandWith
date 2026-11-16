/**
 * Optimistic poll votes: a tap shows at once and the server write follows.
 *
 * The tapped state lives in an overlay on top of the poll as last fetched.
 * One write runs at a time and always sends the state last tapped (setPollVote
 * is a "set", not a toggle), so rapid taps end in the last chosen state and a
 * refetch or realtime update that lands mid-way can't flip the pads back. The
 * overlay is dropped once the fetched poll shows the same answers (or a while
 * after the last write, whatever it shows then). A failed write throws the
 * overlay away: the pads show the poll as fetched again.
 */
import type { RehearsalPoll } from '@/lib/services/rehearsalPolls';

export type PollLike = Pick<RehearsalPoll, 'id' | 'options' | 'unavailable' | 'declined_all'>;

/** The viewer's answers as tapped: per option, and "None of these work". */
export interface VoteOverlay {
  votes: Record<string, boolean>;
  declined?: boolean;
}

/** One server write: a vote set on or off, "None work", or that answer dropped. */
export type VoteStep =
  | { kind: 'vote'; optionId: string; voted: boolean }
  | { kind: 'none' }
  | { kind: 'undecline' };

export type VoteWriter = (step: VoteStep) => Promise<{ error: unknown }>;

export interface VoteSyncListener {
  /** The overlay changed (re-render). */
  change?: () => void;
  /** Every tapped answer is on the server. */
  saved?: () => void;
  /** A write failed; the overlay is gone (rolled back). */
  failed?: (step: VoteStep, error: unknown) => void;
}

const EMPTY: VoteOverlay = { votes: {} };

export const isOverlayEmpty = (o: VoteOverlay): boolean =>
  o.declined === undefined && Object.keys(o.votes).length === 0;

/** The fetched poll already shows every tapped answer. */
export const overlayMatches = (poll: PollLike, o: VoteOverlay): boolean => {
  for (const [id, want] of Object.entries(o.votes)) {
    const opt = (poll.options || []).find((x) => x.id === id);
    if (opt && !!opt.has_voted !== want) return false;
  }
  return o.declined === undefined || !!poll.declined_all === o.declined;
};

/** The poll as the viewer just tapped it: has_voted, counts, voters and "None work". */
export function applyVoteOverlay<P extends PollLike>(poll: P, o: VoteOverlay, userId: string): P {
  if (isOverlayEmpty(o)) return poll;
  // The viewer's own profile, from an answer already in the poll (voter chips).
  const profile =
    (poll.options || []).flatMap((x) => x.votes || []).find((v) => v.user_id === userId)?.profile ??
    (poll.unavailable || []).find((u) => u.user_id === userId)?.profile ??
    null;
  const options = (poll.options || []).map((opt) => {
    const want = o.votes[opt.id];
    if (want === undefined || want === !!opt.has_voted) return opt;
    const others = (opt.votes || []).filter((v) => v.user_id !== userId);
    return {
      ...opt,
      has_voted: want,
      vote_count: Math.max(0, (opt.vote_count ?? (opt.votes || []).length) + (want ? 1 : -1)),
      votes: want
        ? [...others, { id: `local-${opt.id}`, poll_id: poll.id, option_id: opt.id, user_id: userId, created_at: '', profile }]
        : others,
    };
  });
  let { unavailable, declined_all } = poll;
  if (o.declined !== undefined && o.declined !== !!poll.declined_all) {
    declined_all = o.declined;
    const rest = (unavailable || []).filter((u) => u.user_id !== userId);
    unavailable = o.declined ? [...rest, { user_id: userId, profile }] : rest;
  }
  return { ...poll, options, unavailable, declined_all };
}

export class PollVoteSync {
  private desired: VoteOverlay = EMPTY;
  /** What the server holds after our writes; read from the poll at the first tap. */
  private confirmed: { votes: Record<string, boolean>; declined: boolean } | null = null;
  private running = false;
  private settled = true;
  private listener: VoteSyncListener;

  constructor(private write: VoteWriter, listener: VoteSyncListener = {}) {
    this.listener = listener;
  }

  setListener(listener: VoteSyncListener) {
    this.listener = listener;
  }

  get overlay(): VoteOverlay {
    return this.desired;
  }

  /** Writes are in flight. */
  get busy(): boolean {
    return this.running;
  }

  /** The answer the pads show for an option. */
  shown(poll: PollLike, optionId: string): boolean {
    return this.desired.votes[optionId] ?? !!(poll.options || []).find((o) => o.id === optionId)?.has_voted;
  }

  toggle(poll: PollLike, optionId: string) {
    this.seed(poll);
    const next = !this.shown(poll, optionId);
    // Voting for a date drops "None work" (as setPollVote does on the server).
    this.desired = { votes: { ...this.desired.votes, [optionId]: next }, declined: next ? false : this.desired.declined };
    this.changed();
    void this.run();
  }

  noneWork(poll: PollLike) {
    this.seed(poll);
    const votes = { ...this.desired.votes };
    for (const o of poll.options || []) votes[o.id] = false;
    this.desired = { votes, declined: true };
    this.changed();
    void this.run();
  }

  /** Drops the overlay once the fetched poll shows it (nothing in flight). */
  reconcile(poll: PollLike | null | undefined) {
    if (!poll || this.running || !this.settled || isOverlayEmpty(this.desired)) return;
    if (overlayMatches(poll, this.desired)) this.reset();
  }

  /** Drops the overlay after the writes, whatever the fetched poll shows. */
  expire() {
    if (this.running || !this.settled || isOverlayEmpty(this.desired)) return;
    this.reset();
  }

  private seed(poll: PollLike) {
    if (this.confirmed) return;
    this.confirmed = {
      votes: Object.fromEntries((poll.options || []).map((o) => [o.id, !!o.has_voted])),
      declined: !!poll.declined_all,
    };
  }

  private nextStep(): VoteStep | null {
    const c = this.confirmed;
    if (!c) return null;
    const d = this.desired;
    if (d.declined === true && !c.declined) return { kind: 'none' };
    for (const [optionId, voted] of Object.entries(d.votes)) {
      if ((c.votes[optionId] ?? false) !== voted) return { kind: 'vote', optionId, voted };
    }
    if (d.declined === false && c.declined) return { kind: 'undecline' };
    return null;
  }

  private applyStep(step: VoteStep) {
    const c = this.confirmed!;
    if (step.kind === 'none') {
      for (const k of Object.keys(c.votes)) c.votes[k] = false;
      c.declined = true;
    } else if (step.kind === 'vote') {
      c.votes[step.optionId] = step.voted;
      if (step.voted) c.declined = false;
    } else {
      c.declined = false;
    }
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    this.settled = false;
    try {
      for (;;) {
        const step = this.nextStep();
        if (!step) break;
        let error: unknown = null;
        try {
          ({ error } = await this.write(step));
        } catch (e) {
          error = e ?? new Error('write failed');
        }
        if (error) {
          this.running = false;
          this.reset();
          this.listener.failed?.(step, error);
          return;
        }
        this.applyStep(step);
      }
    } finally {
      this.running = false;
    }
    this.settled = true;
    this.listener.saved?.();
  }

  private reset() {
    this.desired = EMPTY;
    this.confirmed = null;
    this.settled = true;
    this.changed();
  }

  private changed() {
    this.listener.change?.();
  }
}
