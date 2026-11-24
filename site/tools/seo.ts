/**
 * Search engines and AI assistants (SEO, GEO, AEO). Used by site/vite.config.ts,
 * site/tools/i18n.ts (applySeo on every page) and site/test/seo.test.ts.
 *
 * - applySeo: the share card (absolute og:image per page and language, Twitter
 *   card) and the Schema.org JSON-LD graph, built from the finished page in its
 *   own language, so the markup always says what the page shows. FAQPage
 *   markup sits on /faq/ and /get/ only (FAQ_SCHEMA): one URL per question.
 * - robots.txt, sitemap.xml (every page × language with hreflang alternates),
 *   llms.txt / llms-full.txt, and the hosting config (redirects, cache headers).
 * - 404.html: noindex, no canonical, never in the sitemap.
 */
import { execFileSync } from 'child_process';
import { JSDOM } from 'jsdom';
import { PAGES, SITE_ROOT, englishPage } from './pages';
import { LANGS, NATIVE, SITE_ORIGIN, pathIn, type Lang } from '../src/i18n/langs';
import { CHANNELS } from '../src/content/features';
import { DEFINITION } from '../src/content/answers';
import { APK_URL, APP_URL, TESTFLIGHT_URL, ACADEMY_HOME, shot } from '../src/content/site';

/** Indexed pages (English source files); each one also exists under /it/ and /es/. */
export const INDEXED: string[] = Object.values(PAGES);
export const NOT_FOUND = '404.html';

/** Public contact and official profiles for the Organization (sameAs: none yet, 11-21). */
export const ORG_EMAIL = 'ciao@bandwith.fun';
export const SAME_AS: string[] = [];

/** The pages whose Q&A carries FAQPage markup (every question marked up on one URL only). */
export const FAQ_SCHEMA: string[] = ['faq/index.html', 'get/index.html'];

/**
 * The offer's availability. The beta is open, and free, but its spots are
 * capped (bw_capacity_status: 300 accounts, a waitlist when they are gone),
 * so LimitedAvailability stays the honest value; InStock would promise a
 * spot to everyone.
 */
export const OFFER_AVAILABILITY = 'https://schema.org/LimitedAvailability';

/** Crawlers named in robots.txt: search engines and AI assistants, all let in. */
export const AI_CRAWLERS = [
  'Googlebot', 'Bingbot', 'DuckDuckBot', 'Applebot', 'Applebot-Extended', 'Google-Extended',
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'PerplexityBot', 'Perplexity-User', 'CCBot', 'Meta-ExternalAgent', 'MistralAI-User', 'cohere-ai', 'YouBot',
];

const pathOf = (rel: string) => '/' + rel.replace(/index\.html$/, '');
const urlOf = (rel: string, lang: Lang) => SITE_ORIGIN + pathIn(pathOf(rel), lang);
const ORG = `${SITE_ORIGIN}/#organization`;
const WEBSITE = `${SITE_ORIGIN}/#website`;
const APP = `${SITE_ORIGIN}/#app`;
/** The languages of the app and the Academy (the site: en, it, es). */
const APP_LANGS = ['en', 'it', 'es', 'fr', 'de', 'pt'];

/** The share card of a page: site/public/og/<key>-<lang>.jpg (site/tools/og-cards.mjs). */
export function cardKey(rel: string): string {
  if (rel === 'index.html' || rel === NOT_FOUND) return 'home';
  const m = /^features\/([a-z-]+)\//.exec(rel);
  return m ? m[1] : rel.split('/')[0];
}
export const cardPath = (rel: string, lang: Lang) => `/og/${cardKey(rel)}-${lang}.jpg`;

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * The head of a finished page (any language), after translation: share card
 * and JSON-LD. `tr` translates a known English string into the page language.
 */
