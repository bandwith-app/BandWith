# Scaling and costs: from free tiers to paid plans without outages

Status: **plan only, no code, no account changes.** Written 2026-11-18, on top of `main` 0d7b061 (beta counter, migration 128).
Nothing here changes a plan, a spend cap or a billing setting. Every upgrade below is a decision for the user and their partner.

Contents

1. Summary
2. How other app makers do it (and what can really be automatic)
3. Where we are today, per service
4. Which limit bites first, and at how many users
5. Staged roadmap with monthly cost
6. Triggers and alerts, per service
7. Cheap engineering changes that delay upgrades
8. A free monitoring job (design only)
9. Store accounts
10. Open questions
11. Sources

---

## 1. Summary

- **The first limit we hit is Supabase egress (5 GB/month on Free).** At today's measured rate (about 60 MB per monthly active user, skewed by our own testing) it runs out at **roughly 80–100 active users**, well below the 300-spot beta. Most of it comes from polling we can remove (§7): the open chat re-downloads its last 50 messages **every 3 seconds**, and Home re-fetches the dashboard every 30 seconds. With those fixed, Free should carry **about 200–300 active users**.
- **The second risk is not a usage number but a failure mode: Resend Free allows 100 emails a day.** Every sign-up sends a confirmation email (Auth SMTP goes through Resend) plus a welcome email. A promotion day with more than ~40 sign-ups stops confirmation emails, and new people cannot get in. Resend Pro ($20/month) has no daily limit.
- **Supabase Free has no backups.** A real band (Mirage Music, 85 songs) lives in production. Pro ($25/month) adds daily backups kept 7 days, removes the 7-day inactivity pause, and raises egress to 250 GB.
- **Vercel Hobby is for personal, non-commercial use only.** Fine for a free beta; not once BandWith earns money. Either Vercel Pro ($20/month per developer seat) or move the static web app and site to Cloudflare (static requests free and unlimited, commercial use allowed).
- **Nothing upgrades itself.** No provider moves you from Free to a paid plan automatically. What *is* automatic: once on a paid plan, usage above the included amount is billed (or blocked, if a spend cap is on), and budgets can email you or call a webhook. The realistic pattern is: **paid plan with a cap or budget + alerts at 70% + a human decision**.
- **Recommended now:** (1) the two polling fixes and the avatar fix (§7, a few hours of work); (2) the free monitoring job (§8); (3) move Supabase to Pro with the spend cap **on** before the beta opens beyond friends; (4) Resend Pro only on the day a public push is planned. Cost: **$25–45/month**.

| Stage | Active users | What changes | Expected monthly cost |
|---|---|---|---|
| 0 | 0–300 (beta) | Supabase Pro (cap on); Resend Pro only for promo days; everything else Free | **$25** (+$20 in promo months) |
| 1 | 300–2,000 | + Resend Pro; web on Cloudflare (free) or Vercel Pro; Apple account | **$45–75** |
| 2 | 2,000–10,000 | + Supabase compute Small/Medium; cap off with budget alerts; realtime/egress overage | **$100–250** |

## 2. How other app makers do it (and what can really be automatic)

What small teams on Supabase + Vercel + Resend actually do, from the providers' docs and published post-mortems:

1. **Start on Free, but move the database to a paid plan before real users depend on it.** Free Supabase projects pause after a week of low activity and have no backups. Most teams treat "a real customer's data is in here" as the trigger for Pro, not a usage number. Keep-alive cron jobs exist (community repos ping the project weekly), but they only solve the pause, not backups.
2. **Use the provider's spend control, not a home-made auto-upgrade.**
   - Supabase Pro has a **Spend Cap**, on by default. With the cap on, usage above the quota is blocked until the next cycle and nothing extra is billed; with it off, overage is billed per unit. The cap does **not** cover compute add-ons. Supabase does not offer cost alert emails; the docs point to the usage page and the upcoming invoice.
   - Vercel Pro has **Spend Management**: budgets per team, project or product, emails at 50/75/100%, an HTTPS webhook, and an optional "pause production" at 100% (visitors then get 503). Hobby has none of this: when a Hobby limit is exceeded you usually wait 30 days.
   - Resend Pro has pay-as-you-go overage ($0.90 per 1,000) that you switch on; Free just stops.
   - GitHub Actions: budgets and emails at 90% and 100% of included usage; without a payment method, usage stops at the included amount.
