import { describe, expect, it } from 'vitest';
import { SOURCE } from '../../academy/content';
import type { AreaModule, AreaText, Block } from '../../academy/content/types';
import it_ from '../../academy/content/i18n/it';
import es from '../../academy/content/i18n/es';
import fr from '../../academy/content/i18n/fr';
import de from '../../academy/content/i18n/de';
import pt from '../../academy/content/i18n/pt';

// Each translation of the Academy must keep the English structure: the same
// articles, blocks, links and on-screen labels, so the guide never mixes
// languages or loses a step.

const LANGS: Record<string, AreaText[]> = { it: it_, es, fr, de, pt };

const links = (s: string) => [...s.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1]).sort().join(',');
const labels = (s: string) => (s.match(/\*\*[^*]+\*\*/g) ?? []).length;

function texts(b: Block): string[] {
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
    case 'symbols':
      return [b.title ?? '', ...b.rows.map((r) => r.text)];
  }
}

function shape(b: Block): string {
  switch (b.type) {
    case 'note':
      return `note:${b.tone}`;
    case 'steps':
    case 'list':
      return `${b.type}:${!!b.title}:${b.items.length}`;
    case 'roles':
      return `roles:${b.rows.map((r) => r.role).join()}`;
    case 'devices':
      return `devices:${b.rows.map((r) => r.devices.join('+')).join()}`;
    case 'shot':
      return `shot:${b.id}:${b.device ?? ''}`;
    case 'table':
      return `table:${b.head.length}:${b.rows.map((r) => r.length).join()}`;
    case 'symbols':
      return `symbols:${b.rows.map((r) => `${r.symbol}${r.n ?? ''}${r.name ?? ''}`).join()}`;
    default:
      return b.type;
  }
}

/** Every text pair (English, translation) with where it is, for the per-string checks. */
function pairs(en: AreaModule, tr: AreaText): [string, string, string][] {
  const out: [string, string, string][] = [
    [`${en.area.id}.title`, en.area.title, tr.area.title],
    [`${en.area.id}.intro`, en.area.intro, tr.area.intro],
  ];
  en.articles.forEach((a, i) => {
    const t = tr.articles[i];
    out.push([`${a.id}.title`, a.title, t.title], [`${a.id}.summary`, a.summary, t.summary]);
    a.body.forEach((b, j) => {
      const x = texts(b);
      const y = texts(t.body[j]);
      x.forEach((s, k) => out.push([`${a.id}.body[${j}][${k}]`, s, y[k]]));
    });
  });
  en.faq.forEach((f, i) => out.push([`faq ${f.q}`, f.q, tr.faq[i].q], [`faq ${f.q} (answer)`, f.a, tr.faq[i].a]));
  en.glossary.forEach((g, i) => out.push([`term ${g.term}`, g.definition, tr.glossary[i].definition]));
  return out;
}

describe.each(Object.entries(LANGS))('Academy in %s', (lang, areas) => {
  it('has every area, article, FAQ and glossary entry, in the English order', () => {
    expect(areas.map((a) => a.area.id)).toEqual(SOURCE.map((m) => m.area.id));
    SOURCE.forEach((en, i) => {
      const tr = areas[i];
      expect(tr.area.icon).toBe(en.area.icon);
      expect(tr.articles.map((a) => a.id)).toEqual(en.articles.map((a) => a.id));
      expect(tr.faq.map((f) => (f.roles ?? []).join())).toEqual(en.faq.map((f) => (f.roles ?? []).join()));
      expect(tr.glossary.map((g) => g.see)).toEqual(en.glossary.map((g) => g.see));
      en.articles.forEach((a, j) => {
        const t = tr.articles[j];
        expect({ id: t.id, roles: t.roles, kind: t.kind, related: t.related ?? [] }).toEqual({
          id: a.id,
          roles: a.roles,
          kind: a.kind,
          related: a.related ?? [],
        });
        expect(t.body.map(shape), `${lang} ${a.id}`).toEqual(a.body.map(shape));
      });
    });
  });

  it('keeps the links and labels of every text, and translates it', () => {
    const bad: string[] = [];
    SOURCE.forEach((en, i) => {
      for (const [where, a, b] of pairs(en, areas[i])) {
        if (!a.trim()) continue; // no title in the English either
        if (!b?.trim()) bad.push(`${where}: empty`);
        else if (links(a) !== links(b)) bad.push(`${where}: links ${links(a)} → ${links(b)}`);
        else if (labels(a) !== labels(b)) bad.push(`${where}: ${labels(a)} labels → ${labels(b)}`);
        else if (a.length > 40 && a === b) bad.push(`${where}: still English`);
      }
    });
    expect(bad).toEqual([]);
  });
});
