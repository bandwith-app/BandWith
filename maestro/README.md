# Emulator check (Maestro)

The app on real emulators, before anything ships. Playwright (`e2e/`) proves the
flows in a browser; this proves what only the native shell can: the WKWebView on
iOS, the Android WebView, Android's system Back, the on-screen keyboard, the
custom-scheme links, safe areas.

**Rule:** nothing ships (Vercel deploy, Android release, device builds) before a
passing emulator check of that exact commit. The release scripts enforce it.

## Run it

```sh
scripts/emulator-check.sh            # or: pnpm emulator:check
```

One command, about 20–25 minutes on a busy Mac:

1. Builds the **demo** web bundle of HEAD (`VITE_DEMO_MODE`, dev mode: local
   sample data, no Supabase) and injects `setup/bw-maestro-setup.js` into it.
2. Builds a **fresh** iOS simulator `App.app` (xcodebuild, DerivedData in
   `~/Library/Caches/bandwith-emulator-check`) and a debug APK with that bundle.
   Never a re-signed old App.app: that gave the black WebView. `dist/`, the
   native `public/` folders, `Podfile.lock` and `capacitor.settings.gradle` are
   put back afterwards.
3. Boots private devices, created when missing:
   - **BW Check iPhone**: iPhone 17 Pro Max, iOS 27.0
   - **BW Check iPad**: iPad Pro 11-inch (M5), iOS 27.0
   - **BW_Check_API36**: Pixel 7 AVD, API 36, `hw.keyboard=yes`, headless, port 5584

   It never touches other sessions' simulators ("iPhone 17 Pro Max (splash
   QA)", `Modo_Taccuino_API36`, the EV/GS/… devices).
4. Installs the app and runs `maestro/flows` on the three devices in parallel:
   iPhone = tag `ios`, iPad = `ios` without `phone-only`, Android = `android`.
