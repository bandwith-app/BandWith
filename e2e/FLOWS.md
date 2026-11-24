# Flow catalogue

Every user flow the app has, the spec that covers it, and what still needs a real device.
A new feature adds its row here plus a spec (see the PR template).

Profiles: **full** = `phone-portrait` + `ipad-landscape`; **all** = every profile
(`@smoke`); **laptop** = `duo-laptop` (`@laptop`). Every test also runs the page-health
check (`app.check`) on each screen it reaches.

## Home, notifications, calendar

| Flow | Spec | Profiles |
| --- | --- | --- |
| Home: every card renders, top to bottom (admin and member) | `home-calendar` | all |
| Home: See all, Upcoming cards, a quote draft, Review payouts | `home-calendar` | full |
| Notifications inbox → open a notification (poll vote sheet) → close | `home-calendar` | full |
| Notifications inbox: Mark all as read clears the Unread count and dots (admin and member) | `home-calendar` | all |
| Calendar renders, top to bottom (admin and member) | `home-calendar` | all |
| Calendar: next / previous month, Today | `home-calendar` | full |
| Calendar: filters All / Gigs / Rehearsals / Quotes | `home-calendar` | full |
| Calendar: search by venue, close search | `home-calendar` | full |
| Calendar: open a gig, rehearsal, quote, personal gig, and back | `home-calendar` | full |
| Calendar link made before 182: asked once in the event (Keep my link) and in Settings → Calendar sync (Make a new link) | `calendar-link-review` | all |
| Home in Spanish and German: translated, fits | `i18n` | all |
| Calendar, a gig and the Account hub in Spanish and German | `i18n` | full |

## Gig and rehearsal overview (#178 card edits)

| Flow | Spec | Profiles |
| --- | --- | --- |
| Title, date & times; venue; fee (extra band fee, member fees, TBD) | `event-edit` | full |
| Lineup: untick yourself; an empty lineup never invites everyone; presets; musician fee → payouts | `event-edit` | full |
| Setlist: load a template, remove a song | `event-edit` | full |
| To-dos: load a list, add, rename, delete | `event-edit` | full |
| Client & notes | `event-edit` | full |
| Rehearsal: roster, studio cost (paid / free), focus songs, notes | `event-edit` | full |
| Personal gig keeps its Edit button; gigs/rehearsals have none | `event-edit` | full |
| Leaving an editor with unsaved changes asks (Cancel, ✕, Escape) | `unsaved-changes` | full |
| Show readiness: "No contract yet" opens Contracts & docs with a new contract for the gig | `event-edit` | full |
| … its Back (the screen's, the Duo rail's, system Back) leaves the form, then returns to the gig | `event-edit` | all |
| … the new contract form fills the pane, its action at the bottom, no tab bar over it (iPad) | `event-edit` | full |
| A gig scrolled to the end keeps Back (pinned top bar, or the Duo rail) on screen | `rider-stage` | all |
| Final balance (168): sheet fits, amount, gig fee vs quote, other payments, email send + reminder, deposit not recorded, no payment setup, Mark as paid + Undo, cancelled gig, member sees nothing | `quote-balance` | full (sheet + member `@smoke`: all) |
| Client page with a balance: amount, bank rows + Copy, Pay by card (https, noopener), paid state, client language | `quote-balance` | all |
| Deposit (168): Deposit received sheet (amount, method, gig confirmed, timeline), client page names the deposit before Accept, how to pay it after (bank + Copy, reference, card link), deposit received state with the amount recorded (183) | `quote-balance` | full (client page `@smoke`: all) |

## Members, privacy, RSVP

| Flow | Spec | Profiles |
| --- | --- | --- |
| Member: gigs and rehearsal are read-only; no client, price or colleagues' fees | `member-readonly` | all (portrait and landscape) |
| Member: Home and Calendar never show a client or gig price | `member-readonly` | all |
| Member: own fee is shown | `member-readonly` | full |
| Admin → member on the same device: cached client and price are gone (also with a slow cache) | `member-readonly` | all |
| Member → admin on the same device: the client shows and a new contract is filled in (slow cache) | `member-readonly` | all |
| RSVP: only GOING / CAN'T, the answer sticks (rehearsal and gig) | `rsvp` | full |
| RSVP: an old "maybe" asks to choose (rehearsal and gig) | `rsvp` | full |
| RSVP: after answering a gig invitation, the next event opened stays open | `rsvp` | full |
| Rehearsal proposals: member proposes; admin sees "Open until", declines with a reason | `rehearsal-proposals` | full |

