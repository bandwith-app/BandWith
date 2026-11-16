import { defineLifecycle } from './lifecycle.ts';

/**
 * (a) RSVP: a member answers a band gig or a rehearsal.
 *
 * From the code:
 * - Gigs: a pending invite shows "Your RSVP · Are you in?" with ACCEPT /
 *   DECLINE (EventDetail.tsx showRsvpCard). Once going, the member gets
 *   DROP OUT → "Drop out?" Confirm drop / CANCEL (EventDetail.tsx, member view).
 * - Rehearsals: RsvpChoiceCard, always shown to invited members, GOING /
 *   CAN'T; answered, it shrinks to "Going" + Change (RsvpChoiceCard.tsx).
 * - An answer saved as "maybe" by an older version asks for GOING / CAN'T:
 *   "Your answer was Maybe. Choose GOING or CAN'T." (RsvpChoiceCard.tsx,
 *   EventDetail.tsx showGigMaybeRsvp for gigs).
 * - Answering closes the event (AuthenticatedApp.tsx handleEventAccept /
 *   handleEventDecline): "You're confirmed!" or "You dropped out of this event.".
 * - A member who declined no longer sees the event (src/lib/eventVisibility.ts:
 *   "band events where the user is a member: only those they are on and
 *   haven't declined").
 * - Past events have no answer controls (every RSVP card needs !isPast).
 * - Academy: together.ts "RSVP" and basics.ts (member view).
 */
export const rsvpGig = defineLifecycle({
  id: 'rsvp-gig',
  title: 'RSVP (gig)',
  summary: 'A member answers a band gig invitation, changes the answer, and a past gig is read-only.',
  role: 'member',
  initial: 'start',
  states: {
    start: {
      see: 'Nothing open yet: the first event seeds the demo data and opens the app.',
      on: { INVITED: 'invited', OLD_MAYBE: 'maybePrompt', ALREADY_GOING: 'goingOpen', PAST_GIG: 'past' },
    },
    invited: {
      see: '"Your RSVP · Are you in?" with ACCEPT and DECLINE, and no Maybe.',
      source: 'EventDetail.tsx showRsvpCard',
      on: { ACCEPT: 'going', DECLINE: 'out' },
    },
    maybePrompt: {
      see: '"Your answer was Maybe. Choose GOING or CAN\'T." with GOING and CAN\'T, neither chosen, no Maybe.',
      source: 'EventDetail.tsx showGigMaybeRsvp; RsvpChoiceCard.tsx',
      on: { GOING: 'going', CANT: 'out' },
    },
    going: {
      see: 'The gig closes with "You\'re confirmed!", stays on the calendar, and the answer is saved as confirmed.',
      source: 'AuthenticatedApp.tsx handleEventAccept',
      on: { REOPEN: 'goingOpen' },
    },
    goingOpen: {
      see: 'No ACCEPT / GOING any more: DROP OUT and EVENT CHAT.',
      source: 'EventDetail.tsx member view (accepted gig)',
      on: { DROP_OUT: 'dropPrompt' },
    },
    dropPrompt: {
      see: '"Drop out?" with Confirm drop and CANCEL.',
      on: { CONFIRM_DROP: 'out', KEEP: 'goingOpen' },
    },
    out: {
      see: 'The gig closes with "You dropped out of this event.", leaves the member\'s calendar, and the answer is saved as declined.',
      source: 'AuthenticatedApp.tsx handleEventDecline; eventVisibility.ts canSeeEvent',
    },
    past: {
      see: 'A past gig with an unanswered invite: no ACCEPT / DECLINE / GOING / CAN\'T, only VIEW SETLIST and EVENT CHAT.',
      source: 'EventDetail.tsx isPast branches',
    },
  },
  events: {
    INVITED: { do: 'The member\'s answer to "Client A — Wedding" is pending; open it from the calendar.' },
    OLD_MAYBE: { do: 'The member\'s answer to "Client A — Wedding" is a legacy "maybe"; open it.' },
    ALREADY_GOING: { do: 'The member already said yes to "Client A — Wedding"; open it.' },
    PAST_GIG: { do: 'The member\'s answer to the past "Summer Fest Opening" is pending; open it.' },
    ACCEPT: { do: 'Tap ACCEPT.' },
    DECLINE: { do: 'Tap DECLINE.' },
    GOING: { do: 'Tap GOING.' },
    CANT: { do: 'Tap CAN\'T.' },
    REOPEN: { do: 'Open the gig again from the calendar.' },
    DROP_OUT: { do: 'Tap DROP OUT.' },
    CONFIRM_DROP: { do: 'Tap Confirm drop.' },
    KEEP: { do: 'Tap CANCEL next to "Drop out?".' },
  },
  wide: [],
  knownBugs: [
    {
      // EventDetail.tsx:791-797 handleAccept awaits onAccept(), i.e.
      // AuthenticatedApp.tsx handleEventAccept, which already closed the
      // detail and then waits for the background sync (notify, refetch
      // events / notifications / dashboard, ~2-3 s in the demo). Only then
      // does handleAccept call onCloseProp(), which closes whatever event is
      // open by now (closeSelectedEventRef): the gig the member reopened.
      // The rehearsal card answers through handleRespond, which doesn't call
      // onCloseProp, so rehearsals are fine.
      path: 'INVITED ACCEPT REOPEN',
      role: 'member',
      profile: 'phone-portrait',
      actual:
        'After ACCEPT the gig closes ("You\'re confirmed!"). Opening it again right away (within ~3 s) shows it with DROP OUT, then it closes by itself; the same happens to any event opened in that window.',
      expected:
        'An event the user opened stays open until they leave it. The stale close comes from EventDetail.tsx:791-797 (handleAccept calls onCloseProp() after awaiting onAccept), and DECLINE has the same shape (EventDetail.tsx:806-812).',
      evidence: 'e2e/.results-known-bugs/rsvp-gig-reopen-after-accept/ (trace.zip, test-failed-1.png)',
    },
  ],
});

