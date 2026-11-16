import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { applyVoteOverlay, PollVoteSync, type PollLike, type VoteStep } from '@/lib/pollVoteSync';
import { clearPollUnavailable, markPollUnavailable, setPollVote } from '@/lib/services/rehearsalPolls';

/** After the last write, how long the tapped answers win over a poll that doesn't show them yet. */
const HOLD_MS = 8000;

/**
 * The poll with the viewer's taps applied at once (lib/pollVoteSync), and the
 * taps themselves. `onSaved` runs once every tapped answer is on the server
 * (refetch there); `onFailed` after a write failed and the taps were undone.
 * Writes still finish when the component closes meanwhile.
 */
export function useOptimisticPollVotes<P extends PollLike | null>(
  poll: P,
  userId: string,
  opts: { onSaved?: () => void; onFailed?: (step: VoteStep, error: unknown) => void } = {}
) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const pollRef = useRef(poll);
  pollRef.current = poll;
  const pollId = poll?.id;

  const sync = useMemo(
    () =>
      new PollVoteSync((step) => {
        if (!pollId) return Promise.resolve({ error: null });
        if (step.kind === 'vote') return setPollVote(pollId, step.optionId, userId, step.voted);
        if (step.kind === 'none') return markPollUnavailable(pollId, userId);
        return clearPollUnavailable(pollId, userId);
      }),
    [pollId, userId]
  );

  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    sync.setListener({
      change: rerender,
      saved: () => {
        sync.reconcile(pollRef.current);
        if (holdRef.current) clearTimeout(holdRef.current);
        holdRef.current = setTimeout(() => sync.expire(), HOLD_MS);
        optsRef.current.onSaved?.();
      },
      failed: (step, error) => optsRef.current.onFailed?.(step, error),
    });
    return () => {
      if (holdRef.current) clearTimeout(holdRef.current);
      // Closed with writes in flight: they finish, and the parent still refreshes / hears of a failure.
      sync.setListener({
        saved: () => optsRef.current.onSaved?.(),
        failed: (step, error) => optsRef.current.onFailed?.(step, error),
      });
    };
  }, [sync]);

  // A fetched poll that shows the tapped answers takes over.
  useEffect(() => {
    sync.reconcile(poll);
  }, [sync, poll]);

  const overlay = sync.overlay;
  const shown = useMemo(
    () => (poll ? applyVoteOverlay(poll as NonNullable<P>, overlay, userId) : poll) as P,
    [poll, overlay, userId]
  );

  const toggleVote = useCallback(
    (optionId: string) => {
      const p = pollRef.current;
      if (p) sync.toggle(p, optionId);
    },
    [sync]
  );
  const markNoneWork = useCallback(() => {
    const p = pollRef.current;
    if (p) sync.noneWork(p);
  }, [sync]);

  return { poll: shown, toggleVote, markNoneWork, saving: sync.busy };
}
