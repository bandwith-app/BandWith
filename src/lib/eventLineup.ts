/**
 * Who is on an event's lineup. The admin who creates a gig or a rehearsal
 * starts on it, but can take themselves off: a non-playing admin still
 * manages the event (bw_can_manage_event goes by the band role), and having
 * no event_members row means no fee line, no RSVP, no payout and no stats.
 */

/**
 * Editing: the user took everyone off the lineup. An empty lineup alone
 * doesn't say so (it may just not have loaded), so the save keeps the
 * lineup unless it had people when the form opened.
 */
export function lineupCleared(isEditing: boolean, initialCount: number, selectedCount: number): boolean {
  return isEditing && initialCount > 0 && selectedCount === 0;
}

/**
 * A new event's invitations. A rehearsal with no list goes to the whole
 * band; a gig goes to its lineup only, so a gig with nobody on it (the admin
 * took themselves off) invites no one. The creator is never invited.
 */
export function newEventInvites(
  isRehearsal: boolean,
  invitedIds: readonly string[],
  creatorId: string,
  bandMemberCount: number,
): { send: boolean; pendingCount: number } {
  if (invitedIds.length === 0) {
    return isRehearsal ? { send: true, pendingCount: Math.max(bandMemberCount - 1, 0) } : { send: false, pendingCount: 0 };
  }
  return { send: true, pendingCount: invitedIds.filter((id) => id !== creatorId).length };
}
