/**
 * What the viewer may do with a rehearsal poll, matching the database rules
 * so the app never offers an action that RLS then refuses:
 *  - 073 rehearsal_polls_delete / _update: admins always; the creator only
 *    while the poll is still a proposal (status 'proposed').
 *  - 098 users_can_insert_own_vote: on a poll with an invite list, only the
 *    invited members vote (admins included).
 */

interface PollLike {
  status?: string | null;
  created_by?: string | null;
  invited_user_ids?: string[] | null;
}

const inviteList = (poll: PollLike): string[] | null =>
  Array.isArray(poll.invited_user_ids) && poll.invited_user_ids.length > 0 ? poll.invited_user_ids : null;

/** Delete poll: admins, or the creator of a proposal not yet turned into a poll. */
export function canDeletePoll(poll: PollLike, userId: string | null | undefined, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return !!userId && poll.created_by === userId && poll.status === 'proposed';
}

/** Withdraw: the member who proposed it, while it is still a proposal. */
export function canWithdrawProposal(poll: PollLike, userId: string | null | undefined): boolean {
  return !!userId && poll.created_by === userId && poll.status === 'proposed';
}

/** Vote (dates or "None work"): everyone on an open poll, only invitees when it has a list. */
export function canVoteInPoll(poll: PollLike, userId: string | null | undefined): boolean {
  if (!userId) return false;
  const invited = inviteList(poll);
  return !invited || invited.includes(userId);
}

/**
 * Who gets "Vote on Rehearsal Times" when a poll is published: the band's
 * members (only the invitees when there is a list), never the admin who
 * published it.
 */
export function pollNotifyTargets(
  memberIds: string[],
  invitees: string[] | null | undefined,
  actorId: string | null | undefined,
): string[] {
  const list = invitees && invitees.length > 0 ? invitees : null;
  return Array.from(new Set(memberIds.filter(Boolean))).filter(
    (id) => id !== actorId && (!list || list.includes(id)),
  );
}
