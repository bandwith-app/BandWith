# Paid plans: Free, Pro, Maestro (technical plan)

Status: **plan only, no product code.** Written 2026-11-18, on top of `main` 5b96d22.
**Nothing goes to production without the user's explicit confirmation**: no migration applied, no Paddle account change, no web deploy, no APK, no TestFlight.

**Prices and limit values are not in this repository.** They live in the database (rows written with the service role, never by a migration) and in Paddle (price IDs). This document names the limits by key only. Tests use fake values.

Contents

1. Summary and order of work
2. What exists today
3. Data model: entitlements in the database
4. Enforcement on the server
5. The app: plan screen, limit prompts, over-limit behaviour
6. Grants: trial, founding bands, partner band
7. Old app versions and the minimum version
8. Store rules: Apple and Google (decision needed)
9. Paddle integration
10. Phases and PRs
11. Testing and the release gate
12. Timeline to mid-December and 1 January
13. Decisions for the user
14. Sources checked

---

## 1. Summary and order of work

- **Billing is per band.** One admin pays. Members and deputies never pay. **Maestro** is one payer account covering several Pro bands.
- **Free has every tool.** Limits are on quantity and customisation only. Each limit is a key with a value per plan, stored in the database.
- **Everything is built switched off.** The global switch `plans_enforced` stays off until 1 January. While it is off, every band behaves exactly as today in the beta (everything unlimited, `IS_BETA` semantics).
- **On 1 January the switch is flipped server-side, with no new release.** The app and the server read the same switch.
- **The server enforces the limits** (RLS, triggers, RPC guards), not only the UI. An old build that does not know about plans still cannot go past a limit; it just gets a less friendly message (§7).
- **Paddle comes last** (web checkout, webhook → subscription row). It needs no native release: the app only opens `app.bandwith.fun/plans` in the browser.

Agreed order (main session, 2026-11-18):

1. This plan.
2. Rehearsal A2–A4 finish (parallel session, one PR at a time).
3. Plans built **switched off** (§10, P1–P5), before the deposit tweaks.
4. Release candidate with plans off, released **by mid-December** on web, APK and TestFlight, so installed builds carry the code before 1 January.
5. 1 January: `plans_enforced` on and the minimum version raised, server-side, with the user's confirmation.
6. Paddle checkout (P6), as soon as the VAT number and the Paddle account are verified.

## 2. What exists today

On `main`:

- `src/lib/beta.ts`: `IS_BETA = true` (compiled in), `isPaidTier(tier)`, `hasPlanFeature(tier) = IS_BETA || isPaidTier(tier)`.
- `profiles.sub_tier` (`free_member`, `single_band`, `multi_band`, `unlimited`): the plan is **on the person**, not on the band. Nothing writes it except by hand.
- `src/app/AuthenticatedApp.tsx` (~line 1580): band-creation limit per `sub_tier`, `Infinity` while `IS_BETA`.
- `src/lib/bandMembership.ts`: `canCoManage = hasPlanFeature(subTier)` (co-admins).
- `BandMembersView.tsx`: a "Pro" badge from the member's `sub_tier`.
- `UpgradePricingSheet.tsx`, `CreateBandModal.tsx`, `NoBandRehearsalModal.tsx`: placeholder plans, "Coming soon", beta wording.
- `quote_links` + `bw_quote_link_mark_sent` (099): the one server choke point where a quote becomes "sent". Contracts have `status` `draft → sent` (006).
- `band_deputies` (069, 086), `band_members.role = 'admin'`, `inventory`, `gear_kits`, `task_templates`, storage buckets per band.
- Android: `src/lib/androidUpdate.ts` + `ApkUpdatePlugin` check GitHub releases and install in the app (from 1.0.3). iOS: TestFlight only, no in-app update prompt. Web: no service worker, so a reload always gets the latest build.

From **PR #207 (rehearsal A1b), still open on 2026-11-18**:

- Migration `130_feature_flags.sql`: `platform_switches (key, enabled)` (global, off = kill switch) and `band_features (band_id, key, enabled)`. RLS on, no grants; read through `bw_band_features(band)`.
- `src/lib/flags.ts`: `resolveFlag` (platform off wins, then band, then code default), cached per band on the device, refreshed every 10 minutes at most.

