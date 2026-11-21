/**
 * The Academy's static pages (academy/seo, written into dist/academy by
 * academy/scripts/prerender.mjs): what Google and the AI assistants read.
 *
 * - every article, area, the FAQ and the glossary, in all 6 languages, as
 *   real HTML with text, headings, alt texts, title, description, canonical;
 * - hreflang alternates, reciprocal, with x-default;
 * - JSON-LD that parses and holds what each type needs;
 * - sitemap.xml = exactly the pages; robots.txt opens /academy/ to every
 *   crawler (AI ones included) and keeps the app out; llms.txt files;
 * - Open Graph + Twitter cards with an absolute image that exists;
 * - the committed lastmod manifest matches the content.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { SOURCE } from '../content/source';
import { LANGS } from '../src/langs';
import {
  AI_CRAWLERS,
  ACADEMY_ORIGIN,
  SHARED_IDS,
  buildSite,
  contentHashes,
  robotsAllows,
  type StaticPage,
} from './build';

const ROOT = path.resolve(__dirname, '..');
const site = buildSite({ cssHref: '/academy/assets/index-test.css' });
const pages = site.pages;
const byPath = new Map(pages.map((p) => [p.path, p]));
const url = (p: StaticPage) => `${ACADEMY_ORIGIN}${p.path}`;
const ARTICLE_IDS = SOURCE.flatMap((m) => m.articles.map((a) => a.id));
const LANG_IDS = LANGS.map((l) => l.id);

/** What the tests read from a page: each page is parsed once (jsdom is slow on ~1000 pages). */
interface Info {
  lang: string;
  h1: string;
  mainH1: string;
  mainText: string;
  title: string;
  description: string;
  canonical: string | null;
  robots: string;
  imgs: { alt: string; src: string }[];
  hrefs: string[];
  alternates: Map<string, string>;
  meta: Map<string, string>;
  graph: Record<string, unknown>[];
  context: unknown[];
}
const cache = new Map<string, Info>();
function info(p: StaticPage): Info {
  let i = cache.get(p.path);
  if (i) return i;
  const d = new DOMParser().parseFromString(p.html, 'text/html');
  const lds = [...d.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent ?? ''));
  i = {
    lang: d.documentElement.lang,
    h1: d.querySelector('h1')?.textContent?.trim() ?? '',
    mainH1: d.querySelector('main h1')?.textContent?.trim() ?? '',
    mainText: d.querySelector('main')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    title: d.title,
    description: d.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
    canonical: d.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    robots: d.querySelector('meta[name="robots"]')?.getAttribute('content') ?? 'index',
    imgs: [...d.querySelectorAll('main img')].map((x) => ({ alt: x.getAttribute('alt') ?? '', src: x.getAttribute('src') ?? '' })),
    hrefs: [...d.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')!),
    alternates: new Map(
      [...d.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => [l.getAttribute('hreflang')!, l.getAttribute('href')!]),
    ),
    meta: new Map(
      [...d.querySelectorAll('meta[property], meta[name]')]
        .filter((m) => !(m.getAttribute('property') ?? '').endsWith('locale:alternate'))
        .map((m) => [m.getAttribute('property') ?? m.getAttribute('name')!, m.getAttribute('content') ?? '']),
    ),
    graph: lds.flatMap((x) => x['@graph'] ?? [x]),
    context: lds.map((x) => x['@context']),
  };
  cache.set(p.path, i);
  return i;
}
const jsonLd = (p: StaticPage) => {
  const i = info(p);
  for (const c of i.context) expect(c).toBe('https://schema.org');
  return i.graph;
};

// parse every page once up front (about 1000 pages: slower than one test's default timeout)
beforeAll(() => {
  for (const p of pages) info(p);
}, 120_000);

