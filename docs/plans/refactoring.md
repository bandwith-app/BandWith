# Refactoring the largest files: operational plan

Status: **plan only, no code.** Written 2026-11-21, on top of `main` 2f3a9ef (#241). Line numbers below are from that commit and will drift; re-read the file before each PR.
**When:** before the official release, after the site, SEO and Academy sessions active today have merged (§10). Nothing here starts without the user's go.

Contents

1. Summary
2. Goals and non-goals
3. What we start from (measured 2026-11-21)
4. Order, dependencies and parallel sessions
5. Rules for every PR
6. Phase 0: baseline and tools (R0) + dead edge functions (ops)
7. Phase 1: `AuthenticatedApp.tsx`, alone (A1–A6)
8. Phase 2: three parallel sessions (Q, E, C)
9. Phase 3: hooks hygiene, `useData.ts`, the lint rule (H1–H3, V1)
10. When to run it
11. Verification gate per PR
12. Performance check (before / after)
13. Estimates
14. Rollback
15. Found during the analysis (not fixed by this plan)
16. Appendix: the 45 `exhaustive-deps` disables

---

## 1. Summary

- Six components hold 19,475 lines and most of the merge conflicts between parallel sessions. In the last 30 days `AuthenticatedApp.tsx` changed in **141 commits**, `EventDetail.tsx` in 79, `CreateEventModal.tsx` in 49, `QuoteCreationWizard.tsx` in 45, `RehearsalCreationWizard.tsx` in 41 and `BandPricingModal.tsx` in 22.
- The plan splits them **without changing behaviour or UI**. The work is **20 PRs (+1 optional) in 4 phases**:
  - **Phase 0:** one PR adds the baseline and tooling. In the same window the main session deletes the three dead edge functions (with the user's OK).
  - **Phase 1:** `AuthenticatedApp.tsx` is split **first and alone**, in 6 sequential PRs, from 5,103 lines to about 900.
  - **Phase 2:** **three parallel sessions** take the other five files. Each session owns disjoint files: quotes (4 PRs), event detail (3 PRs), create gig + rehearsal wizard (3 PRs).
  - **Phase 3:** hooks hygiene and the `useData.ts` split, then `react-hooks/exhaustive-deps` turned on as an error.
- **Time:** about **18–24 session-days of effort**, or **12–15 working days of wall-clock** with the parallel phase. That is more than the rough 1.5–3 days of the 11-21 review, because every PR writes characterization tests first and passes the full device gate (§11).
- **Short path, if time is tight (about 5–7 days of effort):** R0, A1, A2, A3, then Q1, E1 and C1. This moves every pure function and every save/RSVP service out of the components. Those are the lines most often edited at the same time, so it removes most of the conflicts.
- **The 45 `exhaustive-deps` disables silence a rule that is not turned on.** `eslint.config.js` enables only `rules-of-hooks`. With the rule on:
  - The disables sort into **12 safe to fix** (2 are stale and can simply be deleted), **4 risky** and **29 intentional**.
  - **59 more warnings** appear that no comment covers. 23 of them are in `useData.ts`.
  - Phase 3 fixes this and turns the rule on.
- **The three dead edge functions** (`make-server-c689d939`, `create-checkout`, `stripe-webhook`) have **no caller** in the repo:
  - none in the app, site, Academy, native shells or scripts;
  - none in any migration's `net.http_post`;
  - none in `supabase/config.toml`.
  Only the production check (invocation logs, Stripe webhook endpoints) is left before deleting them (§6.2).

## 2. Goals and non-goals

Goals
- Make each of the six files a thin **orchestrator** (≤ ~400 lines; `AuthenticatedApp.tsx` ≤ ~900). It calls named hooks and renders named sub-components.
- Move **pure logic** (money, dates, titles, payload builders, list mapping) into `src/lib`, with table tests.
- Remove dead code and unused imports, which the analysis listed (§15).
- Leave the codebase so two sessions rarely need the same file: one concern per file.
- End with `react-hooks/exhaustive-deps` enforced. Every remaining disable carries a `--` reason.

Non-goals (hard rules)
- **No behaviour or UI change.** That means the same DOM structure where CSS depends on it, the same z-indices, the same texts, the same network calls in the same order, and the same toasts.
- **No new features and no bug fixes inside a refactor PR.** A bug found while moving code goes to §15 and becomes its own PR with a failing-first test.
- **No "unifying" of look-alike code whose output differs.** Examples:
  - the quote composer's paper lines vs `quotePdf.ts` vs `quoteLinks.ts`;
  - the wizard's recurrence vs `recurrenceOf`;
  - the wizard's duration vs `windowSpan`;
  - CreateEventModal's edit fields vs `OverviewEditSheets.tsx` (`w-14` vs `w-16`, `min=0`);
  - the two recurrence expansions in `AuthenticatedApp.tsx`.
  These stay separate. Where a merge is attractive it is listed in §15 for later.
- No React 19 upgrade (`useEffectEvent` is not available on 18.3.1), no router, no state library, no new dependencies.
- No change to `site/`, `academy/`, `supabase/`, migrations or edge functions. No `[deploy]` in any commit. Releasing stays manual.

## 3. What we start from (measured 2026-11-21)

### 3.1 The six files

| File | Lines | State / refs / effects | Imported by | Unit tests | e2e that reach it |
|---|---|---|---|---|---|
| `src/app/AuthenticatedApp.tsx` | 5,103 | 78 `useState`, 28 refs, 39 effects | `src/app/App.tsx` (`lazy`) | none. `planLimitWiring.test.ts` reads it `?raw` and expects **exactly one `<PlanLimitSheet`** | every spec |
| `src/app/components/quotes/QuoteCreationWizard.tsx` | 3,712 | 80 `useState`, 5 refs, 6 effects | `AuthenticatedApp` (`lazyLayer`), `dashboard/expanded/QuotesExpanded.tsx` (**static**) | **none** | `create-wizards`, `xstate-lifecycles` (quote), `fold-layers` |
| `src/app/components/dashboard/CreateEventModal.tsx` | 3,056 | 33 `useState`, 9 refs, 8 effects | `AuthenticatedApp` (`lazyLayer`) | `CreateEventModal.hooks` (1), `.save` (8) | `create-wizards`, `fold-layers`, `unsaved-changes` |
| `src/app/components/dashboard/EventDetail.tsx` | 3,031 | 28 `useState`, 6 refs, 10 effects | `AuthenticatedApp` (**static**) | `EventDetail.calendar` (2), `.devicePass` (12), `.hooks` (1), `.overviewEdit` (4), `.setlist` (1), `.setlistEdit` (3) | `event-edit`, `rsvp`, `rider-stage`, `stage-*`, `member-readonly`, `xstate-lifecycles`, `layers-back` |
| `src/app/components/rehearsal/RehearsalCreationWizard.tsx` | 2,498 | 25 `useState`, 4 refs, 4 effects | `CreateEventModal.tsx` only (static) | **none** (the CreateEventModal tests never open a rehearsal) | `create-wizards`, `fold-layers`, `rehearsal-*` |
| `src/app/components/quotes/BandPricingModal.tsx` | 2,075 | 19 `useState`, 4 refs, 3 effects | `AuthenticatedApp` (`lazyLayer` + type `PricingModalTabType`) | **none** | `settings` (Pricing: every tab, Save) |

What else depends on these files' names and text, so a split must not break it:
- **`vi.mock` paths.** The component tests mock these modules: `@/lib/services/events`, `songs`, `eventTasks`, `pricing`, `wizardDrafts`, `setlistNotify`, `@/app/components/event/useEventMembers`, `ui/WeatherWidget`, `ui/VenueAutocomplete`, `@/lib/BandContext`, `@/lib/supabase`, `@/lib/haptics`, `nativeFiles` and `memberCalendar`. Moved code must keep importing those exact module paths, or the mocks stop applying and the tests hit the real module.
- **`src/lib/academy.test.ts`** scans every source file for `<AcademyHelpButton article=…>` and `article: '…'`. Moved JSX keeps the attribute literal.
- **The screen-map crawler** (`e2e/crawl/lib/report.ts`) names lazy chunks after the module basename in `lazy(() => import('…'))` / `lazyLayer(…)`. Entry files keep their names and paths.
- **`e2e/models/*.model.ts`** quote source locations in `source:` strings (for example `'EventDetail.tsx canEditOverview'`). When the code moves, update the strings and run `pnpm e2e:models:docs`. CI runs `--check`.
- **`e2e/specs/create-wizards.spec.ts`** finds controls by accessible name ("New quote", "Client full name", "Close quote wizard" and so on). Labels stay byte-identical.

### 3.2 Other files over ~1,500 lines

| File | Lines | Verdict |
|---|---|---|
| `src/app/hooks/useData.ts` | 1,658 | **Add (H2).** 24 data hooks in one file; 23 of the 59 un-covered `exhaustive-deps` warnings. Only 2 importers (`AuthenticatedApp`, `AnalyticsView`). A mechanical split behind a barrel is low risk. |
| `src/app/views/EventsView.tsx` | 1,641 | **Optional (V1).** 43 commits in 30 days, about 200 lines of pure calendar helpers (`getEventTags`, `calendarKind`, `formatEventDate`, `getEventWarnings` …) at the top. |
| `src/lib/demo/demoClient.ts` | 1,745 | Not a target. It is the e2e fake backend and works as one table-driven module. Revisit only if it keeps conflicting. |
| `src/lib/i18n/*` locales | large | Not targets; large by nature. Their bundling is a performance follow-up (§12.4). |
| `src/lib/services/chats.ts`, `notifications.ts` (1.3–1.4k) | | Not targets. They are flat lists of service functions, not components. |

## 4. Order, dependencies and parallel sessions

```
Phase 0   R0 (baseline + tools)          ops: delete 3 dead edge functions (main session, user OK)
             │
Phase 1   A1 → A2 → A3 → A4 → A5 → A6     one session, AuthenticatedApp.tsx alone
             │
Phase 2   ┌ Q1 → Q2 → Q3 → Q4   session Q: quotes
          ├ E1 → E2 → E3        session E: event detail          (all three in parallel)
          └ C1 → C2 → C3        session C: create gig + rehearsal wizard
             │
Phase 3   H1 ∥ H2 → H3 (+ V1 optional)    hooks hygiene, useData split, rule on
```

Why `AuthenticatedApp` goes first and alone:
- It renders the other five files and passes them about 60 props: toasts, refetchers, `navigateToEvent`, `onCreate`, `onSave`.
- A3 moves the save/RSVP/quote-create handlers that those props call, and A6 moves the JSX that mounts them.
- If phase 2 ran at the same time, every phase 2 PR would rebase against moving prop wiring.
- After A6 the props of the five components are frozen, and the three phase 2 sessions only touch their own files.

During phase 1 **no other session edits `AuthenticatedApp.tsx`**, and the five other targets take no feature work. A fix that cannot wait lands on `main`, and the refactor session rebases.

### 4.1 File ownership in phase 2 (no two sessions touch the same file)

| Session | Owns (may create or edit) | Must not edit |
|---|---|---|
| **Q** (quotes) | `src/app/components/quotes/QuoteCreationWizard.tsx`, `BandPricingModal.tsx`, new `quotes/wizard/**`, `quotes/pricing/**`; `src/lib/services/pricing.ts`, `quoteMath.ts`, new `src/lib/services/quoteDraft.ts`; `src/lib/i18n/docLanguage.ts` (new, read by `QuoteShareModal` only in a later PR) | `QuoteShareModal.tsx`, `BalanceRequestSheet.tsx`, `quotePdf.ts`, `quoteLinks.ts`, `src/app/data/quotes.ts` (read only) |
| **E** (event detail) | `src/app/components/dashboard/EventDetail.tsx`, new `src/app/components/event/detail/**`, **`src/app/components/event/format.ts`** (only E writes it), new `src/lib/eventSetlist.ts`, `src/lib/eventAddress.ts` | `event/edit/OverviewEditSheets.tsx`, `event/rider/*`, `StageMode.tsx`, `useStage*.ts` |
| **C** (create) | `src/app/components/dashboard/CreateEventModal.tsx`, `rehearsal/RehearsalCreationWizard.tsx`, new `event/create/**`, `rehearsal/wizard/**`; new `src/lib/lineupFees.ts`, `eventFormWarnings.ts`, `eventCategory.ts`, `eventTitle.ts`, `eventDraftPayload.ts`, `gigForecast.ts`, `rehearsalWizard.ts`; `src/lib/setlistSets.ts` | `event/format.ts` (C keeps its duration/time formatters in `event/create/format.ts`), `RehearsalPollModal.tsx`, `OverviewEditSheets.tsx` |

Shared new helpers (`useLatest`, `useResetOnOpen`, `perfProbe`) are written once in R0, before the split, so no session creates them.
`src/lib/dates.ts` and `src/lib/currency.ts` are **read-only** in phase 2. A session that needs a new date helper keeps it next to its own code. H1 can move it later.

Each session works in its own worktree (`~/Developer/BandWith-worktrees/refactor-<q|e|c>`), opens one PR at a time, and waits for the main session to merge it before the next PR in its chain.

## 5. Rules for every PR

1. **Move first, then reshape.** Each extraction is a verbatim move first, with the same code under a new name and explicit inputs. Review it with `git diff --color-moved=dimmed-zebra --color-moved-ws=allow-indentation-change`; any line that is not dimmed is explained in the PR body.
2. **Characterization tests come first, in their own commit, green on the old code.**
   - They import the **public entry** (for example `@/app/components/quotes/QuoteCreationWizard`), so they survive the move unchanged.
   - The PR shows they pass before the move commit and after it.
   - (The failing-first rule is for fixes. For a refactor, the rule is the same tests green before and after.)
3. **Keep every entry path and export name.** `AuthenticatedApp` lazy-loads named exports (`m.QuoteCreationWizard`, `m.CreateEventModal`, `m.BandPricingModal`), and the crawler keys chunks by file name. The old file stays the entry; it does not become a one-line re-export of a new deep file.
4. **Hooks are called in the same order, before the same early returns.** Known early returns:
   - `CreateEventModal` (member opening a quote; rehearsal hand-off);
   - `EventDetail` (line 854);
   - `QuoteCreationWizard` and `RehearsalCreationWizard` (`if (isEditing)` return);
   - `BandPricingModal` (`useSystemBack` before the early returns).
   Writes to refs during render stay in render, in the same place.
5. **Extracted components live at module scope.** A component defined inside a parent's body remounts on every render, and inputs lose focus (`TimePicker`, `VenueAutocomplete`, the quote review drawer, which is why `renderReviewDrawer` is still a function today).
6. **Same DOM where CSS depends on it.** Fragments are fine; new wrapper `div`s are not, unless the PR proves no selector targets that level. Known structural selectors:
   - `.bw-ed-hero > div > :nth-child(2)`;
   - `.bw-ed-sheet > div`;
   - the `columns-2 [&>*]` overview grid;
   - `.bw-fold-form > :first-child / :last-child` and `:has(> .flex-1.overflow-y-auto)`;
   - `.bw-edit-head/-cta/-sub`, `bw-pane-detail`, `.bw-event-detail`;
   - `data-modal-open`, `data-wizard-type`, `data-bw-composer`, `data-bw-wide`.
   The same holds for `AnimatePresence` keys and for DOM order in `AuthenticatedApp`, where stacking relies on it.
7. **Portals and z-indices are unchanged.**
   - `BwSheet` portals to `body` with z 106, 110 and 120 (`layerZ`).
   - `BandPricingModal` portals to `body` at z-130.
   - The quote composer sheet is at z 106.
   - Every layer inside a hub keeps portalling to `body` (the Duo rule).
8. **Small PRs.** About 400–1,200 moved lines each, mergeable alone, with no half-moved feature.
9. Each PR body lists the moved symbols (old line range → new file), the tests added, the devices checked and the perf numbers (§12).

## 6. Phase 0

### 6.1 R0: baseline and tools (one PR, 0.5 day)

Scope (test and tooling code only; nothing user-visible):
- `scripts/bundle-report.mjs`: reads `dist/` after `pnpm build` and prints JSON with:
  - every JS/CSS asset, raw / gzip / brotli;
  - an "initial" group (the entry from `dist/index.html` plus every `modulepreload` and stylesheet it links);
  - an "app shell" group (the `AuthenticatedApp-*` chunk).
  Test: `scripts/bundle-report.test.ts` on a fixture `dist`.
- `src/lib/perfProbe.tsx`: `<PerfProbe id="…">` wraps `React.Profiler` only when `import.meta.env.VITE_PERF_PROBE === '1'`. It counts commits and `actualDuration` into `window.__bwRenders`. Otherwise it renders its children and is dead-code-eliminated; R0 proves the string `__bwRenders` is absent from a normal `pnpm build`. It wraps:
  - the root of `AuthenticatedApp`;
  - `HomeView`;
  - `EventDetail`;
  - `CreateEventModal`;
  - `QuoteCreationWizard`;
  - `RehearsalCreationWizard`;
  - `BandPricingModal`.
- `e2e/perf/renders.spec.ts` with its own config, `e2e/perf.config.ts`. It is not a required check. It runs the scenarios in §12.2 on the demo build with the probe on, and writes `e2e/.perf/<sha>.json` (git-ignored, like `e2e/.report/`).
- `src/lib/hooks/useLatest.ts` and `src/lib/hooks/useResetOnOpen.ts`, with unit tests. They are unused until phase 1/3, so they add no behaviour now.
  - `useLatest(value)` returns a ref that is updated during render.
  - `useResetOnOpen(open, reset, key?)` keeps `reset` in a ref, runs it when `open` or `key` changes, and passes its cleanup through.
- Record the baseline: the bundle report and the render numbers for that commit, plus a full `pnpm e2e:crawl` map, attached to the PR (as a comment and the crawler artifact). They are not committed.
- Tag the merge commit `refactor-baseline` (a lightweight tag, not pushed as a release).

Tests that must stay green: the whole suite (nothing changes).

### 6.2 Ops: delete the three dead edge functions (main session, with the user's OK)

Repo side, checked 2026-11-21:
- **No code in the repo calls them.** That covers `src/`, `site/`, `academy/`, `public/`, `scripts/`, `ios/`, `android/`, every `supabase/migrations/*.sql` `net.http_post` URL, and `supabase/config.toml`.
- The functions the repo does call are `send-push`, `send-email`, `places`, `member-calendar`, `deputy-calendar`, `setup-invite-rls`, `invite-member` and `delete-account`.
- History: `make-server-c689d939` comes from the original generated scaffold (`supabase/functions/server/` in 5a4013e). `create-checkout` and `stripe-webhook` never existed in this repo.
- `docs/KEY_ROTATION_2026-11.md:45` already lists the delete commands.

Left to do in production, which is not a code PR:
1. In the Supabase dashboard, open Edge Functions and check each function's Invocations and Logs for the last 30 days. Expect zero; any hit means stop and find the caller.
2. In the Stripe dashboard, open Developers → Webhooks (both live and test mode) and confirm no endpoint points at `…/functions/v1/stripe-webhook`. If one does, disable it first.
3. Keep a copy: `supabase functions download <name>` into a private folder outside the repo.
4. `supabase functions delete make-server-c689d939`, then `create-checkout`, then `stripe-webhook`.
5. Re-run the CI e2e and a Maestro `smoke` to prove nothing moved.

Rollback: redeploy the downloaded copy. Time: about 30 minutes. It removes three functions that still hold the legacy service-role key. This is independent of every code PR and can happen any time the user agrees.

## 7. Phase 1: `AuthenticatedApp.tsx`, alone

New folder `src/app/shell/` holds the hooks and components that only the app shell uses. Pure functions go to `src/lib`.

### A1: pure logic out, dead code removed (≈ −750 lines, 1 day)

**Moves**

| Code (at 2f3a9ef) | New home |
|---|---|
| `mapEventStatus`, `eventToEventItem` (194–251), `isQuoteLike` (808, 1125) | `src/lib/eventItem.ts` |
| `toUiBand` / `toUiBands`: the `selectedBand` memo (1434–1469) and the `realBands.map(… as Band)` repeated at 3956, 4066, 4124 | `src/lib/bandOption.ts` |
| `toInboxItems(realNotifications, locale)`, `dedupeInboxNotifications` (the same key at 1386 and 1640), `relativeTime` | `src/lib/inboxItems.ts` |
| `toChatItems(realChats, realBands, userId, onlineUserIds, locale)` (1669–1788) | `src/lib/chatList.ts` |
| `expandRehearsals` (1826–1899), `computeMemberStats` (3674–3741), `computeDashboardData` (3743–3911) | `src/lib/homeDashboard.ts`, next to `memberStats.ts`. Keep the two recurrence expansions separate; they differ. |
| `buildCalendarEvents` (drafts merge, 949–1021) | `src/lib/calendarEvents.ts` |
| `personName({ full_name: profile?.full_name ‖ user.user_metadata?.full_name, email })`, written out 8 times | `myDisplayName(profile, user)` in `src/lib/personName.ts` |

**Dead code to delete**
- The unused imports `Loader2`, `useUpcomingEvents`, `useQuotes`, `inviteToEvent`, `USER` and `BandWithMembers`.
- `localNotifications` / `setNotifications` and `permissions` / `userRole`.
- `localEvents` / `setLocalEvents`: only `handleRehearsalDecline` writes to it and nothing renders it. Delete the write too, and prove with the rehearsal-decline e2e that nothing changes.

**Disables that go away:** L1428 and L1468. The `locale` dependency becomes a real argument of `toInboxItems` / `toUiBand`.

**Keep as they are:** `toUiBand` still lists `user` (it changes only identity) and the unused memo deps at 1788 and 3741. Their removal waits for H3, so this PR does not change memo identity.

**Characterization tests first:** a table test per new module, built from the demo seed (`src/lib/demo/seed.ts`):
- the event status matrix;
- chat list ordering, unread counts and the online dot;
- the inbox de-dupe;
- dashboard numbers for admin and member;
- a recurring rehearsal expanded over a month boundary;
- calendar drafts merged with quotes.
Each case is computed from the old inline code before the move (the first commit adds the module as a verbatim copy plus its tests; the second commit switches `AuthenticatedApp` to it and deletes the inline copy).

**Must stay green:** all unit tests, `home-calendar`, `chat`, `i18n`, `member-readonly`, `xstate-lifecycles`.

**Risk:** low. The one trap is memo identity: keep each `useMemo` with the same deps and only call the pure function inside it.

### A2: shell hooks (≈ −500 lines, 0.5–1 day)

| Hook / component | From | Notes |
|---|---|---|
| `useSaveToast()` + `<AppToast>` | 434–454, 5035–5098 | returns `[saveToast, setSaveToast]`. The 68 call sites keep `setSaveToast`; no context yet. |
| `useNativeShell({ isNative, refetchChats, refetchNotifications })` | 279–319, 565–579, 663–670 | keyboard and system bars, push init, badge, badge on resume, refetch on resume. Keep the effect order. |
| `useAndroidUpdateToast(setSaveToast)` | 456–494 | |
| `useHeaderScroll(activeTab)` | 325–358, 377–383 | create the refs in the same order. |
| `useEntityCounts(bandId, flags)` | 1918–1972 | the 9 count queries, same order. |
| `useBandSwitchPrompt(selectBand)` | 1224–1265 | `askBandFor`, `inItemBand`, `chooseBandSwitch`. |
| `useEventMembersMap(masterEventsList, realBand, userId)` | 677–693, 708–786 | returns the setter too: `handleEventCreate` writes the same cache key (3492). |

**Characterization first:**
- `renderHook` tests for `useHeaderScroll` (thresholds), `useEntityCounts` (query list, with mocked `supabase` and exact `.from()` / `.select()` calls) and `useEventMembersMap` (cache seed, then fetch).
- e2e: `settings.spec.ts` already checks a save toast. Add one assertion that a failed save shows the error toast, using a demo refusal.

**Must stay green:** everything above, plus `min-version`, `plan-limits`, `duo-rail`. On a device, Maestro `smoke` and `mark-all-read` (badge and resume).

**Risk:** low.

### A3: mutations out of the shell (≈ −900 lines, 1.5–2 days)

This is the largest single gain: these handlers are where parallel sessions collide most.

| Service (in `src/lib/services/`) | From |
|---|---|
| `eventSave.ts` `saveEventFromWizard(input, deps)` | `handleEventCreate` 3190–3664 (475 lines: gig, rehearsal, recurring, personal gig, quote-linked, offline queue, members cache) |
| `eventSave.ts` `editEvent`, `deleteEvent`, `saveLinkedQuote` | `handleEventEdit` 2578–2657, `handleEventDelete` 2705–2760, `handleLinkedQuoteSave` 2660–2703 |
| `quoteCreate.ts` `createQuoteFromWizard(quote, opts, deps)` | the inline `onCreate` of `QuoteCreationWizard`, 4454–4619, and the `withTimeout` race duplicated at 3523 / 4525 (one helper, same timeout) |
| `quoteConvert.ts` `confirmQuoteAsGig`, `revertGigToQuote` | `handleConfirmQuote` 2807–2869, `handleRevertQuote` 2871–2928 |
| `rsvp.ts` `respondToInvite(kind, event, deps)` | `handleEventAccept` 3019–3085, `handleEventDecline` 3112–3183, inbox `onAction` 4700–4754, RSVP sheet `onAccept` / `onDecline` 4896–4969, `settleInviteNotifications` 3011 |

- The services return a result (`{ ok, toast?, optimistic? }`). The shell keeps the toasts, optimistic hides and refetches, in a thin `src/app/shell/useEventMutations.ts`.
- `deps` carries `supabase`, `isOnline`, `realBand`, `user`, `profile` and the offline queue. Nothing is read from module scope that wasn't before.
- Services import the same module paths the tests mock (`@/lib/supabase`, `@/lib/services/events` …).

**Characterization first** (commit 1, green on the old shell):
- e2e, new `e2e/specs/event-save.spec.ts`. On `phone-portrait` + `ipad-landscape`, as admin:
  - create a gig, a weekly rehearsal (3 occurrences visible), a personal gig and a quote, then check each appears on Calendar and Home with the right toast;
  - edit a gig's fee, then delete a gig, with Undo where it exists;
  - create a gig **offline** (`context.setOffline(true)`), then go online and check it syncs once;
  - confirm a quote as a gig, then Undo.
- `rsvp.spec.ts` and the `xstate-lifecycles` RSVP and quote paths already cover accept / decline / maybe and the inbox actions. Check they run on both profiles.
- After the move (commit 2), unit tests for each service with a mocked `supabase` assert the exact sequence of `.from(table).insert/update/delete` calls and payloads for each case above. They are written against the moved code and compared with a recorded call log from the e2e run on the old code. The log comes from the demo client: `app.readDb()` before and after.

**Must stay green:**
- unit: `CreateEventModal.save`, `planLimitWiring`, every `src/lib/services/__tests__`;
- e2e: `create-wizards`, `rsvp`, `quote-balance`, `plan-limits`, `xstate-lifecycles`, `event-edit`.
- Device: Maestro `rsvp-reopen`, `role-change-cache`, `member-no-client`.

**Risk:** medium. The closures read `isOnline`, `realBand`, `user` and `profile` at call time, so they are passed in per call, not captured at hook creation.

### A4: layer state (≈ −300 lines, 1–1.5 days)

| Hook | From | Notes |
|---|---|---|
| `useHubPages()` | 1481–1529, 1578–1590, 1997, 2051–2062 | one `useReducer` for the 15 hub flags (`showBandMembers`, `showSetlistManager`, `showSettings` + `settingsInitialSection`, `showAnalytics`, `showInventory`, `showContracts` + `contractPrefill`, `showTaskTemplates`, `showPastEvents`, `showDeputyGigs` + `deputyGigsFocus` …), with `open(page, payload)`, `closeAll()` (old `closeHubPages`), `hubOpen` and `analyticsOverlay`. The setters become thin wrappers so call sites read the same. |
| `usePushNavigation({ navigateToEvent, closeLayersFor, hub, … })` | 1298–1369 | the `push-navigate` window event (dispatched by `usePushNotifications.ts:178` and `notificationRouting.ts:126`). |
| `useDuoPaneRules({ twoPane, selectedEvent, hubOpen })` | 1990–2036 | the `data-bw-chat-over-event` attribute, the tablet hub clearing the detail, and the Duo identity opening the profile editor. Keep effect order. |

**Also:** delete `isControlDeckOpen` and `toggleControlDeck`. The flag is never set to true but feeds `isMenuOpen`, the scroll lock, the back chain and the counts effect, so remove it in this PR, where all its readers are touched. Delete the stale disable at L2003. Fix L2020 by adding `selectedEvent?.band_id`, which is safe: the ref guard returns early.

**Characterization first:**
- New `e2e/specs/push-navigate.spec.ts`. For each push type in `notificationRouting.ts` (gig, rehearsal, poll, chat, contract, deputy, quote, payout), dispatch `push-navigate` from the page and assert the screen that opens and which layers closed. Run it as admin and member.
- `hub-layers-laptop` and `layers-back` must already pass.

**Must stay green:** `layers-back`, `hub-layers-laptop`, `duo-rail`, `rail-profile-on-top`, `fold-layers`, `settings`. On the Duo sim, every hub page in every posture.

**Risk:** medium. Many readers. Grep for every `setShow…` before and after; the counts must match.

### A5: navigation core (≈ −500 lines, 1.5 days, highest risk)

| Hook | From |
|---|---|
| `useEventNavigation()`: `navigateToEvent`, `explainMissingEvent`, `closeSelectedEvent`, `openEventCard` / `handleEventCardClick`, the return refs (`eventReturnTabRef`, `eventReturnChatRef`, `contractsReturnRef`), `stageOnOpen` / `feeOnOpen`, the open-event sync (851–866) | 1051–1219, 2931–2965, 2962 |
| `useHomeAutoDetail()` | 2967–2998, using `homeAutoDetail.ts` |
| `useBackNavigation(layers)`: `backNavStateRef`, `backChainRef` (rebuilt every render), `setAppBack`, native `backButton`, web `popstate` | 2273–2576 |

**Disables:**
- L866: hoist `eventKeyOf` (L403, pure) to module scope and read `selectedEventRef.current`, assigned in render. Deps stay `[events, openEventKey]`.
- L2997: call `handleEventCardClickRef.current(next)` instead.
- Both are behaviour-neutral and drop their disables.

**The back chain's order is its precedence.** Move it as one block, with its array literal byte-identical, and pass it a single `layers` object built in the shell.

**Characterization first:** new `e2e/specs/back-precedence.spec.ts`. One test per pair of stacked layers that can coexist:
- event over chat;
- notification detail over inbox;
- Create menu over Home;
- hub page over event (tablet);
- contract form opened from a gig;
- calendar search over Calendar;
- Stage mode over event;
- each wizard with a leave sheet.

Each test presses system Back, then Escape, then the screen's own Back, and asserts the order the layers close. Run it on `phone-portrait`, `ipad-landscape`, `duo-book` and `android`.

**Must stay green:** `layers-back`, `unsaved-changes`, `event-edit` (the Back returns from Contracts), `stage-*`, `home-calendar`. Maestro `android-back`, `contracts-back`, `pinned-topbar`.

**Risk:** high. The refs are assigned during render and read across effects. The move must keep those assignments above the effects that read them. If the characterization spec shows any flakiness on `main`, fix the spec before moving anything.

### A6: JSX split and the shell context (≈ −1,100 lines, 1–1.5 days)

**Context**
- `src/app/shell/AppShellContext.tsx` provides `toast` (`setSaveToast`), `refetchAll` (events + dashboard), `navigateToEvent`, `askBandFor` / `inItemBand` and the layout flags (`twoPane`, `wideLayout`, `rail`).
- Children that receive these as props keep their props in this PR. The context is only for the new shell components, so no child component changes.

**Components** (all in `src/app/shell/`)

| Component | From |
|---|---|
| `AppTabViews` | HomeView / ChatView / EventsView inside `AnimatePresence`, 3978–4056 |
| `ExpandedCards` | 4130–4153, with the inline empty-rehearsal card |
| `AppHubLayers` | the `Suspense` block, 4209–4757 |
| `AppOverlays` | chat detail, NewChat, EventDetail, BandSwitchPrompt, load-error screen, RSVP sheet, poll vote sheets, urgent popup, 4759–5024 |

- `lazyLayer` moves to `src/app/shell/lazyLayer.tsx`. Its import strings stay identical, so crawler chunk names stay the same.
- **`<PlanLimitSheet` stays in `AuthenticatedApp.tsx`.** `planLimitWiring.test.ts` counts it there. So do `MapsChooserHost`, `OfflineBanner` and the toast, which are mounted once at the top.
- DOM order and `AnimatePresence` keys are unchanged. Stacking relies on order (chat z80 under event z90).

**Characterization first:** the crawler baseline from R0 is the reference. After the PR, `pnpm e2e:crawl` must show the same screen and state count per role and profile, the same lazy chunks loaded, and no new findings. Then do a visual spot check of the crawler screenshots of Home, Calendar, Chat, a gig and each hub page.

**Must stay green:** the full e2e set on all 10 profiles (not only `@smoke`), lifecycles, the crawler, and the full emulator pass.

**Risk:** medium. Mostly prop plumbing; `tsc` catches most mistakes.

End of phase 1: `AuthenticatedApp.tsx` ≈ 900 lines (state wiring, hooks, top-level JSX). Run the full §11 gate and the perf check, and tag `refactor-phase-1`.

## 8. Phase 2: three parallel sessions

These start only after A6 is merged. Ownership is in §4.1.

### Session Q: quotes (4 PRs)

**Q1. Pure pricing and quote logic (0.5–1 day)**

Moves:
- To `src/lib/services/pricing.ts`:
  - from `QuoteCreationWizard`: `getEventMonthFromDate` (128–136), `calcMusicianAutoFee` (138–157), `computeLineupBase` (675–695), `servicePrice` / `getServiceAutoQty` (1264–1280, with unit and counts as arguments), the production-fee fallback (`pro‖600 / standard‖300`, 810, 2246, 2272) and the step-fee fallback chain (1379, 1417);
  - from `BandPricingModal`: `inferPerformanceTypeFromCount` (96), `activeFullPackage` (435–442), `marginDivisorFor(type, value)` (574–607) and the new-package factory (548–563).
  - The wizard's inline count → type code (753–761, 1224–1231) is identical to `inferPerformanceTypeFromCount` and calls it. Prove it with a table over 1–12 musicians.
- To `src/lib/services/quoteMath.ts`: `computeDraftTotals(draft)` (1045–1086), the `effective*Fee` helpers (1026–1042) and `computePackageOption` (1305–1350).
- To the new `src/lib/services/quoteDraft.ts`:
  - `initialDraftFromQuote(initialData, …)` (515–672);
  - `buildQuoteFromDraft(draft, totals, settings)` (1472–1564);
  - `effectiveTitle` (1119–1133) and `validUntilDate` (1088);
  - `canProceed` / `maxAccessibleStep` (1135–1153);
  - `draftSnapshot` (3106–3110).

**Characterization first** (on the old components, RTL, with the same mocks as the `CreateEventModal` tests):
- New `src/app/components/quotes/__tests__/QuoteCreationWizard.create.test.tsx`:
  - three create paths (flat package, preset lineup with an edited musician fee, roster plus travel by km), asserting the exact object passed to `onCreate` with `toEqual`;
  - an edit path;
  - the totals shown on the review step.
- New `BandPricingModal.save.test.tsx`: change one field on each of the 5 tabs, Save, and assert the payload given to the mocked `pricing` service.
- Then `quoteDraft.test.ts` and table tests for every moved function.

Must stay green: the above, plus `quoteMath`/`pricing` tests, `create-wizards`, `settings`, `xstate-lifecycles` (quote), `quote-balance`.
Risk: low.

**Q2. `BandPricingModal` split (0.5–1 day) → `src/app/components/quotes/pricing/`**
- `primitives.tsx`: `Section`, `SettingRow`, `ToggleRow`, `NumberPill`, `Stepper`, `Segmented`, `CheckDot`, `SelectPill`, `unitLabel`, `shownPrice`, `categoryLabel`.
- `useBandPricingDraft.ts`: the load effect (331), save/reset, the patch handlers (498–686) and the `bw:band-pricing-saved` event (519), which `QuoteShareModal.tsx:177` listens for.
- `useSignatureCanvas.ts` (381–433) and `PricingSampleStrip.tsx` (444–471, 702–759).
- `tabs/RatesTab.tsx`, `ServicesTab.tsx`, `TravelSoundTab.tsx`, `RulesTaxTab.tsx`, `BrandingTab.tsx`. Tabs get `settings` and `setSettings` as props.
- The handlers that spread a stale `settings` keep doing so. The `setPresetFeedback` / `setTimeout` inside a `setSettings` updater (622–629) stays as it is; that is §15.
- `BandPricingModal.tsx` (~200 lines) keeps the portal, z-[130], tabs, footer and the non-admin gate.

Must stay green: Q1 tests, `settings`, `hub-layers-laptop`. On the Duo sim, Pricing in every posture.
Risk: low.

**Q3. Quote wizard state hooks (1–1.5 days) → `src/app/components/quotes/wizard/`**
- `constants.ts` and `primitives.tsx` (`FieldLabel`, `MiniNumber`, `Chip`, `Segmented`, `StepperCard`, `LedgerRow`, pill classes).
- `QuoteStepIndicator.tsx` and `QuoteAccordionCard.tsx`.
- `useQuoteDraft.ts`: **the ~60 `useState`s moved as they are** (not a reducer). It returns `{ draft, set }`. The 20 never-set pass-through states become one memoised `passthrough` object.
- `useQuotePricing.ts`: settings load, the effects at 700, 851 and 878, the lineup handlers (1164–1261), travel (911–966) and services (1283–1303). This is the riskiest hook: keep `hasInitializedPricingRef` and the effect order exactly. The chained setters inside updaters (`updateMusicianFee` 1244) stay as they are.
- `useQuoteTotals.ts`, `useProposalOptions.ts` (1305–1463), `useWizardClose.ts` (the dirty baseline in render, the leave sheet, `useSystemBack`, `useRailAction`; 3106–3132).

Must stay green: Q1 RTL tests unchanged, `create-wizards`, `fold-layers` (laptop), `unsaved-changes`.
Risk: high for `useQuotePricing`, low for the rest.

**Q4. Quote wizard UI (1–1.5 days)**
- `QuoteWizardContext.tsx` carries the draft, derived values and handlers for the sections.
- Module-level sections: `sections/LineupSection.tsx` (1588–1760; mounted in 3 places), `TravelPill.tsx`, `BillingControls.tsx`, `LogisticsControls.tsx`, `ProposalTermsControls.tsx`, `ReviewDrawer.tsx`, `LiveEstimateBar.tsx`.
- Steps: `steps/EventLineupStep.tsx`, `DateVenueStep.tsx`, `ReviewStep.tsx`.
- `EditAccordionView.tsx`, `QuoteComposer.tsx` (3200–3595; iPad only, `composerOn`) and `duo/useQuoteDuo.tsx` (`deskLines`, `renderQuoteDesk`, the `LiveQuotePreview` companion).

Keep:
- the laptop pose, which mounts each step twice (`renderQuoteDesk(form)`);
- `deckTopRef`;
- `RailCover pane`, `HeaderAction pane`, `NavBackButton pane`;
- `closeInRail`;
- the root `bw-pane-detail fixed inset-0 z-[100]`, `data-wizard-type="quote"` and `--wizard-accent`.

Add a focus test: type 20 characters into "Client full name" and a fee field, and assert focus never leaves and the value is complete. Add it to the RTL suite **before** Q4.

Must stay green: Q1 and Q3 tests, `create-wizards`, `fold-layers`, `xstate-lifecycles`. On a device, the iPad composer, the Duo laptop pose and the leading page, and Maestro `keyboard`.
Risk: medium (focus, mounted twice).

### Session E: event detail (3 PRs)

**E1. Pure helpers (0.5 day)**
- Date/currency formatters (150–180) and duration helpers + `splitTimeDisplay` (218–237) go to `src/app/components/event/format.ts`, which already has `format.test.ts`.
- `getEventType` + `THEME` (182–214) go to `event/detail/theme.ts`.
- `TimeTile` and `SetFlow` go to `event/detail/parts.tsx`.
- Setlist row mapping (564–580) goes to `src/lib/eventSetlist.ts`. `useGigReadiness.ts:68` has its own query; leave it.
- Venue derivation (966–977) goes to `src/lib/eventAddress.ts`.
- `deriveEventDetail(input)` takes the derived values after the early return (858–1382: status chips, quote guide, money, RSVP flags). It is a plain function called in render, not a hook.

Characterization first: table tests for `deriveEventDetail` over the demo seed's gig, rehearsal, quote, personal gig and past gig, as admin and member. They are computed from the old code by the same copy-then-switch commits as A1.
Must stay green: the 6 `EventDetail.*` test files (23 tests), `event-edit`, `member-readonly`, `rsvp`.
Risk: low.

**E2. Hooks (1 day)**
- `useEventSetlist` (400–405, 508, 518–597), `useSetlistLeaveGuard` (409–438), `useEventLive` (713–801), `useHeroScroll` (614–630), `useDeputyRequests` (636–644), `useDetailRailActions` (812–848).
- All of them are called before the early return at 854, in today's order.
- Disables:
  - L651 / L682: memoise `activeMembers` with `useMemo(() => (dbMembers‖[]).filter(m => m.status !== 'declined'), [dbMembers])` before the early return, and depend on it.
  - L808 (run once on open) stays, with a `--` reason.

Characterization first: `EventDetail.setlistEdit` and `.setlist` already cover the setlist guard. Add an RTL test that a realtime update of the event does not reopen Stage mode or the Fee sheet once closed (pins L808).
Must stay green: the `EventDetail.*` tests, `stage-live`, `stage-fullscreen`, `stage-song-only`, `rehearsal-session`, `deputy` lifecycle.
Risk: medium (ref written in render at 777).

**E3. UI (1–1.5 days)**
- `EventHero.tsx` (1435–1579): the chips/title row stays the hero inner div's second child, and the hero stays a direct child of `.bw-ed-scroll`.
- `sections/`: `RsvpSection`, `GigTabs` (iPad tabs, 1648–1761), `MoneySection`, `QuoteSection`, `FeeSection`, `LineupSection`, `StudioCostSection`, `SetlistCard`, `RehearsalSections`, `TasksSection`, `ClientNotesSection` and `ActionsSection`. They are returned as Fragments so they stay direct children of the `columns-2` grid, and they keep `spanAll`.
- `DetailSheets.tsx` (drill-down `BwSheet` 2523–2798, options 2801–2841).
- `DetailOverlays.tsx` (2844–3028: AskDeputy, QuoteShare, Balance, `RiderStageScreen`, `StageMode`, `FloorWedgeMode`, `OverviewEditSheets`).
- `timeTiles` keeps rendering into both `.bw-ed-times-hero` and `.bw-ed-times-sheet`.
- `EventDetail.tsx` stays the entry (~400 lines) and is still imported statically by `AuthenticatedApp` (`lazyLayer` has `fallback={null}`).
- Update the `source:` strings in `e2e/models/card-edit.model.ts`, `deputy.model.ts` and `quote.model.ts`, and run `pnpm e2e:models:docs`.

Must stay green: all of the above, plus `rider-stage`, `event-edit`, `layers-back`, `@duo-book` and `@laptop`. Crawler screenshots of a gig, rehearsal, quote and personal gig, compared with the baseline on `phone-portrait`, `ipad-landscape` and `duo-book`.
Risk: medium (CSS structure).

### Session C: create gig + rehearsal wizard (3 PRs)

**C1. Pure helpers (0.5–1 day)**
- From `CreateEventModal`:
  - `src/lib/lineupFees.ts`: `getAutoFeeForMember` (536), the auto-fill (742–758) and the preset fees (943). Each fallback variant is kept as it is; no merge with `OverviewEditSheets`.
  - `src/lib/eventFormWarnings.ts`: `editingWarnings`, `warnField`.
  - `src/lib/eventCategory.ts`: `modalCategory`, `editingType`, `defaultEventType`.
  - `src/lib/eventTitle.ts`: `getEffectiveTitle` plus auto-title, with `t` and locale passed in.
  - `src/lib/eventDraftPayload.ts`: the payload build (969–1017). It keeps the `_stage` / `_createRider` keys that `composerStage.ts` reads.
  - `src/lib/gigForecast.ts`: `skyFromWmo` and the forecast fetch/cache.
  - `src/lib/setlistSets.ts`: the setlist operations (1204–1353). Uid formats stay exact: `song-${Date.now()}`, plus a random suffix when several songs are picked.
  - `event/create/format.ts`: the duration badge and `formatDurationOption`.
- From `RehearsalCreationWizard`, to `src/lib/rehearsalWizard.ts`:
  - `dbSongToRehearsalSong`, `dbSetlistToTemplate`;
  - `durationLabel`, `totalSetDuration`, `rehearsalTitle`;
  - `initialRehearsalState`, `toggleAudience`, audience cost;
  - `mergeTemplatesIntoSnapshot` (786–847);
  - `editingWarnings` / `canProceed`, `isDraftDated`;
  - the 7-day strip and `barWindow`.
  The wizard's own recurrence mapping and 0h duration are kept; do **not** swap in `recurrenceOf` or `windowSpan`.

Characterization first:
- New `src/app/components/rehearsal/__tests__/RehearsalCreationWizard.create.test.tsx` (RTL, same mocks as `CreateEventModal.save`):
  - a direct rehearsal;
  - a weekly-recurring rehearsal;
  - one with a setlist template and tasks;
  - edit mode;
  - the switch to "poll" calling `onOpenPollBuilder`;
  - the leave sheet saving a draft.
  Each asserts the exact `onCreate` payload.
- Extend `CreateEventModal.save` with a gig that has a preset lineup, a TBD fee and an extra band fee.
- Then table tests for every moved function.

Must stay green: `CreateEventModal.*`, `RehearsalPollModal.*`, `PollDetails`, `foldForm.laptop`, `create-wizards`, `polls`, `rehearsal-proposals`.
Risk: low.

**C2. `CreateEventModal` split (1.5–2 days) → `src/app/components/event/create/`**
- `types.ts` and `parts.tsx` (`InteractiveStepIndicator`, `EditAccordionCard`, `FieldLabel`, `MemberAvatar`, `PICKER_FIELD`).
- `useGigForecast.ts`.
- `useEventDraft.ts` (draft state, the touched refs, snapshot and dirty logic 1037–1071, drafts 1096–1124), `useEventLibrary.ts` (473–494, pricing 727–765) and `useEditPreload.ts` (779–823).
- `useEventLabels.ts` (585–643).
- `fields.tsx`: module-level components replacing the 15 `render*Field` helpers, fed through an `EventDraftContext`.
- `SetlistEditor.tsx`, `TasksEditor.tsx`, `WizardSteps.tsx`, `EditEventView.tsx` (still the Edit page for quotes, drafts and personal gigs), `GigComposer.tsx` (iPad), `WizardShell.tsx` and `SongPickerLayer.tsx` (mounted twice today; keep both mounts).
- The pricing refetch on every `selectedMembers` change (727) stays.
- Disables:
  - L528: use `useLatest(onClose)` / `useLatest(onOpenProposeRehearsal)` with deps `[isAdmin, modalCategory]`.
  - L792 and the uncommented 808: wrap `rebaseEdit` in `useCallback(…, [])` (it only touches refs). `t` is read through `useLatest`, so a language switch mid-edit doesn't refetch.
- `handleCreate` receives `composerOn`, `riderAllowed`, `draftsEnabled` and `persistDraft` explicitly; it reads them before they are declared today.

Add first: a focus test (type into the title, venue and a member fee; focus stays).
Must stay green: C1 tests, `create-wizards`, `fold-layers`, `unsaved-changes`, `event-edit` (Edit page of a personal gig). Maestro `keyboard` and `venue-one-tap`.
Risk: medium.

**C3. `RehearsalCreationWizard` split (1–1.5 days) → `src/app/components/rehearsal/wizard/`**
- `parts.tsx` (`WizardSteps`, `Segmented`, `PillShell`, `DotCheck`, `Initials`, `RehearsalAccordionCard`) and `constants.ts`.
- `useRehearsalForm.ts`, `useRehearsalLibrary.ts`, `fields.tsx` (`LocationField`, `DateTimeFields`, `CostCard`, `TypeTiles`, `MemberRow`, `FocusSuggestions`, `SongList`, `SchedulingModeSwitch`).
- `steps/SessionRosterStep.tsx`, `DateLocationStep.tsx`, `ReviewStep.tsx`.
- `RehearsalEditView.tsx`, `RehearsalComposer.tsx` + `useComposerAvailability.ts`, `RehearsalWizardModals.tsx`.
- `composerOn` is computed **before** the first `useSystemBack` (today it is declared after it and works only because the callback runs later).
- `currentUserId` keeps its own `supabase.auth.getUser` effect; switching to `useAuth` changes timing, see §15.
- Delete the unused `ArrowLeft` import.

Must stay green: the C1 rehearsal RTL tests, `create-wizards`, `fold-layers`, `rehearsal-*`, `to-practise`. On a device, the rehearsal composer on iPad and Duo laptop.
Risk: medium.

**Not in this plan:**
- a shared `useWizardDraft` for both wizards;
- one `AccordionCard` for both;
- folding `CreateEventModal`'s edit fields into `OverviewEditSheets`.
The copies differ in small ways (haptics, `editBaselineRef`, the `dated` logic, widths). Merging them changes behaviour, so it is a separate project after the release (§15).

## 9. Phase 3: hooks hygiene, `useData.ts`, the lint rule

H1 and H2 can run in two sessions at once; they touch different files. H3 comes last.

**H1. The remaining disables (0.5–1 day)**
- `useResetOnOpen` replaces the eight reset-on-open effects in `OverviewEditSheets.tsx` (204, 314, 500, 676, 775, 849, 949; and 104 gets a `--` reason) and `KitSheets.tsx:48`.
- `useStableByKey(value, key)` (one internal disable) replaces the content-key patterns in `useEventStage.ts:75`, `bandAvailability.ts:182` and `useStageRegia.ts:284`.
- Apply the safe fixes from §16 and add a `--` reason to every intentional one.
- The three risky ones (`SongSuggestionsView:92`, `BalanceRequestSheet:165`, `SetlistManagerView:301`) get a `--` reason only; their fixes change when data reloads, so they are §15.

Must stay green: `EventDetail.overviewEdit`, `event-edit`, `unsaved-changes`, `gear`, `stage-*`, `polls`.

**H2. `useData.ts` split (1 day)**
- Split into `src/app/hooks/data/`: `bands.ts`, `events.ts`, `quotes.ts`, `songs.ts`, `setlists.ts`, `notifications.ts`, `dashboard.ts`, `finance.ts`, `expanded.ts`, `chats.ts` and `rehearsalPolls.ts`.
- `useData.ts` stays as a barrel (`export * from './data/…'`), so the two importers don't change.
- The 23 `exhaustive-deps` warnings are mostly `refetch` functions used in effects. Each one is either wrapped in `useCallback` with an RTL test that proves the same number of fetches, or gets a `--` reason.

Must stay green: everything; this is where realtime and polling live. Check the egress-sensitive polling intervals (`docs/plans/scaling-and-costs.md` §7): the count of network requests per minute on Home and an open chat must be unchanged (Playwright request log).

**H3. Turn the rule on (0.5 day)**
- In `eslint.config.js`, set `'react-hooks/exhaustive-deps': 'error'` and `reportUnusedDisableDirectives: 'error'`.
- Fix or justify the remaining warnings from the 59. The unused memo deps (`AuthenticatedApp` 1788, 3741) are removed here, with a re-render check that shows no extra commits.

**V1 (optional). `EventsView.tsx` (0.5–1 day)**
- The pure calendar helpers (80–239) move to `src/lib/calendarList.ts`, with table tests.
- The filter bar and the list rows become module-level components in `src/app/views/events/`.

## 10. When to run it

- **After** the site, SEO and Academy sessions active on 2026-11-21 have merged. They don't touch these files, but the device gates and the main session's attention are shared.
- **After** the release queue is empty, and not while a release candidate is being checked. The refactor merges between releases.
- **Before** the official release. The last phase 3 PR should be merged at least **one week** before the release candidate. That week is for the full release gate (emulator check, Duo checklist, TestFlight to the friends group, APK) on refactored code, and for any revert.
- Feature work on the six files pauses for phase 1 (about 1.5 weeks). In phase 2 each file is paused only while its session holds it. Work on other files continues.
- One session at a time uses the iOS simulators and the Android emulator. The main session schedules the device gates of the three phase 2 sessions so they don't overlap.

## 11. Verification gate per PR

A PR is ready for the main session to merge only when all of these pass. The PR body ticks them.

1. **Local:**
   - `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, `pnpm build`;
   - `pnpm e2e` on `phone-portrait` and `ipad-landscape`;
   - `pnpm e2e --grep @smoke` on all 10 profiles, plus `@laptop` (`duo-laptop`) and `@duo-book`;
   - the lifecycle paths: `pnpm e2e specs/xstate-lifecycles.spec.ts`.
2. **CI:** all 5 required checks green: Typecheck, test, build; E2E 1/3, 2/3, 3/3; E2E lifecycles. Confirm the checks exist and passed, not just that the watch ended.
3. **Moved-code review:** `git diff --color-moved` shows every non-moved line, explained in the PR body. The characterization commit is green on its own, before the move.
4. **Emulators**, on the PR head after CI:
   - `scripts/emulator-check.sh` (Maestro on iPhone 17 Pro Max, iPad Pro 11 and Pixel 7 / API 36);
   - the Duo checklist on the Duo simulator for every screen the PR touched, in **every posture**: closed portrait and landscape (all rotations, camera block), book, laptop (nothing on the fold, keyboard up), open;
   - then `--duo-ok`.
   Playwright profiles alone are not enough.
5. **Screen-map crawler:** run `pnpm e2e:crawl`, or the Screen map workflow by `workflow_dispatch` on the branch. Compare with the R0 baseline: the same screens and states per role (admin, member, deputy, noband, signedout, client) and profile, the same lazy chunks loaded, and no new dead ends or findings in `findings.md`. Spot-compare the screenshots of the screens the PR touched.
6. **Performance check (§12)**, for A2–A6, Q3–Q4, E2–E3, C2–C3 and H2.
7. **Nothing user-visible changed.** No Academy screenshot recapture and no handbook PDF update. If either seems needed, the PR changed the UI and must go back.

## 12. Performance check (before / after)

### 12.1 Bundle

- Run `pnpm build && node scripts/bundle-report.mjs dist` on the PR head and on its base. The report covers each chunk raw / gzip / brotli, the **initial** group (entry plus modulepreloads plus CSS) and the `AuthenticatedApp` chunk.
- **Budget:** initial group ±1% gzip; no chunk grows more than 2% gzip; no new chunk in the initial group.
- Baseline, measured 2026-11-20 on a build of 433e53a (one commit off `main`; R0 re-measures on its own commit):

| Chunk | Raw | Gzip |
|---|---|---|
| `AuthenticatedApp` | 2.38 MB | 482 KB |
| `instruments` (shared chunk, **preloaded at start**, holds the locale dictionaries) | 1.35 MB | 446 KB |
| `main` (entry) | 790 KB | 249 KB |
| `CreateEventModal` (includes `RehearsalCreationWizard`) | 300 KB | 47 KB |
| `OnboardingFlow` | 174 KB | 27 KB |
| `BandPricingModal` | 104 KB | 16 KB |

  - There is **no `QuoteCreationWizard` chunk**: `QuotesExpanded.tsx` imports it statically and `AuthenticatedApp` imports `QuotesExpanded` through the `expanded/index.ts` barrel, so its `lazyLayer` is defeated.
  - `EventDetail` is static on purpose.

### 12.2 Re-renders

- Build the demo app with `VITE_PERF_PROBE=1` and run `pnpm exec playwright test -c e2e/perf.config.ts` (R0). It runs on `phone-portrait` and `ipad-landscape`, 5 runs per scenario, and records the median React commits and the summed `actualDuration` per probe. The scenarios:
  1. cold start to Home rendered (admin);
  2. open a gig, scroll to the end, close;
  3. switch the four tabs and back;
  4. type 30 characters into the quote wizard's "Client full name", then step to Review;
  5. step through the gig wizard to Review with a preset lineup;
  6. step through the rehearsal wizard;
  7. open Pricing and visit all 5 tabs;
  8. open the inbox and a notification;
  9. a realtime note update while a rehearsal is open. The demo's realtime tables are `rehearsal_notes` and `rehearsal_note_assignees`.
- **Budget:** commits per scenario ≤ baseline; `actualDuration` ≤ baseline + 10% (it is noisy, so if it fails, re-run on an idle machine before acting).
- A PR may *improve* the numbers; it records them but does not chase them.
- Optional spot check for typing latency: in Chrome DevTools Performance with 4× CPU throttle, record scenario 4 and compare INP before and after.

### 12.3 Where we report

Each PR body gets a small table: initial gzip, `AuthenticatedApp` gzip, and commits for the scenarios the PR touches, as base → head. The phase tags (`refactor-phase-1`, `-2`, `-3`) get a full report in the PR that ends the phase.

### 12.4 Follow-ups the numbers point to (not in this plan: they change loading timing)

- **Locale dictionaries preloaded at start (446 KB gzip).** Loading only the active language (and the document language on demand) would roughly halve the initial download.
- **`QuoteCreationWizard`** could become its own lazy chunk by making `QuotesExpanded` load it through `lazyLayer` too (an estimated 60–80 KB gzip off the shell).
- These are measurable product changes: separate PRs after the refactor, each with the same gate.

## 13. Estimates

Session-days of focused work, including the characterization tests and the full gate (CI about 14 min, emulator check about 22 min plus the Duo checklist, crawler about 30 min per role pair).

| PR | Effort | Risk |
|---|---|---|
| R0 baseline + tools | 0.5 d | low |
| A1 pure logic + dead code | 1 d | low |
| A2 shell hooks | 0.5–1 d | low |
| A3 mutations → services | 1.5–2 d | medium |
| A4 layer state | 1–1.5 d | medium |
| A5 navigation + back chain | 1.5 d | **high** |
| A6 JSX split + context | 1–1.5 d | medium |
| **Phase 1** | **6.5–8 d** (sequential) | |
| Q1 / Q2 / Q3 / Q4 | 0.5–1 / 0.5–1 / 1–1.5 / 1–1.5 d | low / low / high / medium |
| E1 / E2 / E3 | 0.5 / 1 / 1–1.5 d | low / medium / medium |
| C1 / C2 / C3 | 0.5–1 / 1.5–2 / 1–1.5 d | low / medium / medium |
| **Phase 2** | **8.5–12.5 d effort, 3–5 d wall-clock** (3 sessions) | |
| H1 / H2 / H3 (+ V1) | 0.5–1 / 1 / 0.5 (+ 0.5–1) d | low / medium / low |
| **Phase 3** | **2–2.5 d effort, 1.5–2 d wall-clock** | |
| **Total** | **≈ 18–24 d effort, ≈ 12–15 working days wall-clock** | |

Ops (dead edge functions): about 30 minutes of the main session, with the user's OK.

## 14. Rollback

- **No server side.** No migration, edge function or config changes, so a rollback is always a git revert plus a rebuild.
- **One PR = one squash commit**, so `git revert <sha>` undoes a PR cleanly. Within a chain, revert newest first. Entry files and export names never change, so reverting a later PR never breaks callers of an earlier one.
- **Tags:** `refactor-baseline` (R0), `refactor-phase-1`, `refactor-phase-2`, `refactor-phase-3`. If a phase goes badly, `git revert` the range back to the previous tag in one PR, run the gate, and merge.
- **Revert, don't fix forward**, when a regression found after merge has no obvious one-line cause within about an hour. Re-land the PR later with a characterization test that catches it.
- **Releases are manual** and happen between refactor phases (§10). If a refactor regression shows up in TestFlight or the APK, rebuild the candidate from the last good tag; the previous TestFlight build and the previous `android-v*` release stay available. Nothing reaches users without the user and partner triggering it.
- **Parallel sessions in phase 2** own disjoint files (§4.1), so reverting one session's PR never touches another's.

## 15. Found during the analysis (not fixed by this plan)

Each item becomes its own PR with a failing-first test, after the refactor or when the user decides:

1. **Side effects inside a state updater.** `BandPricingModal` 622–629 calls `setPresetFeedback` / `setTimeout` inside a `setSettings` updater, so they fire twice under StrictMode. `QuoteCreationWizard.updateMusicianFee` (1244) calls `setBaseFee` inside a `setSelectedMusicians` updater.
2. **Roster without de-dupe.** `RehearsalCreationWizard`'s roster (363–374) keeps members without `user_id` and does not de-dupe; `RehearsalPollModal` does both. A candidate shared `bandRoster()` belongs in `src/lib/bandMembership.ts`.
3. **Three risky reload timings.** `SongSuggestionsView:92` doesn't reload on a band switch. `BalanceRequestSheet:165` has a `load` that closes over `quote`. `SetlistManagerView:301` calls `fetchData`, a plain function.
4. **Look-alike code that renders differently.**
   - The quote composer paper vs `quotePdf.ts` vs `quoteLinks.ts` (meals, accommodation, production, discount label).
   - `CreateEventModal` edit fields vs `OverviewEditSheets`.
   - Two wizard draft/leave mechanisms.
   - Two accordion cards.
   - Doc-language follow/pick logic, duplicated in `QuoteCreationWizard` and `QuoteShareModal` (candidate `useDocLanguage`).
5. **Currency symbol.** `QuoteCreationWizard`'s `currencySymbol` memo and `quotePdf.getCurrencySymbol` duplicate `src/lib/currency.ts`; the output is the same.
6. **User id timing.** `RehearsalCreationWizard` reads the user id with its own `supabase.auth.getUser` instead of `AuthContext`.
7. **The inbox list is a snapshot when it opens.** `AuthenticatedApp` sets `selectedNotifications` once; this is already in `e2e/crawl/triage.json`.

## 16. Appendix: the 45 `exhaustive-deps` disables

Today they suppress nothing (the rule is off). With the rule on, this is the verdict per line at 2f3a9ef. Safe = adding the deps, or the ref/`useCallback` shown, changes nothing observable.

| File:line | Verdict | Fix (PR) |
|---|---|---|
| `AuthenticatedApp.tsx:866` | intentional | `selectedEventRef` + module-level `eventKeyOf` (A5) |
| `AuthenticatedApp.tsx:1428`, `:1468` | intentional (`locale` relabel) | becomes an argument of `toInboxItems` / `toUiBand` (A1) |
| `AuthenticatedApp.tsx:2003` | **stale** | delete (A4) |
| `AuthenticatedApp.tsx:2020` | safe | add `selectedEvent?.band_id`; the ref guard returns early (A4) |
| `AuthenticatedApp.tsx:2997` | safe | `handleEventCardClickRef.current(next)` (A5) |
| `EventDetail.tsx:651`, `:682` | safe | memoise `activeMembers` (E2) |
| `EventDetail.tsx:808` | intentional (once on open) | `--` reason (E2) |
| `CreateEventModal.tsx:528` | intentional | `useLatest` for the two callbacks (C2) |
| `CreateEventModal.tsx:792` | risky | `rebaseEdit` in `useCallback(…, [])`, `t` via `useLatest` (C2) |
| `songs/ChordEditor.tsx:134` | safe | module-level `t` inside the effect (H1) |
| `quotes/QuoteShareModal.tsx:262` | safe | add `quote.clientEmail`, `t`; `autoSentRef` guards it (H1) |
| `lib/railActions.ts:219` | safe | add `pane`, `hideTabs` (constant booleans at both callers) (H1) |
| `lib/railActions.ts:297` | **stale** | delete (H1) |
| `lib/bandAvailability.ts:85`, `:95`, `:116` | safe | list the primitives and `hasWin`; `key` already encodes them (H1) |
| `songs/SongSuggestionsView.tsx:92` | risky | `--` reason; fix in §15 |
| `quotes/BalanceRequestSheet.tsx:165` | risky | `--` reason; fix in §15 |
| `views/SetlistManagerView.tsx:301` | risky | `--` reason; fix in §15 |
| `event/edit/OverviewEditSheets.tsx:204`, `:314`, `:500`, `:676`, `:775`, `:849`, `:949` | intentional (reset on open) | `useResetOnOpen` (H1) |
| `event/edit/OverviewEditSheets.tsx:104` | intentional (answer each switch request once) | `--` reason (H1) |
| `gear/KitSheets.tsx:48` | intentional (reset on open) | `useResetOnOpen` keyed by `kit?.id` (H1) |
| `event/rider/useEventStage.ts:75`, `lib/bandAvailability.ts:182`, `event/useStageRegia.ts:284` | intentional (content key) | `useStableByKey` (H1) |
| `event/rider/useEventStage.ts:224` | intentional | hoist `hasStage`, `--` reason (H1) |
| `event/useStageRegia.ts:314`, `onboarding/OnboardingFlow.tsx:143` | intentional (mount / restore only) | `--` reason (H1) |
| `layout/DuoRail.tsx:231`, `:237` | intentional | `--` reason (H1) |
| `quotes/QuoteShareModal.tsx:168`, `:218` | intentional | `--` reason (H1) |
| `quotes/BalanceRequestSheet.tsx:242`, `rehearsal/RehearsalPollModal.tsx:222` | intentional (one-shot, ref-guarded) | `--` reason (H1) |
| `rehearsal/AddSongModal.tsx:188` | intentional | already has a reason (H1: `--` form) |
| `views/ContractsView.tsx:260` | intentional (once per prefill) | `--` reason (H1) |
| `lib/i18n/index.ts:196` | intentional (`l` gives `t` a new identity per locale) | `--` reason (H1) |

Totals: **12 safe** (2 of them stale), **4 risky**, **29 intentional**.
Turning the rule on also reports **59 un-commented warnings**. The biggest groups are 23 in `useData.ts`, 4 in `AuthenticatedApp.tsx`, 3 in `duo/modes/PlannerMode.tsx` and 3 in `RehearsalPollModal.tsx`. They are handled in H2 and H3.
