# End-to-end tests

Playwright tests that use the app the way the device testers do. They run against the
**demo build** of the web app: an in-memory fake backend seeded from
`src/lib/demo/seed.ts`, so no Supabase, no accounts and no network.

## Run

```sh
pnpm install
pnpm exec playwright install chromium webkit   # once
pnpm e2e                                        # builds the demo app, serves it, runs everything
```

The config builds the app into `e2e/.app/` and serves it with `vite preview` on
`127.0.0.1:4319` (`E2E_PORT` changes the port). Locally an already running server on that
port is reused, so rebuild after changing `src/` (stop the server, or delete `e2e/.app/`).

Useful variants:

```sh
pnpm e2e --project=phone-portrait            # one device profile
pnpm e2e specs/polls.spec.ts                 # one file
pnpm e2e -g "poll builder"                   # by test title
pnpm e2e --grep @smoke                       # the smoke set only
pnpm e2e --ui                                # Playwright UI mode
E2E_WORKERS=2 pnpm e2e                       # fewer workers on a busy machine
pnpm e2e:typecheck                           # tsc for e2e/
pnpm e2e:models:coverage                     # lifecycle models: states, transitions, covered
```

## Lifecycle models

`models/` holds XState models of the riskiest multi-step lifecycles (RSVP, rehearsal
proposals, availability polls, overview card edits, quotes, deputies, auth links), for
tests only. `@xstate/graph` generates one path per transition and
`specs/xstate-lifecycles.spec.ts` runs each one as a test ("<lifecycle>: <event → event>").
Paths the app gets wrong today are listed in the model's `knownBugs` and not run.
Diagrams, states, events and paths: [docs/lifecycles](../docs/lifecycles/README.md)
(`pnpm e2e:models:docs` rewrites them after a model changes).
In CI they run in their own job, "E2E lifecycles", beside the E2E shards, which skip
them (`E2E_SKIP_LIFECYCLES=1`).

## A slow machine, on request

GitHub's runners paint WebKit in software: a Duo or iPad profile gets a frame or two a
second there, so anything that moves does so in a few big steps, while scripts still
answer at once. Most timing races of the suite only show up like that. To see one here
before fixing it (and to prove the fix), slow the page down and repeat the test:

```sh
E2E_SLOW_FPS=2 pnpm e2e specs/date-on-hold.spec.ts:59 --project=duo-book --repeat-each=15
E2E_SLOW_FPS=1 pnpm e2e specs/live-tempo.spec.ts -g "two devices" --project=duo-open --repeat-each=15
E2E_SLOW_CPU=5 pnpm e2e specs/date-on-hold.spec.ts --project=android --repeat-each=15
```

- `E2E_SLOW_FPS=<n>`: the page draws only `n` frames a second (its animation frames wait).
- `E2E_SLOW_CPU=<rate>`: about `1/rate` of the CPU for the page. Chromium (`android`) uses
  the DevTools CPU throttle; WebKit has none, so its main thread is kept busy in bursts
  (`E2E_SLOW_CPU=5:200` sets the burst in ms).

Both are off unless set (`support/slow.ts`) and are never set in CI. What they showed so
far, and the rules that came out of it:

- After a tab press the screen before it is still there until its exit has played
  (`app.tab` waits for the new one, `support/tabs.ts`). The same goes for the steps of a
  wizard: wait for what the next step shows, not for "the screen stopped moving".
- One look (`isVisible()`, an `evaluate`) right after an action tells what was there in
  that instant. Use an assertion that waits (`expect(...)`, `expect.poll`).
- `locator.scrollIntoViewIfNeeded()` fails ("Element is not attached to the DOM") when the
  element it found is replaced meanwhile: make sure the screen it belongs to is the one
  on screen first.

The HTML report goes to `e2e/.report/` (`pnpm exec playwright show-report e2e/.report`),
traces and screenshots of failed tests to `e2e/.results/`.

## Device profiles

`support/devices.ts` defines one Playwright project per device the app supports:

| Project | Viewport | Engine | Runs |
| --- | --- | --- | --- |
| `phone-portrait` | 390×844, touch | WebKit | full set |
| `phone-landscape` | 844×390, touch | WebKit | `@smoke` |
| `android` | 412×915 (Pixel 7) | Chromium | `@smoke` |
| `ipad-landscape` | 1210×834, touch | WebKit | full set |
| `ipad-portrait` | 834×1210, touch | WebKit | `@smoke` |
| `duo-closed` / `duo-closed-landscape` | 466×678 / 678×466 | WebKit | `@smoke` |
| `duo-book` | 951×669, fold x 455–495 | WebKit | `@smoke` + `@duo-book` |
| `duo-laptop` | 669×951, fold y 455–495 | WebKit | `@smoke` + `@laptop` |
| `duo-open` | 669×951 | WebKit | `@smoke` |

