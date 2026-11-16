# Screen map crawler

Maps every screen and layer of the demo app, per role and device, from the running app
(so it never drifts from the code), and flags dead ends. It is **not** part of the required
E2E suite: it runs nightly and on demand (`.github/workflows/screen-map.yml`) and uploads
the map as an artifact.

```sh
pnpm e2e:crawl                                   # every role on phone-portrait, ipad-landscape, duo-laptop, duo-book
CRAWL_PROFILES=phone-portrait CRAWL_ROLES=admin,member pnpm e2e:crawl
CRAWL_MINUTES=3 pnpm e2e:crawl                    # shorter time budget per role × profile
CRAWL_DOCS=1 pnpm e2e:crawl:report                # rebuild out/ + docs/screen-map from the runs already there
# more knobs (depth, clicks per state, resume, verbose log): see crawl.config.ts
```

It reuses the E2E set-up: the demo build served by `vite preview` (same `webServer`, port
`E2E_PORT`), the device profiles of `support/devices.ts` (Duo postures through the native
shell's region contract), the fixed clock, the stubbed network, `support/settle.ts`,
`support/health.ts` and the helpers that open events and the hub.

## Roles

| Role | How |
| --- | --- |
| `admin` | Leo M., admin of Velvet Static (the demo seed), plus one saved "New gig" wizard draft |
| `member` | the same account made a member, offline cache cleared (as `setRole('member')`) |
| `deputy` | Leo with no band of his own and the seed's deputy gigs for "The Late Shift": the **Deputy gigs** home of a claimed deputy |
| `noband` | Leo with no band and no deputy gigs: the onboarding |
| `signedout` | no demo session: welcome, sign in, create account, reset password |
| `client` | the public `/quote.html?t=demo&state=viewed\|discussing\|accepted\|declined\|expired` page (the dev-only demo quote) |

The deputy's own reply page (`/deputy.html`) and the venue's rider page (`/rider.html`) have no
demo token: they stay manual (see `e2e/FLOWS.md`).

## How it explores

- **Roots**: Home, Calendar, Chat, the Account hub, Create (+), the notifications inbox, the
  urgent pop-up, and each event type's detail (gig, rehearsal, quote, quote draft, personal gig,
  saved wizard draft). Deputy, no-band, signed-out and client start from their first screen.
- **State** = page path + active tab (or the screen's heading) + the stack of open layers
  (dialog / sheet / pane by kind and accessible name or first heading) + the selected tab in
  the top layer. Never pixels. Digits are normalised (counts, dates).
- **Controls**: every visible, enabled control that is on top (`elementFromPoint`, scrolled to
  the middle of its scroller first). Rows of identical markup (list rows, day cells) are
  sampled: two are clicked, the rest recorded as `sampled`. Text fields are recorded, not typed in.
- **Fresh copy**: before each click the crawler checks that the screen (signature, controls,
  their states and values) and the demo database match the recorded state. If not: one Escape,
  then (database untouched) close the layers and enter the root again, else restore the storage
  of the session, reload, enter the root and replay the path. `CRAWL_STRICT=1` reloads every time.
- **Never clicked** (recorded as `terminal: <kind>`): delete/remove, leave band, sign out,
  send/notify/publish, share/export/PDF, external links, Google/Apple, maps, `tel:`, `mailto:`,
  downloads, file pickers, and the client's Accept/Decline. As a safety net `window.open`, the
  share sheet and printing are swallowed in the page; a click that tried one is recorded as
  `terminal` too. The crawl never leaves the app origin (other hosts are blocked).
- **Back**: on every state, Escape and the browser's Back (the web build's system Back, the
  same chain as Android Back) are tried from a fresh copy, and compared with the visible
  Back / Close control.
- **Bounds**: `CRAWL_DEPTH` clicks from a root (default 4), at most 4 layers, 40 clicks per
  state, and a time budget per role × profile. A run that hits the budget is saved in
  `out/runs/` and **resumes** next time (`CRAWL_FRESH=1` starts over).

## Output (`out/`, git-ignored)

- `map.json`: every state (id, role, profile, area, title, the text the role reads, screenshot,
  actions `[{label, kind, to}]`, Back/Escape, page health, axe summary, findings), every finding
  and the coverage check. Self-describing: see its `about` field.
- `screens/<state id>.png`
- `mermaid/<profile>/<area>.<role>.mmd`
- `findings.md`: by severity, real bugs first, with repro steps and a suggested failing test.

`docs/screen-map/` holds the phone-portrait diagrams (GitHub renders them) and is refreshed with
`CRAWL_DOCS=1`. `out/sample/` is a small committed excerpt of `map.json`.

## Findings

| Kind | Rule |
| --- | --- |
| `privacy` | member or deputy state shows a client, client contacts, a gig price, a quote, band revenue or another musician's fee |
| `no-exit` | a layer that neither Escape, system Back nor a Back/Close control leaves |
| `back-mismatch` | system Back goes somewhere else than the visible Back/Close (or nowhere) |
| `dead-control` | a click with no new state, no content change, no toast, no request, no demo-database change (drag handles excluded) |
| `broken-state` / `empty-state` | `undefined`, `NaN`, raw i18n keys; a top layer with no text and no control |
| `layout` | the page-health check: overflow, controls off screen, controls on the Duo fold |
| `js-error` | an uncaught error or rejection after a click |
| `axe` | serious and critical axe-core violations (WCAG 2.0/2.1 A + AA), grouped by rule |
| `unreachable` | a lazy screen whose code was never loaded; screen components none of whose own texts were seen |

Every finding is checked against its screenshot and given a verdict in `triage.json`
(`"<kind>|<role>|<title>": { "verdict": "real" | "false-positive", "note": "…" }`, where
`<role>` is `*` for every kind except `privacy`, which is per role); verdicts
survive the next crawl. Real bugs get a failing test in their own PR (this crawler never fails
the build).

## Limits

- A state is the route plus the layer stack, so a click that only changes the content (a
  selected card, a filter, a revealed field) is recorded as `inplace` and the controls it
  reveals are not explored from there (for example the onboarding path cards, which reveal
  Continue).
- Text fields and selects are never filled, so screens behind a valid form (a saved gig, a sent
  quote) are reached only when the demo data already has them.
- Rows of the same kind (four or more with the same markup) are sampled: two are clicked, the
  rest are recorded as `sampled`.
- The outcome of a control met again on the same layer stack (or the same base screen) is
  reused (`inferred: true`), except Back / Close controls, which are always clicked.
- Depth and time are budgeted per role × profile; `complete: false` in a run means the budget
  ran out with states still queued (a later run without `CRAWL_FRESH=1` resumes it).
