# BandWith — product site (`site/`)

Static multi-page site (Vite + TypeScript, no React), separate from the app.
English only; the Academy (multilingual guide) stays in the app at `/academy/`.

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

## Beta capacity and forms

- `src/core/capacity.ts` reads totals from the RPC `bw_capacity_status`
  when `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set
  (`site/.env`). Without them: sample numbers in dev, hidden in production.
  `?capacity=full` / `?capacity=open` preview both states.
- `src/ui/forms.ts` posts to `VITE_BETA_ENDPOINT` (the `beta` edge function,
  not built yet). Without it: simulated replies in dev, closed forms in
  production (nothing is sent).

## Tests

`site/test/*.test.ts` run with the app's vitest (`pnpm test:run`): channel
list, Academy links and captures exist, and the Stage demo rules.
