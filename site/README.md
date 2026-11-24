# BandWith — product site (`site/`)

Static multi-page site (Vite + TypeScript, no React), separate from the app.
English (default, at `/`), Italian (`/it/`) and Spanish (`/es/`); the Academy
(the guide, six languages) stays in the app at `/academy/` and opens in the
page's language, on its static pages: `/academy/<lang>/` and
`/academy/<lang>/a/<id>/` (`academyArticle` in `src/content/site.ts`; never
the bare `/academy/` shell or a `#/a/<id>` fragment, which search engines
don't index).

```bash
pnpm dev:site      # http://127.0.0.1:5180
pnpm build:site    # → site/dist
pnpm preview:site  # serve the build on :5181
```

## Pages

| Page | File | Script |
|---|---|---|
| Home | `index.html` | `src/pages/home.ts` |
| Stage mode (CH 07) | `features/stage/index.html` | `src/pages/stage.ts` |
| Get the beta | `get/index.html` | `src/pages/get.ts` |
| Questions & answers | `faq/index.html` | `src/pages/faq.ts` |
| Not found | `404.html` | `src/pages/faq.ts` |

New pages go in `PAGES` in `vite.config.ts`. A feature page goes live by
setting `live: true` on its channel in `src/content/features.ts`: menus, the
rack and the footer are generated from that list.

## The menu

One information architecture for every screen (`MENU` in
`src/content/features.ts`): three verbs in the order of a band's week, "Book
& get paid", "Line up the band", "Play the show", then "Built in" (privacy,
devices). A page's group also labels its hero and its strip in the rack.

- **Wide screens (≥1081px), "The index"**: Features is a button
  (`aria-expanded`) that opens a panel as wide as the header: four columns,
  every page with its one-liner, the current page in lime
  (`aria-current="page"`), the page dimmed behind. Enter, Space or ↓ open it
  and put focus on the first link; Tab reads column by column; Esc, or Tab out
  of either end, closes it and returns focus to the button; hover opens it
  after 120 ms. No preview image, nothing that waits for a hover.
