/**
 * Search engines and AI assistants (SEO, GEO, AEO):
 * - robots.txt, sitemap.xml (every page in every language, hreflang alternates), llms.txt;
 * - every built page: canonical, reciprocal hreflang, absolute og:image, Twitter card;
 * - Schema.org JSON-LD that parses and matches the visible page (FAQ = the Q&A on the page);
 * - quotable answers: the "What is BandWith?" definition and the Q&A blocks;
 * - the 404 page stays out of the index; the hosting config redirects duplicate URLs.
 */
import { describe, expect, it as test } from 'vitest';
import { JSDOM } from 'jsdom';
import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import { PAGES, englishPage } from '../tools/pages';
import { finalizePage, pagePath } from '../tools/i18n';
import { LANGS, SITE_ORIGIN, pathIn, type Lang } from '../src/i18n/langs';
import { INDEXED, NOT_FOUND, FAQ_SCHEMA, OFFER_AVAILABILITY, SAME_AS, robotsTxt, sitemapXml, llmsTxt, llmsFullTxt, hostingConfig, AI_CRAWLERS } from '../tools/seo';
import { ANSWERS, DEFINITION, HOME_ANSWERS } from '../src/content/answers';
import { CHANNELS } from '../src/content/features';
import { academyArticle, ACADEMY_GUIDE } from '../src/content/site';
import { BY_ID } from '../../academy/content';

const SITE = path.resolve(__dirname, '..');
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

type Built = { rel: string; lang: Lang; url: string; doc: Document };
const BUILT: Built[] = INDEXED.flatMap((rel) =>
  LANGS.map((lang) => ({
    rel, lang, url: SITE_ORIGIN + pathIn(pagePath(rel), lang),
    doc: new JSDOM(finalizePage(englishPage(rel), rel, lang)).window.document,
  })),
);
const byUrl = new Map(BUILT.map((b) => [b.url, b]));

type Node = Record<string, unknown> & { '@type'?: string | string[] };
function graph(doc: Document): Node[] {
  const out: Node[] = [];
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const data = JSON.parse(s.textContent ?? '');
    out.push(...((data['@graph'] as Node[] | undefined) ?? [data]));
  }
  return out;
}
const ofType = (g: Node[], t: string) => g.filter((n) => ([] as unknown[]).concat(n['@type']).includes(t));

describe('robots.txt', () => {
  const txt = robotsTxt();
  test('lets every crawler read the site and points to the sitemap', () => {
    expect(txt).toMatch(/^User-agent: \*$/m);
    expect(txt).toMatch(/^Allow: \/$/m);
    expect(txt).not.toMatch(/^Disallow: \/\s*$/m);
    expect(txt).toMatch(/^Disallow: \/api\/$/m);
    expect(txt).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
  });
  test('names the AI crawlers, and lets them in', () => {
    for (const bot of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'Bingbot']) {
      expect(AI_CRAWLERS).toContain(bot);
      expect(txt).toContain(`User-agent: ${bot}`);
    }
  });
});

