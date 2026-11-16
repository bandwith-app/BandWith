import { defineLifecycle } from './lifecycle.ts';

/**
 * (b) Rehearsal proposal: a member proposes a rehearsal, the admin turns it
 * into a poll ("Build poll", which becomes a rehearsal once locked in) or
 * declines it; the member can withdraw; it expires on its own.
 *
 * From the code and migrations:
 * - Propose (ProposeRehearsalModal.tsx): topic, preferred days, "Submit to
 *   admin" → "Proposal sent to band admin."; inserted as status 'proposed'
 *   (038_rehearsal_polls.sql; rehearsalPolls.ts createMemberRehearsalProposal).
 * - One proposal every 7 days per band: "Weekly limit reached" with "Next
 *   available proposal" (ProposeRehearsalModal.tsx; checkMemberProposalEligibility;
 *   server: can_member_propose_rehearsal, 038/073). A withdrawn proposal is
 *   deleted, so it no longer counts.
 * - Card (RehearsalPollCard.tsx): the member sees "Your rehearsal proposal ·
 *   Pending admin · Open until {date}" and Withdraw → "Withdraw your
 *   proposal?"; the admin sees "Member rehearsal proposal", Decline and
 *   Build poll.
 * - Open until: the day after the last preferred day, or 7 days after it was
 *   sent without days (src/lib/proposalExpiry.ts, 123_rehearsal_proposal_decline_expiry.sql);
 *   after that it leaves every list.
 * - Decline (ProposalDeclinePanel.tsx): "Decline this proposal?" with an
 *   optional reason; status 'cancelled'; the proposer gets "Rehearsal
 *   proposal declined" with the reason (pollNotices.ts notifyProposalDeclined,
 *   123).
 * - Build poll opens the poll builder with the topic, note and preferred
 *   days (RehearsalPollModal.tsx initialProposal, "From {name}:").
 * - Academy: together.ts "Propose a rehearsal" / "Handle a proposal".
 */
export const proposal = defineLifecycle({
  id: 'proposal',
  title: 'Rehearsal proposal',
  summary: 'Member proposes → admin sees "Open until" → Build poll (→ rehearsal), Decline with or without a reason, expiry; weekly limit; withdraw.',
  role: 'member',
  initial: 'start',
  states: {
    start: {
      see: 'Home (member).',
      on: { PROPOSE: 'proposed', PROPOSED_BY_JONAH: 'adminSees', STALE_PROPOSAL: 'expired' },
    },
    proposed: {
      see: 'Home shows "Your rehearsal proposal · Pending admin · Open until Thu, Nov 19"; saved as proposed.',
      on: { PROPOSE_AGAIN: 'limitReached', WITHDRAW: 'withdrawPrompt', AS_ADMIN: 'ownProposalAdmin' },
    },
    limitReached: {
      see: '"Weekly limit reached" with "Next available proposal" (in 7 days); no proposal form.',
      on: { CLOSE: 'proposed' },
    },
    withdrawPrompt: {
      see: '"Withdraw your proposal?" — "The admins will no longer see it." with Cancel and Withdraw.',
      on: { KEEP: 'proposed', CONFIRM_WITHDRAW: 'withdrawn' },
    },
    withdrawn: {
      see: '"Proposal withdrawn."; the card is gone and the proposal is deleted.',
      on: { PROPOSE_AGAIN: 'formOpen' },
    },
    formOpen: {
      see: 'The proposal form opens again: a withdrawn proposal doesn\'t count toward the weekly limit.',
    },
    ownProposalAdmin: {
      see: 'The same proposal for the admin: "Member rehearsal proposal", "Open until Thu, Nov 19", Decline and Build poll.',
    },
    adminSees: {
      see: 'The admin\'s Home: "Member rehearsal proposal" by Jonah R., "Open until Thu, Nov 19", Decline and Build poll.',
      on: { DECLINE: 'declinePanel', BUILD_POLL: 'builderFromProposal' },
    },
    declinePanel: {
      see: '"Decline this proposal?" with an optional reason, Cancel and Decline.',
      on: { KEEP: 'adminSees', CONFIRM_DECLINE: 'declined', CONFIRM_DECLINE_WITH_REASON: 'declinedWithReason' },
    },
    declined: {
      see: '"Proposal declined."; the card is gone; status cancelled; Jonah gets "Rehearsal proposal declined" without a reason.',
    },
    declinedWithReason: {
      see: 'As declined, and Jonah\'s notice ends with "Reason: Room booked all week".',
    },
    builderFromProposal: {
      see: 'The poll builder: "From Jonah R.:", the topic as title, Thu preselected.',
      on: { PUBLISH: 'polling' },
    },
    polling: {
      see: 'The proposal is now a poll ("Poll · Active") under the same title; status polling.',
      on: { LOCK_IN: 'rehearsal' },
    },
    rehearsal: {
      see: 'Locked in: the rehearsal is on the calendar and the proposal is confirmed.',
    },
    expired: {
      see: 'A proposal sent 9 days ago with no preferred day (open until 7 days after it was sent) is in no list.',
      source: 'proposalExpiry.ts isProposalExpired; rehearsalPolls.ts getRehearsalPolls',
    },
  },
  events: {
    PROPOSE: { do: 'Create → Propose rehearsal: topic, Thu, Submit to admin ("Proposal sent to band admin.").' },
    PROPOSE_AGAIN: { do: 'Create → Propose rehearsal again.' },
    CLOSE: { do: 'Tap Close.' },
    WITHDRAW: { do: 'Tap Withdraw on the proposal.' },
    KEEP: { do: 'Tap Cancel.' },
    CONFIRM_WITHDRAW: { do: 'Tap Withdraw in the question.' },
    AS_ADMIN: { do: 'The same user becomes the band\'s admin (same device).' },
    PROPOSED_BY_JONAH: { do: 'As the admin, with a proposal Jonah R. sent today for Thu.' },
    STALE_PROPOSAL: { do: 'As the admin, with a proposal Jonah R. sent 9 days ago with no day.' },
    DECLINE: { do: 'Tap Decline on the proposal.' },
    CONFIRM_DECLINE: { do: 'Tap Decline in the panel with no reason.' },
    CONFIRM_DECLINE_WITH_REASON: { do: 'Type a reason, tap Decline.' },
    BUILD_POLL: { do: 'Tap Build poll.' },
    PUBLISH: { do: 'Add next week\'s days, Publish poll.' },
    LOCK_IN: { do: 'Details · Lock in → Lock in → Confirm & create event.' },
  },
  wide: ['PROPOSED_BY_JONAH DECLINE CONFIRM_DECLINE_WITH_REASON'],
  knownBugs: [],
  manual: [
    'The proposer\'s push for a declined proposal (push delivery is device-only); the in-app notice row is checked.',
    'The server-side weekly limit (can_member_propose_rehearsal) and the daily expiry cron (bw_expire_rehearsal_proposals): the demo has no database, so only the client checks run.',
  ],
});
