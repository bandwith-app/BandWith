import { defineLifecycle } from './lifecycle.ts';

/**
 * (f) Deputies: the admin's list, asking a deputy for a member who can't
 * make it, the deputy's own "Deputy gigs" and their answers, and unlinking a
 * deputy's account.
 *
 * From the code and migrations:
 * - The list (DeputiesSection.tsx, Band members → Deputies; 084/086): admins
 *   only; a deputy with an account is "On BandWith" and is "Asked in the app".
 *   Edit → "Unlink account" → "Unlink BandWith account?" (Cancel / Unlink) →
 *   "Unlinked. Send the next request by message: …" (bw_deputy_unlink; 087
 *   rotates the tokens so links already sent stop working).
 * - Find a deputy (EventDetail.tsx canFindDeputy: admin, upcoming band gig,
 *   not a rehearsal or personal gig) next to a member who declined, in the
 *   lineup. AskDeputySheet.tsx: linked deputies get "Ask in the app" →
 *   "Sent in the app: they get a notification." and the request shows
 *   "Asked · no answer yet" (bw_deputy_request_open + bw_deputy_request_ping);
 *   unlinked ones only get a message.
 * - The deputy's side (DeputyGigsScreen.tsx / DeputyGigsList.tsx, 086): the
 *   claim link /?deputy=<token> opens "Deputy gigs" with "You're on {band}'s
 *   deputy list"; each request answers Yes / Not sure yet / No, I can't
 *   (bw_deputy_request_reply: available / maybe / unavailable), then "Change
 *   your answer"; the street address shows only after a yes; a change after
 *   a yes shows "Something changed" with Still OK / I can't anymore.
 * - An account with no band of its own and deputy gigs lands on "Deputy
 *   gigs" as its home (App.tsx deputyHome), with "Playing in a band too?".
 * - Academy: band.ts "Deputies", deputy.ts "Deputy gigs".
 */