3. **Alert on usage, decide by hand.** The common pattern is a scheduled job or the provider's emails warning at 70–80%, then a person upgrades. "Auto-scaling" in this world means *metered billing on a paid plan*, not automatic plan changes.
4. **The limit that bites first for chat/realtime apps is egress or realtime messages, not database size.** Published cases blame "broadcast everything" designs and chatty polling. Realtime messages are counted per listener (one change seen by 5 clients = 5 messages), and every byte a client downloads counts toward the same egress meter.
5. **Cut egress before paying for it:** select only the columns you need, stop polling where Realtime already pushes, cache on the device, serve files through a CDN, and keep media small.
6. **Move static hosting to Cloudflare** when bandwidth or the non-commercial clause becomes a problem: static asset requests on Workers and Pages are free and unlimited on all plans. Many indie teams keep Supabase for data and put the static front end on Cloudflare.

## 3. Where we are today, per service

Measured 2026-11-18, read-only. Supabase billing cycle 30 Oct – 30 Nov (19 days elapsed); Vercel last 30 days.

### Supabase (org "ARIA", project `elvlzpowkohjbhxjasvd`, Free, region West US (Oregon))

| Metric | Free limit | Used this cycle | % | Per active user per month (measured) |
|---|---|---|---|---|
| Egress (uncached) | 5 GB | 0.42 GB | 8% | ~60 MB |
| Cached egress | 5 GB | 0.17 GB | 3% | ~24 MB |
| Database size | 0.5 GB | 37 MB | 8% | mostly fixed overhead |
| Storage | 1 GB | 30 MB (29 files, 19 MB = 3 MP3s) | <1% | depends on audio uploads |
| Monthly active users | 50,000 | 11 | <1% | — |
| Realtime peak connections | 200 | 7 | 4% | — |
| Realtime messages | 2,000,000 | 6,987 | <1% | ~1,000 |
| Edge Function invocations | 500,000 | 310 | <1% | ~45 |
| Log ingestion (new, grace period until early 2027) | 1 GB | 0.23 GB | 23% | ~34 MB |

- Auth users 9 (all confirmed, 5 new in 7 days), 4 bands, 18 push tokens, 65 chat messages and 229 notifications in 30 days (peak 88 notifications in one day).
- Postgres: 60 max connections, `log_statement = ddl`, no pgAudit — Postgres logs are already minimal, so log ingestion is mostly API gateway logs, one line per request. Polling drives it.
- Realtime publication covers 15 tables (events, messages, notifications, setlists, rehearsal polls…). The app opens ~16 channels across `useData`, chats, presence, polls, stage live and suggestions, on one WebSocket per client.
- 2 pg_cron jobs (invite emails 08:00 UTC, rehearsal proposal expiry 03:20 UTC).
- **Free plan: paused after one week of low activity, no backups, no PITR.**
- E2E in CI is fully mocked (`e2e/support/network.ts`), so CI does not consume Supabase quota. The numbers above are real use: us, the partner, testers, simulator passes, and the Mirage import.

### Vercel (personal account, team scope `st-jean-baptiste`, Hobby)

| Metric | Hobby limit | Last 30 days | % |
|---|---|---|---|
| Fast Data Transfer | 100 GB | 204 MB | 0.2% |
| CDN requests | 1,000,000 | 7,600 | 0.8% |
| Function invocations | 1,000,000 | 8 | ~0% |
| Fast Origin Transfer | 10 GB | 1 MB | ~0% |
| Deployments | 100 per day | a handful (vercel.json only builds `[deploy]` commits) | — |

- Covers `bandwith` (app.bandwith.fun), `bandwith-site` (bandwith.fun) and an unrelated `sjb-website`.
- The CLI cannot read usage on Hobby (`vercel billing usage` has no billing data); the numbers come from the dashboard.
- **Terms:** Hobby is "personal, non-commercial use only"; commercial use needs Pro or Enterprise. Vercel does not define "commercial" precisely. A free beta is defensible; charging bands (Stripe, subscriptions) is not.