## Rider & stage

| Flow | Spec | Profiles |
| --- | --- | --- |
| Open from the gig, Back / Escape (also from the input-list editor) | `rider-stage` | full |
| Phone: back from Rider & stage, the gig's Back and stage mode are on screen | `rider-stage` | full |
| Tablet: Rider & stage tab and back to Overview | `rider-stage` | full |
| Build input list from lineup; Update / Keep after a lineup change | `rider-stage` | full |
| No "seen" anywhere | `rider-stage` | full |
| Member: read-only | `rider-stage` | all |

## Live mode (Stage mode on gigs, Live mode on rehearsals)

| Flow | Spec | Profiles |
| --- | --- | --- |
| Rehearsal: admin and member open Live mode from an upcoming rehearsal (header play button or the Duo rail); its focus songs show, with chords; no run of show (load in, soundcheck, show, end) and nothing to strike off for tonight | `stage-live` | all |
| Rehearsal: Exit live mode (the screen's ✕ or the Duo rail's) and system Back return to the rehearsal | `stage-live` | all |
| A past rehearsal and a personal gig offer no live mode | `stage-live` | all |
| A rehearsal without focus songs says "No songs picked for this rehearsal yet." | `stage-live` | full |
| Gig Stage mode unchanged: name, run of show, strike off; Exit and system Back return to the gig | `stage-live` | all |
| Live sync between two devices: the admin's Next reaches a member following (rehearsal and gig) | `stage-live` | full |
| Offline (live pack): a gig opened online shows "Offline ready"; with no network it still opens Stage mode with its songs and "Offline · content from …" (admin and member) | `stage-offline` | all |
| Offline with no pack: Stage mode says the setlist couldn't be loaded | `stage-offline` | all |
| Offline consent: the "setlist ready without signal" push opens the gig with the sheet (what, where, size); "Only this gig" keeps just that one (member) | `live-pack-consent` | all |
| Offline consent: "Not now" downloads nothing and is remembered | `live-pack-consent` | full |
| Offline readiness (admin): "Offline: N of M members ready", the not-ready list, Remind sends one push | `live-pack-consent` | all |
| Settings › Offline & live: automatic on/off, Wi-Fi only, space used, Delete all with a confirm | `live-pack-consent` | all |
| No signal: a personal note written in Stage is kept on the phone ("Note saved on this phone…", "1 change waiting for signal") and sent by itself when the signal is back: nothing left "waiting" (for signal or to send) and nothing under "wasn’t saved" (member) | `live-outbox` | all (laptop skipped: Stage controls on the Deck) |
| No signal: a "Note for the band" from Stage says "Saved on this phone. It goes to the admin…" and reaches the admin when back online | `live-outbox` | all but Book / laptop |
| Urgent pop-up waits for an open sheet: hidden while the sheet is open, back when it closes | `urgent-yields` | all |
| System Back with the urgent pop-up waiting closes the open sheet (New chat), not the hidden pop-up; the pop-up comes back | `urgent-yields` | all |
| Urgent pop-up waits while the gig editor or the quote wizard is open (no dialog role: `data-modal-open`), back when it closes | `urgent-yields` | all |
| Urgent pop-up waits for Stage mode: hidden while Stage is open, back when it closes | `urgent-yields` | all but Book / laptop |
| An urgent item that arrives while a sheet is already open never flashes over it, not even for a frame; it shows once the sheet closes | `urgent-yields` | all |
| Rehearsal session: a running session shows its clock in Live mode and on the rehearsal page; members get no controls; before the start only the admin sees Start rehearsal (Duo Laptop: the floor wedge's clock and Pause) | `rehearsal-session` | all |
| Rehearsal session: start, pause (clock stands), resume, two songs, End asks first, summary (songs played) saved and on the rehearsal page | `rehearsal-session` | full |
| Rehearsal session survives closing Live mode and restarting the app | `rehearsal-session` | full |
| Rehearsal session between two devices: the admin's start, pause and end reach a member (summary without Resume) | `rehearsal-session` | full |
| Rehearsal session lifecycle (start → pause → resume → end → summary → page; restart) | model `rehearsal-live` | phone-portrait |
| Rehearsal notes: Mark in Live mode (song + minute), write it at the pause with a preset and text, read it on the rehearsal page (Duo Laptop: the notes pad's Mark and one-tap preset) | `rehearsal-notes` | all |
| Rehearsal notes: a member marks Practised on a note for them, no OK, no Edit on others' notes | `rehearsal-notes` | full |
| Rehearsal notes: an admin confirms OK and assigns a new note to a member | `rehearsal-notes` | full |
| Rehearsal notes between two devices: a mark shows on the other phone's Live mode | `rehearsal-notes` | full |
| To practise: Home card by song, Practised on a note for me, the song page's "From rehearsals" (tempo / key → set on the song or suggested), Duo Laptop desk action items | `to-practise` | all |
| Next rehearsal: "From last time" with OK for admins, Live mode badge opens a song's earlier notes | `to-practise` | full |
| New rehearsal: focus songs offered from open notes, one tap adds one | `to-practise` | full |
| Rehearsal note lifecycle (mark → write → save → page → OK → reopen) | model `rehearsal-note` | phone-portrait |
| Voice parts: lead, 2nd voice, backing, all and spoken lines drawn in their own style (no markers on screen), the legend ("you" on my part), "Highlight my part" from the singer's instrument (on by default, one tap off, a one-time hint on why lines are dimmed) in Live mode; Duo Laptop on the floor wedge; an admin sets who sings what; the song form shows the words without markers and the parts stay on their lines | `voice-parts` | all |
| The Home rehearsal card's "Enter live mode" / "Check in / live" open the same live mode (no separate local session) | vitest `RehearsalExpanded.live` | unit |

## Create

| Flow | Spec | Profiles |
| --- | --- | --- |
| Gig / quote / rehearsal wizard: ✕ or Back half-way asks Save draft / Discard / Keep editing | `create-wizards` | full |
| Save draft shows under Drafts on Home; Discard leaves nothing | `create-wizards` | full |
| An untouched wizard just closes | `create-wizards` | full |
| Poll builder: header Back, CTA Back, system Back ask before discarding | `polls` | phone only |
| Poll builder with nothing typed: Back doesn't ask | `polls` | phone only |
| Poll location suggests venues | `polls` | full |
| Poll on Home: fast votes, last tap wins; admin locks in a date | `polls` | full |
| iPad composers: venue suggestions (gig, rehearsal) | `fold-layers` | iPad |
| Duo Laptop: Create menu, gig wizard, rehearsal wizard, poll builder, Propose rehearsal, Log personal gig off the fold | `fold-layers` | laptop |
| Duo Laptop: Stage mode (floor wedge), Deputy gigs, What brings you here?, Create account off the fold | `fold-layers` | laptop |
| Duo Laptop: Settings & account (from Home, Calendar, Chat) sits over the page, its rows and Privacy & account off the fold; Help & support, Deputy gigs, Repertoire, Gear, Contracts, To-do lists, Members, Pricing opened from Home sit over the page | `hub-layers-laptop` | laptop |
| Duo rail: every button on screen, clear of the camera block and on top, on Home, Calendar, Chat and a gig, in every Duo posture and closed with the camera top-left (landscape-primary) | `duo-rail` | Duo profiles |
| Duo rail: Open profile shows the Account hub on top from the inbox, a notification and Calendar's Search events (they close), in every Duo posture | `rail-profile-on-top` | Duo profiles |
| Duo Laptop, keyboard up: the field being typed in rests on the Deck strip (or whole on the Display), never on the fold or under a pinned header: Deputy gigs (home and in the app), Create contract, gig wizard, Sign in, Create account | `fold-layers` | laptop |

## Settings, assets, chat

| Flow | Spec | Profiles |
| --- | --- | --- |
| Account hub lists identity, band, assets, app settings | `settings` | all |
| Members: list → member | `settings` | full |
| Pricing: every tab, Save changes, close | `settings` | full |
| Deputy gigs | `settings` | full |
| Contracts & docs: filters, a document, no "Seen" | `settings` | full |
| Member hub: no band settings, pricing, contracts or invite | `settings` | all |
| Gear: add sheet, Speakers category, custom category ≤ 40 characters | `gear` | full |
| Gear as member: band and others' gear locked | `gear` | all |
| Chat: list, band chat sends a message (admin and member) | `chat` | full |
| Chat: event strip opens the gig; Back to chat, then list | `chat` | full |

## Navigation and sign-in

| Flow | Spec | Profiles |
| --- | --- | --- |
| Every layer closes with system Back and with its own Back / ✕ (notifications, Create menu, search, gig, hub page, chat) | `layers-back` | full (some all) |
| Accessibility (axe, WCAG 2.1 AA): Home, Calendar, a gig and its Venue / Lineup / Setlist sheets, a rehearsal, Suggestions, New rehearsal; no critical or serious violation; the role tours (deputy, admin, member) read on both screens of the fold | `a11y` | phone-portrait, iPad (composer), laptop (month grid, sheets, tours) |
| Keyboard focus stays in the top layer: Tab and Shift+Tab cycle inside the Create sheet and the iPad composer, never behind the scrim | `sheet-focus` | all (composer: iPad) |
| Inbox opened while Home loads: no gig opens behind it; Back (and the Duo rail's) closes the inbox | `layers-back` | all |
| Onboarding (web): the browser Back steps back like Escape; on the first screen it leaves | `layers-back` | full |
| Sign-up link from the site (`/?start=signup&src=…`), signed out: opens on Create account, Back leads to Welcome, a reload opens the normal start | `signup-link` | all |
| Sign-up link: an invite link wins; `?bw_screen=sign-in` unchanged; signed in, it opens the app as usual | `signup-link` | full |
| Create account on a 320 px wide phone: the set-up line takes two lines at most, in every language | `signup-link` | phone-portrait |
| Create account with email (confirmation on) → Check your email: a wrong code says so, Send a new code, the 6-digit code typed → What brings you here?, no second password prompt | `signup-code` | all |
| Check your email: the whole code pasted at once; "I’ve confirmed it: sign in" (the email's link was used) opens the sign-in screen | `signup-code` | full |
| Check your email on a 320 px wide phone: the code field, Verify, Send a new code and the sign-in fallback fit, in every language | `signup-code` | phone-portrait |
| Check your email: the title and the text never run under the clock block (the closed Duo's reaches beside them) | `signup-code-layout` | all |
| Check your email, keyboard up: the code field, a refused code's message and Verify show above it; the other buttons by scrolling, nothing slides under the status bar | `signup-code-layout` | all (not duo-laptop) |
| Check your email: the system Back goes back to Create account with the fields kept, like the Back button on the screen | `signup-code-layout` | all |
| Onboarding in a computer window (1440×900, 1920×1080, 2560×1180, a mouse): every step of the band path and of the solo path fills the window beside the brand page; the brand page's named steps and the header's "STEP 2 OF 6" are one count; no band is named before (or without) choosing one | `onboarding-desktop` | ipad-landscape (as a computer) |
| Onboarding in a computer window: a main button that can't be pressed yet is neutral, not dimmed lime; the chosen path is marked on its card; Check your email reads field → Verify → two quiet links on one measure | `onboarding-desktop` | ipad-landscape (as a computer) |
| Solo account (What brings you here? → Solo schedule, no band): Home is the personal calendar; Create offers the personal gig only, which lands on the calendar with its fee; Chat answers "Band required" with Create a band; Settings shows no members, band assets, band settings or plan; no loader left spinning | `solo-account` | all |
| Expired reset link (query or fragment): says so, offers a new link | `auth-callback` | all / full |
| Sign-in server error: explains, Back to sign in, Back doesn't return to the dead link | `auth-callback` | all |
| Already signed in: Back to sign in lands in the app | `auth-callback` | full |

## Lifecycle models (generated paths)

Every path of the XState models in `models/`; the list of paths per model is in
[docs/lifecycles](../docs/lifecycles/README.md).

| Flow | Spec | Profiles |
| --- | --- | --- |
| RSVP gig and rehearsal: invite → accept / decline / maybe → change → drop out; past events read-only | `xstate-lifecycles` | phone-portrait (+ wide subset) |
| Rehearsal proposal: propose, weekly limit, withdraw, decline (with reason), Build poll → rehearsal, expiry | `xstate-lifecycles` | phone-portrait (+ wide subset) |
| Availability poll: builder, discard, publish, fast votes, lock in, cancel, delete, invitees only | `xstate-lifecycles` | phone-portrait (+ wide subset) |
| Overview card edit per card type: Cancel, ✕, Escape, Back, Save, switch card; member sees no edit; setlist draft | `xstate-lifecycles` | phone-portrait (+ wide subset, `@duo-book`) |
| Quote → sent → declined / accepted → gig / contract / rider; Revert to quote; Confirm as gig + Undo | `xstate-lifecycles` | phone-portrait (+ wide subset) |
| Deputies: list, unlink, Find a deputy → Ask in the app; claim link → Deputy gigs → answers; no-band home | `xstate-lifecycles` | phone-portrait (+ wide subset) |
| Auth links: expired (query / fragment) → new link → reset; server error → sign in; Back not to the dead link | `xstate-lifecycles` | phone-portrait (+ wide subset) |

## On emulators (Maestro)

`scripts/emulator-check.sh` runs these on the iOS simulator (iPhone 17 Pro Max, iPad Pro
11) and the Android emulator (Pixel 7, API 36) with the real native shell; releases need a
passing run of the commit (see [maestro/README.md](../maestro/README.md)). The Duo postures
are a manual checklist the script prints.

| Flow | Maestro flow | Devices |
| --- | --- | --- |
| Home, Calendar, a gig, Chat, Settings, Repertoire render (no blank screen) | `smoke` | iPhone, iPad, Android |
| Notifications: Mark all as read clears the unread count (admin and member) | `mark-all-read` | iPhone, iPad, Android |
| RSVP: after answering a gig invitation, the event opened right after stays open | `rsvp-reopen` | iPhone, iPad, Android |
| "No contract yet" → Contracts & docs, filled in → Back → Go back → the gig | `contracts-back` | iPhone, iPad, Android |
| Member never sees the client (Home, gig, scrolled) | `member-no-client` | iPhone, iPad, Android |
| Role change on the same device, cache kept (admin → member, member → admin + contract prefill) | `role-change-cache` | iPhone, iPad, Android |
| Overview edit sheet: "Save your changes?", Keep editing / Discard | `unsaved-changes` | iPhone, iPad, Android |
| Venue suggestion: one tap picks it and closes the list | `venue-one-tap` | iPhone, iPad, Android |
| On-screen keyboard over the main input screens (gig overview sheets, Create contract, poll location, gig wizard, chat, Sign in, Create account): the focused field is in sight above the keyboard, not covered, and does not jump; phones hide the poll CTA bar; an edit sheet's Cancel still takes the tap | `keyboard-*` (one per screen) | iPhone, iPad, Android |
| A gig scrolled to the end keeps Back on screen | `pinned-topbar` | iPhone, Android |
| System Back: calendar search (keyboard, then search), date picker, Contracts & docs → gig, inbox, Create menu | `android-back` | Android |

## Manual only

These need a real device (or the Duo simulator's Device Hub); run them from the device test
matrix before a release.

- **Duo postures** (Closed, Book, Laptop, Open; the checklist `scripts/emulator-check.sh`
  prints), signed off with `scripts/emulator-check.sh --duo-ok`.

- **Real Duo hinge**: posture changes while a layer is open, spanning, the physical fold
  (the suite emulates the postures, not the hardware).
- **Android APK installer**: install, update over an older version, the in-app update notice.
- **Push notifications**: delivery, tapping one opens the right screen, translated text.
- **Real keyboard**: Return / Done, autocorrect, hardware keyboard on the iPad, WebKit's
  own focus scrolling (the suite fires the Keyboard plugin's window events and shrinks the
  viewport, see `support/keyboard.ts`; it does not run the real keyboard; the on-screen keyboard over the main input screens
  runs on emulators, `maestro/flows/keyboard-*.yaml`).
- **Live pack silent refresh**: a setlist change on the server wakes a phone that keeps the gig offline (APNs background / FCM data push) and its pack updates without a banner; needs migration 170 + send-push deployed and a real device.
- **Bluetooth stage sync**: two phones offline in Stage mode (gig) or Live mode (rehearsal), synced click.
- **Native sharing and files**: share sheets (rider PDF, quote), file pickers, camera.
- **Sign in with Google / Apple and real email links** (the suite only tests the callback
  errors).
- **Calendar feed subscription** in the phone's calendar app.