5. Shuts the devices down. On success it writes
   `.emulator-check/<full HEAD sha>.json` (git-ignored; also copied to the main
   clone's `.emulator-check/` when run from a worktree): date, devices, Maestro
   version, every flow's result and the screenshot folder. On failure it exits 1
   and prints `FAILED: <flow> on <device>`; everything is in
   `.emulator-check/runs/<run>/` (Maestro logs, JUnit, screenshots, the screen
   hierarchy at the failing step) and `.emulator-check/last-run.json`.

The app sources and the flows must be committed: the check is of HEAD.

Options, for iterating on flows (none of them writes a release marker):
`--devices iphone,android` (a subset), `--flows smoke,keyboard-chat` (a subset),
`--reuse-build` (skip the builds when they are of this commit),
`--keep-devices` (leave the devices booted afterwards).

### The Duo

Maestro can't set the iPhone Duo's postures (Device Hub does), so the Duo is a
manual step. The script prints the checklist at the end; check it on the Duo
simulator (by hand or with computer use), then:

```sh
scripts/emulator-check.sh --duo-ok
```

That marks the Duo signed off on the commit's passing run. Releases need both.

## The gate

`scripts/emulator-gate.mjs` checks `.emulator-check/<HEAD sha>.json`: it must
exist, name this exact commit, have every flow passed and the Duo signed off.
It is called by:

- `scripts/release-android.sh <version> --publish`: refuses before building.
  A build without `--publish` doesn't need it.
- `scripts/deploy-web.sh` (or `pnpm deploy:web`): the only way to deploy the web
  app to production. It wraps `npx vercel@latest deploy --prod --yes` and also
  refuses uncommitted app changes (the Vercel CLI uploads the working tree).
  `--dry-run` prints the command instead of deploying.

Emergency escape hatch, on both: `--skip-emulator-check "<reason>"`. It prints a
warning and records the reason: in the GitHub release notes (Android), in the
deployment's metadata `emulatorCheckSkipped` (Vercel). A reason is required.

The gate's tests: `scripts/emulator-gate.test.ts` (vitest, part of `pnpm test`).

## The flows

| Flow | What it proves | iPhone | iPad | Android |
| --- | --- | --- | --- | --- |
| `smoke` | Home, Calendar, a gig, Chat, Settings, Repertoire (songs) render; nothing blank | ✓ | ✓ | ✓ |
| `mark-all-read` | Mark all as read clears the unread count (admin, then member) | ✓ | ✓ | ✓ |
| `rsvp-reopen` | A member ACCEPTs a gig invitation, reopens the gig: it stays open while the answer syncs | ✓ | ✓ | ✓ |
| `contracts-back` | "No contract yet" → Contracts & docs with the gig's contract filled in → Back → Go back → the gig | ✓ | ✓ | ✓ |
| `member-no-client` | A member never sees the client (Home, the gig, scrolled) | ✓ | ✓ | ✓ |
| `role-change-cache` | Same device, cache kept: admin → member hides the client; member → admin shows it and fills a new contract | ✓ | ✓ | ✓ |
| `unsaved-changes` | An edited overview sheet (another event type) asks "Save your changes?"; Keep editing keeps it, Discard drops it | ✓ | ✓ | ✓ |
| `venue-one-tap` | Poll location: one tap on a suggestion picks it and closes the list | ✓ | ✓ | ✓ |
| `keyboard-sheet-title`, `keyboard-sheet-venue` | Keyboard up in a gig's title / venue sheet: the field is in sight above the keyboard, not covered, got there in one move (keyboard probe) | ✓ | ✓ | ✓ |
| `keyboard-sheet-cancel` (`android`) | Keyboard up in the venue sheet: Cancel takes the first tap ("Save your changes?"), not only closes the keyboard. iOS by hand: with the keyboard up iOS reports WebView positions off by the page's scroll, so Maestro's taps miss | | | ✓ |
| `keyboard-contract`, `keyboard-contract-notes` | Keyboard probe on Create contract: the client email (where the keyboard comes up on phones), the notes box at the bottom | ✓ | ✓ | ✓ |
| `keyboard-poll` | Keyboard probe on the poll location; phones: BACK / PUBLISH POLL steps aside and comes back | ✓ | ✓ | ✓ |
| `keyboard-gig-wizard`, `keyboard-chat` | Keyboard probe on the gig wizard (client) and a chat's message box | ✓ | ✓ | ✓ |
| `keyboard-sign-in`, `keyboard-create-account` | Keyboard probe on Sign in (email, password) and Create account (name, email, password), signed out | ✓ | ✓ | ✓ |
| `pinned-topbar` (`phone-only`) | A gig scrolled to the end keeps Back on screen | ✓ | | ✓ |
| `android-back` (`android`) | System Back closes one layer at a time: calendar search (keyboard, then search), date picker, Contracts & docs → gig, inbox, Create menu | | | ✓ |

Each flow starts from a clean install state (`launchApp: clearState`) and takes
screenshots at its key steps.

### Writing flows

- Select by visible text and accessibility labels (the WebView exposes
  `aria-label`s). On Android the DevTools hierarchy gives an icon button's
  `aria-label` as its id, not its text: tap those with
  `subflows/tap-label.yaml`. Text the app shows in capitals (CSS `text-transform`) is
  exposed in capitals: match with `(?i)`.
- Setup goes through `subflows/start.yaml` (`env: SETUP`, `ROLE`) and the setup
  link, not through the UI: `app.bandwith.mobile://auth/maestro?role=member`
  (iOS) / `com.bandwith.app://auth/maestro?…` (Android). The app ignores these
  links; `setup/bw-maestro-setup.js` applies them to the demo database and
  reloads (`role`, `keep=1` to keep the offline cache, `pending=<event title>`).
  iOS asks "Open in BandWith?" first; the subflow answers it.
- The setup script also fixes the clock (Mon 16 Nov 2026, 10:00 device time,
  like the e2e suite), signs in to the demo, marks the role tours seen, closes
  the urgent pop-up whenever it appears, and answers Photon / Open-Meteo with
  canned data (no network needed).
- Keyboard: `subflows/type-and-check.yaml` focuses a field, types, and asks the
  keyboard probe (in `setup/bw-maestro-setup.js`). It follows the field from
  focus until it has rested for a second with the keyboard up (the app marks
  it: `data-keyboard="open"`), then checks its centre is inside the web view
  (which ends at the keyboard) and nothing covers it, and that it got there in
  one move: a field that goes one way and then back by more than 24 px
  jumped.
  A failure names the field, why, and the field's path (`top 388 > 422 > …`).
  One flow per screen, so one bug doesn't hide the others.
  The Android AVD has a hardware keyboard (Maestro types with it) and
  `show_ime_with_hard_keyboard=1`, so the on-screen one still comes up.
  `subflows/hide-keyboard.yaml` closes it (Android Back; on iOS a tap outside
  the field, Maestro's `hideKeyboard` can't close a WKWebView keyboard).
- A new fix that a browser can't prove (system Back, keyboard, native plugin,
  WebView-only CSS) gets a flow here and a row in [e2e/FLOWS.md](../e2e/FLOWS.md).

Run one flow while writing it (devices booted, app installed by an earlier run):

```sh
maestro --device <udid or emulator-5584> test maestro/flows/smoke.yaml \
  -e APP_ID=app.bandwith.mobile -e SETUP= -e ROLE=        # com.bandwith.app on Android
```

## Install

```sh
brew tap mobile-dev-inc/tap && brew install mobile-dev-inc/tap/maestro   # 2.12.1 here
```

Maestro needs Java 17+: the script uses openjdk 21
(`/opt/homebrew/opt/openjdk@21`). It sets `MAESTRO_CLI_NO_ANALYTICS=1`.
Android also needs the `android-36` arm64 system image and the cmdline-tools
(`avdmanager`). CocoaPods needs a UTF-8 locale (the script sets it).