### GitHub (org `bandwith-app`, Free, repo public)

- Standard hosted runners are **free and unmetered for public repos**. Today: 331 workflow runs in 7 days; one full CI run is ~60 job-minutes (typecheck/build 2, three E2E shards ~16 each, lifecycles ~10).
- **If the repo goes private:** that cadence is roughly 15,000–20,000 job-minutes a month against ~2,000 included on Free ($12 of compute at $0.006/min) — roughly **$90–110/month**. Options then: run the E2E shards only on PRs to main, a self-hosted runner on the Mac (free), or keep the repo public.

### Resend (Free)

| Metric | Free limit | Used | 
|---|---|---|
| Emails per month | 3,000 | 43 |
| Emails per day | 100 | 6 today |

- Everything goes through it: Supabase Auth SMTP (confirm sign-up, magic link, reset, change email), welcome, band invites + reminders, member joined, product updates, quote emails.
- Per new user: **2 emails** (confirmation + welcome), plus invites. 100/day ≈ 40–50 sign-ups a day.
- Our `bandwith.fun` domain is already on Resend's new "Forge" infrastructure; the dashboard says one domain (the old `contact.gianlucaboccia.me`) still uses the legacy one.

### Cloudflare

- Only a stale copy at `bandwith.pages.dev` on the partner's account, no longer connected to the repo (lost access with the repo transfer). Not primary, nothing to measure. It stays in the Auth redirect list.

### Apple and Google

- Apple Developer Program: $99/year (TestFlight already in use, App Store submission not wanted yet).
- Google Play: $25 once. Android is distributed today as an APK on GitHub releases. A **personal** Play account created after 13 Nov 2023 must run a closed test with **12 testers opted in for 14 continuous days** before production; an organisation account (needs a D-U-N-S number) is exempt.
- Push: APNs and FCM are free. Our cost is only edge invocations of `send-push`.

## 4. Which limit bites first, and at how many users

The per-user numbers in §3 come from 11 accounts, several of them us and test runs, so they over-state a normal band member. The table gives the measured rate and a realistic band-member rate after the fixes in §7.

| # | Limit | Free limit | Measured per user | Bites at (measured) | Realistic after §7 fixes | Bites at (after fixes) |
|---|---|---|---|---|---|---|
| 1 | Supabase egress | 5 GB/mo | ~60 MB | **~85 active users** | 15–25 MB | **~200–300** |
| 2 | Resend per day | 100/day | 2 per sign-up | **~45 sign-ups in one day** | same | same |
| 3 | Supabase log ingestion | 1 GB/mo (grace until early 2027) | ~34 MB | ~30 users | ~5–10 MB (fewer requests) | ~100–200 |
| 4 | Supabase storage | 1 GB | — | ~150 MP3s (≈15–30 bands that upload audio) | Opus/AAC re-encode ≈ ⅓ size | ~50–90 bands |
| 5 | Supabase cached egress | 5 GB/mo | ~24 MB | ~210 | lower with device cache | ~400+ |
| 6 | Supabase realtime peak connections | 200 | 1 socket per open app | ~1,500–3,000 (5–10% online at peak; gig nights spike) | same | same |
| 7 | Supabase realtime messages | 2 M/mo | ~1,000 | ~2,000 | same | same |
| 8 | Resend per month | 3,000/mo | ~2–3 per new user | ~1,000–1,500 sign-ups/mo | same | same |
| 9 | Vercel CDN requests | 1 M/mo | ~700 (incl. site + bots) | ~1,400 web users | native apps don't hit Vercel | ~3,000+ web users |
| 10 | Supabase DB size | 500 MB | small | many thousands (notifications grow forever) | prune old notifications | — |
| 11 | Edge Function invocations | 500 k/mo | ~45 | ~11,000 | — | — |
| 12 | MAU | 50,000 | — | 50,000 | — | — |

