/**
 * BandWith Academy as static pages, for Google and the AI assistants.
 *
 * The interactive guide (academy/index.html, hash routes, the in-app ? buttons)
 * renders in the browser, so a crawler sees almost nothing. This builds, from
 * the same content files, one real HTML page per article, area, FAQ and
 * glossary in each of the 6 languages:
 *
 *   /academy/<lang>/                 the Academy home
 *   /academy/<lang>/area/<area>/     an area
 *   /academy/<lang>/a/<article>/     an article
 *   /academy/<lang>/faq/  ·  /academy/<lang>/glossary/
 *
 * with title, description, canonical, hreflang, Open Graph and JSON-LD; plus
 * robots.txt, the Academy sitemap and llms.txt files (./crawl.ts).
 * academy/scripts/prerender.mjs writes it all into dist/ after `vite build`.
 * Tests: ./seo.test.ts.
 */
import type { AreaModule, AreaText, Article, Faq, GlossaryTerm } from '../content/types';
import { SOURCE } from '../content/source';
import { localize } from '../content/localize';
import { LANGS, type Lang } from '../src/langs';
import itTexts from '../content/i18n/it';
import esTexts from '../content/i18n/es';
import frTexts from '../content/i18n/fr';
import deTexts from '../content/i18n/de';
import ptTexts from '../content/i18n/pt';
import { blocks, chip, clip, esc, inline, plain, shotDevice, shotFile, t, type Ctx } from './render';
import { crawlFiles } from './crawl';

export { AI_CRAWLERS, robotsAllows } from './crawl';

export const ACADEMY_ORIGIN = 'https://app.bandwith.fun';
const SITE_ORIGIN = 'https://bandwith.fun';

/**
 * schema.org nodes shared with the product site (site/, bandwith.fun): the
 * same @id on both domains, so search engines join them into one entity.
 */
export const SHARED_IDS = {
  organization: `${SITE_ORIGIN}/#organization`,
  website: `${SITE_ORIGIN}/#website`,
  app: `${SITE_ORIGIN}/#app`,
  academy: `${ACADEMY_ORIGIN}/academy/#website`,
} as const;

const TEXTS: Record<Exclude<Lang, 'en'>, AreaText[]> = { it: itTexts, es: esTexts, fr: frTexts, de: deTexts, pt: ptTexts };
const LANG_IDS = LANGS.map((l) => l.id);
const OG_LOCALE: Record<Lang, string> = { en: 'en_US', it: 'it_IT', es: 'es_ES', fr: 'fr_FR', de: 'de_DE', pt: 'pt_BR' };
/** The fallback card: the admin's home screen. */
const DEFAULT_SHOT = 'basics-home-admin';

export type PageKind = 'index' | 'area' | 'article' | 'faq' | 'glossary';

export interface StaticPage {
  /** URL path, '/academy/it/a/create-a-gig/'. */
  path: string;
  /** The same page in every language shares it: 'a/create-a-gig', 'area/gigs', 'faq', '' (home). */
  rel: string;
  lang: Lang;
  kind: PageKind;
  title: string;
  description: string;
  lastmod: string;
  html: string;
}

export interface LastmodEntry {
  /** Content hash of the page's texts. */
  h: string;
  /** Last change, YYYY-MM-DD. */
  d: string;
  /** First published, YYYY-MM-DD. */
  p: string;
}
export type LastmodManifest = Record<string, LastmodEntry>;

export interface BuildInput {
  /** The interactive guide's built stylesheet, '/academy/assets/index-….css'. */
  cssHref: string;
  shotSize?: Ctx['shotSize'];
  /** academy/seo/lastmod.json. Pages missing or changed since get `today`. */
  lastmod?: LastmodManifest;
  today?: string;
}

/* ── Content per language ── */

interface LangContent {
  lang: Lang;
  modules: AreaModule[];
  articles: (Article & { areaId: string })[];
  byId: Map<string, Article & { areaId: string }>;
  titles: Map<string, string>;
  faq: (Faq & { areaId: string })[];
  glossary: GlossaryTerm[];
}