export const rsvpRehearsal = defineLifecycle({
  id: 'rsvp-rehearsal',
  title: 'RSVP (rehearsal)',
  summary: 'A member answers a rehearsal, changes the answer, and a past rehearsal is read-only.',
  role: 'member',
  initial: 'start',
  states: {
    start: {
      see: 'Nothing open yet: the first event seeds the demo data and opens the app.',
      on: { INVITED: 'invited', OLD_MAYBE: 'maybePrompt', PAST_REHEARSAL: 'past' },
    },
    invited: {
      see: '"Your RSVP · Are you coming?" with GOING and CAN\'T (neither chosen), the "Answer by" line, no Maybe.',
      source: 'RsvpChoiceCard.tsx; EventDetail.tsx showRehearsalRsvp',
      on: { GOING: 'going', CANT: 'out' },
    },
    maybePrompt: {
      see: '"Your answer was Maybe. Choose GOING or CAN\'T." with GOING and CAN\'T, neither chosen, no Maybe.',
      source: 'RsvpChoiceCard.tsx',
      on: { GOING: 'going', CANT: 'out' },
    },
    going: {
      see: 'The rehearsal closes with "You\'re confirmed!", stays on the calendar, and the answer is saved as confirmed.',
      source: 'AuthenticatedApp.tsx handleEventAccept',
      on: { REOPEN: 'goingOpen' },
    },
    goingOpen: {
      see: 'The RSVP is one line: "Your RSVP · Going" with Change.',
      source: 'RsvpChoiceCard.tsx (answered)',
      on: { CHANGE: 'changing' },
    },
    changing: {
      see: 'GOING (chosen) and CAN\'T again.',
      source: 'RsvpChoiceCard.tsx (editing)',
      on: { SAME_ANSWER: 'changing', CANT: 'out' },
    },
    out: {
      see: 'The rehearsal closes with "You dropped out of this event.", leaves the member\'s calendar, and the answer is saved as declined.',
      source: 'AuthenticatedApp.tsx handleEventDecline; eventVisibility.ts canSeeEvent',
    },
    past: {
      see: 'A past rehearsal with an unanswered invite: no GOING / CAN\'T.',
      source: 'EventDetail.tsx showRehearsalRsvp needs !isPast',
    },
  },
  events: {
    INVITED: { do: 'The member\'s answer to "Weekly rehearsal" is pending; open it from the calendar.' },
    OLD_MAYBE: { do: 'The member\'s answer to "Weekly rehearsal" is a legacy "maybe"; open it.' },
    PAST_REHEARSAL: { do: '"Weekly rehearsal" was two days ago and the member never answered; open it.' },
    GOING: { do: 'Tap GOING.' },
    CANT: { do: 'Tap CAN\'T.' },
    REOPEN: { do: 'Open the rehearsal again from the calendar.' },
    CHANGE: { do: 'Tap Change.' },
    SAME_ANSWER: { do: 'Tap GOING (already the answer): nothing is saved again.' },
  },
  wide: ['INVITED GOING REOPEN CHANGE CANT'],
  knownBugs: [],
});