What happens at the limit on Free:
- **Supabase:** an email to the billing address and a grace period; if usage stays over, restrictions under the Fair Use Policy (users report API calls answered with **402**). Restrictions lift when the quota refills next cycle or on upgrade. Data is not deleted. Database over 500 MB goes read-only.
- **Resend:** sends are refused until the next day/month. Sign-up confirmations fail silently for the user.
- **Vercel Hobby:** the feature stops, usually for 30 days.
- **Realtime:** joins over the limit are refused (`too_many_connections`); chat falls back to the 3-second poll today, which is itself the egress problem.

## 5. Staged roadmap with monthly cost

Prices in USD, excluding VAT, as published on 2026-11-18.

### Stage 0 — now to 300 beta accounts

| Service | Plan | Monthly | Why |
|---|---|---|---|
| Supabase | **Pro, spend cap ON** (includes $10 compute credit = Micro, 1 GB RAM) | $25 | backups, no pause, 250 GB egress, 8 GB DB, 100 GB storage, 500 realtime connections, 5 M realtime messages, 20 GB logs |
| Resend | Free; **Pro on promo months** | $0 / $20 | the 100/day cliff |
| Vercel | Hobby | $0 | free beta, no revenue |
| GitHub | Free, public repo | $0 | |
| Apple | Developer Program | ~$8 ($99/yr, already paid) | TestFlight |
| **Total** | | **$25–45** (+ Apple) | |

Without Supabase Pro this stage is $0, and it holds up to ~200–300 active users **only after the §7 fixes**. Our recommendation is still Pro before the beta opens beyond friends: one bad week (a pause or a lost table) costs more than $25.

### Stage 1 — 300 to 2,000 active users

| Service | Plan | Monthly |
|---|---|---|
| Supabase | Pro, cap ON, Micro | $25 |
| Resend | Pro 50k | $20 |
| Web hosting | **Cloudflare Workers static assets / Pages (free)** or Vercel Pro | $0 or $20 |
| GitHub | Free, public | $0 |
| Apple + Google | $99/yr + $25 once | ~$8 |
| **Total** | | **$45–75** |

Trigger for this stage: the first paying band **or** a sustained 70% on any Free limit. Move the web hosting before monetising, because of the Hobby terms.

### Stage 2 — 2,000 to 10,000 active users

| Item | Estimate | Monthly |
|---|---|---|
| Supabase Pro base | | $25 |
| Compute Small → Medium (minus the $10 credit) | when CPU > 70% sustained or memory swaps | $5–50 |
| Egress over 250 GB | 10k users × 20–30 MB ≈ 200–300 GB | $0–5 |
| Realtime connections over 500 | peak 500–1,000 online | $0–10 |
| Realtime messages over 5 M | ~1,000/user → ~10 M | ~$12 |
| Resend Pro | 50–100k emails | $20–35 |
| Web hosting | Cloudflare free (or $5 Workers Paid) / Vercel Pro | $0–20 |
| Apple + Google | | ~$8 |
| **Total** | | **≈ $100–250** |

At this stage turn the Supabase spend cap **off** (a blocked egress quota in the middle of a gig weekend is worse than a few dollars) and replace it with the §8 alerts plus a monthly budget review. Consider moving the Supabase region closer to users (Oregon today; most bands are in Europe) — a region change means a new project and a migration, so it is cheapest to do while still small.

## 6. Triggers and alerts, per service

| Service | Watch | Warn at | Act at | Action (human) | Alert source |
|---|---|---|---|---|---|
| Supabase | egress, cached egress, log ingest, storage, DB size | 70% month-to-date or projected 100% before cycle end | 90% | Pro (from Free); then compute add-on / cap off (on Pro) | §8 job; Supabase's own quota email (at 100% only) |
| Supabase | realtime peak connections | 140 (70% of 200) | 180 | Pro (500) | §8 job (realtime logs / dashboard) |
| Supabase | CPU, memory, connections (Pro) | CPU > 70% for 1 h, swap > 0 | sustained | Small → Medium compute | dashboard Reports |
| Resend | emails today / this month | 70/day, 2,100/month | 90/day | Pro ($20) | §8 job counting our sends |
| Vercel | CDN requests, data transfer | 70% | 90% | move to Cloudflare or Pro | dashboard (no API on Hobby); on Pro, Spend Management 50/75/100% + webhook |
| Vercel | revenue starts | first paid band | — | Pro or Cloudflare | business decision |
| GitHub | repo visibility | going private | — | trim CI or self-hosted runner | GitHub 90/100% emails |
| Apple | membership renewal | 30 days before | — | renew | Apple email |