function content(lang: Lang): LangContent {
  const tr = lang === 'en' ? null : TEXTS[lang];
  const modules = SOURCE.map((m) => localize(m, tr?.find((x) => x.area.id === m.area.id)));
  const articles = modules.flatMap((m) => m.articles.map((a) => ({ ...a, areaId: m.area.id })));
  return {
    lang,
    modules,
    articles,
    byId: new Map(articles.map((a) => [a.id, a])),
    titles: new Map(articles.map((a) => [a.id, a.title])),
    faq: modules.flatMap((m) => m.faq.map((f) => ({ ...f, areaId: m.area.id }))),
    glossary: modules.flatMap((m) => m.glossary).sort((a, b) => a.term.localeCompare(b.term, lang)),
  };
}

const CONTENT = new Map(LANG_IDS.map((l) => [l, content(l)] as const));

const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const pathOf = (lang: Lang, rel: string) => `/academy/${lang}/${rel ? `${rel}/` : ''}`;
const abs = (p: string) => `${ACADEMY_ORIGIN}${p}`;
const shotUrl = (id: string, dev: Parameters<typeof shotFile>[1]) => abs(`/academy/${shotFile(id, dev)}`);

/** Every page, as [rel, kind], in the order of the sitemap. */
function pageList(): { rel: string; kind: PageKind }[] {
  return [
    { rel: '', kind: 'index' },
    ...SOURCE.flatMap((m) => [
      { rel: `area/${m.area.id}`, kind: 'area' as const },
      ...m.articles.map((a) => ({ rel: `a/${a.id}`, kind: 'article' as const })),
    ]),
    { rel: 'faq', kind: 'faq' },
    { rel: 'glossary', kind: 'glossary' },
  ];
}

/* ── Content hashes (lastmod) ── */

/** cyrb53: a small, stable string hash (no node:crypto, so it runs anywhere). */
function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** What each page says, as data: when it changes, the page's lastmod moves. */
function pageData(c: LangContent, rel: string, kind: PageKind): unknown {
  switch (kind) {
    case 'article': {
      const a = c.byId.get(rel.slice(2))!;
      return [a.title, a.summary, a.roles, a.kind, a.body, (a.related ?? []).map((r) => c.titles.get(r))];
    }
    case 'area': {
      const m = c.modules.find((x) => `area/${x.area.id}` === rel)!;
      return [m.area, m.articles.map((a) => [a.id, a.title, a.summary, a.kind, a.roles]), m.faq];
    }
    case 'faq':
      return c.faq;
    case 'glossary':
      return c.glossary;
    case 'index':
      return c.modules.map((m) => [m.area, m.articles.length]);
  }
}

const keyOf = (lang: Lang, rel: string) => (rel ? `${lang}/${rel}` : lang);

/** Page key ('it/a/create-a-gig') → content hash. academy/seo/lastmod.json keeps them with a date. */
export function contentHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const lang of LANG_IDS) {
    const c = CONTENT.get(lang)!;
    for (const { rel, kind } of pageList()) out[keyOf(lang, rel)] = hash(JSON.stringify(pageData(c, rel, kind)));
  }
  return out;
}

/** The manifest after a content change: changed and new pages get `today`, removed ones go. */
export function updatedLastmod(old: LastmodManifest, today: string): LastmodManifest {
  const out: LastmodManifest = {};
  for (const [k, h] of Object.entries(contentHashes())) {
    const prev = old[k];
    out[k] = prev?.h === h ? prev : { h, d: today, p: prev?.p ?? today };
  }
  return out;
}

/* ── JSON-LD ── */

