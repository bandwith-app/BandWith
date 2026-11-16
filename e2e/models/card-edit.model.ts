import { defineLifecycle } from './lifecycle.ts';

/**
 * (d) Overview card edit (#178): an admin edits a gig or rehearsal card by
 * card, right in its overview.
 *
 * From the code (src/app/components/event/edit/OverviewEditSheets.tsx):
 * - Every card editor is an EditSheet: Cancel and Save in the footer, ✕ in
 *   the header; Save is disabled until something changed.
 * - Leaving with changes (Cancel, ✕, the scrim, system Back) asks first:
 *   UnsavedChangesSheet "Save your changes?" with Save changes / Discard /
 *   Keep editing (src/app/components/bw/UnsavedChanges.tsx). Without changes
 *   it just closes.
 * - Opening another card's editor while one has changes asks the same
 *   question (SwitchRequest): Discard opens the other card, Keep editing
 *   stays, Save changes saves and stays on the overview (stay() resolves the
 *   switch with false before saving). Only a layout that keeps the overview
 *   usable beside the sheet allows this: the Duo in book posture (sheet in
 *   one pane, overview in the other). On phones, tablets and the other Duo
 *   postures the scrim covers the overview.
 * - Escape and the browser's Back are the web build's system Back
 *   (src/lib/backStack.ts onEscapeKey, AuthenticatedApp.tsx popstate).
 * - A save shows on the overview at once (useOverviewEdit onPatched).
 * - Members get no editors: canEditOverview needs isAdmin.
 * - Academy: gigs.ts "Edit a gig from its overview".
 */
export const CARDS = ['hero', 'venue', 'lineup', 'fee', 'to-dos', 'client & notes', 'studio cost'] as const;
export type Card = (typeof CARDS)[number];

export const cardEdit = defineLifecycle({
  id: 'card-edit',
  title: 'Overview card edit',
  summary: 'An admin opens a card editor on a gig or rehearsal overview, changes it, and leaves, switches or saves.',
  role: 'admin',
  initial: 'start',
  // Each path runs for one card, in turn, so every card is covered across
  // the paths (saving every card type is also in e2e/specs/event-edit.spec.ts).
  variants: CARDS,
  rotateVariants: true,
  states: {
    start: {
      see: 'Home.',
      on: { OPEN_EVENT: 'overview', AS_MEMBER: 'memberView' },
    },
    overview: {
      see: 'The event overview with an edit control on the card.',
      source: 'EventDetail.tsx canEditOverview',
      on: { OPEN: 'clean' },
    },
    clean: {
      see: 'The card\'s editor with the saved values; Save disabled.',
      source: 'OverviewEditSheets.tsx EditSheet',
      on: { CHANGE: 'dirty', ESCAPE: 'closedUnchanged' },
    },
    closedUnchanged: {
      see: 'No question: the editor closes and the overview shows the saved value.',
      source: 'EditSheet requestClose (dirty false)',
    },
    dirty: {
      see: 'The editor with the change; Save enabled.',
      on: {
        CANCEL: 'leavePrompt',
        CLOSE_X: 'leavePrompt',
        ESCAPE: 'leavePrompt',
        BROWSER_BACK: 'leavePrompt',
        SWITCH_CARD: 'switchPrompt',
        SAVE: 'saved',
      },
    },
    leavePrompt: {
      see: '"Save your changes?" with Save changes, Discard and Keep editing, over the editor.',
      source: 'UnsavedChanges.tsx UnsavedChangesSheet',
      on: { KEEP_EDITING: 'dirty', DISCARD: 'closedUnchanged', SAVE_CHANGES: 'saved' },
    },
    switchPrompt: {
      see: '"Save your changes?" over the editor, the other card\'s editor not open yet.',
      source: 'OverviewEditSheets.tsx SwitchRequest',
      on: { KEEP_EDITING: 'dirty', DISCARD: 'otherCard', SAVE_CHANGES: 'saved' },
    },
    otherCard: {
      see: 'The other card\'s editor is open; the first card kept its saved value.',
    },
    saved: {
      see: 'The editor closes and the overview shows the new value at once; the demo database has it.',
      source: 'useOverviewEdit.ts onPatched',
    },
    memberView: {
      see: 'A member opening the same gig and rehearsal finds no edit control on any card.',
      source: 'EventDetail.tsx canEditOverview (isAdmin)',
    },
  },
  events: {
    OPEN_EVENT: { do: 'Open the card\'s event (Rooftop Session, or Weekly rehearsal for studio cost) from the calendar.' },
    AS_MEMBER: { do: 'Become a member of the band and open Rooftop Session, then Weekly rehearsal.' },
    OPEN: { do: 'Tap the card\'s edit control.' },
    CHANGE: { do: 'Change one value in the editor.' },
    ESCAPE: { do: 'System Back: Escape with no field focused.' },
    BROWSER_BACK: { do: 'System Back: the browser\'s Back.' },
    CANCEL: { do: 'Tap Cancel.' },
    CLOSE_X: { do: 'Tap ✕.' },
    SAVE: { do: 'Tap Save.' },
    SWITCH_CARD: { do: 'Tap another card\'s edit control on the overview pane.', only: ['duo-book'] },
    KEEP_EDITING: { do: 'Tap Keep editing.' },
    DISCARD: { do: 'Tap Discard.' },
    SAVE_CHANGES: { do: 'Tap Save changes.' },
  },
  wide: ['OPEN_EVENT OPEN CHANGE BROWSER_BACK'],
  knownBugs: [],
});

