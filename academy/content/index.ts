import type { Article, AreaModule, AreaText, Faq, GlossaryTerm, Role, Shot } from './types';
import { getTexts } from './active';
import { u } from '../src/ui';
import basics from './basics';
import gigs from './gigs';
import business from './business';
import together from './together';
import music from './music';
import people from './people';

/** The English areas, in the order they appear on the home page. */
export const SOURCE: AreaModule[] = [basics, gigs, business, together, music, people];

/**
 * An area in the reader's language: the translated texts over the English
 * structure. Anything missing or out of step with the English (a new
 * article, a block added later) stays in English until it is translated.
 */
export function localize(m: AreaModule, tr: AreaText | undefined): AreaModule {
  if (!tr) return m;
  const byId = new Map(tr.articles.map((a) => [a.id, a] as const));
  return {
    area: { ...m.area, title: tr.area.title || m.area.title, intro: tr.area.intro || m.area.intro },
    articles: m.articles.map((a) => {
      const t = byId.get(a.id);
      if (!t) return a;
      return {
        ...a,
        title: t.title,
        summary: t.summary,
        body: t.body.length === a.body.length && t.body.every((b, i) => b.type === a.body[i].type) ? t.body : a.body,
        // the English words still find it (people type "setlist" in any language)
        keywords: [...(t.keywords ?? []), ...(a.keywords ?? [])],
      };
    }),
    faq: tr.faq.length === m.faq.length ? m.faq.map((f, i) => ({ ...f, q: tr.faq[i].q, a: tr.faq[i].a })) : m.faq,
    glossary:
      tr.glossary.length === m.glossary.length
        ? m.glossary.map((g, i) => ({ ...g, term: tr.glossary[i].term, definition: tr.glossary[i].definition }))
        : m.glossary,
    shots: m.shots,
  };
}

const texts = getTexts();

/** Areas in the order they appear on the home page, in the reader's language. */
export const MODULES: AreaModule[] = SOURCE.map((m) => localize(m, texts?.find((t) => t.area.id === m.area.id)));

export interface Indexed extends Article {
  areaId: string;
}

export const ARTICLES: Indexed[] = MODULES.flatMap((m) =>
  m.articles.map((a) => ({ ...a, areaId: m.area.id })),
);

export const BY_ID = new Map(ARTICLES.map((a) => [a.id, a]));

export const FAQ: (Faq & { areaId: string })[] = MODULES.flatMap((m) =>
  m.faq.map((f) => ({ ...f, areaId: m.area.id })),
);

export const GLOSSARY: GlossaryTerm[] = MODULES.flatMap((m) => m.glossary).sort((a, b) =>
  a.term.localeCompare(b.term, document.documentElement.lang || 'en'),
);

export const SHOTS = new Map<string, Shot>(MODULES.flatMap((m) => m.shots.map((s) => [s.id, s])));

export const areaOf = (id: string) => MODULES.find((m) => m.area.id === id);

export const ROLE_LABEL: Record<Role, string> = {
  admin: u('Admin'),
  member: u('Member'),
  deputy: u('Deputy'),
};