const ORG_NODE = { '@type': 'Organization', '@id': SHARED_IDS.organization, name: 'BandWith', url: `${SITE_ORIGIN}/` };
const ACADEMY_NODE = {
  '@type': 'WebSite',
  '@id': SHARED_IDS.academy,
  name: 'BandWith Academy',
  url: abs('/academy/en/'),
  inLanguage: LANG_IDS,
  publisher: { '@id': SHARED_IDS.organization },
  isPartOf: { '@id': SHARED_IDS.website },
  about: { '@id': SHARED_IDS.app },
};

const jsonLd = (graph: object[]) =>
  `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [ORG_NODE, ACADEMY_NODE, ...graph] })
    // nothing inside can close the <script>
    .replace(/</g, '\\u003c')}</script>`;

const breadcrumb = (url: string, items: { name: string; path: string }[]) => ({
  '@type': 'BreadcrumbList',
  '@id': `${url}#breadcrumb`,
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: abs(it.path) })),
});

/* ── The page shell ── */

interface Shell {
  c: LangContent;
  rel: string;
  kind: PageKind;
  title: string;
  description: string;
  image: { url: string; alt: string; w?: number; h?: number };
  lastmod: LastmodEntry;
  graph: object[];
  /** Where the interactive guide opens this page: '#/a/create-a-gig'. */
  hash: string;
  main: string;
  cssHref: string;
}

function shell(s: Shell): string {
  const { c, rel } = s;
  const lang = c.lang;
  const url = abs(pathOf(lang, rel));
  const alternates = [
    ...LANG_IDS.map((l) => `<link rel="alternate" hreflang="${l}" href="${abs(pathOf(l, rel))}">`),
    `<link rel="alternate" hreflang="x-default" href="${abs(pathOf('en', rel))}">`,
  ].join('\n');
  const og = [
    ['og:type', s.kind === 'article' ? 'article' : 'website'],
    ['og:site_name', 'BandWith Academy'],
    ['og:title', s.title],
    ['og:description', s.description],
    ['og:url', url],
    ['og:locale', OG_LOCALE[lang]],
    ...LANG_IDS.filter((l) => l !== lang).map((l) => ['og:locale:alternate', OG_LOCALE[l]]),
    ['og:image', s.image.url],
    ['og:image:alt', s.image.alt],
    ...(s.image.w ? [['og:image:width', String(s.image.w)], ['og:image:height', String(s.image.h)]] : []),
    ...(s.kind === 'article' ? [['article:modified_time', s.lastmod.d], ['article:published_time', s.lastmod.p]] : []),
  ]
    .map(([k, v]) => `<meta property="${k}" content="${esc(v)}">`)
    .join('\n');
  const twitter = [
    ['twitter:card', 'summary_large_image'],
    ['twitter:title', s.title],
    ['twitter:description', s.description],
    ['twitter:image', s.image.url],
    ['twitter:image:alt', s.image.alt],
  ]
    .map(([k, v]) => `<meta name="${k}" content="${esc(v)}">`)
    .join('\n');
  const interactive = `/academy/?lang=${lang}${s.hash}`;
  const langLinks = LANGS.map((l) =>
    l.id === lang
      ? `<b>${esc(l.name)}</b>`
      : `<a href="${pathOf(l.id, rel)}" hreflang="${l.id}" lang="${l.id}">${esc(l.name)}</a>`,
  ).join(' · ');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(s.title)}</title>
