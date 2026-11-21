import type { Article, AreaModule, Faq, GlossaryTerm, Role, Shot } from './types';
import { localize } from './localize';
import { getTexts } from './active';
import { u } from '../src/ui';
import { SOURCE } from './source';

export { SOURCE, localize };

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