This plan **reuses** that layer for the switches (`plans_enforced`, `plans_checkout`, `plans_trial`) and **depends on #207 being merged**. Plan values (which plan, which limits) do not fit in booleans, so they get their own tables (§3).

## 3. Data model: entitlements in the database

Migration block reserved for this work: **160–169** (A uses 130–134, B uses 140–154). All migrations additive, idempotent, applied by hand after a rollback-only dry run and the user's OK.

### 3.1 Tables (P1, migration 160)

| Table | What | Who writes |
| --- | --- | --- |
| `plan_limits (plan, key, value)` | One row per plan and limit key. `value` is an integer; `NULL` = unlimited. Plans: `free`, `pro`, `maestro`. **The migration creates the table empty.** | service role only (SQL from a local, uncommitted file) |
| `plan_settings (key, value jsonb)` | Non-limit terms: trial length, founding window end, Maestro band cap, grace days. Empty in the migration. | service role only |
| `billing_accounts (id, payer_user_id, plan, status, provider, provider_customer_id, provider_subscription_id, current_period_end, cancel_at, updated_at)` | One per paying subscription. A Pro subscription covers one band; a Maestro subscription covers up to the Maestro cap. | webhook / service role |
| `band_plans (band_id PK, billing_account_id NULL, plan, source, status, trial_ends_at, past_due_since, grant_reason, grant_until, updated_at)` | **The band's current plan**, one row per band. `source`: `paddle`, `apple`, `google`, `grant`, `trial`. No row = Free. | webhook / RPCs below / service role |
| `billing_events (provider, event_id, received_at, type, payload jsonb, processed_at, error)` | Every webhook event, unique on `(provider, event_id)`, for idempotency and replay. | webhook |
| `band_usage (band_id, key, period_start, value)` | Counters that are expensive to compute live (storage bytes, sends this month). Updated by triggers. | triggers |
| `plan_trials (user_id PK, band_id, started_at)` | One trial per account. A table instead of the `profiles.trial_used_at` column first planned, so the `profiles` grants and old builds stay untouched (decided in P1). | `bw_start_trial` |

Grants: `plan_limits`, `plan_settings`, `billing_*`, `band_usage` get **no** table grants to `anon` / `authenticated`; everything is read through RPCs. `band_plans` likewise. Columns the app reads are listed in `columnGrants.test.ts` only if a direct grant is ever added (none planned).

### 3.2 Switches (rows in `platform_switches`, from #207)

| Key | Off | On |
| --- | --- | --- |
| `plans_enforced` | today's beta: every band unlimited, no plan UI beyond "Free during the beta" | limits apply, plan screen live |
| `plans_checkout` | no buy buttons anywhere; `paddle-checkout` refuses | web checkout available |
| `plans_trial` | `bw_start_trial` refuses | trial can be started |

The webhook ignores the switches: money already in flight is always recorded.

### 3.3 Read path (P1)

`bw_band_entitlements(p_band_id uuid) returns jsonb` (SECURITY DEFINER, `authenticated` only, active members of the band only):

```
{
  enforced: bool,                 // plans_enforced
  plan: 'free' | 'pro' | 'maestro',
  source, status, trial_ends_at, grant_until,
  is_payer: bool,                 // caller is the payer (sees billing links)
  limits: { <key>: int | null },  // from plan_limits for this plan
  usage:  { <key>: int },         // only for keys with a counter
  checkout: bool                  // plans_checkout
}
```