<meta name="description" content="${esc(s.description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${url}">
${alternates}
${og}
${twitter}
<link rel="icon" href="/academy/favicon.svg">
<link rel="stylesheet" href="https://use.typekit.net/mzr4hzv.css">
<link rel="stylesheet" href="${s.cssHref}">
<script>try{var t=localStorage.getItem('bw-academy-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
${jsonLd(s.graph)}
</head>
<body>
<header class="top">
<a class="brand" href="${pathOf(lang, '')}"><img src="/academy/favicon.svg" alt="" width="28" height="28"><span>BandWith <b>Academy</b></span></a>
<nav class="top__nav"><a href="${pathOf(lang, 'faq')}">${esc(t(c, 'FAQ'))}</a><a href="${pathOf(lang, 'glossary')}">${esc(t(c, 'Glossary'))}</a></nav>
<div class="top__tools"><a class="searchPill" href="${interactive}" aria-label="${esc(t(c, 'Open the interactive guide'))}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg><span>${esc(t(c, 'Open the interactive guide'))}</span></a></div>
</header>
<main class="main main--${s.kind === 'index' ? 'home' : s.kind}">
${s.main}
</main>
<footer class="foot">
<span>BandWith Academy</span>
<span>${esc(t(c, 'Language'))}: ${langLinks}</span>
<span><a href="${pathOf(lang, 'glossary')}">${esc(t(c, 'Glossary'))}</a> · <a href="${pathOf(lang, 'faq')}">${esc(t(c, 'FAQ'))}</a> · <a href="/">${esc(t(c, 'Open BandWith'))}</a></span>
</footer>
</body>
</html>
`;
}

/* ── Pages ── */

const ctxOf = (c: LangContent, input: BuildInput): Ctx => ({
  lang: c.lang,
  titles: c.titles,
  articlePath: (id) => pathOf(c.lang, `a/${id}`),
  shotSize: input.shotSize,
});

const crumbsHtml = (c: LangContent, items: { name: string; path?: string }[]) =>
  `<nav class="crumbs" aria-label="Breadcrumb"><a href="${pathOf(c.lang, '')}">Academy</a>${items
    .map((i) => ` <span aria-hidden="true">›</span> ${i.path ? `<a href="${i.path}">${esc(i.name)}</a>` : `<span>${esc(i.name)}</span>`}`)
    .join('')}</nav>`;

const rowHtml = (c: LangContent, a: Article & { areaId: string }, showArea = false) => {
  const area = c.modules.find((m) => m.area.id === a.areaId)!;
  return (
    `<a class="row" href="${pathOf(c.lang, `a/${a.id}`)}"><span class="row__main"><span class="row__title">${esc(a.title)}</span>` +
    `<span class="row__sum">${inline(a.summary, { lang: c.lang, titles: c.titles, articlePath: () => '#' }).replace(/<a [^>]*>|<\/a>/g, '')}</span></span>` +
    `<span class="row__meta">${showArea ? `<span class="row__area">${esc(area.area.title)}</span>` : ''}<span class="row__roles">${a.roles
      .map((r) => chip(c, r))
      .join('')}</span></span></a>`
  );
};

const faqHtml = (c: LangContent, items: Faq[], ctx: Ctx) =>
  `<div class="faq">${items
    .map(
      (f) =>
        `<details><summary><span>${esc(f.q)}</span></summary><p>${inline(f.a, ctx)}</p>${
          f.roles ? `<div class="faq__roles">${f.roles.map((r) => chip(c, r)).join('')}</div>` : ''
        }</details>`,
    )
    .join('')}</div>`;

/** The card image of a list of blocks: their first screenshot. */
function firstShot(articles: Article[], c: LangContent): Shell['image'] | null {
  for (const a of articles) {
    for (const b of a.body) {
      if (b.type !== 'shot') continue;
      const dev = shotDevice(b.id, b.device);
      if (dev) return { url: shotUrl(b.id, dev), alt: plain(b.caption, c.titles), file: shotFile(b.id, dev) } as Shell['image'] & { file: string };
    }
  }
  return null;
}

function image(articles: Article[], c: LangContent, input: BuildInput, fallbackAlt: string): Shell['image'] {
  const found = (firstShot(articles, c) as (Shell['image'] & { file: string }) | null) ?? {
    url: shotUrl(DEFAULT_SHOT, 'web'),
    alt: fallbackAlt,
    file: shotFile(DEFAULT_SHOT, 'web'),
  };
  const size = input.shotSize?.(found.file);
  return { url: found.url, alt: found.alt, ...(size ? { w: size.w, h: size.h } : {}) };
}

function articlePage(c: LangContent, id: string, base: Omit<Shell, 'title' | 'description' | 'image' | 'graph' | 'hash' | 'main'>, input: BuildInput) {
  const a = c.byId.get(id)!;
  const m = c.modules.find((x) => x.area.id === a.areaId)!;
  const ctx = ctxOf(c, input);
  const url = abs(pathOf(c.lang, base.rel));
  const siblings = m.articles.map((x) => c.byId.get(x.id)!);
  const idx = siblings.findIndex((x) => x.id === id);
  const prev = siblings[idx - 1];
  const next = siblings[idx + 1];
  const related = (a.related ?? []).map((r) => c.byId.get(r)).filter((x): x is Article & { areaId: string } => !!x);
  const description = clip(plain(a.summary, c.titles));
  const img = image([a], c, input, a.title);
  const steps = a.body.flatMap((b) => (b.type === 'steps' ? b.items : []));
  const common = {
    '@id': `${url}#article`,
    url,
    mainEntityOfPage: url,
    name: a.title,
    headline: clip(a.title, 110),
    description,
    inLanguage: c.lang,
    image: img.url,
    datePublished: base.lastmod.p,
    dateModified: base.lastmod.d,
    author: { '@id': SHARED_IDS.organization },
    publisher: { '@id': SHARED_IDS.organization },
    isPartOf: { '@id': SHARED_IDS.academy },
    about: { '@id': SHARED_IDS.app },
    articleSection: m.area.title,
    keywords: (a.keywords ?? []).join(', ') || undefined,
    audience: { '@type': 'Audience', audienceType: a.roles.map((r) => t(c, r === 'admin' ? 'Admin' : r === 'member' ? 'Member' : 'Deputy')).join(', ') },
    breadcrumb: { '@id': `${url}#breadcrumb` },
  };
  const main =
    a.kind === 'task' && steps.length
      ? {
          '@type': 'HowTo',
          ...common,
          step: steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, text: plain(s, c.titles), url: `${url}#step-${i + 1}` })),
        }
      : { '@type': 'TechArticle', ...common };
  const areaPath = pathOf(c.lang, `area/${m.area.id}`);
  const html = `<div class="articleLayout">
<aside class="toc"><a class="toc__area" href="${areaPath}">← ${esc(m.area.title)}</a><ul>${siblings
    .map((x) => `<li><a href="${pathOf(c.lang, `a/${x.id}`)}"${x.id === id ? ' class="on" aria-current="page"' : ''}>${esc(x.title)}</a></li>`)
    .join('')}</ul></aside>
<article class="article">
${crumbsHtml(c, [{ name: m.area.title, path: areaPath }])}
<header class="article__head"><p class="eyebrow">${esc(t(c, a.kind === 'task' ? 'How to' : 'Guide'))}</p><h1>${esc(a.title)}</h1><p class="lede">${inline(a.summary, ctx)}</p>
<div class="article__roles"><span class="mini">${esc(t(c, 'For'))}</span>${(['admin', 'member', 'deputy'] as const).map((r) => chip(c, r, a.roles.includes(r))).join('')}</div></header>
<div class="article__body">
${blocks(a.body, ctx)}
</div>
${related.length ? `<section class="block"><h2 class="mini">${esc(t(c, 'Related'))}</h2><div class="rows">${related.map((r) => rowHtml(c, r, r.areaId !== a.areaId)).join('')}</div></section>` : ''}
<nav class="pager">${prev ? `<a href="${pathOf(c.lang, `a/${prev.id}`)}"><small>${esc(t(c, 'Previous'))}</small><span>← ${esc(prev.title)}</span></a>` : '<span></span>'}${
    next ? `<a href="${pathOf(c.lang, `a/${next.id}`)}" class="pager__next"><small>${esc(t(c, 'Next'))}</small><span>${esc(next.title)} →</span></a>` : ''
  }</nav>
</article>
</div>`;
  return shell({
    ...base,
    title: `${a.title} · BandWith Academy`,
    description,
    image: img,
    graph: [main, breadcrumb(url, [{ name: 'Academy', path: pathOf(c.lang, '') }, { name: m.area.title, path: areaPath }, { name: a.title, path: pathOf(c.lang, base.rel) }])],
    hash: `#/a/${id}`,
    main: html,
  });
}

