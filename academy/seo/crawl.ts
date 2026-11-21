/**
 * The crawler files of app.bandwith.fun: robots.txt, the Academy sitemap and
 * the llms.txt files. Only the Academy is public content; the app itself and
 * the private links it sends (deputy, quote, rider pages) stay out.
 */
import type { ShotDevice } from '../content/types';
import type { Lang } from '../src/langs';
import { blocksText, plain } from './render';
import type { LangContent, StaticPage } from './build';

/**
 * AI crawlers named in robots.txt, all allowed into the Academy (the user's
 * call, 2026-11-20: training crawlers included). `User-agent: *` covers
 * Googlebot, Bingbot and the rest the same way.
 */
export const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Meta-ExternalAgent',
  'Amazonbot',
  'DuckAssistBot',
  'MistralAI-User',
  'cohere-ai',
];

export function robotsTxt(origin: string): string {
  return `# app.bandwith.fun: the BandWith web app (sign-in) and the BandWith Academy.
# Public content is the Academy only, the user guide in 6 languages, open to
# every crawler, AI assistants included. The app and the private links it sends
# (deputy, quote and rider pages) are not public: keep them out.
${['*', ...AI_CRAWLERS].map((ua) => `User-agent: ${ua}`).join('\n')}
Allow: /academy/
Allow: /academy$
Allow: /llms.txt
Disallow: /

Sitemap: ${origin}/academy/sitemap.xml
`;
}

/**
 * Does robots.txt let `ua` fetch `path`? RFC 9309: the group naming the
 * agent (else `*`), the longest matching rule wins, Allow on a tie;
 * `*` and a final `$` in rules.
 */
export function robotsAllows(robots: string, ua: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, field, value] = m;
    const f = field.toLowerCase();
    if (f === 'user-agent') {
      if (!lastWasAgent || !current) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((f === 'allow' || f === 'disallow') && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: f === 'allow', pattern: value });
    } else lastWasAgent = false;
  }
  const want = ua.toLowerCase();
  const rules = (groups.filter((g) => g.agents.includes(want)).length
    ? groups.filter((g) => g.agents.includes(want))
    : groups.filter((g) => g.agents.includes('*'))
  ).flatMap((g) => g.rules);
  const match = (pattern: string) => {
    const anchored = pattern.endsWith('$');
    const re = new RegExp(
      `^${(anchored ? pattern.slice(0, -1) : pattern)
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')}${anchored ? '$' : ''}`,
    );
    return re.test(path);
  };
  let best: { allow: boolean; len: number } | null = null;
  for (const r of rules) {
    if (!match(r.pattern)) continue;
    const len = r.pattern.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
  }
  return best ? best.allow : true;
}

export function sitemapXml(pages: StaticPage[], origin: string, langs: Lang[], pathOf: (l: Lang, rel: string) => string): string {
  const urls = pages.map((p) => {
    const alts = [
      ...langs.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${origin}${pathOf(l, p.rel)}"/>`),
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${origin}${pathOf('en', p.rel)}"/>`,
    ].join('\n');
    return `  <url>\n    <loc>${origin}${p.path}</loc>\n    <lastmod>${p.lastmod}</lastmod>\n${alts}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
}

const LANG_NAMES: Record<Lang, string> = { en: 'English', it: 'Italian', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese' };

const ABOUT =
  'BandWith is an app that bands use to run their work together: gigs and rehearsals on a shared calendar, quotes and contracts for clients, fees and payouts per member, deputies (stand-in musicians), setlists and a song repertoire with chords and lyrics, Stage mode on stage, polls and band chat. It runs on iPhone, iPad, Android, dual-screen phones and the web.';

interface CrawlInput {
  pages: StaticPage[];
  origin: string;
  siteOrigin: string;
  langs: Lang[];
  en: LangContent;
  pathOf: (l: Lang, rel: string) => string;
  shotUrl: (id: string, dev: ShotDevice) => string;
}

export function llmsTxt({ origin, siteOrigin, langs, en, pathOf }: CrawlInput): string {
  const url = (rel: string) => `${origin}${pathOf('en', rel)}`;
  return `# BandWith Academy

> The official user guide of BandWith, step by step, for band admins, members and deputies, on every device. ${ABOUT}

The Academy is written in English and translated into ${langs
    .filter((l) => l !== 'en')
    .map((l) => LANG_NAMES[l])
    .join(', ')}: replace /en/ in any link with ${langs
    .filter((l) => l !== 'en')
    .map((l) => `/${l}/`)
    .join(', ')}.

- [The whole guide as one text file](${origin}/academy/llms-full.txt)
- [BandWith, the product site](${siteOrigin}/) ([llms.txt](${siteOrigin}/llms.txt))
- [FAQ & common problems](${url('faq')})
- [Glossary](${url('glossary')})

${en.modules
  .map(
    (m) =>
      `## ${m.area.title}\n\n${m.area.intro}\n\n${m.articles
        .map((a) => `- [${a.title}](${url(`a/${a.id}`)}): ${plain(a.summary, en.titles)}`)
        .join('\n')}`,
  )
  .join('\n\n')}
`;
}

export function llmsFullTxt({ origin, en, pathOf, shotUrl }: CrawlInput): string {
  const url = (rel: string) => `${origin}${pathOf('en', rel)}`;
  const roles = (r: string[]) => r.map((x) => x[0].toUpperCase() + x.slice(1)).join(', ');
  return `# BandWith Academy: the full guide

> ${ABOUT}
> Source: ${origin}/academy/en/ (also in Italian, Spanish, French, German and Portuguese).

${en.modules
  .map(
    (m) =>
      `# ${m.area.title}\n\n${m.area.intro}\n\n${m.articles
        .map(
          (a) =>
            `## ${a.title}\n\nURL: ${url(`a/${a.id}`)}\nFor: ${roles(a.roles)}\n\n${plain(a.summary, en.titles)}\n\n${blocksText(a.body, en.titles, shotUrl)}`,
        )
        .join('\n\n')}${
        m.faq.length ? `\n\n## Questions about ${m.area.title}\n\n${m.faq.map((f) => `### ${f.q}\n\n${plain(f.a, en.titles)}`).join('\n\n')}` : ''
      }`,
  )
  .join('\n\n')}

# Glossary

${en.glossary.map((g) => `- ${g.term}: ${plain(g.definition, en.titles)}`).join('\n')}
`;
}

export function rootLlmsTxt({ origin, siteOrigin }: CrawlInput): string {
  return `# BandWith (app.bandwith.fun)

> The BandWith web app (sign-in required, not public) and the BandWith Academy, its public user guide. ${ABOUT}

- [BandWith Academy](${origin}/academy/en/): the user guide, in 6 languages ([llms.txt](${origin}/academy/llms.txt), [full text](${origin}/academy/llms-full.txt))
- [BandWith, the product site](${siteOrigin}/) ([llms.txt](${siteOrigin}/llms.txt))
`;
}

/** Files to write, keyed by their path under dist/. */
export function crawlFiles(input: CrawlInput): Record<string, string> {
  return {
    'robots.txt': robotsTxt(input.origin),
    'llms.txt': rootLlmsTxt(input),
    'academy/sitemap.xml': sitemapXml(input.pages, input.origin, input.langs, input.pathOf),
    'academy/llms.txt': llmsTxt(input),
    'academy/llms-full.txt': llmsFullTxt(input),
  };
}

