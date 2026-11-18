# Next big updates: rehearsal live mode with notes (A), getting paid with Stripe Connect (B)

Status: **plan only, no product code.** Written 2026-11-16, on top of `main` 030dcae (release 1.0.6 being finished).
**Update B (Stripe payments) is on hold since 2026-11-17, by the user's decision.** Only update A goes ahead; B0 (accountant, lawyer, Stripe setup) and B1 do not start until the user lifts the hold. The B sections stay as a reference. **On 2026-11-18 the user set B's flow and decisions (§4.0): Stripe optional, the invoicing admin holds the account, no member accounts, a split ledger with cash/transfer, the deposit confirms the gig, and the balance is sent with one tap.**

Work starts **after the user has tried 1.0.6**. Nothing here is decided until the open questions (§5) are answered.

Contents

1. Summary
2. What exists today (the plan builds on it)
3. Update A: rehearsals in live mode, notes to practise
4. Update B: getting paid in the app with Stripe Connect
5. Open questions (the user answers these before work starts)
6. Needs an accountant or a lawyer (not settled here)
7. Organising the work: order, PR slicing, parallel sessions
8. Regression proofing (applies to every PR)
9. Payments-specific testing, rollback and kill switch
10. Estimates, risks, definition of done per phase
11. Release plan
12. Sources checked

---

## 1. Summary

- **A first, B second** (the default, kept). A has no legal or money risk and reuses the Stage engine that already works for gigs. B has long non-code lead times (accountant, lawyer, Stripe platform setup), so its **B0 paperwork starts on day 1, in parallel with A**, and its server foundation (B1, flag off, nothing visible) can be built while A is in testing.
- **A** turns the existing Stage mode (gigs only today) into a shared live engine. Rehearsals get it without the gig's evening phases and times. Notes are attached to songs during the session (one-tap presets, free text, done/ok) and assigned to the band and/or members. Each member gets a **To practise** list on Home, on the song page and at the next rehearsal.
- **B** lets the client pay the **deposit and the final balance** from the public quote page (`/quote.html`), on Stripe-hosted Checkout. The band is the merchant of record on **its own connected account** (direct charges, Stripe-hosted onboarding, Stripe liable for losses, platform fee 0 in the pilot). The admin splits the money in the app on the existing fee model: members see only their own share. Automatic transfers to members (separate charges and transfers) are a **later, separate phase (B6)**, only after the legal answers, because it moves loss liability to the platform.
- The money never passes through the app binary: the client pays on the web page, so App Store 3.1.3(e) and Google Play's Payments policy (physical services) apply, and in-app purchase is not used.
- Every phase ships behind a **server-side, per-band feature flag** with a global **kill switch**, and goes through the same gates as today: failing-first tests, e2e on 10 profiles, XState lifecycle models in the required "E2E lifecycles" check, Maestro for native-only paths, the emulator release gate with `--duo-ok`, axe, 6 languages, Academy and both handbook PDFs, and a crawler re-run.
- **Releases are manual.** Each phase ends at "release candidate ready + gate passed". The user and their partner decide when to run the web deploy, the APK publish and the TestFlight / store builds (§11).

## 2. What exists today (the plan builds on it)

Checked in the code on `main` 030dcae.

**Live mode**
- `src/app/components/dashboard/EventDetail.tsx:678`: `canStage = eventType === 'gig' && !isPast && !isPersonalGig`. It drives the Stage button, the Duo rail action (`useRailAction`), "Go live" from Home (`startInStage`) and the Bluetooth key prefetch.
- `src/app/components/dashboard/StageMode.tsx` (830 lines): gig-day view with `steps` (the evening timeline from `gigTiming.timelineDates`), the setlist, Lyrics tab, visual click, my notes (109) and `StageLiveControls` (leader, follow, reorder, strike-off).
- `src/app/components/event/useStageLive.ts` + `src/lib/stageLive.ts`: private Realtime channel `stage:event:<id>` (migration **085**, Lamport seq) merged with Bluetooth (`useStageBle`, `src/lib/stageBle.ts`, key table **087** `stage_keys` + `bw_stage_key`). Both server checks resolve the event's `band_id` only; they **do not check `event_type`**, so a rehearsal id should already be accepted (to prove with a dry run in A1, not assumed).
- `src/app/components/duo/modes/FloorWedgeMode.tsx`: the Duo Laptop pose version of Stage mode.
- **A rehearsal live view already exists, but local-only:** `src/app/components/rehearsal/RehearsalLiveView.tsx` + `RehearsalPostView.tsx` + `src/lib/rehearsalSession.ts`. It keeps, in memory on one device, a timer, the current song, a per-song verdict (`nailed | work | problem | redo`) and check-ins. Reached only from the Home rehearsal card (`RehearsalExpanded` → `setRehearsalViewMode('live')`, `AuthenticatedApp.tsx:2269` and `:4227`). Nothing is shared with the band and nothing survives an app restart. The 11-15 Academy review listed it as "rehearsal live mode (dead code)".

**Songs and personal layer**
- Migration **109** `song_personal_notes` / `song_personal_files`: owner-only RLS, no admin exception. UI in `src/app/components/songs/PersonalLayer.tsx` (`MyNotesBar`, in `LyricsViewer` and `StageMode`), anchors in `src/lib/personalNotes.ts`.
- Rehearsal notes for the band are a **different thing** from these private notes: they are shared and assigned. The plan keeps 109 private and untouched.

