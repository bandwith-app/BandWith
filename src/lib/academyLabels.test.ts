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
  'lead-stage-mode',
  'follow-in-stage-mode',
  'stage-bluetooth-sync',
  'changes-without-signal',
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
 * A placeholder is filled only by a number, by the guide's own "…" for a name
 * it can't know ("Go to …" is "Go to {title}"), or by a counted phrase that is
 * itself a text of the app ("You’re offline · 2 changes waiting for signal" is
 * "You’re offline · {changes} waiting for signal" with "{count} changes"), so
 * "{name} paid" never vouches for a made-up label.
 */
function fill(key: string, label: string): Record<string, string> | null {
  const names: string[] = [];
  const source = escape(key).replace(/\\\{(\w+)\\\}/g, (_m, name: string) => {
    names.push(name);
    return '(.+?)';
  });
  const m = label.match(new RegExp(`^${source}$`));
  if (!m) return null;
  const vars: Record<string, string> = {};
  names.forEach((name, i) => (vars[name] ??= m[i + 1]));
  return Object.values(vars).every((v) => plain(v) || (counted(v) && v.length < label.length && sourcesOf(v).length > 0)) ? vars : null;
}
/** A number, or the guide's "…". */
const plain = (value: string) => /^(\d+|…)$/.test(value);
/** "2 changes": a number and its noun, to be found among the app's texts. */
const counted = (value: string) => /^\d+ \S/.test(value);

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
      // A counted phrase inside is shown in its own translation ("2 modifiche").
      let shown = [v];
      for (const [name, value] of Object.entries(vars)) {
        const with_ = plain(value) ? [value] : shownIn(lang, value);
        shown = shown.flatMap((s) => with_.map((w) => s.split(`{${name}}`).join(w)));
      }
      shown.forEach((s) => out.add(s));
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

// The handbook names labels in English in both editions, as <b class="ui">…</b>.
// In the sections of these guides every one must be a text the app shows:
// the 11-23 release left "Live · BT", "· BT" and two messages the app no
// longer has in the Stage sections, in both editions.
describe('Handbook labels are the app’s labels', () => {
  /** Sections checked label by label. Add one once its labels are verified against the app. */
  const HANDBOOK_CHECKED = [
    'stage-click',
    'song-live-settings',
    'count-in',
    'follow-the-tempo',
    'delete-a-rehearsal',
    'lead-stage-mode',
    'follow-in-stage-mode',
    'stage-bluetooth-sync',
    'changes-without-signal',
  ];
  const HANDBOOK = import.meta.glob<string>(['/docs/handbook/en/*.html', '/docs/handbook/it/*.html'], {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  /** An article's section: from its heading to the next heading. */
  function section(lang: string, id: string): string | null {
    for (const [file, html] of Object.entries(HANDBOOK)) {
      if (!file.startsWith(`/docs/handbook/${lang}/`)) continue;
      const at = html.indexOf(`id="art-${id}"`);
      if (at < 0) continue;
      const rest = html.slice(at);
      const end = rest.search(/<h[23][ >]/);
      return end < 0 ? rest : rest.slice(0, end);
    }
    return null;
  }

  it.each(['en', 'it'])('%s edition: every label of the checked sections is a text the app shows', (lang) => {
    const unknown: string[] = [];
    for (const id of HANDBOOK_CHECKED) {
      const html = section(lang, id);
      if (html === null) {
        unknown.push(`${id}: no section`);
        continue;
      }
      const labels = [...html.matchAll(/<b class="ui">(.*?)<\/b>/g)].map((m) => decode(m[1]));
      // A section with no label at all is one this check can't read.
      if (!labels.length) unknown.push(`${id}: no label found`);
      for (const label of labels) {
        if (BUILT_IN_CODE.has(label) ? !APP_CODE.includes(label) : !sourcesOf(label).length) unknown.push(`${id}: “${label}”`);
      }
    }
    expect(unknown).toEqual([]);
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
