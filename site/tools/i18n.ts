/**
 * Build-time languages (used by site/vite.config.ts and site/test/i18n.test.ts).
 *
 * The English pages are the source. Each one gets an Italian and a Spanish
 * copy at the same path under /it/ and /es/: site/it/** and site/es/** hold
 * generated one-line stubs (gitignored) so Vite has a file per page; the
 * stub's HTML is the English page, translated here.
 *
 * Every page (English too) gets <html lang>, a canonical URL, hreflang
 * alternates, og:locale and the EN · IT · ES switcher (<!--@lang-switch-->).
 * On /it/ and /es/ the text is translated (i18n/translate.ts), site links
 * keep the prefix and Guide links open the Academy in that language.
 */
import { JSDOM } from 'jsdom';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import { LANGS, OG_LOCALE, SITE_ORIGIN, NATIVE, localizeHref, pathIn, type Lang } from '../src/i18n/langs';
import { makeTranslator, translateTree, type Translator } from '../src/i18n/translate';
import { SAME } from '../src/i18n/same';
import { it } from '../src/i18n/dict/it';
import { es } from '../src/i18n/dict/es';
import { applySeo, NOT_FOUND } from './seo';

export const MIRROR_LANGS = LANGS.filter((l): l is Exclude<Lang, 'en'> => l !== 'en');
export const STUB = '<!--bw:mirror-->';

/** 'features/money/index.html' → '/features/money/'. */
export const pagePath = (rel: string) => '/' + rel.replace(/index\.html$/, '');

/** Which language a page file is in, and its English source file (relative to site/). */
export function pageOf(rel: string): { lang: Lang; enRel: string } {
  const m = /^(it|es)\/(.*)$/.exec(rel.split(path.sep).join('/'));
  return m ? { lang: m[1] as Lang, enRel: m[2] } : { lang: 'en', enRel: rel.split(path.sep).join('/') };
}

/** Writes the /it/ and /es/ stubs for every English page; returns their files (relative). */
export function writeMirrors(root: string, pages: string[]): string[] {
  const out: string[] = [];
  for (const lang of MIRROR_LANGS) {
    for (const rel of pages) {
      const file = path.join(root, lang, rel);
      mkdirSync(path.dirname(file), { recursive: true });
      const body = `${STUB}\n`;
      if (!existsSync(file) || readFileSync(file, 'utf8') !== body) writeFileSync(file, body);
      out.push(`${lang}/${rel}`);
    }
  }
  return out;
}

let translators: Record<string, Translator> | null = null;
export function translatorFor(lang: Exclude<Lang, 'en'>): Translator {
  translators ??= { it: makeTranslator('it', it, SAME), es: makeTranslator('es', es, SAME) };
  return translators[lang];
}

export function switcherHtml(enPath: string, lang: Lang) {
  const links = LANGS.map((l) =>
    `<a href="${pathIn(enPath, l)}" hreflang="${l}" lang="${l}" title="${NATIVE[l]}"${l === lang ? ' aria-current="page"' : ''}>${l.toUpperCase()}</a>`,
  ).join('');
  return `<nav class="lsw" data-lang-switch aria-label="Language">${links}</nav>`;
}

export type Misses = Map<string, Set<string>>;

/**
 * The finished HTML of a page in `lang`, from its English HTML (partials
 * already filled). `misses` collects untranslated units per page.
 */
export function finalizePage(html: string, enRel: string, lang: Lang, misses?: Misses): string {
  // The 404 page answers any path: its switcher offers the three home pages.
  const enPath = enRel === NOT_FOUND ? '/' : pagePath(enRel);
  html = html.replace(/<!--@lang-switch-->/g, switcherHtml(enPath, lang));
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  doc.documentElement.lang = lang;

  let tr = (s: string) => s;
  if (lang !== 'en') {
    const t = translatorFor(lang);
    tr = (s: string) => t.text(s) ?? s;
    t.misses.clear();
    translateTree(doc, t);
    if (misses) for (const m of t.misses) (misses.get(m) ?? misses.set(m, new Set()).get(m)!).add(`/${lang}${enPath}`);
    // The install guides exist in every site language: /videos/install/en/… → /videos/install/<lang>/…
    doc.querySelectorAll('video[poster], source[src]').forEach((el) => {
      for (const attr of ['poster', 'src']) {
        const v = el.getAttribute(attr);
        if (v?.startsWith('/videos/install/en/')) el.setAttribute(attr, v.replace('/videos/install/en/', `/videos/install/${lang}/`));
      }
    });
    doc.querySelectorAll('a[href]').forEach((a) => {
      if (a.closest('[data-lang-switch]')) return;
      const h = a.getAttribute('href')!;
      const out = localizeHref(h, lang);
      if (out !== h) a.setAttribute('href', out);
    });
  }

  const head = doc.head;
  head.querySelectorAll('link[rel="canonical"], link[rel="alternate"][hreflang], meta[property="og:locale"], meta[property="og:locale:alternate"], meta[property="og:url"]').forEach((n) => n.remove());
  const add = (tag: string, attrs: Record<string, string>) => {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    head.appendChild(el);
  };
  const abs = (l: Lang) => SITE_ORIGIN + pathIn(enPath, l);
  add('link', { rel: 'canonical', href: abs(lang) });
  for (const l of LANGS) add('link', { rel: 'alternate', hreflang: l, href: abs(l) });
  add('link', { rel: 'alternate', hreflang: 'x-default', href: abs('en') });
  add('meta', { property: 'og:url', content: abs(lang) });
  add('meta', { property: 'og:locale', content: OG_LOCALE[lang] });
  for (const l of LANGS) if (l !== lang) add('meta', { property: 'og:locale:alternate', content: OG_LOCALE[l] });

  // Share card and Schema.org JSON-LD, from the page as it now reads (tools/seo.ts).
  applySeo(doc, enRel, lang, tr);
  return dom.serialize();
}