The iPhone Duo postures are emulated through the same contract the native shell uses
(`window.__bwApplyRegions`, the `bwregions` event and the `--bw-*` CSS variables), so the
app takes its real Duo code paths without any test-only code.
The on-screen keyboard likewise: `support/keyboard.ts` fires the window events the
Keyboard plugin fires on iOS and Android (`keyboardWillShow`, `keyboardDidShow`, …) and
shrinks the viewport by the keyboard's height, as the native resize does.

Tags in test titles:

- `@smoke`: runs on every profile. Layout and privacy checks of the main screens.
- `@laptop`: runs only on `duo-laptop` (nothing may sit on the fold).
- `@duo-book`: runs only on `duo-book` (lifecycle paths that need its two panes).
- no tag: the full flow set, on `phone-portrait` and `ipad-landscape`.

## What every test gets (`fixtures.ts`)

- A fresh demo database per test (each test has its own browser context).
- Signed in as Leo M., admin of Velvet Static. `test.use({ role: 'member' })` makes him a
  member of the same band (and clears the offline cache, as a fresh member device would).
- The app language: `test.use({ lang: 'de' })`. `app.t('English text')` gives the text in
  the test's language, from the app's own locale files, so tests work in any language.
- A fixed clock (Mon 16 Nov 2026, 10:00, Europe/Rome), so the seed's relative dates and the
  "now" of the app always agree.
- The welcome tour already seen; the urgent pop-up and tours are dismissed whenever they
  get in the way.
- External hosts are stubbed (`support/network.ts`): place search returns
  "<query> Studios" and "<query> Hall", the weather is canned, everything else is blocked.
- `app.check(where)`: the page-health rules: no horizontal overflow, no control or heading
  off screen, no `undefined` / `NaN` / `[object Object]` / "Something went wrong" (in any
  language), no raw i18n keys, no uncaught JS errors and, on `duo-laptop`, no control on
  the fold. Every passing test runs it once more at the end.

## Add a test

1. Find the flow in [FLOWS.md](FLOWS.md). A new flow gets a row there first.
2. Write the test as the rule a user would state, e.g.
   `test('an empty lineup never invites the whole band', …)`. Click what a user clicks
   (roles and visible names via `app.t(...)`), and assert what they would see. Read the
   demo database (`app.readDb()`) only to prove something the screen can't show.
3. Call `app.check('…')` on every new screen you reach.
4. Use the helpers in `support/` (`openEvent`, `openCreate`, `openHub`, `systemBack`,
   `checkWholeScreen`, …) instead of new selectors where they fit.
5. Tag it `@smoke` if it is a layout or privacy check that must hold on every device.
6. A bug fix ships with a test that fails without the fix. A known bug is a normal test
   that fails until the fix lands: no `test.skip`, no `test.fixme`.
7. Run it on `phone-portrait` and `ipad-landscape` (and everywhere if it's `@smoke`).

No `data-testid` unless a control has no accessible name a user would recognise; then add
the missing `aria-label` instead, which helps screen readers too.

## Emulator check (Maestro)

A browser can't prove the native shell: the iOS WKWebView, the Android WebView,
Android's system Back, the on-screen keyboard. `scripts/emulator-check.sh` builds the demo
app of HEAD for the iOS simulator and the Android emulator and runs the Maestro flows in
[`maestro/`](../maestro/README.md) on an iPhone, an iPad and an Android emulator. Nothing
ships without it: `scripts/release-android.sh --publish` and `scripts/deploy-web.sh` (the
only way to deploy the web app) refuse a commit without a passing run and the Duo
postures signed off (`scripts/emulator-check.sh --duo-ok`). Which flows it covers:
[FLOWS.md › On emulators](FLOWS.md#on-emulators-maestro).

Order before any release: CI green → merge → `scripts/emulator-check.sh` on the merged
commit → Duo checklist → `--duo-ok` → deploy / builds / release.

## Manual-only

Some things only a real device can check (the hinge, the APK installer, push, the real
keyboard, Bluetooth stage sync). They are listed at the end of [FLOWS.md](FLOWS.md).