describe('sitemap.xml', () => {
  const xml = sitemapXml(() => '2026-11-21');
  const doc = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
  const urls = [...doc.getElementsByTagName('url')];
  const loc = (u: Element) => u.getElementsByTagName('loc')[0]?.textContent ?? '';

  test('lists every page in every language, once', () => {
    const want = INDEXED.flatMap((rel) => LANGS.map((l) => SITE_ORIGIN + pathIn(pagePath(rel), l))).sort();
    expect(urls.map(loc).sort()).toEqual(want);
    expect(want.length).toBe(Object.keys(PAGES).length * LANGS.length);
  });

  test('every URL has its hreflang alternates, x-default and a lastmod', () => {
    for (const u of urls) {
      const alts = [...u.getElementsByTagName('xhtml:link')].map((l) => `${l.getAttribute('hreflang')} ${l.getAttribute('href')}`);
      const built = byUrl.get(loc(u))!;
      const head = [...built.doc.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => `${l.getAttribute('hreflang')} ${l.getAttribute('href')}`);
      expect(alts.sort(), loc(u)).toEqual(head.sort());
      expect(u.getElementsByTagName('lastmod')[0]?.textContent).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });

  test('leaves the 404 page out', () => {
    expect(xml).not.toContain('404');
    expect(INDEXED).not.toContain(NOT_FOUND);
  });
});

describe('every built page', () => {
  for (const b of BUILT) {
    describe(`${b.lang} ${pagePath(b.rel)}`, () => {
      test('canonical is itself, hreflang alternates point back', () => {
        expect(b.doc.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
        expect(b.doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(b.url);
        const alts = [...b.doc.querySelectorAll('link[rel="alternate"][hreflang]')];
        expect(alts.map((a) => a.getAttribute('hreflang'))).toEqual([...LANGS, 'x-default']);
        for (const a of alts) {
          const other = byUrl.get(a.getAttribute('href')!);
          expect(other, a.getAttribute('href')!).toBeDefined();
          const back = [...other!.doc.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => l.getAttribute('href'));
          expect(back).toContain(b.url);
        }
      });

      test('a share card: absolute og:image that exists, Twitter large card', () => {
        const img = b.doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '';
        expect(img.startsWith(`${SITE_ORIGIN}/og/`), img).toBe(true);
        expect(existsSync(path.join(SITE, 'public', img.slice(SITE_ORIGIN.length))), img).toBe(true);
        expect(b.doc.querySelectorAll('meta[property="og:image"]')).toHaveLength(1);
        expect(b.doc.querySelector('meta[property="og:image:width"]')?.getAttribute('content')).toBe('1200');
        expect(b.doc.querySelector('meta[property="og:image:height"]')?.getAttribute('content')).toBe('630');
        expect(b.doc.querySelector('meta[name="twitter:card"]')?.getAttribute('content')).toBe('summary_large_image');
        expect(b.doc.querySelector('meta[name="twitter:title"]')?.getAttribute('content')).toBe(b.doc.querySelector('meta[property="og:title"]')?.getAttribute('content'));
        expect(b.doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')).toBe('BandWith');
        const desc = b.doc.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
        expect(desc.length, desc).toBeGreaterThan(70);
        // Google shows about 155–160 characters: every page says its piece inside that, in every language.
        expect(desc.length, desc).toBeLessThanOrEqual(160);
      });

      test('JSON-LD parses and describes this page', () => {
        const g = graph(b.doc);
        expect(ofType(g, 'Organization')).toHaveLength(1);
        expect(ofType(g, 'Organization')[0].email).toBe('ciao@bandwith.fun');
        expect(ofType(g, 'Organization')[0]['@id']).toBe(`${SITE_ORIGIN}/#organization`);
        expect(ofType(g, 'WebSite')[0]['@id']).toBe(`${SITE_ORIGIN}/#website`);
        expect(ofType(g, 'WebSite')).toHaveLength(1);
        const [page] = ofType(g, 'WebPage').concat(ofType(g, 'FAQPage'), ofType(g, 'CollectionPage'));
        expect(page, 'a WebPage').toBeDefined();
        expect(page.url).toBe(b.url);
        expect(page.inLanguage).toBe(b.lang);
        expect(page.name).toBe(b.doc.title);
        const ids = new Set(g.map((n) => n['@id']));
        expect(ids.size).toBe(g.length);
        // Every reference inside the graph points to a node in it.
        const refs = JSON.stringify(g).match(/"@id":"[^"]+"(?=})/g) ?? [];
        for (const r of refs) expect(ids.has(r.slice(7, -1)), r).toBe(true);
      });

      test('FAQPage markup: on /faq/ and /get/ it is the Q&A the page shows, elsewhere there is none', () => {
        const shown = [...b.doc.querySelectorAll('.faq__list details')].map((d) => ({
          q: d.querySelector('summary')!.textContent!.replace(/\s+/g, ' ').trim(),
          a: d.querySelector('summary')!.nextElementSibling!.textContent!.replace(/\s+/g, ' ').trim(),
        }));
        const faq = ofType(graph(b.doc), 'FAQPage')[0] as { mainEntity?: { name: string; acceptedAnswer: { text: string } }[] } | undefined;
        if (!FAQ_SCHEMA.includes(b.rel)) { expect(faq).toBeUndefined(); return; }
        expect(shown.length).toBeGreaterThan(0);
        expect(faq?.mainEntity?.map((q) => ({ q: q.name, a: q.acceptedAnswer.text }))).toEqual(shown);
      });

      test('Guide links are the Academy’s static pages in this language, to articles that exist', () => {
        const hrefs = [...b.doc.querySelectorAll('a[href*="app.bandwith.fun/academy"]')].map((a) => a.getAttribute('href')!);
        expect(hrefs.length).toBeGreaterThanOrEqual(3); // the nav, the menu and the footer at least
        const re = new RegExp(`^https://app\\.bandwith\\.fun/academy/${b.lang}/(?:a/([a-z0-9-]+)/)?$`);
        for (const h of hrefs) {
          const m = re.exec(h);
          expect(m, `${b.url} → ${h}`).not.toBeNull();
          if (m?.[1]) expect(BY_ID.has(m[1]), h).toBe(true);
        }
      });
    });
  }

  test('the app (SoftwareApplication) on the home, Get and Devices pages: every platform, free, no ratings', () => {
    for (const b of BUILT.filter((x) => ['index.html', 'get/index.html', 'features/devices/index.html'].includes(x.rel))) {
      const [app] = ofType(graph(b.doc), 'SoftwareApplication') as Node[];
      expect(app, `${b.lang} ${b.rel}`).toBeDefined();
      for (const os of ['iOS', 'iPadOS', 'Android', 'Web']) expect(String(app.operatingSystem)).toContain(os);
      const offers = app.offers as { price: string; priceCurrency: string };
      expect(offers.price).toBe('0');
      expect(app.aggregateRating).toBeUndefined();
      expect(app.review).toBeUndefined();
      expect((app.featureList as string[]).length).toBe(CHANNELS.length);
    }
  });

  test('every question carries FAQPage markup on one URL only, and /faq/ has all of the site’s answers', () => {
    for (const lang of LANGS) {
      const seen = new Map<string, string>();
      for (const b of BUILT.filter((x) => x.lang === lang)) {
        const faq = ofType(graph(b.doc), 'FAQPage')[0] as { mainEntity?: { name: string }[] } | undefined;
        for (const q of faq?.mainEntity ?? []) {
          expect(seen.get(q.name), `${q.name}: ${seen.get(q.name)} and ${b.url}`).toBeUndefined();
          seen.set(q.name, b.url);
        }
      }
      const all = [...HOME_ANSWERS, ...Object.values(ANSWERS).flat()].length;
      expect([...seen.values()].filter((u) => u.endsWith('/faq/')).length, lang).toBe(all);
      expect([...seen.values()].filter((u) => u.endsWith('/get/')).length, lang).toBeGreaterThanOrEqual(5);
    }
    const faq = ofType(graph(byUrl.get(`${SITE_ORIGIN}/faq/`)!.doc), 'FAQPage')[0] as { mainEntity: { name: string }[] };
    expect(faq.mainEntity.map((q) => q.name).sort()).toEqual([...HOME_ANSWERS, ...Object.values(ANSWERS).flat()].map((x) => x.q).sort());
  });

  test('the offer: free, limited availability while the beta’s spots are capped; no invented profiles', () => {
    expect(OFFER_AVAILABILITY).toBe('https://schema.org/LimitedAvailability');
    for (const b of BUILT.filter((x) => x.rel === 'index.html')) {
      const [app] = ofType(graph(b.doc), 'SoftwareApplication') as Node[];
      expect((app.offers as { availability: string }).availability).toBe(OFFER_AVAILABILITY);
      // sameAs only with a real official profile (none in the repo yet).
      expect(SAME_AS).toEqual([]);
      expect(ofType(graph(b.doc), 'Organization')[0].sameAs).toBeUndefined();
    }
  });

  test('the Get page keeps the closed-beta blocks out of the page until the count says so', () => {
    for (const b of BUILT.filter((x) => x.rel === 'get/index.html')) {
      const hidden = (sel: string) => [...b.doc.querySelectorAll(sel)].map((el) => el.hasAttribute('hidden'));
      expect(hidden('#waitlist'), b.url).toEqual([true]);
      expect(hidden('.full__inv-open, .full__inv-shut'), b.url).toEqual([true, true]);
      expect(hidden('.gdoors__inv'), b.url).toEqual([true]);
      expect(b.doc.querySelector('#waitlist')?.getAttribute('data-cap-show')).toBe('closed');
      // The doors themselves are always there.
      expect(b.doc.querySelector('[data-doors]')?.closest('[hidden]')).toBeNull();
    }
  });

  test('feature pages: a two-step breadcrumb, Home → the channel, in the page language', () => {
    for (const b of BUILT.filter((x) => x.rel.startsWith('features/'))) {
      const [crumbs] = ofType(graph(b.doc), 'BreadcrumbList') as { itemListElement: { position: number; name: string; item: string }[] }[];
      expect(crumbs, b.url).toBeDefined();
      expect(crumbs.itemListElement.map((i) => i.position)).toEqual([1, 2]);
      expect(crumbs.itemListElement[0].item).toBe(SITE_ORIGIN + pathIn('/', b.lang));
      expect(crumbs.itemListElement[1].item).toBe(b.url);
      const slug = b.rel.split('/')[1];
      const name = CHANNELS.find((c) => c.slug === slug)!.name;
      if (b.lang === 'en') expect(crumbs.itemListElement[1].name).toBe(name);
      else expect(crumbs.itemListElement[1].name).not.toBe(name);
    }
  });

  test('no plan prices or payment providers anywhere in the structured data', () => {
    for (const b of BUILT) {
      const ld = [...b.doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent).join('');
      expect(ld).not.toMatch(/Paddle|Stripe|Maestro|€|"price":"(?!0")/);
    }
  });
});

describe('answers people and AI assistants can quote', () => {
  test('the definition: one short paragraph that says what BandWith is', () => {
    expect(DEFINITION.startsWith('BandWith is ')).toBe(true);
    expect(words(DEFINITION)).toBeGreaterThanOrEqual(35);
    expect(words(DEFINITION)).toBeLessThanOrEqual(70);
    const home = byUrl.get(`${SITE_ORIGIN}/`)!.doc;
    expect(home.querySelector('[data-definition]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(DEFINITION);
  });

  test('the home page answers at least five questions, every channel page three or more', () => {
    expect(HOME_ANSWERS.length).toBeGreaterThanOrEqual(5);
    for (const c of CHANNELS) expect(ANSWERS[c.slug]?.length ?? 0, c.slug).toBeGreaterThanOrEqual(3);
    const home = byUrl.get(`${SITE_ORIGIN}/`)!.doc;
    expect(home.querySelectorAll('.faq__list details')).toHaveLength(HOME_ANSWERS.length);
    for (const c of CHANNELS) {
      const page = byUrl.get(`${SITE_ORIGIN}/features/${c.slug}/`)!.doc;
      expect(page.querySelectorAll('.faq__list details'), c.slug).toHaveLength(ANSWERS[c.slug].length);
    }
  });

  test('every answer is a question, then a short self-contained answer', () => {
    const all = [...HOME_ANSWERS, ...Object.values(ANSWERS).flat()];
    const qs = new Set<string>();
    for (const { q, a } of all) {
      expect(q.endsWith('?'), q).toBe(true);
      expect(qs.has(q), `twice: ${q}`).toBe(false);
      qs.add(q);
      expect(words(a), q).toBeGreaterThanOrEqual(15);
      expect(words(a), q).toBeLessThanOrEqual(80);
      expect(a, q).toMatch(/BandWith|[A-Z]/);
    }
  });

  test('the FAQ page gathers every question on the site', () => {
    const faq = byUrl.get(`${SITE_ORIGIN}/faq/`)!.doc;
    const shown = new Set([...faq.querySelectorAll('.faq__list summary')].map((s) => s.textContent!.trim()));
    for (const { q } of [...HOME_ANSWERS, ...Object.values(ANSWERS).flat()]) expect(shown.has(q), q).toBe(true);
    expect(faq.querySelectorAll('h1')).toHaveLength(1);
  });
});

describe('llms.txt', () => {
  const txt = llmsTxt();
  test('names BandWith, says what it is and links every page', () => {
    expect(txt.startsWith('# BandWith\n')).toBe(true);
    expect(txt).toMatch(/^> .{80,}$/m);
    for (const rel of INDEXED) expect(txt, rel).toContain(`(${SITE_ORIGIN}${pagePath(rel)})`);
    expect(txt).toContain(`${SITE_ORIGIN}/llms-full.txt`);
    // The Academy (app.bandwith.fun) has its own llms.txt and prerendered pages.
    expect(txt).toContain('(https://app.bandwith.fun/academy/llms.txt)');
    expect(txt).toContain('(https://app.bandwith.fun/academy/en/)');
    expect(txt).toContain(`${SITE_ORIGIN}/it/`);
    expect(txt).toContain(`${SITE_ORIGIN}/es/`);
  });
  test('the full text holds every page title and every answer', () => {
    const full = llmsFullTxt(INDEXED.map((rel) => ({ rel, html: finalizePage(englishPage(rel), rel, 'en') })));
    // The h1 as a heading (its lines may be joined by a space in the text).
    const squeezed = full.replace(/\s+/g, '');
    for (const b of BUILT.filter((x) => x.lang === 'en')) {
      expect(squeezed, b.rel).toContain(`#${b.doc.querySelector('h1')!.textContent!.replace(/\s+/g, '')}`);
    }
    for (const { q, a } of [...HOME_ANSWERS, ...Object.values(ANSWERS).flat()]) {
      expect(full, q).toContain(q);
      expect(full, q).toContain(a);
    }
    expect(full).toContain(DEFINITION);
    expect(full).not.toMatch(/undefined|\[object Object\]|<[a-z]/);
  });
  test('the full text leaves out what only a closed beta shows, and says nothing the app stopped doing', () => {
    const full = llmsFullTxt(INDEXED.map((rel) => ({ rel, html: finalizePage(englishPage(rel), rel, 'en') })));
    expect(full).not.toMatch(/Tonight’s show is full|Sold out tonight|Every open spot is taken|Your spot is kept|kept for band invites are taken too|Your door is still open/);
    expect(full).not.toMatch(/click needs the internet|isn’t sent over Bluetooth|Ask the lineup now|Open the gig once while online/);
    // The Get page itself is still there, with its doors and its questions.
    expect(full).toContain('Pick the door that fits your phone.');
    expect(full).toContain('### Do I need TestFlight on iPhone?');
    // What the release added.
    for (const words of ['Follow the tempo', 'Count in', 'next 7 days', 'Highlight my part', 'Possible gig – keep the date free', 'Send crash reports', 'Delete this date']) {
      expect(full, words).toContain(words);
    }
  });
  test('Guide links: the article helper and the home point at static English pages', () => {
    expect(academyArticle('count-in')).toBe('https://app.bandwith.fun/academy/en/a/count-in/');
    expect(ACADEMY_GUIDE).toBe('https://app.bandwith.fun/academy/en/');
    expect(llmsTxt()).not.toContain('/academy/#/');
  });
  test('no plan prices or payment providers', () => {
    expect(txt + llmsFullTxt([])).not.toMatch(/Paddle|Stripe|Maestro|€\s?\d/);
  });
});

describe('404 and hosting', () => {
  test('the 404 page is noindex and has no canonical', () => {
    const doc = new JSDOM(finalizePage(englishPage(NOT_FOUND), NOT_FOUND, 'en')).window.document;
    expect(doc.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
    expect(doc.querySelector('link[rel="canonical"]')).toBeNull();
    expect(doc.querySelectorAll('link[rel="alternate"][hreflang]')).toHaveLength(0);
    expect(doc.querySelector('a[href="/"]')).not.toBeNull();
  });

  test('duplicate URLs redirect to the one with the slash; hashed files are cached for good', () => {
    const cfg = hostingConfig();
    const redirects = new Map(cfg.redirects.map((r) => [r.source, r]));
    for (const rel of INDEXED) {
      for (const l of LANGS) {
        const p = pathIn(pagePath(rel), l);
        if (p !== '/') expect(redirects.get(p.slice(0, -1))?.destination, p).toBe(p);
        expect(redirects.get(`${p}index.html`)?.destination, p).toBe(p);
      }
    }
    for (const r of cfg.redirects) expect(r.permanent).toBe(true);
    expect(cfg).not.toHaveProperty('trailingSlash');
    const assets = cfg.headers.find((h) => h.source === '/assets/(.*)');
    expect(assets?.headers).toContainEqual({ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' });
  });
});

describe('IndexNow', () => {
  test('the key file is served from the site root and matches scripts/indexnow.sh', () => {
    const keys = readdirSync(path.join(SITE, 'public')).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
    expect(keys).toHaveLength(1);
    const key = keys[0].slice(0, -4);
    expect(readFileSync(path.join(SITE, 'public', keys[0]), 'utf8').trim()).toBe(key);
    expect(readFileSync(path.join(SITE, '../scripts/indexnow.sh'), 'utf8')).toContain(`KEY="${key}"`);
  });
});
