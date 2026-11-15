/**
 * BandWith Academy (the user guide in academy/): where it lives and how the
 * app links into it.
 *
 * `pnpm build` builds it into dist/academy, so the native apps ship it (it
 * opens offline) and the web serves it at /academy/. In `vite dev` the app
 * server doesn't serve it: run `npx vite --config academy/vite.config.ts`
 * (port 5190) or set VITE_ACADEMY_URL.
 */

import { getLocale } from './i18n';

export type AcademyRole = 'admin' | 'member' | 'deputy';

/** What to open: an article (by id, see academy/content), a role path, or the home. */
export type AcademyTarget = { article: string } | { role: AcademyRole } | null;

const base = (): string => {
  const env = import.meta.env.VITE_ACADEMY_URL as string | undefined;
  if (env) return env.endsWith('/') ? env : `${env}/`;
  return import.meta.env.DEV ? 'http://localhost:5190/' : '/academy/';
};

/**
 * The device the Academy shows screenshots for (academy/content/types.ts
 * ShotDevice). The app passes it in the URL and posts
 * `{ type: 'bw-academy-device', device }` to the guide when it changes.
 */
export type AcademyDevice = 'phone' | 'tablet' | 'web' | 'duoClosed' | 'duoBook' | 'duoLaptop';

export function academyDevice(f: {
  /** A dual-screen phone (it reports a system status column). */
  duo: boolean;
  laptop: boolean;
  twoPane: boolean;
  /** Tablet-sized window (data-bw-wide). */
  wide: boolean;
  native: boolean;
  /** Mouse or trackpad: a desktop browser. */
  finePointer: boolean;
}): AcademyDevice {
  if (f.duo) return f.laptop ? 'duoLaptop' : f.twoPane ? 'duoBook' : 'duoClosed';
  if (!f.wide) return 'phone';
  return !f.native && f.finePointer ? 'web' : 'tablet';
}

export function academyUrl(target: AcademyTarget, theme: 'light' | 'dark', device?: AcademyDevice): string {
  const hash = !target ? '#/' : 'article' in target ? `#/a/${target.article}` : `#/role/${target.role}`;
  return `${base()}index.html?embed=1&theme=${theme}${device ? `&device=${device}` : ''}&lang=${getLocale()}${hash}`;
}
