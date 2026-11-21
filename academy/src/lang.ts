/**
 * The Academy's language: the app's own six.
 *
 * - Inside the app (?embed=1&lang=…): the app passes its language.
 * - On the web: the language picked in the top bar (kept per browser), else
 *   the app's language setting when the app ran in this browser, else the
 *   browser's language, else English.
 */
import { LANGS, type Lang } from './langs';

export { LANGS, type Lang };

const PICK_KEY = 'bw-academy-lang';
/** The app's language setting (src/lib/i18n): a language, or 'system'. */
const APP_KEY = 'bw-locale-v1';

const isLang = (v: unknown): v is Lang => typeof v === 'string' && LANGS.some((l) => l.id === v);

const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked
  }
};

function detect(): Lang {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (isLang(fromUrl)) return fromUrl;
  const picked = stored(PICK_KEY);
  if (isLang(picked)) return picked;
  const app = stored(APP_KEY);
  if (isLang(app)) return app;
  for (const l of navigator.languages ?? [navigator.language]) {
    const base = (l || '').toLowerCase().split(/[-_]/)[0];
    if (isLang(base)) return base;
  }
  return 'en';
}

export const LANG: Lang = detect();
document.documentElement.lang = LANG;

/** The reader picked a language in the top bar (web only): keep it and reload. */
export function pickLang(l: Lang) {
  try {
    localStorage.setItem(PICK_KEY, l);
  } catch {
    /* storage blocked: the URL still carries it */
  }
  const url = new URL(location.href);
  url.searchParams.set('lang', l);
  location.replace(url.toString());
}
