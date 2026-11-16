import { defineLifecycle } from './lifecycle.ts';

/**
 * (c) Availability poll: an admin builds and publishes a poll, members vote,
 * the admin locks in a date and the rehearsal is created, or cancels.
 *
 * From the code:
 * - Builder (src/app/components/rehearsal/RehearsalPollModal.tsx): Back with
 *   nothing typed goes straight back to the rehearsal wizard; with something
 *   typed (isDirty) it asks "Discard this poll?" with Keep editing / Discard.
 *   Publish needs a title and at least one slot ("Add selected days to
 *   poll"). Publishing toasts "Rehearsal availability poll published to band!".
 * - Votes (src/lib/pollVoteSync.ts, setPollVote): each tap sets the vote to
 *   the pad's new state, so fast taps end on the last one.
 * - Lock in (src/lib/services/rehearsalPolls.ts finalizePollIntoRehearsal):
 *   creates the rehearsal, sets the poll to confirmed; the roster is the
 *   invited members (098: invited_user_ids, empty = everyone). The admin who
 *   locks it in is added only when invited (the publisher always is) or when
 *   they voted.
 * - Cancel: "Delete poll" → "Delete rehearsal poll?" → Delete poll
 *   (RehearsalPollCard.tsx, deletePoll); a locked-in rehearsal is cancelled
 *   by deleting it from its detail.
 * - Academy: together.ts "Find a date with a poll".
 */
export const poll = defineLifecycle({
  id: 'poll',
  title: 'Availability poll',
  summary: 'Build (Back / discard / keep editing) → publish → member votes → lock in → rehearsal, or cancel.',
  role: 'admin',
  initial: 'home',
  states: {
    home: {
      see: 'Home with the seeded poll "Extra rehearsal next week".',
      on: { OPEN_BUILDER: 'builderEmpty', RESTRICT_INVITEES: 'restrictedPoll' },
    },
    builderEmpty: {
      see: '"Availability poll" with its default title (nothing typed) and Publish poll disabled (no slots).',
      on: { BACK: 'wizard', TYPE_TITLE: 'builderTyped' },
    },
    builderTyped: {
      see: 'The builder with the typed title.',
      on: { BACK: 'discardPrompt', ADD_SLOTS: 'builderReady' },
    },
    discardPrompt: {
      see: '"Discard this poll?" with Keep editing and Discard.',
      source: 'RehearsalPollModal.tsx leave()',
      on: { KEEP_EDITING: 'builderTyped', DISCARD: 'wizard' },
    },
    wizard: {
      see: 'The rehearsal wizard\'s first step, no "Discard this poll?" and no poll saved.',
    },
    builderReady: {
      see: '"Candidate slots · 4" (Mon–Thu next week) and Publish poll enabled.',
      on: { PUBLISH: 'published' },
    },
    published: {
      see: '"Rehearsal availability poll published to band!"; Home shows the poll, "0 of 5 answered"; the database has it as polling with everyone invited.',
      on: { MEMBER_VOTES_FAST: 'voted', DELETE_POLL: 'pollDeleted' },
    },
    voted: {
      see: 'As a member, after taps Mon, Tue, Mon, Tue, Mon: Mon pressed, Tue not, and the database keeps only the Mon vote.',
      source: 'pollVoteSync.ts',
      on: { LOCK_IN: 'lockedIn' },
    },
    lockedIn: {
      see: '"Rehearsal scheduled and added to the calendar!"; the rehearsal is on the calendar; the admin (publisher, so invited) is on its roster as confirmed; the poll is confirmed.',
      source: 'rehearsalPolls.ts finalizePollIntoRehearsal',
      on: { CANCEL_REHEARSAL: 'rehearsalCancelled' },
    },
    rehearsalCancelled: {
      see: 'The rehearsal is gone from the calendar and the database.',
    },
    pollDeleted: {
      see: '"Rehearsal poll deleted."; the poll leaves Home and the database.',
    },
    restrictedPoll: {
      see: 'The seeded poll asks only Jonah, Marta and Lena: the admin\'s card says "Not invited".',
      source: '098 invited_user_ids; RehearsalPollCard.tsx',
      on: { LOCK_IN: 'lockedInWithoutAdmin' },
    },
    lockedInWithoutAdmin: {
      see: 'The rehearsal is created with Jonah, Marta and Lena; the admin, not invited and no vote, is not on its roster.',
      source: 'rehearsalPolls.ts finalizePollIntoRehearsal (adminVoted)',
    },
  },
  events: {
    OPEN_BUILDER: { do: 'Create → New rehearsal → Poll availability.' },
    BACK: { do: 'Tap the builder\'s Back.' },
    TYPE_TITLE: { do: 'Type a poll title.' },
    KEEP_EDITING: { do: 'Tap Keep editing.' },
    DISCARD: { do: 'Tap Discard.' },
    ADD_SLOTS: { do: 'Next week, then Add selected days to poll.' },
    PUBLISH: { do: 'Tap Publish poll.' },
    MEMBER_VOTES_FAST: { do: 'As a member, tap Mon, Tue, Mon, Tue, Mon on the poll in quick succession.' },
    LOCK_IN: { do: 'As the admin: Details · Lock in → Lock in on the top pick → Confirm & create event.' },
    CANCEL_REHEARSAL: { do: 'Open the new rehearsal and delete it.' },
    DELETE_POLL: { do: 'Details · Lock in → Delete poll → Delete poll.' },
    RESTRICT_INVITEES: { do: 'The seeded poll invites Jonah, Marta and Lena only (not the admin).' },
  },
  wide: ['RESTRICT_INVITEES LOCK_IN'],
  knownBugs: [],
});
