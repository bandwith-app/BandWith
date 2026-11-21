import type { AreaModule, AreaText } from './types';

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