function areaPage(c: LangContent, areaId: string, base: Omit<Shell, 'title' | 'description' | 'image' | 'graph' | 'hash' | 'main'>, input: BuildInput) {
  const m = c.modules.find((x) => x.area.id === areaId)!;
  const ctx = ctxOf(c, input);
  const url = abs(pathOf(c.lang, base.rel));
  const list = m.articles.map((a) => c.byId.get(a.id)!);
  const refs = list.filter((a) => a.kind === 'reference');
  const tasks = list.filter((a) => a.kind === 'task');
  const section = (title: string, items: typeof list) =>
    items.length ? `<section class="block"><h2 class="mini">${esc(t(c, title))}</h2><div class="rows">${items.map((a) => rowHtml(c, a)).join('')}</div></section>` : '';
  const description = clip(`${m.area.intro} ${t(c, '{n} guides', { n: list.length })}.`);
  return shell({
    ...base,
    title: `${m.area.title} · BandWith Academy`,
    description,
    image: image(list, c, input, m.area.title),
    graph: [
      {
        '@type': 'CollectionPage',
        '@id': `${url}#page`,
        url,
        name: m.area.title,
        description,
        inLanguage: c.lang,
        dateModified: base.lastmod.d,
        isPartOf: { '@id': SHARED_IDS.academy },
        about: { '@id': SHARED_IDS.app },
        breadcrumb: { '@id': `${url}#breadcrumb` },
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: list.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(pathOf(c.lang, `a/${a.id}`)), name: a.title })),
        },
      },
      breadcrumb(url, [{ name: 'Academy', path: pathOf(c.lang, '') }, { name: m.area.title, path: pathOf(c.lang, base.rel) }]),
    ],
    hash: `#/area/${areaId}`,
    main: `${crumbsHtml(c, [{ name: m.area.title }])}
<header class="pageHead"><h1>${esc(m.area.title)}</h1><p class="lede">${esc(m.area.intro)}</p></header>
${section('Understand it', refs)}
${section('How do I…', tasks)}
${m.faq.length ? `<section class="block"><h2 class="mini">${esc(t(c, 'Questions'))}</h2>${faqHtml(c, m.faq, ctx)}</section>` : ''}`,
  });
}