export function applySeo(doc: Document, enRel: string, lang: Lang, tr: (s: string) => string): void {
  const head = doc.head;
  const meta = (sel: string) => head.querySelector(sel)?.getAttribute('content') ?? '';
  const add = (tag: string, attrs: Record<string, string>) => {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    head.appendChild(el);
    return el;
  };

  if (enRel === NOT_FOUND) {
    head.querySelectorAll('link[rel="canonical"], link[rel="alternate"][hreflang], meta[property="og:url"]').forEach((n) => n.remove());
    if (!head.querySelector('meta[name="robots"]')) add('meta', { name: 'robots', content: 'noindex' });
  }

  // Share card.
  head.querySelectorAll('meta[property^="og:image"], meta[name^="twitter:"], meta[property="og:site_name"]').forEach((n) => n.remove());
  const title = norm(doc.title);
  const ogTitle = meta('meta[property="og:title"]') || title;
  const description = meta('meta[name="description"]');
  const ogDescription = meta('meta[property="og:description"]') || description;
  const image = SITE_ORIGIN + cardPath(enRel, lang);
  add('meta', { property: 'og:site_name', content: 'BandWith' });
  add('meta', { property: 'og:image', content: image });
  add('meta', { property: 'og:image:type', content: 'image/jpeg' });
  add('meta', { property: 'og:image:width', content: '1200' });
  add('meta', { property: 'og:image:height', content: '630' });
  add('meta', { property: 'og:image:alt', content: ogTitle });
  add('meta', { name: 'twitter:card', content: 'summary_large_image' });
  add('meta', { name: 'twitter:title', content: ogTitle });
  add('meta', { name: 'twitter:description', content: ogDescription });
  add('meta', { name: 'twitter:image', content: image });

  if (enRel === NOT_FOUND) return;

  // Schema.org graph.
  head.querySelectorAll('script[type="application/ld+json"]').forEach((n) => n.remove());
  const url = urlOf(enRel, lang);
  const home = SITE_ORIGIN + pathIn('/', lang);
  const org: Record<string, unknown> = {
    '@type': 'Organization', '@id': ORG, name: 'BandWith', url: `${SITE_ORIGIN}/`,
    logo: { '@type': 'ImageObject', url: `${SITE_ORIGIN}/brand/app-icon.png`, width: 1024, height: 1024 },
    description: tr(DEFINITION),
  };
  if (ORG_EMAIL) org.contactPoint = { '@type': 'ContactPoint', contactType: 'customer support', email: ORG_EMAIL, availableLanguage: APP_LANGS };
  if (ORG_EMAIL) org.email = ORG_EMAIL;
  if (SAME_AS.length) org.sameAs = SAME_AS;
  const website = {
    '@type': 'WebSite', '@id': WEBSITE, name: 'BandWith', url: `${SITE_ORIGIN}/`,
    inLanguage: LANGS, publisher: { '@id': ORG },
  };
  const app = {
    '@type': 'SoftwareApplication', '@id': APP, name: 'BandWith', url: home,
    description: tr(DEFINITION),
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'iOS, iPadOS, Android, Web',
    availableOnDevice: 'iPhone, iPad, Android, Surface Duo, web browser',
    inLanguage: APP_LANGS,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR', availability: OFFER_AVAILABILITY, url: SITE_ORIGIN + pathIn('/get/', lang) },
    downloadUrl: [TESTFLIGHT_URL, APK_URL, APP_URL],
    featureList: CHANNELS.map((c) => tr(c.name)),
    screenshot: ['gig-workspace-admin', 'calendar-month', 'music-stage'].map((id) => `${SITE_ORIGIN}${shot(id)}`),
    publisher: { '@id': ORG },
  };

  // FAQPage once per question on the whole site: /faq/ (it shows every question of content/answers.ts)
  // and /get/ (its own "Before you sign up"). The home and channel pages show their questions without
  // the markup, so no question is marked up on two URLs.
  const shown = !FAQ_SCHEMA.includes(enRel) ? [] : [...doc.querySelectorAll('.faq__list details')].map((d) => {
    const s = d.querySelector('summary');
    return { q: norm(s?.textContent), a: norm(s?.nextElementSibling?.textContent) };
  }).filter((x) => x.q && x.a);

  const page: Record<string, unknown> = {
    '@type': shown.length ? ['WebPage', 'FAQPage'] : 'WebPage', '@id': `${url}#webpage`, url, name: title,
    description, inLanguage: lang, isPartOf: { '@id': WEBSITE }, about: { '@id': APP },
    primaryImageOfPage: { '@type': 'ImageObject', url: image, width: 1200, height: 630 },
  };
  const nodes: Record<string, unknown>[] = [org, website, app, page];

  const crumb = crumbName(enRel, title, tr);
  if (crumb) {
    page.breadcrumb = { '@id': `${url}#breadcrumb` };
    nodes.push({
      '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'BandWith', item: home },
        { '@type': 'ListItem', position: 2, name: crumb, item: url },
      ],
    });
  }
  if (shown.length) {
    page.mainEntity = shown.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }));
  }

  const script = doc.createElement('script');
  script.setAttribute('type', 'application/ld+json');
  script.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replace(/</g, '\\u003c');
  head.appendChild(script);
}

/** The second breadcrumb step: the channel's name, or the page's title (Get, FAQ). Home has none. */
function crumbName(enRel: string, title: string, tr: (s: string) => string): string | null {
  if (enRel === 'index.html') return null;
  const ch = CHANNELS.find((c) => enRel === `features/${c.slug}/index.html`);
  if (ch) return tr(ch.name);
  return title.replace(/\s*·\s*BandWith$/, '');
}

