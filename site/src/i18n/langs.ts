/**
 * The site's languages. English is the default and lives at the root;
 * Italian at /it/, Spanish at /es/ (same paths below the prefix).
 * Shared by the build (site/tools/i18n.ts) and the pages' scripts.
 */
export type Lang = 'en' | 'it' | 'es';
export const LANGS: Lang[] = ['en', 'it', 'es'];
export const DEFAULT_LANG: Lang = 'en';
export const SITE_ORIGIN = 'https://bandwith.fun';

/** Each language written in itself (switcher titles, the popup). */
export const NATIVE: Record<Lang, string> = { en: 'English', it: 'Italiano', es: 'Español' };
/** Open Graph locale per language. */
export const OG_LOCALE: Record<Lang, string> = { en: 'en_US', it: 'it_IT', es: 'es_ES' };
/** Number and date formats. */
export const INTL_LOCALE: Record<Lang, string> = { en: 'en-US', it: 'it-IT', es: 'es-ES' };

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as string[]).includes(v);

/** The language a site path is in: /it/… → it, /es/… → es, anything else → en. */
export function langOfPath(pathname: string): Lang {
  const m = /^\/(it|es)(?:\/|$)/.exec(pathname);
  return m ? (m[1] as Lang) : 'en';
}

/** The English path of any site path: /it/features/money/ → /features/money/. */
export function basePath(pathname: string): string {
  const p = pathname.replace(/^\/(it|es)(?=\/|$)/, '');
  return p === '' ? '/' : p;
}

/** A site path in a language: ('/features/money/', 'es') → /es/features/money/. */
export function pathIn(pathname: string, lang: Lang): string {
  const base = basePath(pathname);
  return lang === 'en' ? base : `/${lang}${base}`;
}

/** Folders of files, not pages: their links never get a language prefix. */
const ASSET = /^\/(shots|photos|brand|icons|assets|fonts|api|favicon|src|@)/;

/** Whether an href is a page of this site (and so belongs in the page's language). */
export const isPageHref = (href: string) => href.startsWith('/') && !href.startsWith('//') && !ASSET.test(href);

/**
 * An href as it should read on a page in `lang`: site pages get the prefix,
 * the Academy opens on its static page in the same language
 * (/academy/it/a/<id>/), everything else is untouched.
 */
export function localizeHref(href: string, lang: Lang): string {
  if (lang === 'en') return href;
  if (isPageHref(href)) {
    if (/^\/(it|es)(\/|$|#|\?)/.test(href)) return href;
    return `/${lang}${href}`;
  }
  // The privacy policy has Italian and Spanish versions (the terms are English only).
  if (href === 'https://app.bandwith.fun/legal/privacy.html') return `https://app.bandwith.fun/legal/privacy-${lang}.html`;
  // The Academy's static pages: /academy/en/… → /academy/<lang>/… (the home, or one article).
  const academy = /^(https:\/\/app\.bandwith\.fun\/academy\/)(?:en\/)?((?:a\/[a-z0-9-]+\/)?)$/.exec(href);
  if (academy) return `${academy[1]}${lang}/${academy[2]}`;
  return href;
}
