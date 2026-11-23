# BandWith — product site (`site/`)

Static multi-page site (Vite + TypeScript, no React), separate from the app.
English (default, at `/`), Italian (`/it/`) and Spanish (`/es/`); the Academy
(the guide, six languages) stays in the app at `/academy/` and opens in the
page's language.

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

## How it fits together

- `partials/` — shared HTML: `<!--#name-->` includes a partial,
  `<!--@name-->` is generated from `src/content/render.ts`.
- `src/core/boot.ts` — every page starts with `boot()` and ends with
  `finish()`: smooth scroll (Lenis, desktop mouse only), shared reveals, nav,
  footer, capacity counter.
- Screens are the Academy captures (`academy/public/shots`), served at
  `/shots/` in dev and copied into `dist/shots` on build. Demo data only
  (band "Velvet Static", persona Leo M.).
- Motion: at most two pinned scenes per page and none below 1081px or with
  reduced motion; everything works and reads without JavaScript animation.
- Photos (`public/photos`): Unsplash, toned Ink → Lime; credits in the footer.

## Languages

- English is the source. Every page also exists at `/it/<path>` and
  `/es/<path>`: `site/it/**` and `site/es/**` are generated stubs (gitignored,
  written by `vite.config.ts`) and `tools/i18n.ts` turns the English HTML into
  the translated page: `<html lang>`, canonical, `hreflang` alternates,
  `og:locale`, site links under the prefix, Academy links with `?lang=`.
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
  pages, and FAQPage built from the Q&A the page shows.
- **Q&A** (`src/content/answers.ts`, rendered by `answersRender.ts`): the
  "What is BandWith?" definition and FAQ on the home page, 3–4 questions at the
  end of each channel page, and `/faq/` with all of them. Plain text, the
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
  home hero, and on the Get page the doors right under the headline with the
  counter next to "Why a limit?". Once only band invites (or nobody) get in,
  `capacity.ts` turns the `[data-cap-beta]` labels back to "Private beta",
  shows the hero's notice (`data-cap-line="closed"`) and `pages/get.ts` moves
  the counter back under the headline, above the waitlist.
- The Get page puts the visitor's own door first (TestFlight on iPhone and
  iPad, the APK on Android, the web app anywhere else): `src/core/device.ts`,
  run inline right after the doors (`<!--@door-order-->`), before the first
  paint.
- `src/ui/forms.ts` posts to `VITE_BETA_ENDPOINT` (the `beta` edge function,
  not built yet). Without it: simulated replies in dev, closed forms in
  production (nothing is sent).

## Tests

`site/test/*.test.ts` run with the app's vitest (`pnpm test:run`): channel
list, Academy links and captures exist, the Stage demo rules, the
languages, and search (`seo.test.ts`: JSON-LD, hreflang, sitemap, robots,
llms.txt, share cards, 404). `pnpm e2e:site` (Playwright, desktop Chromium + iPhone WebKit) runs
`e2e/site/`: the language suggestion and the translated scripts.
