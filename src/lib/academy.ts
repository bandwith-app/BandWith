/**
 * BandWith Academy (the user guide in academy/): where it lives and how the
 * app links into it.
 *
 * `pnpm build` builds it into dist/academy, so the native apps ship it (it
 * opens offline) and the web serves it at /academy/. In `vite dev` the app
 * server doesn't serve it: run `npx vite --config academy/vite.config.ts`
 * (port 5190) or set VITE_ACADEMY_URL.
 */

export type AcademyRole = 'admin' | 'member' | 'deputy';

/** What to open: an article (by id, see academy/content), a role path, or the home. */
export type AcademyTarget = { article: string } | { role: AcademyRole } | null;

const base = (): string => {
  const env = import.meta.env.VITE_ACADEMY_URL as string | undefined;
  if (env) return env.endsWith('/') ? env : `${env}/`;
  return import.meta.env.DEV ? 'http://localhost:5190/' : '/academy/';
};

export function academyUrl(target: AcademyTarget, theme: 'light' | 'dark'): string {
  const hash = !target ? '#/' : 'article' in target ? `#/a/${target.article}` : `#/role/${target.role}`;
  return `${base()}index.html?embed=1&theme=${theme}${hash}`;
}