function faqPage(c: LangContent, base: Omit<Shell, 'title' | 'description' | 'image' | 'graph' | 'hash' | 'main'>, input: BuildInput) {
  const ctx = ctxOf(c, input);
  const url = abs(pathOf(c.lang, base.rel));
  const name = t(c, 'FAQ & common problems');
  const description = clip(`${name}: ${c.faq.slice(0, 4).map((f) => f.q).join(' ')}`);
  return shell({
    ...base,
    title: `${name} · BandWith Academy`,
    description,
    image: image([], c, input, name),
    graph: [
      {
        '@type': 'FAQPage',
        '@id': `${url}#page`,
        url,
        name,
        description,
        inLanguage: c.lang,
        dateModified: base.lastmod.d,
        isPartOf: { '@id': SHARED_IDS.academy },
        about: { '@id': SHARED_IDS.app },
        breadcrumb: { '@id': `${url}#breadcrumb` },
        mainEntity: c.faq.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: plain(f.a, c.titles) },
        })),
      },
      breadcrumb(url, [{ name: 'Academy', path: pathOf(c.lang, '') }, { name, path: pathOf(c.lang, base.rel) }]),
    ],
    hash: '#/faq',
    main: `${crumbsHtml(c, [{ name: t(c, 'FAQ') }])}
<header class="pageHead"><h1>${esc(name)}</h1></header>
${c.modules
  .filter((m) => m.faq.length)
  .map((m) => `<section class="block"><h2 class="mini">${esc(m.area.title)}</h2>${faqHtml(c, m.faq, ctx)}</section>`)
  .join('\n')}`,
  });
}

