import { Fragment, type ReactNode } from 'react';
import { BY_ID } from '../content';

/** Links that point to an article that doesn't exist (shown on #/dev). */
export const brokenLinks = new Set<string>();

// A label may end in an escaped asterisk, a required field: **Song title \***.
const TOKEN = /(\*\*(?:\\\*|[^*])+\*\*|\[\[[^\]]+\]\]|`[^`]+`)/g;
const unescape = (s: string) => s.replace(/\\\*/g, '*');

/** Renders the inline conventions of the content: **label**, [[id|text]], `code`. */
export function Inline({ text }: { text: string }) {
  const parts = text.split(TOKEN);
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i} className="ui">
              {placeholders(unescape(part.slice(2, -2)))}
            </strong>
          );
        }
        if (part.startsWith('[[') && part.endsWith(']]')) {
          const [id, label] = part.slice(2, -2).split('|');
          const target = BY_ID.get(id.trim());
          if (!target) {
            brokenLinks.add(id.trim());
            return <span key={i}>{label ?? id}</span>;
          }
          return (
            <a key={i} href={`#/a/${target.id}`} className="xref">
              {label ?? target.title}
            </a>
          );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i}>{part.slice(1, -1)}</code>;
        }
        return <Fragment key={i}>{placeholders(part)}</Fragment>;
      })}
    </>
  );
}

/** App labels keep their {placeholders}; show them as a soft slot ("Fee for [name]"). */
function placeholders(text: string): ReactNode {
  if (!text.includes('{')) return text;
  return text.split(/\{([a-zA-Z]+)\}/g).map((p, i) =>
    i % 2 ? (
      <span key={i} className="ph">
        {p}
      </span>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  );
}

/** Plain text of an inline string (for search and summaries). */
export const plain = (text: string) =>
  text
    .replace(/\*\*((?:\\\*|[^*])+)\*\*/g, (_, l: string) => unescape(l))
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, (_, id: string) => BY_ID.get(id.trim())?.title ?? id)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\{([a-zA-Z]+)\}/g, '$1');

export function highlight(text: string, terms: string[]): ReactNode {
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
  return text.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>));
}