## 7. Cheap engineering changes that delay upgrades

Ordered by egress saved per hour of work. Each ships with a failing-first test, like every fix.

1. **Chat: stop the 3-second poll while Realtime is connected.** `src/app/components/chat/ChatDetailModal.tsx:502` re-fetches the last 50 messages and the participants every 3 s, even with the Realtime subscription working. That is ~1,200 requests and ~30–40 MB per hour of open chat. Poll only when the channel is not `SUBSCRIBED`, on resume, and fetch only messages newer than the last one we have.
2. **Home and lists: refetch on change, not on a timer.** `useData.ts` polls events every 60 s, notifications every 60 s, and the dashboard (5 queries) every 30 s while visible. Realtime already covers `events` and `notifications`. Keep `onAppResume` and the realtime triggers; drop or stretch the timers to 5 min as a safety net.
3. **Avatars: upload the resized image, not the original.** `EditProfileModal.tsx:118` uploads the original file (up to 8 MB; one avatar today is 3.5 MB) although a 256 px JPEG is already computed. Avatars show on every list, so this is egress on every load.
4. **Songs: select columns, not `*`.** `songs.ts:105` loads every song with lyrics and chords. Lists need id, title, artist, key, BPM, duration; load lyrics/chords on open. The Mirage band alone has 85 songs with 73 lyrics.
5. **Audio files: cache on the device and keep them small.** Song audio is served by a new 1-hour signed URL each time (`songFiles.ts:152`), so the browser cache rarely hits and every play downloads 5–8 MB again. Store downloaded files on the device (offline already matters for Stage) and re-encode uploads to AAC/Opus ~96 kbps (≈ ⅓ the size). Consider a per-band audio quota during the beta.
6. **Public files with long cache headers.** Quote PDFs, logos and band branding are in public buckets; set `cacheControl` to a week or more where the file never changes (new path on change) so they count as cached egress and are served by the CDN.
7. **Realtime channel hygiene.** One socket per client is fine; make sure channels are removed on unmount and on band switch (no duplicate joins after resume), and that `postgres_changes` filters by `band_id` so a change is not delivered to listeners who then discard it. Presence (`presence:band:<id>`) is capped at 20 presence messages/s on Free.
8. **Prune old rows.** A pg_cron job deleting read notifications older than 90 days and `net._http_response` older than 7 days keeps the database flat.
9. **Static web on Cloudflare** (when §5 says so): the app is a static Vite SPA with one rewrite (`/auth/callback`), so it runs unchanged on Workers static assets / Pages. DNS stays on Vercel (a CNAME for `app.`); the apex needs either Vercel or a Cloudflare zone.

Fixes 1–4 are small, contained diffs and are what turns "~85 users" into "~200–300 users" on Free.

## 8. A free monitoring job (design only)

Not implemented. Build it only if the user asks.

**Where it runs:** a scheduled GitHub Actions workflow (`.github/workflows/usage-watch.yml`, daily at 06:30 UTC). Free on the public repo, and independent from Supabase — if Supabase gets restricted, the alert still goes out. (A Supabase pg_cron + `pg_net` job would be simpler, but it fails together with the thing it watches.)

**What it reads (all read-only):**
- **Supabase SQL**, through one new `SECURITY DEFINER` function `bw_usage_snapshot()` callable only by a dedicated role: database size, storage size per bucket, auth users active in 30 days, new users today, notifications and messages today, emails we sent today and this month (Auth emails from `auth.audit_log_entries` + `bw_email_log` + a new row per send in `send-email`).
- **Supabase logs** through the Management API logs endpoint (personal access token as an Actions secret): sum of response bytes and request count from yesterday's API edge logs, as an egress and log-volume proxy. Free keeps logs for one day, so the job must run daily and store the result.
- **History:** each run inserts one row into `bw_usage_daily` (date, metric, value) so month-to-date totals and a linear projection to the cycle end are possible.
- **Vercel and Resend dashboards** have no usable usage API on our plans; the job reports our own counters for Resend and leaves Vercel to a monthly manual check (or Spend Management once on Pro).