**Money**
- Quotes: `src/lib/services/quoteMath.ts` (VAT, exempt / reverse charge, deposit rate), `quotePdf.ts`, `QuoteDetailModal.tsx`, wizard and Duo `QuoteDeskMode`.
- Client page `/quote.html` (`src/quote.ts`, `src/quote/strings.ts` 6 languages) on migration **099**: `quote_links`, `quote_link_versions`, `quote_activity`, token RPCs `bw_quote_link_view/seen/respond/message` granted to anon, everything else admin-only. Acceptance doesn't auto-confirm the gig.
- `src/app/components/quotes/OnlineDeposit.tsx`: "Collect the deposit online" buttons (Card · Stripe, PayPal), **visible and disabled**, gated by the constant `ONLINE_DEPOSITS_ENABLED = false` in `src/lib/services/pricing.ts:12`. Band pricing settings already have a `stripe_payment_link` text field (`BandPricingModal.tsx:1952`), printed on the PDF only when enabled.
- Payouts to members: `event_members.fee` + `paid_at`, `bw_set_member_paid` (**093**), `bw_event_member_money` (**071**), `src/lib/payoutsDue.ts` + `PayoutsDueCard` (#74), `FeePayoutsContent.tsx` (band fund = remainder). Privacy rule: **members see only their own fee and logistics** (Phase 2.3, revokes 079–081, `columnGrants.test.ts`).
- Event private money columns (`price`, `deposit_*`, `payment_status`, `client_*`) come only from `bw_event_private` (**078**) for admins.
- **Legacy to clean up:** production has unversioned edge functions `create-checkout` and `stripe-webhook` on the legacy service-role key (no caller in the app, `docs/KEY_ROTATION_2026-11.md`), and a `subscriptions` table. `bands.stripe_customer_id` exists (private column). None of it is reused.

**Plumbing**
- Edge functions in repo: `send-email`, `send-push`, `invite-member`, `deputy-calendar`, `delete-account`, `setup-invite-rls`; deployed `--no-verify-jwt` from a clean worktree, secrets `SUPABASE_SECRET_KEYS`.
- Push texts translated server-side by BEFORE INSERT triggers (088–090) from `profiles.preferred_language`; summary pushes pattern `bw_notify_setlist_saved` (107).
- Native deep link scheme `app.bandwith.mobile://` (`Info.plist`, `appUrlOpen` in `App.tsx:141`).
- Feature flags: none beyond compile-time constants. **A real flag layer is a prerequisite** (A0).
- Highest migration on `main`: 127 (124–126 not on main). Migrations are applied by hand with the user's OK, after a rollback-only dry run.

## 3. Update A: rehearsals in live mode, notes to practise

### 3.0 Status after #197 and revisions (2026-11-18, approved by the user)

**What #197 shipped** (merged 2026-11-17, `src/lib/liveMode.ts`):
- Upcoming band rehearsals open the same live screen as gigs ("Live mode"): the setlist (focus songs), lyrics and chords, transpose, click, my notes, admin leads, members follow over Realtime and Bluetooth.
- There is no run of show and no strike-off.
- No migration was needed: 085/087 check the band, not the event type.
- Tests: e2e `stage-live.spec.ts` on 10 profiles, vitest `liveMode`, `StageMode.rehearsal`, `RehearsalExpanded.live`. This covers most of A0.2/A0.3 and A1.1/A1.2/A1.4.

**What #197 removed:** the legacy local rehearsal view (`RehearsalLiveView`, `RehearsalPostView`, `rehearsalSession.ts`). With it went the timer and pause, the per-song verdicts, the check-ins and the end-of-rehearsal summary.
- This plan had said to retire it only after the new path covered them. No data was lost, since that view never saved anything, but those functions are gone today.

**Revisions (these replace the matching parts of 3.1–3.3, §5, §7.1, §10 and §11):**
1. **Timer + pause come back** in the rehearsal Live mode (small).
2. **Check-ins are dropped.** RSVP already says who comes, and tracking lateness among friends adds friction for little value. The `rehearsal_session_arrivals` table is dropped from the data model.
3. **The end-of-rehearsal summary comes back and is saved** (`rehearsal_sessions.summary`). It is where marks become notes.
4. **"Mark now, write later."** Musicians have their hands on their instruments, so typing during a song is unrealistic.
   - During a song there is one big **Mark** button. One tap records the song and the minute (`rehearsal_notes` row with `status = 'marked'`, `marked_at_s`, no preset or text yet). It works from the Duo on the amp too.
   - At the pause, or in the summary, marks become notes: a preset or text, and the assignees.
   - Anyone with a free hand can still write a full note on the spot.
   - The check becomes `status = 'marked' OR preset IS NOT NULL OR body IS NOT NULL`.
5. **Section presets ("Verse 3 to repeat") appear only when the song has structure headings** (`# Verse 1`, `# Chorus` in `songFormat.ts`). Otherwise use free text.
6. **New: open notes suggest focus songs.** When the admin creates the next rehearsal or a poll (097 `focus_song_ids`), songs with open notes are pre-selected, and the admin can untick them.
7. **New: tempo and key notes become song change suggestions.**
   - A "Tempo: 96" or "Key: F#m" note can be turned, with one tap, into a song change suggestion through the existing flow (108, `SuggestSongChangeSheet` with a prefilled note).
   - An admin note applies directly with the admin's existing editing rights.
8. **Band-editable presets are downgraded to "only if asked"** (A5 optional). The built-in translated presets come first.
9. **Later, not now:** the same notes after a gig (debrief; the model is per event, so it costs little).
10. **Not now:** audio recording of the rehearsal (storage cost on the free tiers; see the scaling plan, #203).

**Revised phases for A** (replacing the A rows in §7.1 and §10; A0.1 flags still needed):

| Phase | What | Estimate |
| --- | --- | --- |
| A1b | Flag layer (A0.1). Timer + pause in rehearsal Live mode. `rehearsal_sessions` migration (no arrivals). Saved summary (duration, songs played). `rehearsal-live` XState model. | ~2 d |
| A2 | Notes: Mark now / write later, presets (section chips only with structure), text, band / members, live sync, offline queue, Practised / OK. `rehearsal-note` model. Duo Laptop notes pad. | 3–5 d |
| A3 | To practise: Home card, song page strip, next rehearsal "From last time" + live badges. Focus-song suggestion (097). Tempo/key note → song suggestion (108). | 2–3 d |
| A4 | One summary push at session end, translated, prefs respected. Academy + both handbooks. | ~1 d |
| **Total** | | **8–11 d** |

**Releases stay manual.** Nothing goes to production (web deploy, APK, TestFlight / store) without the user's explicit confirmation. Each phase stops at "release candidate ready + gate passed".

### 3.1 Product shape

**Live rehearsal** (same engine as Stage mode, without gig phases)
- Opened from the rehearsal detail (button + Duo rail action, prominent on rehearsal day) and from the Home rehearsal card (which today opens the local view; that path is redirected to the new one).
- Shows: elapsed timer with pause (from `rehearsalSession.ts`), the rehearsal's setlist (focus songs first if a poll set them, 097), the current song large, Lyrics / Chords views, the visual click, my private notes (109).
- No evening timeline (`steps` empty: no load-in, soundcheck, doors, sets), no "next step" banner, no overnight roll.
- Leader = band admin (as for gigs). Members follow by default; own step = follow off. Bluetooth works offline in the rehearsal room (same key table 087).
- Check-ins (who arrived, late) move from the old local view into the live view; End session leads to a summary that is **saved** (today it is lost on restart).
- Recurring rehearsals share one event id: everything session-related is keyed by `(event_id, occurrence_date)`, as `sessionKey()` already does.

**Notes per song while rehearsing**
- On the current song: a row of **one-tap presets**, a **free text** field, and the **assignee** picker: Band, or one or more members (lineup of this rehearsal first).
- Built-in presets (translated through `src/lib/i18n/builtins.ts`, stored as keys, not text). Proposed first set, wording to confirm with the user:
  `Review` ("Da rivedere"), `Solo OK` ("Solo ok"), `Repeat a section` ("Strofa 3 da ripetere / approfondire", with a section picker from the song's `# Verse 3` headings in `songFormat.ts`), `Tempo`, `Ending`, `Nailed it`.
- The four old verdicts become presets (`nailed` → Nailed it, `work`/`problem` → Review, `redo` → Repeat), so there is one concept, not two.
- Each note has a state per assignee: **open → practised** (the member ticks it at home) and a band-level **ok** (confirmed at a later rehearsal). See question Q-A4 on who closes.
- Notes appear live for everyone in the session (Realtime), and are queued offline (offline queue, as other writes) when the room has no signal.

**To practise (per member)**
- **Home card** "To practise": songs with open notes assigned to me or to the band, grouped by song, newest rehearsal first.
- **Song page** (LyricsViewer): a "From rehearsal" strip above My notes, with the note, who wrote it, the rehearsal date, and Practised.
- **Next rehearsal**: the overview shows "From last time" (open notes on songs in its setlist), and in live mode each song carries a badge with its open notes, so the band can mark them **ok** or keep them.
- Optional "Copy to my notes" turns a band note into a private 109 note anchored on the song.

**Duo and iPad**
- Laptop pose: top half = song / lyrics (FloorWedgeMode), bottom half = **notes pad** (presets, assignees, text). Closed cover: compact live view with the presets as a horizontal strip. Book / iPad: setlist pane + song + notes side by side.

### 3.2 Data model (A)

All new, additive. Migration numbers: take the next free number at the time, and **reserve a block per update** to avoid the clashes seen with 085/086/087 (proposal: A = 130–134, B = 140–154; check `ls supabase/migrations` and open PRs first).

- `rehearsal_sessions` (`id`, `band_id`, `event_id`, `occurrence_date`, `started_at`, `ended_at`, `started_by`, `paused_ms`, `summary jsonb`), unique `(event_id, occurrence_date)`. Read: active band members. Write: band admins (and the leader).
- `rehearsal_session_arrivals` (`session_id`, `user_id`, `arrived_at`). Members write their own row; admins any.
- `rehearsal_notes` (`id`, `band_id`, `event_id`, `occurrence_date`, `session_id` nullable, `song_id` nullable, `preset` text nullable (key), `section` text nullable, `body` text nullable (1–1000 chars), `scope` `'band' | 'members'`, `status` `'open' | 'ok'`, `created_by`, `ok_by`, `ok_at`, `created_at`, `updated_at`). Check: `preset IS NOT NULL OR body IS NOT NULL`.
- `rehearsal_note_assignees` (`note_id`, `user_id`, `practised_at`), PK `(note_id, user_id)`.
- `band_note_presets` (A5 only, if Q-A3 says yes): `band_id`, `key`, `label`, `position`, `archived`.
- RLS per the answers to Q-A1/Q-A2 (default proposed in §5). No anon grants anywhere. Column grants explicit (the repo rule since 079–081: any new column the app reads goes in a GRANT; extend `columnGrants.test.ts`).
- Realtime: add `rehearsal_notes`, `rehearsal_note_assignees`, `rehearsal_sessions` to `supabase_realtime` (as 082).
- Push: one **summary** push per assignee when the session ends ("3 songs to practise"), written by a SECURITY DEFINER function like `bw_notify_setlist_saved` (107), translated by the 090 trigger, respecting `notificationPrefs`. Never one push per note.
- Demo mode: the demo client gets the same tables (demo DB key bump, as `bw-demo-db-v6`), so e2e and XState run without Supabase.

### 3.3 Code shape (A)

- **A0 refactor first, behaviour-identical:** split `StageMode` into a shell + gig parts. The live engine (`useStageLive`, BLE, setlist, click, lyrics, my notes) becomes event-type neutral; gig-only pieces (`steps`, timeline, overnight roll, strike-off of tonight) stay in a gig slot. `canStage` becomes `canGoLive(event)` in a pure module (`src/lib/liveMode.ts`) with a test table: gig yes, rehearsal yes (flag), personal gig no, past no.
- New pure modules with vitest: `src/lib/rehearsalNotes.ts` (preset keys, grouping for To practise, carry-over rules, who may close), `src/lib/rehearsalSession.ts` extended (persisted session mapping).
- Service: `src/lib/services/rehearsalNotes.ts` (offline-queue aware, explicit column lists).
- UI: `src/app/components/rehearsal/live/` (live shell for rehearsals, NotesPad, AssigneePicker), `ToPractiseCard` (Home), `FromRehearsalStrip` (song page). Layers portal to `<body>` (the hub-clipping rule from #147).
- `RehearsalLiveView`/`RehearsalPostView` are retired only after the new path covers check-ins and the summary (A1), with their tests ported first.

## 4. Update B: getting paid in the app with Stripe Connect

### 4.0 The user's flow and decisions (2026-11-18)

These decisions replace the matching parts of 4.1–4.8, §5, §7.2 and §10. B stays **on hold for building** until the user says to start; this records the design.

**The flow the user wants**
1. Create the quote.
2. Send it.
3. The client sees it and pays the deposit.
4. The money arrives and the app updates every status.
5. The gig.
6. During the evening the app prepares the final balance (without the deposit).
7. The client receives it and pays.
8. The money arrives and the app notifies.
9. The admin divides the gig's money with the members and pays them.

**Decisions**
- **Stripe is an optional extra, never required.** Bank transfer and cash keep working exactly as today. A band turns on card payments only if its invoicing admin connects a Stripe account. Bands without Stripe see no change (flag off = today's screens, byte-identical).
- **The admin always invoices the client**, so the Stripe account belongs to **the invoicing admin** (as an individual or a business). Other admins of the band see the payment statuses but don't manage the account. This answers Q-B1.
  - If that admin leaves the band, card payments switch off for new requests until another admin connects their own account. Past payments stay readable.
- **No friction for members: no member ever needs a Stripe account.** Automatic member payouts (**B6**, separate charges and transfers) are **dropped**, together with the platform liability, member KYC and held-funds questions. Direct charges on the admin's account stay the only model.
- **Splits = ledger only (B5).**
  - The app proposes each member's share from the fees already on the gig; the remainder goes to the band fund.
  - The admin pays each member by hand and records **how**: cash, bank transfer or other. This needs a `paid_method` column next to `event_members.paid_at` in a new migration, with its GRANT, and `bw_set_member_paid` extended.
  - A member sees only their own share, whether it is paid, when, and how.
  - Payouts due (#74) keeps working unchanged.
- **The deposit paid confirms the gig automatically.**
  - On the webhook for a paid deposit, the server does what `gigFromAcceptedQuote` (`src/lib/services/quotes.ts`) does today in the admin's app: the tentative event becomes confirmed, or a confirmed event is created from the quote with its lineup. Then the usual lineup notifications go out.
  - To keep one source of truth, that logic moves into one SECURITY DEFINER RPC that both the app and the webhook call. The tests pin today's behaviour first (the `quote` XState model).
  - It is idempotent: a confirmed gig stays confirmed, and replayed events do nothing.
- **The balance is prepared automatically and sent with one tap.**
  - When the gig's last set starts (from the run of show; or at the show's end time if there are no sets), the app prepares the balance request: total minus the deposit received minus any refunds.
  - The admin gets a push: "Balance ready: €X. Send?". One tap sends it through the same quote link and email (template previewed and approved by the user first). Edits before sending are possible (extra hour, extras).
  - Nothing is sent without that tap.
- **Invoices (needs the accountant, §6).** The app does not issue Italian fiscal invoices in the pilot.
  - It prepares the deposit request and the **balance request** (non-fiscal) and stores the number of the real invoice the admin issues in their own software.
  - Under the general Italian VAT rule an advance payment normally needs its own invoice when it is received, and the balance invoice then refers to it. The accountant confirms this for each regime (ordinary, flat-rate…).
  - Sending e-invoices to SDI through a provider's API is a possible later phase (B8), only if the accountant says it is worth it.
- **Clients can still pay outside the app** (cash, bank transfer). The admin marks the deposit or balance received by hand, as today.

**Deposit tweaks without Stripe (decided 2026-11-18, ~2–3 d).** Today the client can only accept on `/quote.html`. Bank details are only on the PDF, and **nothing in the app ever writes `events.deposit_paid`**, so readiness keeps saying the deposit is due.

The four tweaks:
1. The admin marks **Deposit received** with a method (transfer / cash / other). That sets `deposit_paid` and **confirms the gig** through the shared RPC.
2. After Accept, the quote page shows how to pay: amount, IBAN, a payment reference with the quote ref, and a due date if set. Client-facing only, through the token RPC.
3. The acceptance text names the deposit to be paid (neutral wording, not a signature).
4. The band's own payment link (the existing `stripe_payment_link` / PayPal.me field), if set, appears on the page and the PDF. Receipt is still marked by hand.

**Order agreed with the user (11-18):** egress fixes #206 → rehearsal A1b → A2 → A3 → A4 → **deposit tweaks** → one release candidate with the emulator gate. One app change at a time. The Stripe phases (B1+) stay on hold.

**Revised B phases** (B6 removed):

| Phase | What | Estimate |
| --- | --- | --- |
| B0 | Accountant (invoicing regime of the admin, deposit invoice, cash payments to members), Stripe platform account and its legal owner, remove legacy prod functions | user time |
| B1 | Server foundation (flag off): migrations, webhook with signature + idempotency, money module, demo adapter | 3–4 d |
| B2 | Optional Stripe connection for the invoicing admin (Settings → Payments), hosted onboarding, deep link back | 2–3 d |
| B3 | Pay the deposit from the quote page. Statuses + pushes. **Gig auto-confirmed** (shared RPC). Refunds. | 3–5 d |
| B4 | Balance prepared at the last set, push "Send?", one-tap send, pay the balance, fiscal invoice number fields | 3–5 d |
| B5 | Split ledger with payment method (cash / transfer / other), member sees own line, CSV export | 2–3 d |
| B7 | Reconciliation, kill switch drill, runbook (before any live key) | 2–3 d |
| **Total** | | **15–23 d** |

**Releases stay manual:** nothing goes to production without the user's explicit confirmation.

### 4.1 Recommended Connect model

Stripe now treats Standard / Express / Custom as **legacy account types** and recommends the **Accounts v2 API** (configurations + responsibilities) for new platforms. The plan uses v2 terms and gives the legacy equivalent in brackets.

**Who is the connected account**
- **One connected account per band**, with the *merchant* configuration, opened by the band admin who onboards (as an individual / sole trader or as the band's company: Stripe asks). This matches how the band invoices its client today (band name, IBAN in pricing settings). It also matches the privacy rule: money in belongs to the band; members see only their share.
- Not the BandWith platform as merchant, and not each member as merchant.
- **Members** get an account only in **B6** (automatic transfers), with the *recipient* configuration (receives transfers, no card payments). Until then, members get nothing new to onboard.

**Charge type for B3–B5: direct charges on the band's account**
- The Checkout Session is created on the band's account (`Stripe-Account` header). The band is the business of record, its name is on the client's statement, funds settle in the band's country.
- Responsibilities: `fees_collector = stripe`, `losses_collector = stripe`, `dashboard = full` (legacy: Standard-like). Stripe collects KYC, Stripe fees are taken from the band's balance, refunds and disputes hit the band's balance, not the platform's. This keeps a solo platform owner out of the loss chain during the pilot.
- `application_fee_amount = 0` in the pilot (no platform fee). Q-B3.
- Consequence: the band can also refund from its own Stripe Dashboard. The webhook and the reconciliation job must accept changes that did not start in the app (`charge.refunded`, `charge.dispute.created` from the Connect endpoint).

**Splits**
- **B5 (ledger, recommended for the pilot):** the admin splits a received payment in the app (defaults from `event_members.fee`, remainder to the band fund, as `FeePayoutsContent` does). The band pays members as today (bank transfer). Marking paid uses `bw_set_member_paid` (093), so Payouts due (#74) keeps working unchanged. Members see only their own line.
- **B6 (automatic transfers, optional, after §6 answers):** Stripe can only move money from the **platform** balance to connected accounts, not from one connected account to another. Automatic member payouts therefore need **separate charges and transfers**: the charge on the platform (optionally `on_behalf_of` = band, so the band stays business of record), then one transfer to the band and one per member (`transfer_group` = the payment request, `source_transaction` = the charge so a transfer never runs before the funds are available).
  - Trade-off: refunds, disputes and negative balances then debit the **platform** balance. The platform can reverse transfers, but not if the member already paid the money out. Platform owner liability is the reason B6 waits for the lawyer.
  - Destination charges don't fit: one charge, one destination account.
  - Regions: cross-border transfers work only between platforms and accounts in the US, UK, EEA, Canada and Switzerland, and not with `on_behalf_of`. In practice B6 = band and members in the same region as the platform.

**Country scope**
- The app's languages point to Italy, Spain, France, Germany, Portugal and Brazil, plus English speakers.
- Pilot: **Italy only** (or the EEA), one band. Brazil is **out of scope**: it isn't in the self-serve cross-border regions, and the account and tax rules differ (Q-B4).

### 4.2 Onboarding and KYC

- **Band (B2):** Settings → Payments (admin only), shown only when the band's flag is on.
  - "Set up payments" calls `payments-connect`. It creates the v2 account (country from a picker, default from band settings, **it can't be changed later**) and returns a Stripe-hosted onboarding link (Account Link), opened in the system browser.
  - `return_url` / `refresh_url` are https pages on bandwith-beryl.vercel.app (`/pay/return`, `/pay/refresh`). They hand off to `app.bandwith.mobile://payments/return` in the native apps, or to the app's Settings on the web.
  - The status shown comes from the webhook (`account.updated` or v2 equivalents), never from the redirect: Not started / Needs info (`requirements` due, with "Continue setup") / Ready to accept payments / Restricted.
- **Another admin of the same band** sees the status but can't take over the account. If the onboarding admin leaves the band, the account stays with the band and re-onboarding goes through Stripe (Q-B1).
- **Members (B6 only):** "Get paid directly" in the member's own profile. Recipient onboarding works the same way, through hosted pages.
  - **A member not yet onboarded:** their split is kept as `held_not_onboarded`. The admin sees "Waiting for Marco to set up payouts" and can pay them by hand instead (marked paid, as today).
  - The held amount stays in the platform balance until the member onboards or the admin pays by hand.
  - Stripe can't hold funds forever. The pilot rule: release or pay by hand within N days (Q-B7).
- KYC data never touches BandWith's database. We store only the account id, country, capability flags, and a list of due requirements without values.

### 4.3 Money flow

- **Deposit (B3):** after the client accepts on `/quote.html`, the page shows "Pay the deposit · €X" (amount from the accepted version). That creates a Checkout Session for the open `payment_request` (kind `deposit`). Card, Apple Pay and Google Pay come through dynamic payment methods. Checkout's language follows the client's language (`quote_links.lang`).
  - Success returns to `/quote.html?t=…&paid=1`, which only says "Processing". The paid state comes from the webhook.
  - The admins get a push (translated, as 099). `events.deposit_*` / `payment_status` are updated through a SECURITY DEFINER RPC, so the existing admin UI shows it unchanged.
- **Final balance (B4):** after the gig (or on a date the admin sets), the admin issues the **final payment request** and its document (see 4.4), sent through the same quote link and email (`send-email` template, preview and approval by the user first, as the rule says). Reminders: the admin can send them by hand, and B4b may add automatic ones.
- **Pay in person:** the admin shows the payment link as a QR code for the client's own phone. No card is taken in the app.
- **Refunds:** the admin clicks Refund (full or partial) in the app, then gives a reason. That calls `payments-refund` with an idempotency key. Refunds made in the Stripe Dashboard are picked up by the webhook.
  - **After a split was paid (B5 ledger):** the app flags the split "Refunded after payout". The admin decides how to settle it with members, and the app doesn't move money.
  - **After a split was paid (B6):** the platform reverses the transfers in proportion, as far as each connected balance allows. Anything left is logged as a reconciliation issue for the user to resolve.
- **Disputes / chargebacks:** `charge.dispute.*` events set the payment to `disputed` and notify the admins. With direct charges the dispute amount and fee come out of the band's balance. Evidence is submitted in the band's Stripe Dashboard (no in-app evidence flow in the pilot). B6 is as above, with a platform debit and transfer reversal.
- **Payouts to the band's bank:** Stripe's default schedule on the band's account, visible in its Dashboard. The app shows "Paid out" only from `payout.*` events, if the user wants it (nice to have).
- **Fees:** Stripe's processing fees are taken from the band's balance (direct charges), and the platform fee is 0 in the pilot. The app shows net = gross − Stripe fee, read from the balance transaction, on the payment row.
  - Passing card fees on to consumers is restricted in the EEA (surcharge rules). **The app offers no surcharge option** (§6).
- **Bank transfer stays:** clients can still pay by bank transfer. The admin marks it received, as today. `ONLINE_DEPOSITS_ENABLED` is replaced by the per-band flag, and with the flag off nothing changes.

### 4.4 Invoicing and tax (needs an accountant, see §6)

- The app already computes VAT, exemptions and reverse charge on quotes (`quoteMath.ts`). The plan **doesn't assume the app's document is a valid tax invoice** in any country.
- Proposed default (B4), pending the accountant:
  - The app issues a **"Final payment request"** (pro-forma style) PDF in the client's language: lines, VAT as computed, deposit already paid, balance due, payment link, bank details.
  - The band's **fiscal invoice number and date** can be entered (or later imported) and are printed or linked. The fiscal invoice is issued in the band's own invoicing tool.
  - **Italy:** a fiscal invoice goes through SDI (fattura elettronica, FatturaPA XML). The app does not send to SDI. Integrating an accredited SDI intermediary is a possible later phase (B8), only if the accountant says it is worth it.
  - **Elsewhere:** France (e-invoicing mandate from September 2026, SMEs from September 2027 per secondary sources), Spain (Veri*Factu / Crea y Crece, dates moved more than once), Germany (B2B receiving since 2025, issuing phased 2027–2028), Portugal (certified invoicing software, ATCUD / QR) and Brazil (NFS-e) all have their own rules. The app's document must say what it is ("not a tax invoice") wherever the accountant says so.
- Stripe Tax and Stripe Invoicing are **not** assumed. They may help outside Italy, but they don't produce an SDI e-invoice.

### 4.5 Store rules (checked 2026-11-16)

- **Apple App Review Guideline 3.1.3(e), Goods and Services Outside of the App:** an app that lets people buy services consumed outside the app must use purchase methods **other than** in-app purchase. A live music performance is such a service. Also relevant: **3.1.1** keeps in-app purchase mandatory for unlocking features in the app, so any BandWith subscription (the "Coming soon" `UpgradePricingSheet`) is a separate matter and is out of scope here. **3.1.3(d)** (one-to-few real-time services must use IAP) covers digital services delivered in the app, not a band playing at a venue.
- **Google Play Payments policy, Section 3:** Play's billing system must not be used for payments that are primarily for physical services (live event tickets are among the examples), so Play Billing is not required.
- The card is entered by the **client on the web page**, never in the app. The app only onboards the band (hosted pages in the browser) and shows statuses, QR codes and links.
- To do at submission: update App Review notes (how payments work, who pays whom), App Privacy labels (financial info: none collected by the app; Stripe collects it on the web), Data safety form on Play, Terms and Privacy (Stripe as processor).

### 4.6 Server side

**Edge functions** (all new, in the repo, deployed `--no-verify-jwt` from a clean worktree like the others; each verifies the caller itself):

| Function | Caller | Does |
| --- | --- | --- |
| `payments-connect` | band admin (JWT checked in code, admin of that band) | create/fetch the band's account, create onboarding link, return status |
| `payments-checkout` | `/quote.html` (token) or admin (QR) | create a Checkout Session for an **open** payment request. The amount is read from the DB, never from the request. Idempotency key `pr:<id>:v<version>`, metadata `{band_id, quote_id, payment_request_id}`. |
| `payments-refund` | band admin | full/partial refund, idempotency key `rf:<payment_id>:<n>` |
| `stripe-webhook` | Stripe | two endpoints, two signing secrets: **platform** events and **Connect** events (direct-charge events arrive on the Connect endpoint with `account`) |
| `payments-reconcile` | schedule (pg_cron or a scheduled Action calling it with a secret) | compare Stripe balance transactions / charges / refunds / disputes since the last run with the DB; write issues; notify the user |
| `payments-transfer` (B6) | server only (from webhook / admin approve) | transfers per split with `source_transaction`, idempotency key `tr:<split_id>` |

**Webhook rules**
- Verify the signature on the **raw body** with `stripe.webhooks.constructEventAsync` and the SubtleCrypto provider (Deno). Reject on a bad signature or an old timestamp (400).
- **Idempotency:** `INSERT INTO stripe_events(id, …) ON CONFLICT DO NOTHING`. If the row already exists and is processed, return 200 and do nothing.
- Processing goes through one SECURITY DEFINER RPC per effect, inside a transaction.
- On a processing error: return 500 so Stripe retries, and keep the row with the error for replay.
- **Order is not guaranteed:** state changes use the object fetched from the API (or a monotonic status rank), never "the last event wins".
- Unknown event types: store, then return 200.
- Remove the unversioned legacy `create-checkout` / `stripe-webhook` from production first (after confirming no caller and no endpoint registered in any Stripe account), so nothing old shares a name.

**Data model (B)** (block 140–154, additive, each with a rollback-only dry run that impersonates admin / member / outsider / anon, then the user's OK):
- `band_payment_accounts` (`band_id` PK, `stripe_account_id` unique, `country`, `currency`, `charges_enabled`, `payouts_enabled`, `requirements_due jsonb` (keys only), `onboarded_by`, `updated_at`). No direct grants; admins read through `bw_band_payment_account(band)`.
- `payment_requests` (`id`, `band_id`, `quote_id`, `event_id`, `kind` deposit|balance|full, `amount_cents` int, `currency`, `status` (see the lifecycle model), `version`, `due_date`, `checkout_session_id` unique, `payment_intent_id` unique, `charge_id`, `fee_cents`, `net_cents`, `created_by`, timestamps). Admin-only. The client page gets only `{kind, amount, currency, status}` for its own token, through an extended `bw_quote_link_view` (or a new token RPC, granted to anon explicitly).
- `payment_refunds`, `payment_disputes`: one row per Stripe object, unique on the Stripe id.
- `payment_documents` (B4): `id`, `band_id`, `event_id`, `quote_id`, `kind` final_request, `number`, `issue_date`, `lines` snapshot, totals, `lang`, `pdf_ref`, `fiscal_number`, `fiscal_date`, `fiscal_status`. Admin-only.
- `payment_splits` (B5): `payment_request_id` or `event_id`, `user_id` (null = band fund), `amount_cents`, `status` planned|paid_manual|held_not_onboarded|transferring|paid|reversed|failed, `transfer_id` unique, `reversal_id`, `paid_at`. A member reads only their own row through an RPC (the `bw_event_member_money` pattern). Sums are checked by a constraint trigger: total splits ≤ net received.
- `member_payment_accounts` (B6): own row only.
- `stripe_events` (`id` PK, `type`, `account`, `livemode`, `created`, `received_at`, `processed_at`, `error`, `payload` without card/PII fields beyond Stripe ids). **No grants** to anon or authenticated.
- `band_features` (`band_id`, `key`, `enabled`, `updated_at`) and `platform_switches` (`key` PK, `enabled`): read through `bw_band_features(band)`, written only by the service role (the user flips them via SQL or a tiny admin script).
- All money in **integer cents** with a currency per band (`pricing_currency`, 077). Rounding is shared between the app and the functions in `supabase/functions/_shared/money.ts`, re-exported to `src/lib/payments/money.ts` (the `deputy-calendar` pattern), so client and server compute the same numbers.
- Existing columns (`events.deposit_*`, `payment_status`) are written only through RPCs, and the 078/081 grants stay as they are.

### 4.7 Security

- **No secret key in the app, the web bundle or the repo.**
  - Functions read `STRIPE_SECRET_KEY` (a **restricted key** with only the permissions needed, if Stripe's restricted keys cover the Accounts v2 calls; else the secret key), `STRIPE_WEBHOOK_SECRET_PLATFORM` and `STRIPE_WEBHOOK_SECRET_CONNECT` from Supabase function secrets.
  - Test and live keys are different secrets. A function refuses to run if `livemode` doesn't match `PAYMENTS_MODE`.
- The browser needs **no Stripe key at all** with hosted Checkout and hosted onboarding. If Stripe.js is ever used, only the **publishable** key goes in `.env.production` (as the Supabase one does).
- The repo is **public**: no keys in fixtures, no real account ids in tests. GitHub Actions get only **test-mode** secrets, only on `main` and same-repo branches (forks never get them), and the required checks never need them (they use the demo adapter and recorded fixtures).
- Amounts and accounts always come from the DB. A token can only pay its own quote's open request. Rate limits on `payments-checkout` per token and IP.
- Logs: event ids and types only, never full payloads, emails or names.
- Key rotation procedure added to `docs/KEY_ROTATION_2026-11.md`. Rotate on any suspicion. The webhook keeps accepting the old signing secret during a rotation window.

### 4.8 Rollout

Each step below starts only when the user decides (releases are manual, see §11). The plan prepares each one up to "release candidate ready + gate passed".

1. **Test mode end to end** (sandbox): onboarding with test data, deposit, balance, refund, dispute (test cards), payout simulation, reconciliation. Run on all devices (§8) and by the user.
2. **Live, internal:** the user's own band with a real €1–€5 payment from the user's own card, a refund, and reconciliation the next day.
3. **Live pilot:** one real band (the partner's?), flag on for that band only, for 2–4 weeks with a daily reconciliation report to the user.
4. **Wider:** per-band opt-in. B6 stays a separate later decision.

## 5. Open questions (the user answers these before work starts)

My proposed default is in **bold**. A default is used only if the user agrees.

**Update A**
- **Q-A1 Who can write and assign notes?** **Admins write and assign to anyone. Members write notes for the band or for themselves, but can't assign to other members.** Alternative: only admins write.
- **Q-A2 Do members see notes assigned to others?** **Yes, all rehearsal notes are visible to the whole band (they are musical, not money), and To practise filters to mine plus band.** Alternative: assignees and admins only.
- **Q-A3 Are presets editable per band?** **Built-in translated presets in A2. Band presets (add, rename, hide) in A5.**
- **Q-A4 Who closes a note?** **The assignee marks "Practised" for themselves. The note becomes "OK" when an admin (or its author) confirms it at a rehearsal. Band-wide notes are closed by an admin.**
- **Q-A5 Do assignees get a push?** **One summary push per member when the session ends, nothing per note, and it respects notification settings.** Optional reminder the day before the next rehearsal.
- **Q-A6 Who leads the live rehearsal?** **The band admin, as for gigs.** A "hand the lead to…" option can come later.
- **Q-A7 Notes on songs outside the setlist, or a general note with no song?** **Both allowed. A song can be added to the session on the fly.**
- **Q-A8 What happens to the preset wording** ("Da rivedere", "Solo ok", "Strofa 3 da ripetere/approfondire")? The user confirms the list and the English keys.
- **Q-A9 (added 11-18) Drop check-ins?** **Yes, RSVP already covers who comes** (see 3.0).
- **Q-A10 (added 11-18) "Mark now, write later" during songs?** **Yes, one big Mark button, with details at the pause or in the summary** (see 3.0).
- Q-A3 is revised: band-editable presets only if the band asks for them.

**Update B**
- **Q-B1 Who owns the band's Stripe account?** **Answered 11-18: the admin who invoices the client** (§4.0).
- **Q-B2 Who is the platform?** The Stripe platform account needs a legal owner (the user as sole trader? a company?). This must be settled before any live key (see §6).
- **Q-B3 Platform fee?** **0% in the pilot.** Later: a percentage, a flat fee, or part of a subscription.
- **Q-B4 Countries in the pilot?** **Italy only. Brazil excluded.** The US later.
- **Q-B5 Payment methods?** **Card + Apple Pay / Google Pay through Checkout.** SEPA Direct Debit or bank transfer through Stripe later, because settlement is slower.
- **Q-B6 Is the app's final document a tax invoice?** **No, it's a "final payment request". The band issues the fiscal invoice in its own tool.** The accountant decides.
- **Q-B7 When can members be paid out of a payment, and how long can a split wait for a member who has not onboarded?** **After the gig is over and the funds are available, and for B6 a hold of at most N days, then the admin pays by hand.**
- **Q-B8 Automatic member payouts (B6) at all?** **Answered 11-18: no.** Members never need a Stripe account; the ledger (B5) records cash / transfer / other (§4.0).
- **Q-B9 Which band is the live pilot?** Who is its admin, and in which country is it registered?
- **Q-B10 Deposit policy texts** (refundable or not, cancellation terms): the band's own, shown on the quote page? **Yes, from the band's quote terms. The app doesn't define them.**

## 6. Needs an accountant or a lawyer (not settled here)

None of the points below is a conclusion. They are questions to put to professionals. Dates are from secondary sources as of November 2026.

**Lawyer**
1. **Legal owner of the platform** and what the Stripe Connect platform agreement makes the platform liable for.
   - With direct charges (B3–B5) the band / Stripe carries losses. With B6, the platform carries refunds, disputes and negative balances.
2. **Whether collecting and splitting money for bands (B6) needs a payment licence** or is fully covered by Stripe's licence (for example the commercial-agent exemption or "platform as agent" wording in the EU).
3. **EU DAC7 platform reporting.** Performing a gig may count as a "personal service" (no minimum threshold for personal services), and DAC7 has an exclusion for platforms that only process payments.
   - Is BandWith a "platform operator" in B3–B5, in B6, or never?
   - If yes, it must collect seller data and report it every year.
4. **Consumer law** for clients who are consumers: payment terms, cancellation and refunds, information on the quote page.
   - Also the **ban on card surcharges** in the EEA. The plan offers none.
5. **Terms of Service and Privacy Policy** updates: Stripe as processor, data shared with Stripe, roles (band = merchant, BandWith = software), GDPR processor terms with bands.
6. **US**, if ever in scope: 1099-K / 1099-NEC reporting for payouts to musicians.

**Accountant**
1. **Italy, fattura elettronica via SDI:**
   - Which bands must issue e-invoices (including flat-rate / forfettario regimes) and when.
   - Whether the app's "final payment request" is acceptable as a non-fiscal document.
   - Whether integrating an SDI intermediary is worth it.
   - Also: stamp duty on VAT-exempt invoices (marca da bollo), and when it applies.
2. **Italy, performers:**
   - Social security for performing artists (INPS ex-ENPALS, *certificato di agibilità*).
   - Withholding tax when a band (a company or a person) pays members.
   - Whether in-app splits change who must do what.
3. **VAT:** on gig fees (the app already supports rates, exempt, reverse charge), and on a future platform fee (who invoices it and where VAT is due).
4. **Other countries in the app's languages:**
   - France: e-invoicing via accredited platforms from September 2026, SMEs from September 2027.
   - Spain: Veri*Factu and the Crea y Crece B2B mandate, dates moved several times.
   - Germany: B2B e-invoices received since 2025, issuing phased 2027–2028.
   - Portugal: certified software, ATCUD / QR.
   - Brazil: NFS-e.
   - For each: what the app's document may and may not claim to be.
5. **Bookkeeping:** what export bands need from the app (CSV of payments, refunds, fees, splits) for their accountant.

## 7. Organising the work: order, PR slicing, parallel sessions

**Principles**
- Small PRs, each mergeable on its own, each either invisible (refactor, server-only, flag off) or complete for its slice.
- No PR touches both A and B.
- A shared file that two sessions both need (i18n dictionaries, `e2e/FLOWS.md`, `docs/lifecycles` (generated), `academy/content`, `AuthenticatedApp.tsx`, `SettingsView.tsx`) is changed by **one session at a time**. Other sessions rebase.
- Migration numbers come from the reserved blocks (A 130–134, B 140–154).

### 7.1 Update A phases and PRs

> **Superseded on 2026-11-18 by the revised phases in 3.0** (#197 shipped most of A0 and A1). The table below is kept for reference.

| Phase | PRs (each its own PR) | Depends on |
| --- | --- | --- |
| **A0 Groundwork** | A0.1 flag layer: `band_features` + `platform_switches` migration, `bw_band_features`, `src/lib/flags.ts` with a demo adapter, tests (shared with B). A0.2 characterisation tests that pin today's gig Stage mode (vitest on `StageMode` render, e2e `stage.spec.ts`, XState `stage-gig` model): they must pass **before** the refactor. A0.3 refactor StageMode into a type-neutral live shell + gig slot, `canGoLive()` pure module; zero visible change, all A0.2 tests still green. | none |
| **A1 Live rehearsal** | A1.1 dry run proving 085/087 accept a rehearsal id for members/admins/outsider (expect no migration; write one only if it fails). A1.2 rehearsal live in EventDetail + Duo rail + Home card redirect, no steps, timer/pause, check-ins, flag `rehearsal_live`. A1.3 sessions persisted (migration `rehearsal_sessions` + arrivals), saved summary, old `RehearsalLiveView`/`PostView` retired after their tests are ported. A1.4 Duo Laptop (FloorWedgeMode for rehearsals), closed cover, iPad. | A0 |
| **A2 Notes** | A2a data: migration notes + assignees + RLS + realtime, service, pure lib, demo tables, vitest (**can run in parallel with A1.2–A1.4**: files disjoint). A2b UI: NotesPad (presets, text, assignees), live sync, offline queue, done/ok. | A2a ∥ A1; A2b after A1.2 and A2a |
| **A3 To practise** | A3.1 Home card. A3.2 song page strip (LyricsViewer, next to MyNotesBar, 109 untouched). A3.3 next rehearsal "From last time" + live badges + mark OK. | A2b |
| **A4 Push** | summary push at session end (SECURITY DEFINER + 090 translation), notification prefs, Academy article. | A2b |
| **A5 Polish** | band presets (if Q-A3), copy to my notes, analytics hook (optional). Then handbook PDFs both languages. | A3, A4 |

### 7.2 Update B phases and PRs

| Phase | PRs | Depends on |
| --- | --- | --- |
| **B0 Decisions & accounts** (no code) | Answers to §5 B and §6. Stripe platform account in the right legal name, platform profile, sandbox, webhook endpoints registered in test mode. Legacy `create-checkout` / `stripe-webhook` removed from prod (after a check). | none; **starts day 1, parallel to A** |
| **B1 Server foundation** (flag off) | B1.1 migrations: payment accounts, requests, refunds, disputes, stripe_events, grants + `columnGrants`. B1.2 `_shared/money.ts` + `src/lib/payments/*` pure (amounts, statuses as a reducer) + vitest. B1.3 `stripe-webhook` (signature, idempotency, two endpoints) + Deno tests on recorded fixtures + replay script. B1.4 demo payments adapter (fake Checkout page in demo `/quote.html`), so e2e and XState run without Stripe. | A0.1 (flags); runs **parallel to A1–A3** (files disjoint: `supabase/functions/*`, `src/lib/payments/*`, new migrations) |
| **B2 Band onboarding** | `payments-connect`, Settings → Payments (admin), return pages, deep link back, statuses from webhook, Maestro flow out-and-back. | B1, and **after A ships** (UI work waits for 1.1.0) |
| **B3 Deposit** | `payments-checkout`, Pay the deposit on `/quote.html`, success/processing states, admin push, `events.deposit_*` via RPC, refund from the app, QR "pay on the client's phone". Replaces `ONLINE_DEPOSITS_ENABLED`. | B2 |
| **B4 Final balance** | final payment request document (6 languages, client language), fiscal number fields, send by link/email (template preview → user approval → deploy), manual reminders. | B3, accountant's answer on Q-B6 |
| **B5 Splits ledger** | split sheet on the payment (defaults from member fees), member's own line only, "paid by hand" through 093, refund-after-payout flag, CSV export. | B3 (B4 not required) |
| ~~**B6 Automatic payouts**~~ (dropped 11-18, §4.0) | member recipient onboarding, separate charges and transfers for new requests, held state, reversals. | lawyer's answers, B5 |
| **B7 Ops** | `payments-reconcile` + daily report, kill switch drill, monitoring (failed webhooks count, stuck processing > 1 h), runbook. **Before the live pilot.** | B3 |

### 7.3 What can run in parallel sessions

| At the same time | Why it's safe |
| --- | --- |
| A (any phase) ∥ **B0** | B0 is paperwork and Stripe Dashboard setup, no repo files |
| A1.2–A1.4 ∥ **A2a** | A2a touches only a new migration, `src/lib/rehearsalNotes.ts`, `src/lib/services/rehearsalNotes.ts`, demo tables; A1 touches the live UI |
| A1–A3 ∥ **B1** | B1 is server-only + pure modules + new migrations in its own block; no i18n, no UI, no `AuthenticatedApp` |
| A3 ∥ A4 | A3 = Home/song page UI; A4 = SQL function + prefs; different files (Academy edits serialised) |
| B4 ∥ B5 | B4 = document + email template; B5 = split sheet; both need the payment row only (shared `src/lib/payments` changes go first in one PR) |

**Must be sequential:** A0.2 → A0.3 → A1.2 (the refactor is the riskiest step for gigs). A2a → A2b. B1 → B2 → B3. B7 before any live key. B6 after the lawyer. The Academy, handbook and FLOWS.md edits are done by one session per batch.

## 8. Regression proofing (applies to every PR)

From the project rules (`bandwith-no-regressions`, `-integration-test-matrix`, `-duo-every-posture`, `-academy`, `-features-pdf`):

1. **Failing-first tests:** every bug fix and every new rule gets a vitest or Playwright test that fails without the change. Pure logic lives in `src/lib/*.ts` with tables of cases (`canGoLive`, note close rules, money rounding, split sums, status reducer).
2. **e2e flows:** each new flow gets a row in `e2e/FLOWS.md` and a spec, as **admin and member**, on all **10 device profiles** for render and smoke (`@smoke`), and full for interactions:
   - A flows: start a live rehearsal, follow as a member, add a preset note to the band / to two members, free text, offline add, end the session, To practise on Home, song page strip, mark Practised, next rehearsal shows "From last time", mark OK.
   - B flows: admin onboarding states, client accepts and pays the deposit (demo adapter), processing → paid, refund, dispute banner, balance request, splits (admin sees all, member sees only own), flag off = today's bank-transfer UI byte-identical.
3. **XState lifecycle models** (`e2e/models`, run in the required **E2E lifecycles** check, docs regenerated by `pnpm e2e:models:docs`):
   - `stage-gig` (A0.2, pins the existing behaviour before the refactor);
   - `rehearsal-live` (idle → live → paused → live → ended → summary; leader/member; reconnect; BLE fallback);
   - `rehearsal-note` (open → practised (per assignee) → ok; reopened at the next rehearsal; deleted by author/admin; offline queued → synced);
   - `payment` (draft → open → processing → paid → partially_refunded / refunded; open → failed → open; paid → disputed → won / lost; expired session; kill switch on);
   - `split` (planned → paid_manual; planned → held_not_onboarded → transferring → paid → reversed; failed → retried).
   Every state and every transition is covered (100%, as the current 104/104, 129/129).
4. **Maestro** (native only, `maestro/flows`): live rehearsal with the keyboard (free-text note on iPhone/iPad/Android), Android system Back inside the notes pad, BLE status label; payments: Settings → Payments opens the browser and `app.bandwith.mobile://payments/return` brings the app back to the right screen (iOS and Android), Back during the redirect, QR sheet.
5. **Release gate:** `scripts/emulator-check.sh` passes on the **exact release commit**, plus the Duo checklist signed with `--duo-ok`. `deploy-web.sh` and `release-android.sh --publish` refuse anything else. These scripts are run only by the user's decision; a phase ends at "release candidate ready + gate passed". Before a release candidate is reported, every fixed item is re-checked on the iPhone, iPad and Android emulators and the Duo sim, not only in Playwright.
6. **axe** (`a11y.spec.ts`): the live rehearsal, NotesPad, To practise card, song strip, Settings → Payments, quote page payment states, split sheet. No new exceptions.
7. **Every Duo posture:** closed portrait and landscape (4 rotations), book, laptop (notes pad in the lower half), open. Every layer inside a hub portals to `<body>`.
8. **6 languages:** every string through `t()` (the i18n test fails on missing keys). Presets go through `builtins.ts`, push texts through the DB triggers, quote-page strings through `src/quote/strings.ts`, and Stripe Checkout's locale is set from the client's language. Overflow scan in Duo closed / open / laptop for one long language (DE) and IT.
9. **Academy, then both handbooks:** new articles (Live rehearsal, Notes to practise, Getting paid, Splits) and updated ones (the "Online deposit is switched off" texts in `academy/content` and `docs/handbook/*/ch-business.html` become wrong when B3 ships), translated in `academy/content/i18n`. Screenshots per device per the recapture recipe. Then `docs/handbook --lang it` and `--lang en`, both PDFs sent.
10. **Screen-map crawler** (`pnpm e2e:crawl`) re-run after each phase. New role states: member with notes, client with payment states. No new dead ends, no data a role must not see (members never see client payments or other members' splits).
11. **Shared components:** when `StageMode`, `EventDetail`, `QuoteDetailModal` or `/quote.html` change, list every caller in the PR and re-check them.
12. **Migrations:** additive only, applied by hand after a rollback-only dry run (admin / member / outsider / anon) and the user's explicit OK. Any column the app reads is in a GRANT (`columnGrants.test.ts`), and new anon access only through explicitly granted SECURITY DEFINER RPCs. Revokes that would break old builds wait until every installed build (TestFlight, APK, Duo) runs the new code (the 119 rule).

## 9. Payments-specific testing, rollback and kill switch

**Tests that are new for B**
- **Webhook signature tests** (Deno, in CI): valid, tampered body, wrong secret, old timestamp, platform vs Connect secret mix-up.
- **Idempotency tests:**
  - the same event delivered twice, or ten times in parallel, has one effect;
  - double-tapping "Pay" gives the same Checkout Session (same idempotency key, unique `checkout_session_id`);
  - a refund retried after a timeout is not refunded twice;
  - a transfer per split happens only once (unique `transfer_id`).
- **Out-of-order tests:** `payment_intent.succeeded` before `checkout.session.completed`; `charge.refunded` before the app's refund call returns; `account.updated` arrives late after the return page.
- **Webhook replay:** a fixtures folder of recorded test-mode events (scrubbed). `scripts/stripe-replay.sh` posts them, signed with a test secret, to `supabase functions serve`. On sandbox runs the Stripe CLI (`stripe listen --forward-to`, `stripe trigger`, `stripe events resend`) does the same against real test objects.
- **Test clocks:** Stripe test clocks simulate Billing objects (customers, invoices, subscriptions). They are used only if B4 uses Stripe Invoicing with due dates and reminders.
  - Otherwise time-based rules (balance due, hold N days, session expiry, reminder dates) take an injected `now`, as `payoutsDue.ts` already does, and are tested with fixed clocks.
- **Amount tests:** cents rounding, VAT, deposit percentage, balance = total − deposit paid − refunds. Client and server share one module, and the same table of cases runs in vitest and Deno.
- **Reconciliation checks:** a seeded sandbox with a deliberate mismatch must produce exactly one issue. The daily job reports:
  - Stripe objects missing in the DB;
  - DB rows missing in Stripe;
  - amount or status differences;
  - webhooks unprocessed for over 15 minutes;
  - requests stuck in `processing` for over an hour.
- **Privacy tests:** RLS dry runs and e2e show that a member never receives client payment data or other members' splits; that anon reaches only its own token's payment status; and that an outsider gets nothing.
- **Nightly sandbox job** (not a required check, because it needs network and test secrets): a real test-mode run of onboarding → deposit → refund → dispute with test cards. A failure opens an issue.

**Rollback and kill switch**
- **Per-band flag** `payments` (and `rehearsal_live` for A): off = today's UI exactly (bank transfer details, disabled buttons gone or as today). It is tested byte-identically on screens and PDFs, the way the i18n work proved English unchanged.
- **Global kill switch** `platform_switches.payments_enabled`, checked by `payments-checkout`, `payments-refund` and `payments-transfer` (fail closed). The client page then shows bank transfer only. The **webhook keeps processing** whatever the switch says, so money already in flight is never dropped.
- **Stripe-side:** the webhook endpoints can be disabled and test or live keys rolled in minutes (runbook).
- **Code rollback:** every phase is additive (new tables, new functions, flagged UI), so reverting a PR or turning off the flag restores the old behaviour. Migrations are never destructive, and no column is dropped during the pilot.
- **Drill before the pilot:** turn the switch on and off in live mode with a €1 payment open, and check the page, the app and reconciliation.

## 10. Estimates, risks, definition of done per phase

Estimates are focused working days of implementation sessions, including tests and the emulator pass. CI takes about 14 minutes per PR, and the emulator gate about 22 minutes per release. Wall-clock time for the user's answers, the accountant and the lawyer is extra.

| Phase | Estimate | Main risks | Definition of done |
| --- | --- | --- | --- |
| A0 | 1.5–2.5 d | refactor breaks gig Stage mode (BLE, follow, Laptop pose) | A0.2 tests written first and green before and after; gig Stage mode identical on all profiles and emulators; flags module live with demo adapter |
| A1 | 3–4 d | recurring rehearsal occurrences mix; old local view callers missed | rehearsal live opens from detail, rail, Home; no gig phases; leader/follow + BLE proven for a rehearsal id (dry run); session + summary survive restart; old view retired with its tests ported; `rehearsal-live` model 100% |
| A2 | 3–5 d | offline notes duplicate or reorder; RLS too open or too closed | notes with presets, text, band/members, live for all in the session, offline queue proven; `rehearsal-note` model 100%; RLS dry run admin/member/outsider |
| A3 | 2–3 d | Home crowding on Duo closed; song page conflict with 109 notes | To practise on Home, song page, next rehearsal + live badges; 109 private notes unchanged (tests) |
| A4 | 1–1.5 d | push spam, untranslated pushes | one summary push per member, 6 languages, prefs respected |
| A5 | 1.5–2.5 d | preset edits break built-in translations | band presets (if yes), Academy + both PDFs regenerated, crawler clean |
| **A total** | **12–18 d** (revised 11-18: **8–11 d** remaining, see 3.0) | | release candidate 1.1.0 ready and the full gate passed (releasing is the user's call) |
| B0 | user / pro time, 2–6 weeks | no legal owner for the platform; DAC7 or licence answer blocks B6 or even B3 | written answers to §5 B and §6; Stripe platform account in the right name; legacy functions removed |
| B1 | 3–4 d | webhook wrong in Deno (raw body); grants leak | signature/idempotency/out-of-order tests green; migrations dry-run; nothing visible |
| B2 | 2–3 d | deep link back fails on one platform; account country wrong | onboarding out and back on iOS/Android/web (Maestro); statuses only from webhook |
| B3 | 3–5 d | double charge; paid shown before webhook; existing deposit UI regresses | `payment` model 100%; double-tap and replay tests; flag off byte-identical; refund works from app and Dashboard |
| B4 | 3–5 d | document taken as a tax invoice; email template not approved | document in 6 languages + fiscal fields; template approved by the user; accountant's wording applied |
| B5 | 2–3 d | member sees others' shares; sums drift after refunds | split sheet; member sees only own line (dry run + e2e); Payouts due unchanged |
| B6 | 5–8 d (optional) | platform liability; held funds; reversals failing | only after lawyer; `split` model 100%; reversal and held paths tested in sandbox |
| B7 | 2–3 d | silent webhook failures | daily reconciliation report; kill-switch drill done; runbook in docs |
| **B total** | **15–23 d** without B6, +5–8 with B6 | | pilot band paid for real, reconciliation clean for 2 weeks |

Cross-cutting risks
- **Inherited bugs:** the Home-card rehearsal live path is old and in-memory. A1 replaces it only after its behaviour is pinned by tests.
- **Old installed builds:** new tables are additive, and revokes wait for every build to update (TestFlight, APK and Duo).
- **Two-phone paths** (BLE, live follow) were never tested on two real phones. A needs the Mac-as-member stand-in or a second device before 1.1.0.
- **Stripe API surface:** Accounts v2 is new. If a needed call is missing, fall back to Accounts v1 with controller properties (Stripe's documented fallback).
- **Scope creep in B4** (full invoicing): resisted by the "final payment request" default.

## 11. Release plan

| Version | Contents | Visible to |
| --- | --- | --- |
| 1.0.6 | current release, the user tries it first | all |
| *(11-18)* | *#197 already merged rehearsal Live mode (the core of A1). Next release candidate: A1b–A4 per 3.0, as 1.1.0. Production only after the user confirms.* | |
| **1.0.7** | A0 only: flag layer, Stage mode characterisation tests, refactor (no visible change); B0 runs in parallel; legacy Stripe functions removed | all (nothing new to see) |
| **1.1.0** | A1–A4: live rehearsal, notes, To practise, summary push; flag `rehearsal_live` on for the user's own band first, then everyone after a week | all |
| 1.1.1 | A5 presets/polish + fixes from 1.1.0 testers; B1 server foundation merged with flag off | all / nobody |
| **1.2.0** | B2 + B3 (onboarding + deposit) + B7 ops; test mode first, then live for the user's own band, then the pilot band | pilot band only |
| 1.2.x | B4 final balance, B5 splits ledger | pilot band → opt-in bands |
| 1.3.0 | B6 automatic payouts, only if decided; wider opt-in | opt-in bands |

**A first, B second: kept.** A has no legal dependency, reuses tested code and gives testers something visible quickly. B's slow parts are human (accountant, lawyer, Stripe setup).

One change to the default order: **start B0 on day 1** and merge **B1 (server-only, flag off) during the A testing window**. That way B's UI work can start the day 1.1.0 is approved, without waiting.

1.0.7 ships the Stage mode refactor alone, so any regression in gig Stage mode is caught before rehearsal features land on top of it.

**Releases are never started automatically.** Web deploy, Android APK publish and TestFlight / store builds are triggered by hand by the user and their partner, when they decide. Every phase in this plan ends at **"release candidate ready + gate passed"**; releasing is the user's call, never a phase step.

Each phase ends with the same steps:
1. CI green and merge.
2. Emulator pass on the fixed items, plus a smoke run.
3. `emulator-check.sh` and `--duo-ok` on the exact commit.
4. Academy and both handbook PDFs updated.
5. **Release candidate ready:** the commit sha, what's in it, and the gate marker are reported to the user. Stop here.

Only when the user says so: `[deploy]` through `deploy-web.sh`, `release-android.sh --publish`, and the TestFlight upload via Organizer. The "Visible to" column in the table above describes the release candidate's flags, not a date.

## 12. Sources checked (2026-11-16)

- Stripe, charge types for Connect (direct, destination, separate charges and transfers; refunds, disputes, fees): https://docs.stripe.com/connect/charges
- Stripe, connected account types are legacy; Accounts v2 recommended: https://docs.stripe.com/connect/accounts
- Stripe, Accounts v2 configuration and responsibilities (fees_collector, losses_collector, dashboard, KYC): https://docs.stripe.com/connect/accounts-v2/connected-account-configuration
- Stripe, cross-border payouts (US, UK, EEA, Canada, Switzerland; not with `on_behalf_of`; not under the recipient service agreement): https://docs.stripe.com/connect/connect-cross-border-payouts
- Stripe, Billing testing and test clocks (Billing objects only): https://docs.stripe.com/billing/testing/test-clocks
- Apple App Review Guidelines 3.1.1, 3.1.3(d), 3.1.3(e): https://developer.apple.com/app-store/review/guidelines/
- Google Play Payments policy, Section 3: https://support.google.com/googleplay/android-developer/answer/9858738
- DAC7, personal services and the payment-processing exclusion (secondary sources, to verify with a lawyer): https://www.bdo.nl/en-gb/insights/what-is-dac7, https://tipalti.com/en-eu/resources/learn/dac7-reporting/
- EU e-invoicing timelines (secondary sources, dates disputed, to verify with an accountant): https://www.fonoa.com/resources/blog/e-invoicing-and-digital-reporting-in-the-eu-upcoming-changes, https://docs.invopop.com/compliance/europe