- **Phones and tablets, the sheet**: Log in / Sign up first, the four groups as
  an accordion (one open at a time, the current page's to begin with), then How
  it works / Guide / FAQ, the language last; "Get the app" is pinned at the
  bottom. Focus stays inside, the page behind is inert and does not scroll,
  Esc closes.
- Reduced motion: both only fade.
- Markup: `partials/nav.html` + `featurePanel()` / `menuRows()` in
  `src/content/render.ts`; behaviour: `src/ui/nav.ts`; styles:
  `src/styles/menu.css`. Tests: `test/menu.test.ts`, `e2e/site/menu.spec.ts`.

## How it fits together

- `partials/` — shared HTML: `<!--#name-->` includes a partial,
  `<!--@name-->` is generated from `src/content/render.ts`.
- `src/core/boot.ts` — every page starts with `boot()` and ends with
  `finish()`: smooth scroll (Lenis, desktop mouse only), shared reveals, nav,
  footer, capacity counter.
- Screens are the Academy captures (`academy/public/shots`), served at
  `/shots/` in dev and copied into `dist/shots` on build. Demo data only
  (band "Velvet Static", persona Leo M.).
- Channel pages end with "The small things" (`details` in
  `src/content/pages/<slug>.ts`, rendered by `pageRender.ts`): three numbered
  panels, each with the product (an Academy capture in the crop component, on
  any device, or a fragment drawn in HTML from `src/content/fragments.ts` when
  no capture shows the thing; a fragment uses the app's own labels and is
  checked against the app's screen), then a spec sheet: every other capability
  in one line, under two to four mono labels, an even number per label so both
  columns are full. The long explanation stays in the Guide, which the next
  section links.
- Motion: at most two pinned scenes per page and none below 1081px or with
  reduced motion; everything works and reads without JavaScript animation.
- No photos. What gives a page its rhythm is the brand's own mark and three
  flat fields, ink, paper and lime: a channel hero is built on the mark's grid
  (`.mk` in `styles/feature.css`: the page's screen in the tall cell, its
  chips in four cells, one lime, the empty cell empty; scaled to the page on
  a phone, never cropped), "Try it" is a lime band above the demo on paper,
  and "One gig" on Home gives the day ink, load-in and pay paper, the show
  lime, with the seven times in cells (`.cell`). `test/no-photos.test.ts`
  keeps photos out.

## Languages

- English is the source. Every page also exists at `/it/<path>` and
  `/es/<path>`: `site/it/**` and `site/es/**` are generated stubs (gitignored,
  written by `vite.config.ts`) and `tools/i18n.ts` turns the English HTML into
  the translated page: `<html lang>`, canonical, `hreflang` alternates,
  `og:locale`, site links under the prefix, Academy links on the guide's
  static page in that language (`/academy/en/…` → `/academy/it/…`).
- Translations: `src/i18n/dict/it.json`, `es.json` (English text → translation,
  units and placeholders explained in `src/i18n/translate.ts`), plus
  `dict/live.ts` for the capacity counter and the waitlist. On `/it/` and
  `/es/`, `src/i18n/runtime.ts` translates what the scripts write (demos,
  counters) with the same dictionary.
- New or changed English text: `pnpm build:site` lists what has no
  translation in `site/.i18n-missing.json`; `site/test/i18n.test.ts` fails on
  any English left in the built pages, `e2e/site/i18n-runtime.spec.ts` on any
  the scripts write.
- EN · IT · ES switcher in the footer and the menu sheet
  (`<!--@lang-switch-->`).
- Language suggestion (`src/ui/langSuggest.ts`, rules in
  `src/i18n/suggest.ts`): the country comes from `api/geo.js`, a Vercel edge
  function reading Vercel's own `x-vercel-ip-country` (no third-party
  lookup). Spanish-speaking countries → Spanish, Italy/San Marino/Vatican/
  Ticino → Italian, English-speaking countries → English, only when that
  differs from the page; anywhere else nothing. A yes, a no or the switcher is
  remembered (`localStorage` `bw-site-lang`). `?geo=MX` or `?geo=CH-TI`
  previews it; locally `BW_GEO=ES pnpm dev:site`.
- Legal pages (the app's `/legal/privacy.html`, `/legal/terms.html`) are
  English only.

## Search engines and AI assistants (SEO, GEO, AEO)

Everything comes from `tools/seo.ts` at build time, so it can't drift from the pages:

- **Head of every page** (`applySeo`, run by `tools/i18n.ts` after translation):
  canonical and hreflang (en, it, es, x-default), a 1200×630 share card
  (`og:image`, Twitter `summary_large_image`) and one Schema.org JSON-LD graph:
  Organization, WebSite, SoftwareApplication (iOS, iPadOS, Android, Web, free
  in beta, no ratings), the WebPage, a BreadcrumbList on channel, Get and FAQ
  pages, and FAQPage built from the Q&A the page shows, on `/faq/` and
  `/get/` only (`FAQ_SCHEMA`): every question is marked up on one URL. The
  home and channel pages show their questions without the markup, because
  `/faq/` already carries all of them.
- **Meta descriptions**: 160 characters at most, in every language
  (`test/seo.test.ts`); they also feed llms.txt and the share text.
- **Q&A** (`src/content/answers.ts`, rendered by `answersRender.ts`): the
  "What is BandWith?" definition and FAQ on the home page, 3–5 questions at the
  end of each channel page, and `/faq/` with all of them (the Get page keeps
  its own "Before you sign up", linked from `/faq/`). Plain text, the
  question as people ask it, an answer that stands alone. Every string needs
  its IT and ES key, like the rest of the copy.
- **Files next to the pages** (written into `dist` by `vite.config.ts`):
  `robots.txt` (everyone in, AI crawlers named, `/api/` out), `sitemap.xml`
  (every page × language, hreflang alternates, lastmod from git), `llms.txt`
  and `llms-full.txt` (the English pages as text, demos left out) and
  `vercel.json` (no-slash and `index.html` URLs redirect to the slash; long
  cache for `/assets`).
- **Share cards**: `public/og/<page>-<lang>.jpg`, committed. After changing a
  title or a hero screen: `pnpm build:site && node site/tools/og-cards.mjs`.
- **404**: `404.html`, noindex, no language copies, never in the sitemap.
- `test/seo.test.ts` checks all of it on the built pages.

## Deploy

`scripts/deploy-site.sh` builds a clean checkout and deploys `site/dist` to
the Vercel project `bandwith-site`: a preview by default, `--prod` for
https://bandwith.fun (manual release only).

## Beta capacity and forms

- `src/core/capacity.ts` reads totals from the RPC `bw_capacity_status`
  when `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set
  (`site/.env`). Without them: sample numbers in dev, hidden in production.
  `?capacity=open` / `?capacity=invites` / `?capacity=full` preview each state.
- Open is what the pages say as written: "Open beta", no spots count in the
  home hero, and on the Get page the doors right under the headline. Once
  only band invites (or nobody) get in, `capacity.ts` turns the
  `[data-cap-beta]` labels back to "Private beta", shows the hero's notice
  (`data-cap-line="closed"`) and `pages/get.ts` moves the counter back under
  the headline, above the waitlist.
- The counter ("N of 255 open spots left", the LED meter) and the Get page's
  "Why a limit?" section are on the page only when the limit matters to the
  visitor: 50 open spots or fewer, or none (`counterShown`, `COUNTER_FROM` in
  `capacity.ts`). They are written `hidden` (`data-cap-show="limit"`); with
  plenty of spots a count next to the doors reads as "a small room".
  `?capacity=few` previews the counter with the beta still open.
- The main call to action (home hero, every footer: `[data-web-cta]`) opens
  the web app on Create account; with the open spots gone (`html.is-full`)
  the `.cta-full` button next to it, "Join the waitlist", takes its place.
- The waitlist ("Tonight's show is full") and the lines for invited people
  are written `hidden` in the page (`data-cap-show="closed|invites|full"`);
  `capacity.ts` shows the ones the state needs. While the beta is open they
  are out of the page for readers, crawlers and `llms-full.txt` (which also
  skips them by name, `SKIP` in `tools/seo.ts`).
- The Get page orders its doors for the device: on a phone the web app first
  (it opens right there, nothing to install), then the phone's own app, then
  the other; on a tablet or a computer the device's own door first
  (TestFlight on iPad, the APK on an Android tablet, the web app anywhere
  else). `src/core/device.ts`, run inline right after the doors
  (`<!--@door-order-->`), before the first paint; the same script shows the
  web door's words for a phone (`data-door-for="phone"`) and puts the trust
  line (`data-trust`) after the first door on a phone, under the doors
  elsewhere.
- `src/ui/forms.ts` posts to `VITE_BETA_ENDPOINT` (the `beta` edge function,
  not built yet). Without it: simulated replies in dev, closed forms in
  production (nothing is sent).

## The way to sign-up

- Every link to the app's sign-up says which spot of the site it is:
  `?start=signup&src=site-hero` (also `site-nav`, `site-menu`, `site-get-web`,
  `site-footer`). The list is `SIGNUP_SPOTS` in `src/content/site.ts`; a new
  spot goes there first (`test/conversion.test.ts` refuses any other value).
  The app reads only `start`; `src` stays in the address for analytics.
- Two labels, one per destination: "Start free in your browser" (the web
  sign-up, as the main button) and "Get the app" (the Get page).
- Facebook's and Instagram's in-app browsers (`src/core/inApp.ts`, by user
  agent) get a bar at the top of every page (`<!--@inapp-bar-->` in
  `partials/nav.html`, `src/ui/inAppBar.ts`): on Android a link that opens the
  same address in Chrome, on iPhone the words say how and the action copies
  the link. It is written hidden and shown by an inline script before the
  first paint; closed, it stays away for the visit (sessionStorage).
  `<html data-inapp>` and `--iab-h` (its height) move the fixed header down.
- "Made by" (`MADE_BY` in `src/content/site.ts`) is off: fill in name, role
  and contact and set `on: true` to show it next to the trust line on the Get
  page.

## Tests

`site/test/*.test.ts` run with the app's vitest (`pnpm test:run`): channel
list, Academy links and captures exist, the shape of "The small things"
(`pages.test.ts`), the Stage demo rules, the
languages, and search (`seo.test.ts`: JSON-LD, hreflang, sitemap, robots,
llms.txt, share cards, 404). `coverage.test.ts` lists what the app does and
the words the site uses for it, and what the app stopped doing: add a row
with every release. `pnpm e2e:site` (Playwright, desktop Chromium + iPhone WebKit) runs
`e2e/site/`: the language suggestion, the translated scripts, the Get page's
doors, `conversion.spec.ts` (the hero's buttons per device, the counter's
threshold, the in-app browser bar, 44px controls), `release-fixes.spec.ts`
(the Stage and Money demos, the closed-beta blocks, narrow phones) and
`capabilities.spec.ts` (the three panels and the spec sheet at each width,
captures fitted, fragments in the page's language), `no-photos.spec.ts` and
`menu.spec.ts` (the panel, the sheet, keyboard and focus).