/**
 * (d) Setlist / focus songs draft: the gig's setlist (inline on the
 * overview on phones) and the rehearsal's focus songs (a sheet) keep edits
 * as a draft until Save.
 *
 * From the code (src/app/components/dashboard/EventDetail.tsx):
 * - A draft shows "Unsaved changes · Cancel / Save" (UnsavedChangesBar), in
 *   the setlist sheet or on the overview.
 * - Closing the sheet keeps the draft: the bar moves to the overview.
 * - Leaving the event with a draft asks "Save the setlist changes?" with
 *   Save changes / Discard / Keep editing (guardUnsaved, useSystemBack).
 */
export const setlistDraft = defineLifecycle({
  id: 'setlist-draft',
  title: 'Setlist draft',
  summary: 'An admin changes a gig setlist or rehearsal focus songs, then cancels, saves, or leaves the event.',
  role: 'admin',
  initial: 'start',
  variants: ['gig setlist', 'focus songs'],
  rotateVariants: true,
  states: {
    start: { see: 'Home.', on: { OPEN_EVENT: 'overview' } },
    overview: { see: 'The event overview with its songs.', on: { OPEN_SONGS: 'clean' } },
    clean: {
      see: 'The song editor with the saved songs and no "Unsaved changes" bar.',
      on: { CHANGE: 'dirty' },
    },
    dirty: {
      see: '"Unsaved changes" with Cancel and Save; the template\'s songs are listed.',
      source: 'UnsavedChanges.tsx UnsavedChangesBar',
      on: { CANCEL_DRAFT: 'clean', SAVE_DRAFT: 'saved', CLOSE_SONGS: 'draftKept' },
    },
    draftKept: {
      see: 'The overview with "Unsaved changes" Cancel / Save: the draft is kept.',
      source: "EventDetail.tsx: setlistDraft.dirty && activeSheet !== 'setlist'",
      on: { LEAVE_EVENT: 'leavePrompt' },
    },
    leavePrompt: {
      see: '"Save the setlist changes?" with Save changes, Discard and Keep editing.',
      source: 'EventDetail.tsx guardUnsaved',
      on: { KEEP_EDITING: 'draftKept', DISCARD: 'leftUnchanged', SAVE_CHANGES: 'leftSaved' },
    },
    saved: { see: 'No bar; the database holds the template\'s songs.' },
    leftUnchanged: { see: 'The event closes; the database still holds the old songs.' },
    leftSaved: { see: 'The event closes; the database holds the template\'s songs.' },
  },
  events: {
    OPEN_EVENT: { do: 'Open Rooftop Session (gig setlist) or Weekly rehearsal (focus songs).' },
    OPEN_SONGS: { do: 'Gig: show the setlist (inline on phones, its tab on tablets). Rehearsal: EDIT on FOCUS SONGS.' },
    CHANGE: { do: 'Load a setlist template.' },
    CANCEL_DRAFT: { do: 'Tap Cancel on the "Unsaved changes" bar.' },
    SAVE_DRAFT: { do: 'Tap Save on the "Unsaved changes" bar.' },
    CLOSE_SONGS: { do: 'Rehearsal: close the focus songs sheet with its ✕. Gig: nothing (the setlist is part of the overview).' },
    LEAVE_EVENT: { do: 'Tap the event\'s Back.' },
    KEEP_EDITING: { do: 'Tap Keep editing.' },
    DISCARD: { do: 'Tap Discard.' },
    SAVE_CHANGES: { do: 'Tap Save changes.' },
  },
  wide: [],
  knownBugs: [],
});