describe('static Academy pages', () => {
  it('render every article in every language', () => {
    for (const lang of LANG_IDS) {
      for (const id of ARTICLE_IDS) {
        const p = byPath.get(`/academy/${lang}/a/${id}/`);
        expect(p, `${lang}/${id}`).toBeDefined();
        const i = info(p!);
        expect(i.lang).toBe(lang);
        expect(i.h1).toBeTruthy();
        expect(i.mainText.length, `${lang}/${id} text`).toBeGreaterThan(120);
      }
    }
  });

  it('render the index, every area, the FAQ and the glossary in every language', () => {
    for (const lang of LANG_IDS) {
      for (const rel of ['', 'faq/', 'glossary/', ...SOURCE.map((m) => `area/${m.area.id}/`)]) {
        const p = byPath.get(`/academy/${lang}/${rel}`);
        expect(p, `${lang}/${rel}`).toBeDefined();
        expect(info(p!).mainH1).toBeTruthy();
      }
    }
    expect(pages).toHaveLength(LANG_IDS.length * (ARTICLE_IDS.length + SOURCE.length + 3));
  });

  it('use the translated texts, not the English, outside English', () => {
    const en = info(byPath.get('/academy/en/a/create-a-gig/')!).h1;
    for (const lang of LANG_IDS.filter((l) => l !== 'en')) {
      expect(info(byPath.get(`/academy/${lang}/a/create-a-gig/`)!).h1).not.toBe(en);
    }
  });

  it('have their own title, description and canonical', () => {
    const titles = new Set<string>();
    for (const p of pages) {
      const i = info(p);
      const title = i.title;
      expect(title, p.path).toMatch(/BandWith Academy/);
      expect(titles.has(`${p.lang} ${title}`), `duplicate title ${title}`).toBe(false);
      titles.add(`${p.lang} ${title}`);
      const desc = i.description;
      expect(desc.length, p.path).toBeGreaterThan(30);
      expect(desc).not.toMatch(/\*\*|\[\[|`/);
      expect(i.canonical).toBe(url(p));
      expect(i.robots).not.toMatch(/noindex/);
    }
  });

  it('give every screenshot alt text and a file that exists', () => {
    let seen = 0;
    for (const p of pages) {
      for (const img of info(p).imgs) {
        seen++;
        expect(img.alt.trim(), p.path).toBeTruthy();
        const src = img.src;
        expect(src).toMatch(/^\/academy\/shots\/.+\.webp$/);
        expect(existsSync(path.join(ROOT, 'public', src.replace('/academy/', ''))), src).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(30);
  });

  it('link only to pages and files that exist', () => {
    for (const p of pages) {
      for (const raw of info(p).hrefs.filter((h) => h.startsWith('/academy/'))) {
        const href = raw.split('#')[0].split('?')[0];
        if (href === '/academy/') continue; // the interactive guide
        expect(byPath.has(href), `${p.path} → ${href}`).toBe(true);
      }
    }
  });

  it('link to the interactive guide at the same place', () => {
    expect(info(byPath.get('/academy/it/a/create-a-gig/')!).hrefs).toContain('/academy/?lang=it#/a/create-a-gig');
  });
});

describe('hreflang', () => {
  it('lists every language plus x-default, and every alternate links back', () => {
    for (const p of pages) {
      const map = info(p).alternates;
      expect([...map.keys()].sort(), p.path).toEqual([...LANG_IDS, 'x-default'].sort());
      expect(map.get(p.lang)).toBe(url(p));
      expect(map.get('x-default')).toBe(map.get('en'));
      for (const [lang, href] of map) {
        if (lang === 'x-default') continue;
        const other = byPath.get(href.replace(ACADEMY_ORIGIN, ''));
        expect(other, href).toBeDefined();
        const back = info(other!).alternates.get(p.lang);
        expect(back, `${href} → ${p.lang}`).toBe(url(p));
      }
    }
  });
});

describe('JSON-LD', () => {
  const known = new Set(Object.values(SHARED_IDS));

  it('parses on every page, and every @id it points to is defined there or shared with bandwith.fun', () => {
    for (const p of pages) {
      const graph = jsonLd(p);
      expect(graph.length, p.path).toBeGreaterThan(0);
      const defined = new Set(graph.map((n) => n['@id']).filter(Boolean));
      for (const n of graph) expect(n['@type'], p.path).toBeTruthy();
      const refs = JSON.stringify(graph).match(/\{"@id":"[^"]+"\}/g) ?? [];
      for (const r of refs) {
        const id = JSON.parse(r)['@id'];
        expect(defined.has(id) || known.has(id), `${p.path}: ${id}`).toBe(true);
      }
      // nothing in the JSON can close the script tag
      expect(p.html).not.toMatch(/application\/ld\+json">[^<]*<\/script[^>]*>[^<]*<\/script/);
    }
  });

  it('describes every article as a TechArticle or a HowTo, with a breadcrumb', () => {
    for (const p of pages.filter((x) => x.kind === 'article')) {
      const graph = jsonLd(p);
      const main = graph.find((n) => n['@type'] === 'TechArticle' || n['@type'] === 'HowTo');
      expect(main, p.path).toBeDefined();
      expect(main!.inLanguage).toBe(p.lang);
      expect(main!.url).toBe(url(p));
      expect(String(main!.headline ?? main!.name)).toBeTruthy();
      expect(String(main!.description)).toBeTruthy();
      expect(main!.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(String(main!.image)).toMatch(/^https:\/\//);
      if (main!['@type'] === 'HowTo') {
        const steps = main!.step as { '@type': string; text: string; position: number }[];
        expect(steps.length).toBeGreaterThan(0);
        steps.forEach((s, i) => {
          expect(s['@type']).toBe('HowToStep');
          expect(s.position).toBe(i + 1);
          expect(s.text).toBeTruthy();
          expect(s.text).not.toMatch(/\*\*|\[\[/);
        });
      }
      const crumbs = graph.find((n) => n['@type'] === 'BreadcrumbList');
      const items = crumbs!.itemListElement as { position: number; item: string; name: string }[];
      expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
      expect(items[2].item).toBe(url(p));
      for (const i of items) expect(byPath.has(i.item.replace(ACADEMY_ORIGIN, ''))).toBe(true);
    }
  });

  it('puts every question of the FAQ in a FAQPage', () => {
    for (const lang of LANG_IDS) {
      const graph = jsonLd(byPath.get(`/academy/${lang}/faq/`)!);
      const faq = graph.find((n) => n['@type'] === 'FAQPage')!;
      const qs = faq.mainEntity as { '@type': string; name: string; acceptedAnswer: { '@type': string; text: string } }[];
      expect(qs).toHaveLength(SOURCE.reduce((n, m) => n + m.faq.length, 0));
      for (const q of qs) {
        expect(q['@type']).toBe('Question');
        expect(q.name).toBeTruthy();
        expect(q.acceptedAnswer['@type']).toBe('Answer');
        expect(q.acceptedAnswer.text).toBeTruthy();
      }
    }
  });

  it('marks the glossary as a DefinedTermSet and the index as the Academy home', () => {
    const g = jsonLd(byPath.get('/academy/en/glossary/')!).find((n) => n['@type'] === 'DefinedTermSet')!;
    expect((g.hasDefinedTerm as unknown[]).length).toBe(SOURCE.reduce((n, m) => n + m.glossary.length, 0));
    const home = jsonLd(byPath.get('/academy/en/')!);
    expect(home.some((n) => n['@type'] === 'CollectionPage')).toBe(true);
    expect(home.some((n) => n['@type'] === 'WebSite' && n['@id'] === SHARED_IDS.academy)).toBe(true);
  });
});

describe('Open Graph and Twitter cards', () => {
  it('every page has its own card with an absolute image that exists', () => {
    for (const p of pages) {
      const i = info(p);
      const og = (k: string) => i.meta.get(`og:${k}`);
      expect(og('title'), p.path).toBeTruthy();
      expect(og('description')).toBeTruthy();
      expect(og('url')).toBe(url(p));
      expect(og('type')).toBe(p.kind === 'article' ? 'article' : 'website');
      expect(og('locale')).toMatch(/^[a-z]{2}_[A-Z]{2}$/);
      const img = og('image')!;
      expect(img.startsWith(`${ACADEMY_ORIGIN}/academy/shots/`), img).toBe(true);
      expect(existsSync(path.join(ROOT, 'public', img.replace(`${ACADEMY_ORIGIN}/academy/`, '')))).toBe(true);
      expect(og('image:alt')).toBeTruthy();
      expect(i.meta.get('twitter:card')).toBe('summary_large_image');
    }
  });
});

describe('sitemap.xml', () => {
  const xml = new DOMParser().parseFromString(site.files['academy/sitemap.xml'], 'application/xml');
  const urls = [...xml.getElementsByTagName('url')];

  it('lists exactly the static pages, each with its alternates and a lastmod', () => {
    expect(xml.getElementsByTagName('parsererror')).toHaveLength(0);
    const locs = urls.map((u) => u.getElementsByTagName('loc')[0].textContent);
    expect(new Set(locs)).toEqual(new Set(pages.map(url)));
    expect(locs).toHaveLength(pages.length);
    for (const u of urls) {
      expect(u.getElementsByTagName('lastmod')[0].textContent).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(u.getElementsByTagName('xhtml:link')).toHaveLength(LANG_IDS.length + 1);
    }
  });
});

describe('robots.txt', () => {
  const robots = site.files['robots.txt'];
  const agents = ['*', ...AI_CRAWLERS];

  it('names the AI crawlers the user allowed', () => {
    for (const bot of ['GPTBot', 'Google-Extended', 'CCBot', 'ClaudeBot', 'PerplexityBot']) expect(robots).toContain(`User-agent: ${bot}`);
  });

  it('opens the Academy and llms.txt to every crawler', () => {
    for (const ua of agents) {
      for (const p of ['/academy/', '/academy/en/', '/academy/it/a/create-a-gig/', '/academy/shots/calendar-month@web.webp', '/academy/sitemap.xml', '/academy/llms.txt', '/llms.txt']) {
        expect(robotsAllows(robots, ua, p), `${ua} ${p}`).toBe(true);
      }
    }
  });

  it('keeps every app route out', () => {
    for (const ua of agents) {
      for (const p of ['/', '/index.html', '/auth/callback', '/deputy.html?t=x', '/quote.html?t=x', '/rider.html?t=x', '/unsubscribe.html', '/assets/index.js', '/academyx']) {
        expect(robotsAllows(robots, ua, p), `${ua} ${p}`).toBe(false);
      }
    }
  });

  it('points to the sitemap', () => {
    expect(robots).toContain(`Sitemap: ${ACADEMY_ORIGIN}/academy/sitemap.xml`);
  });
});

describe('llms.txt', () => {
  it('lists every article of the Academy and links the product site', () => {
    const txt = site.files['academy/llms.txt'];
    expect(txt.startsWith('# BandWith Academy')).toBe(true);
    for (const id of ARTICLE_IDS) expect(txt).toContain(`${ACADEMY_ORIGIN}/academy/en/a/${id}/`);
    expect(txt).toContain('https://bandwith.fun/llms.txt');
    expect(txt).toContain(`${ACADEMY_ORIGIN}/academy/llms-full.txt`);
  });

  it('has the full English text in llms-full.txt', () => {
    const full = site.files['academy/llms-full.txt'];
    for (const m of SOURCE) for (const a of m.articles) expect(full).toContain(`## ${a.title}`);
    expect(full).not.toMatch(/\*\*[^*]+\*\*|\[\[/);
  });

  it('has a root llms.txt on app.bandwith.fun that points to the Academy', () => {
    expect(site.files['llms.txt']).toContain(`${ACADEMY_ORIGIN}/academy/llms.txt`);
  });
});

describe('lastmod manifest', () => {
  it('matches the content (run `node academy/scripts/prerender.mjs --update-lastmod` after editing the guide)', () => {
    const manifest = JSON.parse(readFileSync(path.join(__dirname, 'lastmod.json'), 'utf8')) as Record<string, { h: string }>;
    const now = contentHashes();
    const stale = Object.keys(now).filter((k) => manifest[k]?.h !== now[k]);
    const gone = Object.keys(manifest).filter((k) => !(k in now));
    expect({ stale, gone }).toEqual({ stale: [], gone: [] });
  });
});

describe('the app stays out of search engines', () => {
  it('vercel.json sends noindex everywhere except the Academy and the crawler files', () => {
    const cfg = JSON.parse(readFileSync(path.join(ROOT, '..', 'vercel.json'), 'utf8'));
    const rule = (cfg.headers ?? []).find((h: { headers: { key: string; value: string }[] }) =>
      h.headers.some((x) => x.key === 'X-Robots-Tag' && /noindex/.test(x.value)),
    );
    expect(rule).toBeDefined();
    const re = new RegExp(`^${rule.source.replace(/^\//, '\\/')}$`);
    for (const p of ['/', '/index.html', '/auth/callback', '/deputy.html', '/quote.html']) expect(re.test(p), p).toBe(true);
    for (const p of ['/academy/', '/academy/en/', '/academy/it/a/create-a-gig/', '/robots.txt', '/llms.txt']) expect(re.test(p), p).toBe(false);
  });

  it('the interactive guide (/academy/) is noindex, follow and links to the static pages', () => {
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    expect(html).toMatch(/<meta name="robots" content="noindex, follow"/);
    for (const lang of LANG_IDS) expect(html).toContain(`href="/academy/${lang}/"`);
  });
});