**When it alerts:** for each metric, `month_to_date / quota ≥ 70%` **or** `projected_end_of_cycle / quota ≥ 100%`; and for Resend, `today ≥ 70`. One email per metric per threshold per cycle (state in `bw_usage_daily`), so no daily spam.

**How it alerts:** a POST to Resend's API from the workflow, sender `noreply@bandwith.fun`, recipient from an Actions secret (never in the repo). The email names the metric, the % used, the projection and the action from §6. Optionally the same message as a GitHub issue labelled `usage`.

**Secrets:** `SUPABASE_ACCESS_TOKEN` (read-only use), `SUPABASE_USAGE_KEY` (role limited to `bw_usage_snapshot`), `RESEND_API_KEY` (a separate, send-only key), `ALERT_EMAIL`. Scheduled workflows never expose secrets to fork PRs.

**Work:** one migration (function + table + role grant), one workflow, one small Node script, a failing-first test for the threshold logic. Half a day.

## 9. Store accounts

- **iOS:** account active, TestFlight allows up to 10,000 external testers (our public link is capped at 1,000). App Store submission needs a price decision (free with in-app purchase or paid); no infrastructure cost beyond $99/year.
- **Android:** today APK on GitHub releases (free, in-app updater). For Google Play: $25 once; plan the 12-testers/14-days closed test (personal account) or open an organisation account with a D-U-N-S number to skip it.
- Neither store charges for traffic. Store fees only matter once there are in-app payments; the quote payments in the next-big-updates plan (update B, on hold) use the web, not in-app purchase.

## 10. Open questions

1. Supabase Pro now, or only when the beta opens beyond friends? (Recommendation: before the public beta.)
2. Keep the GitHub repo public? (If private, CI must be trimmed or moved to a self-hosted runner.)
3. Is the web app moving to Cloudflare before the first paid band, or does Vercel Pro make more sense for us (one place for app, site and DNS)?
4. Per-band audio limit during the beta (e.g. 100 MB per band)?
5. Build the §8 monitoring job and the §7 fixes 1–4 now?

## 11. Sources

- Supabase pricing (plans, overage, compute add-ons, backups): https://supabase.com/pricing
- Supabase spend cap and cost control: https://supabase.com/docs/guides/platform/cost-control
- Supabase egress: https://supabase.com/docs/guides/platform/manage-your-usage/egress
- Supabase log ingestion: https://supabase.com/docs/guides/platform/manage-your-usage/logs-ingest and https://supabase.com/changelog/logs-usage-based-pricing
- Supabase realtime limits: https://supabase.com/docs/guides/realtime/limits
- Supabase project pausing: https://supabase.com/docs/guides/platform/project-pausing
- Supabase billing FAQ (exceeding quotas on Free): https://supabase.com/docs/guides/platform/billing-faq and user report of 402 restrictions: https://github.com/orgs/supabase/discussions/38200
- Realtime quota case study (party game, 1000% over): https://dev.to/yitao/nextjs-15-supabase-i-accidentally-blew-past-my-quota-by-1000-and-how-local-first-saved-it-1leh
- Vercel Hobby plan: https://vercel.com/docs/plans/hobby
- Vercel fair use and non-commercial clause: https://vercel.com/docs/limits/fair-use-guidelines and https://vercel.com/legal/terms
- Vercel Spend Management: https://vercel.com/docs/spend-management
- Cloudflare Pages limits: https://developers.cloudflare.com/pages/platform/limits/
- Cloudflare static asset requests free and unlimited: https://developers.cloudflare.com/workers/platform/pricing/ and https://developers.cloudflare.com/pages/functions/pricing/
- GitHub Actions billing: https://docs.github.com/en/billing/concepts/product-billing/github-actions
- Resend pricing: https://resend.com/pricing
- Google Play testing requirements for new personal accounts: https://support.google.com/googleplay/android-developer/answer/14151465
- Apple Developer Program: https://developer.apple.com/programs/
- Usage numbers: Supabase org usage page, Vercel team usage page and Resend usage page (read in the built-in browser), `supabase db query --remote --read-only`, `gh api` for Actions runs, all on 2026-11-18.