- Members get `plan` and `limits` (they need them to understand a prompt) but **not** billing details (`is_payer` false, no provider IDs, no period end).
- `src/lib/plans.ts` (pure, P1): `resolvePlan(row, now)` (status + trial + grant + grace → effective plan), `limitFor(ent, key)`, `canUse(ent, key, used)`, `isOverLimit`. A table of cases in vitest.
- `src/lib/usePlan.ts`: same caching pattern as `flags.ts` (memory → device → RPC, TTL 10 minutes, refresh on resume and after a limit error).
- Built in P1 (migration 160): `bw_band_effective_plan(band, at)` is the one SQL resolver (internal, not callable by the app), checked case by case against `src/lib/__fixtures__/planCases.json` in the dry run; `bw_band_entitlements` also returns `is_admin` and, for admins while plans are off, `notice` (§5.3). A key with no row in `plan_limits` is unlimited, so flipping the switch before the values are written limits nothing. Past due with no `grace_days` written keeps the plan until the provider cancels.
- When `enforced` is false the app treats every limit as unlimited, the same as `IS_BETA` today. `IS_BETA` becomes `!ent.enforced`, read from the server, and `beta.ts` is deleted at the end of P3.

### 3.4 Limit keys

Values are per plan in `plan_limits`, never in code. Keys, and where each is counted:

| Key | Counted on | Enforcement |
| --- | --- | --- |
| `quotes_sent_month` | `quote_links` going `draft → sent` this calendar month (Europe/Rome), resends free | server (`bw_quote_link_mark_sent`) |
| `contracts_sent_month` | `contracts.status` going to `sent` this month | server (trigger) |
| `deputies` | rows in `band_deputies` for the band | server (trigger) |
| `admins` | `band_members` with `role = 'admin'` | server (trigger on insert/update) |
| `custom_templates` | custom quote/contract/task templates the band created (built-ins never count) | server (trigger) |
| `gear_items` | rows in `inventory` for the band (personal gear excluded, 110) | server (trigger) |
| `storage_mb` | bytes in the band's storage paths (`band_usage`) | server (storage insert policy) |
| `analytics_days` | how far back analytics and money history go | UI only (the band's own data, see §4.3) |
| `branding` (0/1) | logo, signature, colours, no "Made with BandWith" | client page RPC + PDFs (§4.3) |
| `bands_as_admin` | Free bands an account administers; Maestro cap | server (`bands` insert trigger) |

Drafts are never limited: only sending is.

## 4. Enforcement on the server

### 4.1 One guard function (P2, migration 161)

`bw_plan_guard(p_band_id uuid, p_key text, p_add int default 1)`:

- returns immediately when `plans_enforced` is off (so P2 can merge and be applied in November with **zero effect**);
- reads the band's effective plan (same rules as `resolvePlan`, written once in SQL and checked against the TS table of cases by a shared fixture);
- compares usage + `p_add` with the limit;
- on refusal raises `SQLSTATE 'P0001'` with message `BW_PLAN_LIMIT:<key>` and a `HINT` in plain English: *"Your band's Free plan limit is reached. Update BandWith to see the options."* Old builds that show `error.message` show something understandable; new builds map the code to the limit prompt (§5).

It is called from:

- `bw_quote_link_mark_sent` (first send only);
- a `BEFORE UPDATE` trigger on `contracts` when `status` becomes `sent`;
- `BEFORE INSERT` triggers on `band_deputies`, `inventory` (band gear), the template tables;
- a `BEFORE INSERT OR UPDATE OF role` trigger on `band_members` when the result is `admin`;
- a `BEFORE INSERT` trigger on `bands` (counts the creator's Free bands; Maestro cap per billing account);
- storage: an `INSERT` policy on `storage.objects` for band buckets that calls a `STABLE` check on `band_usage`, plus a trigger that keeps `band_usage.storage_bytes` up to date on insert/delete.

Triggers skip the service role (imports, admin scripts, the Mirage import) and the demo.

### 4.2 Downgrade and over-limit

Nothing is ever deleted or hidden because of a plan.

- Over a limit after a downgrade (Pro ended, trial ended, grant ended): existing rows stay readable and editable; only **adding** more is refused.
- Admins over the limit: during the grace period (`plan_settings.grace_days`) nothing changes; after it, only the payer (or the band creator if there is no payer) keeps admin rights and the others become members. The app warns the band before. (Decided 2026-11-18, §13.)
- Storage over the limit: files stay; new uploads are refused.
- `past_due` from Paddle: Pro continues until Paddle's dunning ends (`subscription.canceled` or `past_due` beyond grace), then Free.

### 4.3 What is UI-only, and why

- `analytics_days`: analytics and the money history are computed from the band's own events, which members already read for other screens. Hiding old rows at the RLS level would break the calendar and gig history. The limit is a **view window** in `analytics.ts`; not a security boundary.
- `branding`: quote, contract and setlist PDFs are generated on the device. The public client page (`/quote.html`) gets `branding` from its existing anon RPC, so the "Made with BandWith" mark there is decided on the server. A modified client could remove the mark from its own PDFs; acceptable.

### 4.4 Dry runs (each server PR)

Rollback-only, on production, as today: admin of a Free band / Pro band / grant band / trial band, member, outsider, anon; with `plans_enforced` off (nothing changes) and **on inside the transaction** (every limit refuses exactly at the limit + 1, resends and drafts still pass, the service role passes).

## 5. The app: plan screen, limit prompts, over-limit behaviour

### 5.1 Plan screen (P3a)

`Settings → Plan` (replaces `UpgradePricingSheet`; `CreateBandModal` and `NoBandRehearsalModal` lose their placeholder tiers):

- The band's plan, its source in words ("Pro, paid by <admin name>", "Pro, founding band until …", "Pro, offered by BandWith", "Trial, 9 days left"), and a usage meter for each counted limit.
- For the payer: **Manage subscription** (Paddle customer portal, in the browser).
- For admins who are not the payer: who pays.
- For members: the plan only, no prices, no buttons.
- Prices come from Paddle (`Paddle.PricePreview`, localised, VAT included) on the web, never hardcoded. In the app the screen links to the web page (§8).

### 5.2 Limit prompts (P3b)

Every limit has one prompt, opened from the action that hit it (before the server call when `usePlan` already knows, and again from the `BW_PLAN_LIMIT:<key>` error when it did not):

| Where | Prompt |
| --- | --- |
| Send quote / Send contract | "This month's sends on Free are used. Your draft is saved." + plan options (admin) |
| Add deputy / Make admin / Add gear / New template | the limit, what is already there, plan options |
| Upload (song files, rider, stage plot, avatar is exempt) | storage meter + options |
| Analytics older than the window | a blurred band "Older history is on Pro" |
| PDFs and client page on Free | the "Made with BandWith" mark, with a "Remove the mark" link for the admin |
| Create a second band as admin | "Your account runs one Free band. Make this band Pro, or join it as a member." |

Rules for prompts:

- Members never see prices or upgrade buttons: "Ask your band admin".
- A prompt never blocks reading, never interrupts a gig or rehearsal Live mode, never appears on Stage.
- Each prompt is translated (6 languages, `t()`), fits every Duo posture, portals to `<body>`, passes axe.
- One analytics event per prompt shown/acted on, through the existing analytics hook (no new provider).

### 5.3 Before the switch: the beta notice (P3a)

While `plans_enforced` is off and `plan_settings.launch_notice` is set, admins see one dismissible card: plans arrive on a date, the founding offer applies to their band (computed server-side, §6). The date and wording come from the database, so the card can be turned on on the planned notice day without a release.

## 6. Grants: trial, founding bands, partner band

All grants are `band_plans` rows with `source = 'grant'` or `'trial'`, so the app has one code path.

- **Trial** (P5): `bw_start_trial(band)` by an admin; refuses if `plans_trial` is off, if the caller's `profiles.trial_used_at` is set, or if the band already had a plan. Length from `plan_settings`. No card. Offered on the plan screen and on the first limit prompt.
- **Founding bands** (P5): a SQL function `bw_founding_candidates()` returns the bands that qualify (rules from the pricing decision: created before launch, enough members, recent gig or rehearsal). It is **run as a report first** and shown to the user; the grant is applied by a separate statement only with the user's OK, on launch day, with `grant_reason = 'founding'` and `grant_until` from `plan_settings`. The founding price lock is a Paddle price ID attached to the band's checkout (§9), not a database price.
- **Partner band (Mirage Music)**: `grant_reason = 'partner'`, `grant_until = NULL` (forever). Applied by hand, when the user says it is ready. Not counted as a paying band in reports.
- **Ending a grant** (founding window over, no subscription): the band falls to Free with the over-limit rules (§4.2). The app warns the payer before the end (in-app card + push + email through the existing templates, user-approved before deploy).

## 7. Old app versions and the minimum version

Server enforcement means an old build **cannot** get Pro for free: the limit is checked in the database. What an old build lacks is the explanation (no plan screen, no prompt; at best the plain-English `HINT`). So the minimum version is about clarity, not security.

### 7.1 Minimum version (P4, migration 162)

- `app_versions (platform, min_version, latest_version, store_url, message_key)` for `ios`, `android`, `web`; read by anon RPC `bw_app_version(platform)` (it must work before sign-in).
- `src/lib/minVersion.ts` (pure): compare with `compareVersions` from `androidUpdate.ts`; returns `ok`, `soft` (newer exists) or `blocked` (below `min_version`).
- **Blocked** shows a full-screen, translated "Update BandWith" with one button. Data is not touched; signing out still works.
  - **Android**: the button runs the existing in-app APK installer (`ApkUpdatePlugin`), forced mode.
  - **iOS (TestFlight)**: opens TestFlight (`itms-beta://`), later the App Store page.
  - **Web**: reloads. A long-open tab checks `bw_app_version('web')` on resume against the build's own version (stamped at build time), and reloads at the next safe moment (never during Live mode).
- Checked at start and on resume, at most every 6 hours, cached on the device; offline never blocks.

### 7.2 What to set on 1 January

- `min_version` for iOS and Android = the plans-off release (the mid-December build). Builds older than that are the ones that cannot show the block screen either; they keep working, hit server limits with the plain `HINT`, and Android ones still get the existing update offer.
- Push to testers on the notice day: "Update before 1 January".
- Revokes or column changes that would break old builds still wait for every build to update (the 119 rule).

## 8. Store rules: Apple and Google (decision needed)

### 8.1 Apple, as of 2026-11-18

- **3.1.1**: features or subscriptions unlocked **in the app** must use in-app purchase (IAP).
- **3.1.3(b) Multiplatform services**: a subscription bought on the web may be used in the iOS app **provided it is also available as IAP**. BandWith is not a "reader" app (3.1.3(a) is for magazines, books, music, video), so the reader-app exemption does not apply.
- **United States storefront**: since the April 2025 Epic v. Apple injunction, apps may show buttons and links to web purchase, and Apple charges **0%** on them today. The Ninth Circuit allowed a "reasonable" commission in principle; the district court has not set one, Apple has proposed rates, and the Supreme Court has the contempt question. **This can change during 2027.**
- **European Union storefronts** (new terms, effective 2026-10-01): developers pick IAP, alternative in-app payment, link-out to the web, or a mix, and keep the choice for 12 months. **IAP is no longer required alongside the others.** Commission: IAP 26% (15% in the Small Business Program, and for subscriptions after the first year), alternative processing 20% (10%), **link-out 15% (10% in the Small Business Program)**. Link-out needs the external purchase entitlement and Apple's reporting.
- **Rest of the world**: IAP only; no links or prices pointing to the web.
- **Small Business Program** (under $1M a year): IAP 15% outside the EU.
- **TestFlight**: purchases in TestFlight are sandbox only (free). Real sales on iOS need the App Store release, which is not planned yet.

### 8.2 Options for iOS

| Option | What iOS users see | Cost on iOS sales | Work | Risk |
| --- | --- | --- | --- | --- |
| **A. No sales on iOS until the App Store, then IAP at the same price** (recommended) | Now: the plan, the limits and the usage; no prices, no buy button, no link or hint to the web. The admin's prompt names the limit only. At App Store launch: IAP for Pro and Maestro + on the US storefront a link to the web | IAP 15% (Small Business); US web link 0% today | now: none; at App Store launch: StoreKit 2 + App Store Server Notifications v2 → `band_plans` (~1 day wall-clock) | low; the IAP margin is lower but still fine (pricing doc) |
| B. Web link-out where allowed (US + EU), no IAP | admin sees a link to the web in US/EU; nothing elsewhere | US 0% (may change), EU 10% + reporting; rest of world: cannot sell | per-storefront logic, EU entitlement, reporting | Apple review outside US/EU; US rate may change; non-EU/US admins stuck on iOS |
| C. IAP only on iOS from the start | same as A, but needs the App Store now | 15% | StoreKit now, App Store listing now | App Store submission is not wanted yet |

**Decided by the user on 2026-11-18: A.** It matches the 2026-11-18 pricing decision (Paddle on the web, iOS without prices until the App Store, then IAP at the same price). For the testers on TestFlight on 1 January, the admin who wants Pro pays on the web (from a computer, Android, or the iPhone's browser); the iOS app then shows Pro because the plan is on the band.

### 8.3 Google

- Android ships as an **APK outside Google Play** (GitHub releases). Play's billing rules do not apply: the app may open `app.bandwith.fun/plans` in the browser and show prices. No fee beyond Paddle's.
- If the app moves to Google Play later: since 2026-06-30 (EEA, UK, US, first $1M a year) Play Billing for subscriptions is 15% (10% service + 5% billing), alternative billing or external links 10%. **Recommendation then: external link to Paddle (10%).**
- Android developer verification for sideloaded apps reaches other countries in 2027: the APK will need registering in the Android Developer Console. Not a plans issue, but a release one.

## 9. Paddle integration (P6, after the VAT number and Paddle verification)

- **Model**: Paddle Billing as merchant of record. Products `pro` and `maestro`, prices monthly/yearly + founding prices, all created in the Paddle dashboard by the user (sandbox first). Price IDs go into `plan_settings`, not into code.
- **Checkout**: web only, `app.bandwith.fun/plans`, Paddle.js overlay. `customData = { band_id, payer_user_id, billing_account_id? }` set by a small Edge Function `paddle-checkout` that checks the caller is an admin of the band, the band is not already paid, `plans_checkout` is on, and returns the transaction to open. The Android app opens this page in the browser; iOS does not link to it (§8).
- **Webhook**: Edge Function `paddle-webhook` (`--no-verify-jwt`), verifies the `Paddle-Signature` header (`ts=…;h1=…`; HMAC-SHA256 of `ts:raw_body` with the destination's secret; Paddle's default timestamp tolerance of 5 seconds; more than one `h1` during secret rotation), stores the event in `billing_events` (unique `event_id`, so retries are no-ops), then applies it:
  - `subscription.created / activated / updated / resumed` → `billing_accounts` + `band_plans` (plan from the price ID, status, period end);
  - `subscription.past_due / paused / canceled` → status, grace;
  - `transaction.completed / payment_failed` → recorded for the payer's history;
  - `adjustment.created` (refund, chargeback) → recorded; a full refund ends the plan.
  Out-of-order events are resolved by `occurred_at`; the newest wins.
- **Customer portal**: `paddle-portal` returns a Paddle customer-portal session URL for the payer (cancel, change card, invoices). No billing UI of our own.
- **Test mode**: Paddle sandbox (separate API key and webhook secret in Supabase secrets with a `_SANDBOX` suffix; `Paddle.Environment.set('sandbox')` when the build or the switch says so). Sandbox test cards and Paddle's webhook simulator. Recorded, scrubbed events in `supabase/functions/paddle-webhook/fixtures/` and a `scripts/paddle-replay.sh` that posts them signed with a test secret to `supabase functions serve`.
- **Demo adapter**: in demo mode the plans page shows a fake checkout that writes `band_plans` locally, so e2e and XState run without Paddle.
- **Kill switch**: `plans_checkout` off hides every buy button and makes `paddle-checkout` refuse; the webhook keeps processing. `plans_enforced` off returns everyone to unlimited instantly (the emergency brake if enforcement misbehaves).
- **Ops**: a daily reconciliation job compares Paddle subscriptions with `band_plans` and reports differences (same pattern as B7 in the payments plan).

## 10. Phases and PRs

Every PR: failing-first tests, the 5 required CI checks green, merged after checks, **no `[deploy]`**. Migrations applied by hand only after the dry run and the user's OK. Each phase ends at "merged + applied"; the release is separate (§11).

| Phase | PR content | Tests written first | Depends on |
| --- | --- | --- | --- |
| **P1 Data + read path** | migration 160 (tables, empty), `bw_band_entitlements`, switches rows absent (= off), `src/lib/plans.ts`, `usePlan.ts`, demo adapter | vitest: `resolvePlan` table (free, pro, trial active/ended, grant forever/ended, past_due in/after grace, maestro member band), `limitFor`, enforced off = unlimited; static migration guards (no `INSERT INTO plan_limits` in any migration, no grants); `columnGrants.test.ts` unchanged | #207 merged |
| **P2 Server guards** | migration 161: `bw_plan_guard`, triggers and policy of §4.1, `band_usage` counters + backfill | SQL dry run (rollback) per limit, enforced off and on; static guard that every trigger calls `bw_plan_guard`; vitest for the error mapping `BW_PLAN_LIMIT:<key>` | P1 |
| **P3a Plan screen** | Settings → Plan, launch-notice card, `IS_BETA` read from the server, `sub_tier` no longer read (column kept), `canCoManage` from the band plan | vitest components; e2e `plans.spec.ts` @smoke on 10 profiles (admin/member, enforced off and on via demo); XState model `band-plan` (free → trial → free; free → pro → past_due → pro / free; grant → free) | P1 |
| **P3b Limit prompts** | every prompt of §5.2, the mark on PDFs and client page, analytics window | e2e: each limit as admin and member, draft saved after refusal, prompts absent on Stage/Live; axe; i18n keys; Duo postures | P2, P3a |
| **P4 Minimum version** | migration 162 `app_versions` + `bw_app_version`, `minVersion.ts`, block screen, Android forced update, iOS TestFlight link, web reload | vitest `minVersion` table; e2e block screen on 10 profiles; Maestro (native) for the Android forced update and the iOS button | none (can run in parallel with P2/P3, files disjoint) |
| **P5 Grants** | `bw_start_trial`, `bw_founding_candidates` (report), partner grant procedure, grant-end warnings (in-app + push text; email template only after the user approves it) | SQL dry runs; vitest for grant states; e2e trial start | P2 |
| *Release candidate (plans off)* | emulator gate, Academy + both handbooks, crawler | §11 | P1–P5 |
| **P6 Paddle** | `paddle-checkout`, `paddle-webhook`, `paddle-portal`, web `/plans` page, fixtures + replay, reconciliation job | Deno: signature (valid, tampered, wrong secret, old timestamp), idempotency (same event ×10 in parallel = one effect), out-of-order, every event type → expected row; e2e with the demo adapter | VAT number + Paddle sandbox account; P1–P5 |
| **P7 iOS IAP** (only at App Store submission) | StoreKit 2 subscriptions, App Store Server Notifications v2 → `band_plans` (`source = 'apple'`), restore purchases, US web link | Deno: notification signature (JWS) and states; Maestro on the iOS sim with a StoreKit config file | App Store submission decided |

**P6 needs no native release**: checkout and portal are web pages and Edge Functions. It ships with a web deploy and a function deploy, both on the user's word.

## 11. Testing and the release gate

The rules of `next-big-updates.md` §8 apply unchanged (failing-first, 10 device profiles, XState in the required "E2E lifecycles" check, Maestro for native-only paths, axe, 6 languages, Academy then both handbook PDFs, crawler re-run). Additions for plans:

- **Enforced off must equal today.** e2e runs every existing spec with `plans_enforced` off; the plans-off release must be indistinguishable from the beta, except the Settings → Plan entry and the notice card.
- **Enforced on, in demo.** The demo adapter flips the switch locally, so the full limit matrix runs in CI without touching production.
- **Server matrix.** The rollback dry runs of §4.4 are pasted in each server PR.
- **Emulator gate at the release candidate**: `scripts/emulator-check.sh` on the exact commit + `--duo-ok`; on the iPhone, iPad, Android emulator and Duo sim, each prompt and the plan screen in every posture, with enforced off and with enforced on (demo). The block screen on iOS and Android.
- **Launch-day drill (before 1 January, in a rollback transaction and then for real on the user's own test band)**: flip on, hit a limit from an old build and from the new build, start a trial, flip off again.

## 12. Timeline to mid-December and 1 January

Wall-clock, with the pace seen so far (A1b: about 20 minutes of coding and 20 minutes of CI). A typical PR here is 30–90 minutes of coding plus about 20 minutes of CI, plus the migration dry run and the user's OK where there is a migration. The user's answers and OKs are the slowest part.

| When | What |
| --- | --- |
| 18 Nov | This plan merged |
| 18–19 Nov | Rehearsal A2–A4 finishing (parallel session) |
| from ~19–20 Nov, on the user's go | P1 → P2 → P3a → P3b, P4 in parallel, P5 (about 6–8 PRs, ~1.5–2 working days of wall-clock including CI; migrations 160–162 applied after the user's OK) |
| ~24–27 Nov | Release candidate with plans off: emulator gate, Academy, handbooks (~half a day plus fixes) |
| early Dec | Planned notice to beta bands (the card of §5.3 switched on from the database; email on the user's OK) |
| by mid-Dec | **Release by the user**: web deploy, APK, TestFlight. About two weeks for testers to update |
| after release | Deposit tweaks (payments plan) |
| as soon as VAT + Paddle sandbox exist | P6 Paddle in sandbox (~half a day + sandbox runs), then live keys after verification; web + functions deploy on the user's word |
| before 1 Jan | Founding report shown to the user; launch-day drill |
| **1 Jan** | With the user's confirmation: founding and partner grants applied, `min_version` raised, `plans_enforced` on, `plans_trial` on, `plans_checkout` on if Paddle is live |

Slack: about two weeks before mid-December (A2–A4 end earlier than first planned, so the build can start as soon as the rehearsal session is done and the user says go). The risk is outside the code: VAT number and Paddle verification (§13, decision 2).

## 13. Decisions for the user

1. ~~**iOS sales (§8.2)**~~ **Decided 2026-11-18: A.** No sales, prices or web links on iOS while on TestFlight; IAP at the same price (plus the US web link) when the App Store submission is decided (P7).
2. ~~**If Paddle is not live on 1 January**~~ **Decided 2026-11-18:** switch the limits on anyway (founding bands have their free months, new bands get the trial); `plans_checkout` is turned on the day Paddle is verified.
3. ~~**Admins over the limit after a downgrade (§4.2)**~~ **Decided 2026-11-18:** after the grace period only the payer (or the band creator) stays admin; the others become members, warned before.
4. ~~**Minimum version on 1 January (§7.2)**~~ **Decided 2026-11-18:** block builds older than the mid-December release, with an "Update" button.
5. **Google Play** (still open, no hurry): stay APK-only for now (recommended); if Play later, external link (10%).

## 14. Sources checked (2026-11-18)

- Apple App Review Guidelines 3.1.1, 3.1.1(a), 3.1.3(a), 3.1.3(b): https://developer.apple.com/app-store/review/guidelines/
- Apple, changes for apps in the EU (2026-08-18; IAP 26%/15%, alternative processing 20%/10%, link-out 15%/10%, choice kept 12 months): https://www.apple.com/newsroom/2026/08/apple-announces-changes-for-apps-in-the-european-union/
- Apple Small Business Program: https://developer.apple.com/app-store/small-business-program/
- Epic v. Apple, US link-outs (0% since April 2025; commission to be set by the district court; Supreme Court review): https://www.macrumors.com/2026/06/30/apple-epic-games-supreme-court/, https://9to5mac.com/2026/05/06/supreme-court-rejects-apples-stay-request-epic-games-case-to-head-back-to-district-court/, https://macdailynews.com/2026/08/14/u-s-supreme-court-clears-path-for-app-store-commission-showdown-as-apple-must-defend-its-rates-in-lower-court/
- Google Play service fees from 2026-06-30: https://support.google.com/googleplay/android-developer/answer/112622, https://support.google.com/googleplay/android-developer/answer/17161464
- Android developer verification: https://android-developers.googleblog.com/2026/06/android-developer-verification.html
- Paddle Billing webhooks and signature verification: https://developer.paddle.com/webhooks/signature-verification
- Paddle sandbox: https://developer.paddle.com/build/tools/sandbox