export function robotsTxt(): string {
  const named = AI_CRAWLERS.map((bot) => `User-agent: ${bot}\nAllow: /\nDisallow: /api/\n`).join('\n');
  return (
    '# bandwith.fun: everything here is public, for people, search engines and AI assistants.\n' +
    `# About BandWith for language models: ${SITE_ORIGIN}/llms.txt\n\n` +
    'User-agent: *\nAllow: /\nDisallow: /api/\n\n' +
    named + '\n' +
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml\n`
  );
}

/** The last commit that touched a page's sources (YYYY-MM-DD), or today outside git. */
export function gitLastmod(rel: string, lang: Lang): string {
  const slug = /^features\/([a-z-]+)\//.exec(rel)?.[1];
  const files = [
    rel, 'partials', 'src/content/answers.ts', 'src/content/features.ts',
    ...(slug ? [`src/content/pages/${slug}.ts`] : []),
    ...(lang === 'en' ? [] : [`src/i18n/dict/${lang}.json`]),
  ];
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', ...files], { cwd: SITE_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  } catch { /* not a git checkout */ }
  return new Date().toISOString().slice(0, 10);
}

export function sitemapXml(lastmod: (rel: string, lang: Lang) => string = gitLastmod): string {
  const urls = INDEXED.flatMap((rel) => LANGS.map((lang) => {
    const alts = [...LANGS.map((l) => [l, urlOf(rel, l)]), ['x-default', urlOf(rel, 'en')]]
      .map(([l, href]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${href}"/>`).join('\n');
    return `  <url>\n    <loc>${urlOf(rel, lang)}</loc>\n    <lastmod>${lastmod(rel, lang)}</lastmod>\n${alts}\n  </url>`;
  }));
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    urls.join('\n') + '\n</urlset>\n'
  );
}

const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function headOf(rel: string) {
  const html = englishPage(rel);
  const title = unesc(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '');
  const description = unesc(/<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '');
  return { title, description };
}
function pageName(rel: string, title: string) {
  if (rel === 'index.html') return 'Home';
  const ch = CHANNELS.find((c) => rel === `features/${c.slug}/index.html`);
  return ch ? ch.name : title.replace(/\s*·\s*BandWith$/, '');
}

/** llms.txt (llmstxt.org): what BandWith is and where each topic lives, in Markdown. */
export function llmsTxt(): string {
  const line = (rel: string) => {
    const { title, description } = headOf(rel);
    return `- [${pageName(rel, title)}](${SITE_ORIGIN}${pathOf(rel)}): ${description}`;
  };
  const features = INDEXED.filter((r) => r.startsWith('features/'));
  const other = INDEXED.filter((r) => !r.startsWith('features/'));
  return [
    '# BandWith',
    '',
    `> ${DEFINITION}`,
    '',
    'BandWith is free while it’s in beta, with a limited number of spots. Roles decide what each person sees: admins run the deal (client, quote, contract, every fee), members see their gigs and their own fee, deputies see only the requests sent to them. The server enforces it.',
    `The app is at ${APP_URL}.`,
    '',
    '## Pages',
    '',
    ...other.map(line),
    '',
    '## Features',
    '',
    ...features.map(line),
    '',
    '## Docs',
    '',
    `- [BandWith Academy](${ACADEMY_HOME}en/): the full user guide, every screen for admins, members and deputies, in English, Italian, Spanish, French, German and Portuguese.`,
    `- [BandWith Academy for language models](${ACADEMY_HOME}llms.txt): the guide's own llms.txt, with every article.`,
    '',
    '## Languages',
    '',
    ...LANGS.filter((l) => l !== 'en').map((l) => `- [${NATIVE[l]}](${SITE_ORIGIN}/${l}/): the same pages in ${NATIVE[l]}.`),
    '',
    '## Optional',
    '',
    `- [Full text](${SITE_ORIGIN}/llms-full.txt): every page of this site as plain text, with all the questions and answers.`,
    `- [Sitemap](${SITE_ORIGIN}/sitemap.xml)`,
    '',
  ].join('\n');
}

/**
 * Blocks that become a line of the full text; skipped: demos, decorations,
 * controls, and what only a closed beta shows (the waitlist "Tonight's show
 * is full" and the lines for invited people: `hidden` in the HTML, named here
 * too so they stay out whatever hides them).
 */
const SKIP = '#try, #try-it, [aria-hidden="true"], script, style, template, svg, form, button, nav, .crop, .sr-only, [data-hero-picks], [hidden], .full, .full__inv-shut, .gdoors__inv, [data-cap-show]';
const BLOCKS = new Set(['H1', 'H2', 'H3', 'H4', 'P', 'LI', 'SUMMARY', 'TABLE', 'FIGCAPTION']);

