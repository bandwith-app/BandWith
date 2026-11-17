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
| Inbox opened while Home loads: no gig opens behind it; Back (and the Duo rail's) closes the inbox | `layers-back` | all |
| Onboarding (web): the browser Back steps back like Escape; on the first screen it leaves | `layers-back` | full |
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
- **Bluetooth stage sync**: two phones offline in Stage mode, synced click.
- **Native sharing and files**: share sheets (rider PDF, quote), file pickers, camera.
- **Sign in with Google / Apple and real email links** (the suite only tests the callback
  errors).
- **Calendar feed subscription** in the phone's calendar app.