function glossaryPage(c: LangContent, base: Omit<Shell, 'title' | 'description' | 'image' | 'graph' | 'hash' | 'main'>, input: BuildInput) {
  const ctx = ctxOf(c, input);
  const url = abs(pathOf(c.lang, base.rel));
  const name = t(c, 'Glossary');
  const description = clip(`BandWith Academy · ${name}: ${c.glossary.map((g) => g.term).join(', ')}`);
  const groups = new Map<string, GlossaryTerm[]>();
  for (const g of c.glossary) {
    const k = g.term[0].toUpperCase();
    groups.set(k, [...(groups.get(k) ?? []), g]);
  }
  const anchor = (term: string) => `term-${term.toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')}`;
  return shell({
    ...base,
    title: `${name} · BandWith Academy`,
    description,
    image: image([], c, input, name),
    graph: [
      {
        '@type': 'DefinedTermSet',
        '@id': `${url}#terms`,
        url,
        name: `BandWith Academy · ${name}`,
        description,
        inLanguage: c.lang,
        isPartOf: { '@id': SHARED_IDS.academy },
        hasDefinedTerm: c.glossary.map((g) => ({
          '@type': 'DefinedTerm',
          name: g.term,
          description: plain(g.definition, c.titles),
          url: `${url}#${anchor(g.term)}`,
          inDefinedTermSet: { '@id': `${url}#terms` },
        })),
      },
      breadcrumb(url, [{ name: 'Academy', path: pathOf(c.lang, '') }, { name, path: pathOf(c.lang, base.rel) }]),
    ],
    hash: '#/glossary',
    main: `${crumbsHtml(c, [{ name }])}
<header class="pageHead"><h1>${esc(name)}</h1></header>
<div class="glossary">${[...groups.entries()]
      .map(
        ([k, list]) =>
          `<section><h2 class="glossary__k">${esc(k)}</h2><dl>${list
            .map(
              (g) =>
                `<div id="${anchor(g.term)}"><dt>${esc(g.term)}</dt><dd>${inline(g.definition, ctx)}${
                  g.see && c.byId.get(g.see) ? ` <a class="xref" href="${pathOf(c.lang, `a/${g.see}`)}">${esc(t(c, 'Read more'))}</a>` : ''
                }</dd></div>`,
            )
            .join('')}</dl></section>`,
      )
      .join('')}</div>`,
  });
}

