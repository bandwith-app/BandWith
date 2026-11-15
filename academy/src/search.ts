import { ARTICLES, FAQ, GLOSSARY, type Indexed } from '../content';
import type { Block } from '../content/types';
import { plain } from './inline';

export type Hit =
  | { kind: 'article'; score: number; article: Indexed; snippet: string }
  | { kind: 'faq'; score: number; q: string; a: string; areaId: string }
  | { kind: 'term'; score: number; term: string; definition: string; see?: string };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const blockText = (b: Block): string[] => {
  switch (b.type) {
    case 'p':
    case 'note':
      return [b.text];
    case 'steps':
    case 'list':
      return [b.title ?? '', ...b.items];
    case 'roles':
    case 'devices':
      return b.rows.map((r) => r.text);
    case 'shot':
      return [b.caption];
    case 'table':
      return [...b.head, ...b.rows.flat()];
  }
};

interface Doc {
  article: Indexed;
  title: string;
  keys: string;
  summary: string;
  body: string[];
}

const DOCS: Doc[] = ARTICLES.map((a) => ({
  article: a,
  title: norm(a.title),
  keys: norm((a.keywords ?? []).join(' ')),
  summary: norm(plain(a.summary)),
  body: a.body.flatMap(blockText).map((t) => plain(t)),
}));

export const terms = (q: string) =>
  norm(q)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);

const count = (hay: string, t: string) => {
  if (!hay.includes(t)) return 0;
  // whole-word or prefix matches count more than infix
  return new RegExp(`(^|[^\\p{L}\\p{N}])${t}`, 'u').test(hay) ? 2 : 1;
};

export function search(q: string): Hit[] {
  const ts = terms(q);
  if (!ts.length) return [];
  const hits: Hit[] = [];

  for (const d of DOCS) {
    let score = 0;
    let all = true;
    let snippet = '';
    for (const t of ts) {
      const s =
        count(d.title, t) * 6 + count(d.keys, t) * 4 + count(d.summary, t) * 2;
      let b = 0;
      for (const line of d.body) {
        const c = count(norm(line), t);
        if (c) {
          b += c;
          if (!snippet) snippet = line;
        }
      }
      if (!s && !b) all = false;
      score += s + Math.min(b, 6);
    }
    if (!all) score *= 0.35;
    if (score > 1) hits.push({ kind: 'article', score, article: d.article, snippet: snippet || plain(d.article.summary) });
  }

  for (const f of FAQ) {
    const hq = norm(f.q);
    const ha = norm(plain(f.a));
    let score = 0;
    for (const t of ts) score += count(hq, t) * 3 + count(ha, t);
    if (score >= ts.length * 2) hits.push({ kind: 'faq', score: score * 0.8, q: f.q, a: plain(f.a), areaId: f.areaId });
  }

  for (const g of GLOSSARY) {
    const ht = norm(g.term);
    let score = 0;
    for (const t of ts) score += count(ht, t) * 5 + count(norm(g.definition), t);
    if (score >= ts.length * 3) hits.push({ kind: 'term', score, term: g.term, definition: plain(g.definition), see: g.see });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, 30);
}
