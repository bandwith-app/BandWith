import type { Article, AreaModule, Faq, GlossaryTerm, Role, Shot } from './types';
import basics from './basics';
import gigs from './gigs';
import business from './business';
import together from './together';
import music from './music';
import people from './people';

/** Areas in the order they appear on the home page. */
export const MODULES: AreaModule[] = [basics, gigs, business, together, music, people];

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
  a.term.localeCompare(b.term),
);

export const SHOTS = new Map<string, Shot>(MODULES.flatMap((m) => m.shots.map((s) => [s.id, s])));

export const areaOf = (id: string) => MODULES.find((m) => m.area.id === id);

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  member: 'Member',
  deputy: 'Deputy',
};