export const deputy = defineLifecycle({
  id: 'deputy',
  title: 'Deputies',
  summary: 'Admin: deputy list → ask a deputy in the app for a member who declined → unlink the account. Deputy: claim link → Deputy gigs → Yes / Not sure / No → change the answer; no-band home.',
  role: 'admin',
  initial: 'home',
  states: {
    home: {
      see: 'Home (admin).',
      on: { OPEN_ROSTER: 'roster', MEMBER_DECLINED: 'lineupDeclined', OPEN_CLAIM_LINK: 'welcome', NO_BAND: 'deputyHome' },
    },
    roster: {
      see: 'Band members → Deputies: Luca T. "On BandWith", Noa B. and Ivo M. without; "Only admins see this list."',
      on: { EDIT_LUCA: 'lucaSheet' },
    },
    lucaSheet: {
      see: 'Edit deputy Luca T.: "On BandWith", "Luca T. answers in the app", Unlink account.',
      on: { UNLINK: 'unlinkPrompt' },
    },
    unlinkPrompt: {
      see: '"Unlink BandWith account?": links already sent stop working; Cancel and Unlink.',
      on: { CANCEL: 'lucaSheet', CONFIRM_UNLINK: 'unlinked' },
    },
    unlinked: {
      see: '"Unlinked. Send the next request by message…"; no "On BandWith" and no Unlink account any more; saved without the account.',
      on: { ASK_AFTER_UNLINK: 'askByMessageOnly' },
    },
    askByMessageOnly: {
      see: 'Find a deputy: Luca T. is no longer "On BandWith" and has no "Ask in the app", only the message buttons.',
    },
    lineupDeclined: {
      see: 'The Wedding\'s lineup: Lena P. declined, with "Find a deputy" next to her.',
      on: { FIND_DEPUTY: 'askSheet' },
    },
    askSheet: {
      see: '"Find a deputy", "Replacing Lena P."; Luca T. "On BandWith" with "Ask in the app"; Noa B. and Ivo M. by message only.',
      on: { ASK_IN_APP: 'askedInApp' },
    },
    askedInApp: {
      see: '"Sent in the app: they get a notification."; Luca T.\'s request is "Asked · no answer yet"; saved as pending for the Wedding.',
    },
    welcome: {
      see: 'The claim link opens Deputy gigs: "You\'re on The Late Shift\'s deputy list", "Your gigs with The Late Shift are below."',
      on: { OK: 'deputyGigs' },
    },
    deputyGigs: {
      see: 'Deputy gigs: Jazz Brunch "Waiting for your answer" with Yes / Not sure yet / No, I can\'t and no street address; Summer Wedding "Something changed".',
      on: { YES: 'saidYes', NOT_SURE: 'saidMaybe', NO: 'saidNo', STILL_OK: 'stillOk' },
    },
    saidYes: {
      see: 'Jazz Brunch: "You said yes", the street address, Change your answer; saved as available.',
      on: { CHANGE_ANSWER: 'changing' },
    },
    changing: {
      see: 'The answers again, with Cancel.',
      on: { NO: 'saidNo', CANCEL_CHANGE: 'saidYes' },
    },
    saidMaybe: {
      see: 'Jazz Brunch: "You\'ll confirm later", no street address; saved as maybe.',
    },
    saidNo: {
      see: 'Jazz Brunch: "You said you can\'t", no street address; saved as unavailable.',
    },
    stillOk: {
      see: 'Summer Wedding: no "Something changed" any more, still "You said yes".',
    },
    deputyHome: {
      see: 'No band of its own: Deputy gigs is the home screen, with "Playing in a band too?" and the requests to answer.',
      on: { YES: 'saidYes' },
    },
  },
  events: {
    OPEN_ROSTER: { do: 'Settings → Members → Deputies.' },
    EDIT_LUCA: { do: 'Tap Luca T.' },
    UNLINK: { do: 'Tap Unlink account.' },
    CANCEL: { do: 'Tap Cancel.' },
    CONFIRM_UNLINK: { do: 'Tap Unlink.' },
    ASK_AFTER_UNLINK: { do: 'Close; Lena P. declines the Wedding; open its lineup, Find a deputy.' },
    MEMBER_DECLINED: { do: 'Lena P. declines the Wedding; open it, Open lineup details.' },
    FIND_DEPUTY: { do: 'Tap Find a deputy next to Lena P.' },
    ASK_IN_APP: { do: 'Tap Ask in the app on Luca T.' },
    OPEN_CLAIM_LINK: { do: 'Open the deputy link /?deputy=<token> (the demo user plays for The Late Shift).' },
    OK: { do: 'Tap OK on the welcome.' },
    YES: { do: 'Jazz Brunch: tap Yes.' },
    NOT_SURE: { do: 'Jazz Brunch: tap Not sure yet.' },
    NO: { do: 'Jazz Brunch: tap No, I can\'t.' },
    CHANGE_ANSWER: { do: 'Tap Change your answer.' },
    CANCEL_CHANGE: { do: 'Tap Cancel.' },
    STILL_OK: { do: 'Summer Wedding: tap Still OK.' },
    NO_BAND: { do: 'The account leaves its band (deputy gigs only), opens the app again.' },
  },
  wide: ['NO_BAND YES CHANGE_ANSWER NO'],
  knownBugs: [
    // KNOWN BUG (app): the no-band Deputy gigs home puts controls on the
    // Duo Laptop fold. The path still runs on phone-portrait and iPad.
    {
      path: 'NO_BAND',
      role: 'deputy',
      profile: 'duo-laptop',
      onlyOn: ['duo-laptop'],
      actual:
        'On the Duo in Laptop pose (fold y 455–495) the standalone Deputy gigs home is one long scrolling page: Jazz Brunch\'s "Message to the band" field sits across the fold (TEXTAREA @y476..546), and scrolling moves the answer buttons through it.',
      expected:
        'Nothing the user can touch sits on the fold in Laptop pose, as on every other screen (e2e/support/health.ts onFold, e2e/README.md "@laptop … nothing may sit on the fold"). DeputyHome.tsx wraps DeputyGigsScreen in DuoAuthLayout, which only lays out the open (two-pane) display, so the Laptop pose gets no fold-aware layout.',
      evidence: 'e2e/.results-known-bugs/deputy-home-laptop-fold/ (trace.zip, test-failed-1.png)',
    },
  ],
  manual: [
    'Two accounts: the admin\'s request reaching the deputy\'s notifications and their answer reaching the admin ("Available"): the demo has one user, and its deputy gigs are a separate demo table (demo_deputy_gigs) for another band.',
    'Claiming a link for the first time ("From now on {band} can ask you in the app"), a link of another account, and the link a band member opens: the demo claim always answers "already" (demoClient.ts bw_deputy_claim).',
    'After an unlink, links already sent stop working (087 rotates the tokens) and the deputy no longer sees the band\'s gigs: server only.',
    'The public reply page /deputy.html and the calendar feed: no backend in the demo.',
    'Push notifications for requests, recaps and updates: device only.',
  ],
});