function textOf(el: Element): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === 3) { out += n.textContent; return; }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    if (e.matches(SKIP)) return;
    if (e.tagName === 'BR') { out += ' '; return; }
    e.childNodes.forEach(walk);
    // Elements that sit side by side (a name and its message, a label and a line) read as separate words.
    if (!/^(EM|I|A|CODE|SMALL|ABBR|SUP|SUB|U|MARK|Q)$/.test(e.tagName)) out += ' ';
  };
  walk(el);
  return norm(out).replace(/ ([.,;:!?…’])/g, '$1');
}

function markdownOf(main: Element): string[] {
  const lines: string[] = [];
  const walk = (el: Element) => {
    for (const c of el.children) {
      if (c.matches(SKIP)) continue;
      if (!BLOCKS.has(c.tagName)) { walk(c); continue; }
      if (c.tagName === 'TABLE') {
        const rows = [...c.querySelectorAll('tr')].map((r) => [...r.children].map((x) => textOf(x) || ' '));
        if (rows.length) {
          lines.push('', `| ${rows[0].join(' | ')} |`, `|${rows[0].map(() => ' --- ').join('|')}|`, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`), '');
        }
        continue;
      }
      const t = textOf(c);
      if (!t) continue;
      if (c.tagName === 'H1') lines.push('', `# ${t}`, '');
      else if (c.tagName === 'H2') lines.push('', `## ${t}`, '');
      else if (c.tagName === 'H3' || c.tagName === 'H4' || c.tagName === 'SUMMARY') lines.push('', `### ${t}`, '');
      else if (c.tagName === 'LI') {
        const b = c.querySelector(':scope > b, :scope > a > b');
        const rest = b ? norm(t.slice(textOf(b).length)) : '';
        lines.push(b && rest ? `- **${textOf(b)}**: ${rest}` : `- ${t}`);
      } else lines.push('', t, '');
    }
  };
  walk(main);
  return lines;
}

/** llms-full.txt: every English page's text (no demos), with its URL. */
export function llmsFullTxt(pages: { rel: string; html: string }[]): string {
  const parts = [
    '# BandWith: the full text of bandwith.fun',
    '',
    `> ${DEFINITION}`,
    '',
    `Every page of ${SITE_ORIGIN}, in English, as plain text. The same pages exist in Italian (${SITE_ORIGIN}/it/) and Spanish (${SITE_ORIGIN}/es/).`,
  ];
  for (const { rel, html } of pages) {
    const doc = new JSDOM(html).window.document;
    const main = doc.querySelector('main');
    if (!main) continue;
    parts.push('', '---', '', `URL: ${SITE_ORIGIN}${pathOf(rel)}`, `Title: ${norm(doc.title)}`, ...markdownOf(main));
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

type Redirect = { source: string; destination: string; permanent: true };
type Header = { source: string; headers: { key: string; value: string }[] };

/**
 * vercel.json for the site's static deploy (written into dist): one URL per
 * page (no-slash and /index.html redirect to the slash), long cache for hashed
 * files. No trailingSlash switch: it would also redirect /api/geo.
 */
export function hostingConfig(): { redirects: Redirect[]; headers: Header[] } {
  const redirects: Redirect[] = [];
  for (const rel of INDEXED) {
    for (const l of LANGS) {
      const p = pathIn(pathOf(rel), l);
      if (p !== '/') redirects.push({ source: p.slice(0, -1), destination: p, permanent: true });
      redirects.push({ source: `${p}index.html`, destination: p, permanent: true });
    }
  }
  for (const l of LANGS) {
    const base = pathIn('/', l);
    redirects.push({ source: `${base}features`, destination: `${base}#rack`, permanent: true });
    redirects.push({ source: `${base}features/`, destination: `${base}#rack`, permanent: true });
  }
  return {
    redirects,
    headers: [
      { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      { source: '/(shots|og|fonts|brand|icons)/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800' }] },
      { source: '/(llms|llms-full).txt', headers: [{ key: 'X-Robots-Tag', value: 'noindex' }, { key: 'Content-Type', value: 'text/plain; charset=utf-8' }] },
    ],
  };
}

/** Everything the build writes next to the pages (site/dist), from the finished English pages. */
export function seoFiles(englishPages: { rel: string; html: string }[]): Record<string, string> {
  return {
    'robots.txt': robotsTxt(),
    'sitemap.xml': sitemapXml(),
    'llms.txt': llmsTxt(),
    'llms-full.txt': llmsFullTxt(englishPages),
    'vercel.json': JSON.stringify(hostingConfig(), null, 2) + '\n',
  };
}
