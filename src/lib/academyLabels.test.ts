import { describe, expect, it } from 'vitest';
import { SOURCE } from '../../academy/content/source';
import type { AreaText, Article, Block } from '../../academy/content/types';
import it_ from '../../academy/content/i18n/it';
import es from '../../academy/content/i18n/es';
import fr from '../../academy/content/i18n/fr';
import de from '../../academy/content/i18n/de';
import pt from '../../academy/content/i18n/pt';
import dictIt from './i18n/locales/it';
import dictEs from './i18n/locales/es';
import dictFr from './i18n/locales/fr';
import dictDe from './i18n/locales/de';
import dictPt from './i18n/locales/pt';

// The Academy names buttons and labels as **Label**. In these guides every
// label must be the one the app shows, in that language: the English source
// of a t('…') in the app, and in a translation the text the app's own locale
// file gives for it (the English one where the app has no translation).
// Written after the release audit of 11-23: guides published from the plan
// named controls the app never had ("Starts 2 beats early", "Sync lines").

/** Guides checked label by label. Add a guide here once its labels are verified against the app. */
const CHECKED = [
  'stage-click',
  'song-live-settings',
  'count-in',
  'follow-the-tempo',
  'ask-lineup-availability',
  'delete-a-rehearsal',
  'recurring-rehearsals',
];

/**
 * Labels the app builds without a t('…') of their own, or shows untranslated.
 * Each one is checked by hand against the component named beside it.
 */
const BUILT_IN_CODE = new Set([
  'BPM', // AddSongModal: the field's label is the same in every language
]);

const ACADEMY: Record<string, AreaText[]> = { it: it_, es, fr, de, pt };
const DICTS: Record<string, Record<string, string>> = { it: dictIt, es: dictEs, fr: dictFr, de: dictDe, pt: dictPt };

const SOURCES = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.*', '!/src/**/__tests__/**', '!/src/lib/i18n/locales/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const APP_CODE = Object.values(SOURCES).join('\n');

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

/** Every **Label** of a guide, in order, without the required-field escape. */
const labelsOf = (a: Pick<Article, 'body'>): string[] =>
  a.body
    .flatMap(texts)
    .flatMap((s) => [...s.matchAll(/\*\*([^*]+?)\*\*/g)].map((m) => m[1].replace(/\\$/, '').trim()));

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * "Starts on beat {n}" as a pattern: "Starts on beat 4" matches, n = "4".
 * Only a number fills a placeholder, so "{name} paid" never vouches for a made-up label.
 */
function fill(key: string, label: string): Record<string, string> | null {
  const names: string[] = [];
  const source = escape(key).replace(/\\\{(\w+)\\\}/g, (_m, name: string) => {
    names.push(name);
    return '(\\d+)';
  });
  const m = label.match(new RegExp(`^${source}$`));
  if (!m) return null;
  const vars: Record<string, string> = {};
  names.forEach((name, i) => (vars[name] ??= m[i + 1]));
  return vars;
}

/** Dictionary keys without their "|context" (it.ts: "Start|follow"). */
const KEYS = [...new Set(Object.keys(dictIt).map((k) => k.replace(/\|[a-z]+$/, '')))];

/** The English source(s) of a label: the key itself, or a key with placeholders it fills. */
function sourcesOf(label: string): { key: string; vars: Record<string, string> }[] {
  if (KEYS.includes(label)) return [{ key: label, vars: {} }];
  return KEYS.filter((k) => k.includes('{')).flatMap((key) => {
    const vars = fill(key, label);
    return vars ? [{ key, vars }] : [];
  });
}

/** What the app shows for an English label in a language (every context variant counts). */
function shownIn(lang: string, label: string): string[] {
  const dict = DICTS[lang];
  const out = new Set<string>();
  for (const { key, vars } of sourcesOf(label)) {
    for (const [k, v] of Object.entries(dict)) {
      if (k !== key && !k.startsWith(`${key}|`)) continue;
      out.add(v.replace(/\{(\w+)\}/g, (m, name: string) => vars[name] ?? m));
    }
  }
  // No translation in the app: it shows the English one.
  return out.size ? [...out] : [label];
}

const english = new Map(SOURCE.flatMap((m) => m.articles.map((a) => [a.id, a] as const)));

describe('Academy labels are the app’s labels', () => {
  it('checks guides that exist', () => {
    expect(CHECKED.filter((id) => !english.has(id))).toEqual([]);
  });

  it('English: every label of the checked guides is a text the app shows', () => {
    const unknown: string[] = [];
    for (const id of CHECKED) {
      for (const label of labelsOf(english.get(id)!)) {
        if (BUILT_IN_CODE.has(label)) {
          if (!APP_CODE.includes(label)) unknown.push(`${id}: “${label}” is not in the app code`);
          continue;
        }
        if (!sourcesOf(label).length) unknown.push(`${id}: “${label}”`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it.each(Object.keys(ACADEMY))('%s: every label of the checked guides is the app’s translation', (lang) => {
    const translated = new Map(ACADEMY[lang].flatMap((m) => m.articles.map((a) => [a.id, a] as const)));
    const wrong: string[] = [];
    for (const id of CHECKED) {
      const en = labelsOf(english.get(id)!);
      const tr = labelsOf(translated.get(id)!);
      // Each English label's translation must be there, as often as the label is.
      const left = [...tr];
      for (const label of en) {
        const shown = shownIn(lang, label);
        const at = left.findIndex((l) => shown.includes(l));
        if (at < 0) wrong.push(`${id}: “${label}” should read “${shown.join('” or “')}”`);
        else left.splice(at, 1);
      }
      for (const extra of left) wrong.push(`${id}: “${extra}” is not the app’s text for any label of the English guide`);
    }
    expect(wrong).toEqual([]);
  });
});

// Text written before a feature was finished was fenced with "<draft …>"
// markers, and shipped that way. Nothing published may carry one.
describe('Academy and handbook carry no draft marker', () => {
  const FILES = import.meta.glob<string>(['/academy/content/**/*.ts', '/docs/handbook/en/*.html', '/docs/handbook/it/*.html'], {
    query: '?raw',
    import: 'default',
    eager: true,
  });

  it('reads the guide and both handbook editions', () => {
    const names = Object.keys(FILES);
    expect(names.filter((f) => f.startsWith('/academy/content/')).length).toBeGreaterThan(40);
    expect(names.filter((f) => f.startsWith('/docs/handbook/')).length).toBeGreaterThan(20);
  });

  it('no "<draft" marker and no draft note is left', () => {
    const found = Object.entries(FILES).flatMap(([file, src]) =>
      src
        .split('\n')
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => /<\/?draft\b/.test(line) || /class="note draft"/.test(line))
        .map(({ n }) => `${file}:${n}`),
    );
    expect(found).toEqual([]);
  });
});