function indexPage(c: LangContent, base: Omit<Shell, 'title' | 'description' | 'image' | 'graph' | 'hash' | 'main'>, input: BuildInput) {
  const url = abs(pathOf(c.lang, ''));
  const h1 = t(c, 'Everything your band can do, step by step.');
  const lede = t(c, '{n} guides for admins, members and deputies, on phone, iPad, dual-screen, Android and the web.', { n: c.articles.length });
  const feature = ['first-gig-in-10-minutes', 'who-sees-what', 'device-differences']
    .map((id) => c.byId.get(id))
    .filter((a): a is Article & { areaId: string } => !!a);
  const description = clip(`${h1} ${lede}`);
  return shell({
    ...base,
    title: `BandWith Academy: ${h1}`,
    description,
    image: image([], c, input, 'BandWith Academy'),
    graph: [
      {
        '@type': 'CollectionPage',
        '@id': `${url}#page`,
        url,
        name: 'BandWith Academy',
        description,
        inLanguage: c.lang,
        isPartOf: { '@id': SHARED_IDS.academy },
        about: { '@id': SHARED_IDS.app },
        breadcrumb: { '@id': `${url}#breadcrumb` },
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: c.modules.map((m, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: abs(pathOf(c.lang, `area/${m.area.id}`)),
            name: m.area.title,
          })),
        },
      },
      breadcrumb(url, [{ name: 'Academy', path: pathOf(c.lang, '') }]),
    ],
    hash: '#/',
    main: `<section class="hero"><p class="eyebrow">BandWith Academy</p><h1>${esc(h1)}</h1><p class="lede">${esc(lede)}</p></section>
<section class="block feature">${feature
      .map(
        (a, i) =>
          `<a class="featureCard${i === 0 ? ' featureCard--lime' : ''}" href="${pathOf(c.lang, `a/${a.id}`)}"><span class="featureCard__t">${esc(a.title)}</span><span class="featureCard__d">${esc(
            plain(a.summary, c.titles),
          )}</span></a>`,
      )
      .join('')}</section>
<section class="block"><h2 class="mini">${esc(t(c, 'Browse by area'))}</h2><div class="areas">${c.modules
      .map(
        (m) =>
          `<a class="areaCard" href="${pathOf(c.lang, `area/${m.area.id}`)}"><span class="areaCard__t">${esc(m.area.title)}</span><span class="areaCard__d">${esc(
            m.area.intro,
          )}</span><span class="areaCard__n">${esc(t(c, '{n} guides', { n: m.articles.length }))}</span></a>`,
      )
      .join('')}</div></section>
${c.modules
  .map(
    (m) =>
      `<section class="block"><h2 class="mini">${esc(m.area.title)}</h2><div class="rows">${m.articles
        .map((a) => rowHtml(c, c.byId.get(a.id)!))
        .join('')}</div></section>`,
  )
  .join('\n')}
<section class="block twoUp"><a class="linkCard" href="${pathOf(c.lang, 'faq')}"><span><b>${esc(t(c, 'FAQ & common problems'))}</b><small>${esc(
      t(c, '{n} answers', { n: c.faq.length }),
    )}</small></span></a><a class="linkCard" href="${pathOf(c.lang, 'glossary')}"><span><b>${esc(t(c, 'Glossary'))}</b><small>${esc(
      t(c, '{n} terms', { n: c.glossary.length }),
    )}</small></span></a></section>`,
  });
}

/* ── Everything ── */

export function buildPages(input: BuildInput): StaticPage[] {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const hashes = contentHashes();
  const pages: StaticPage[] = [];
  for (const lang of LANG_IDS) {
    const c = CONTENT.get(lang)!;
    for (const { rel, kind } of pageList()) {
      const key = keyOf(lang, rel);
      const known = input.lastmod?.[key];
      const lastmod = known && known.h === hashes[key] ? known : { h: hashes[key], d: today, p: known?.p ?? today };
      const base = { c, rel, kind, lastmod, cssHref: input.cssHref };
      const html =
        kind === 'article'
          ? articlePage(c, rel.slice(2), base, input)
          : kind === 'area'
            ? areaPage(c, rel.slice(5), base, input)
            : kind === 'faq'
              ? faqPage(c, base, input)
              : kind === 'glossary'
                ? glossaryPage(c, base, input)
                : indexPage(c, base, input);
      const title = unesc(/<title>([^<]*)<\/title>/.exec(html)![1]);
      const description = unesc(/<meta name="description" content="([^"]*)">/.exec(html)![1]);
      pages.push({ path: pathOf(lang, rel), rel, lang, kind, title, description, lastmod: lastmod.d, html });
    }
  }
  return pages;
}

/** The pages plus the crawler files, keyed by their path under dist/. */
export function buildSite(input: BuildInput): { pages: StaticPage[]; files: Record<string, string> } {
  const pages = buildPages(input);
  const en = CONTENT.get('en')!;
  return {
    pages,
    files: crawlFiles({
      pages,
      origin: ACADEMY_ORIGIN,
      siteOrigin: SITE_ORIGIN,
      langs: LANG_IDS,
      en,
      pathOf,
      shotUrl,
    }),
  };
}

export type { LangContent };
