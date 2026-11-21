/**
 * App language (Settings › Language): English, Italiano, Español, Français,
 * Deutsch, Português.
 *
 * The English text in the code is the key: `t('Notifications')` looks the
 * string up in the chosen language's dictionary and falls back to the
 * English it was given. So a screen that hasn't been translated yet, or a
 * string missing from a dictionary, shows exactly what it showed before.
 *
 * Placeholders use braces: `t('Version {version}', { version: '1.0.0' })`.
 *
 * The choice is per device (like the theme and the distance unit). Until it
 * is set, the app follows the device language when it is one of the six, and
 * English otherwise.
 *
 * Only the language in use is loaded: each dictionary is its own chunk,
 * fetched with a dynamic import (about 85 KB gzip each, instead of all five
 * at startup). English needs none, the code's text is the English. main.tsx
 * waits for the current language before the first render; a switch applies
 * once the new dictionary is in; a text in another language (a client's
 * document, a bandmate's notification) loads that language first, see
 * `loadLocale` and `useLocaleReady`.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type Locale = 'en' | 'it' | 'es' | 'fr' | 'de' | 'pt';
export type LocalePref = Locale | 'system';
export type Dictionary = Record<string, string>;
export type TranslateVars = Record<string, string | number>;

/** Languages as they are written in themselves (shown untranslated). */
export const LANGUAGES: { id: Locale; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'it', name: 'Italiano' },
  { id: 'es', name: 'Español' },
  { id: 'fr', name: 'Français' },
  { id: 'de', name: 'Deutsch' },
  { id: 'pt', name: 'Português' },
];

type Translated = Exclude<Locale, 'en'>;
type DictModule = { default: Dictionary };

// One chunk per language. Literal paths, so the bundler splits them.
const LOADERS: Record<Translated, () => Promise<DictModule>> = {
  it: () => import('./locales/it'),
  es: () => import('./locales/es'),
  fr: () => import('./locales/fr'),
  de: () => import('./locales/de'),
  pt: () => import('./locales/pt'),
};

const KEY = 'bw-locale-v1';
const CHANGED = 'bw:locale';

const loaded: Partial<Record<Translated, Dictionary>> = {};
const pending: Partial<Record<Translated, Promise<void>>> = {};
const failedAt: Partial<Record<Translated, number>> = {};
// Bumped when a dictionary arrives, so screens using it render again.
let version = 0;

const notify = () => {
  try {
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    /* no window */
  }
};

/** True when `l`'s texts can be shown now (English always). */
export const isLocaleLoaded = (l: Locale): boolean => l === 'en' || !!loaded[l];

/**
 * Loads the dictionary of `l` (once; English has none). Never rejects: if the
 * chunk can't be fetched (offline web), texts stay in English and a later
 * call tries again.
 */
export const loadLocale = (l: Locale): Promise<void> => {
  if (l === 'en' || loaded[l] || !(l in LOADERS)) return Promise.resolve();
  return (pending[l] ??= Promise.all([LOADERS[l](), import('./locales/academy')])
    .then(([dict, academy]) => {
      // The Academy entry points keep their strings in their own file (locales/academy.ts).
      loaded[l] = { ...academy.ACADEMY_STRINGS[l], ...dict.default };
      version++;
      notify();
    })
    .catch((err) => {
      failedAt[l] = Date.now();
      console.warn('[i18n] could not load', l, err);
    })
    .finally(() => {
      delete pending[l];
    }));
};

/** The dictionary of `l` (loads it if needed). For tests and tools. */
export const loadDictionary = async (l: Translated): Promise<Dictionary> => {
  await loadLocale(l);
  return loaded[l] ?? {};
};

const isLocale = (v: unknown): v is Locale => LANGUAGES.some((l) => l.id === v);
const isPref = (v: unknown): v is LocalePref => v === 'system' || isLocale(v);

/** The first of the device's languages that the app speaks, else English. */
export const deviceLocale = (): Locale => {
  try {
    const langs = typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : [];
    for (const l of langs) {
      const base = (l || '').toLowerCase().split(/[-_]/)[0];
      if (isLocale(base)) return base;
    }
  } catch {
    /* no navigator */
  }
  return 'en';
};

const readPref = (): LocalePref => {
  try {
    const v = localStorage.getItem(KEY);
    if (isPref(v)) return v;
  } catch {
    /* storage blocked */
  }
  return 'system';
};

let pref: LocalePref | null = null;
let locale: Locale | null = null;

export const getLocalePref = (): LocalePref => (pref ??= readPref());
export const getLocale = (): Locale => {
  if (locale) return locale;
  const p = getLocalePref();
  locale = p === 'system' ? deviceLocale() : p;
  return locale;
};

const applyDocumentLang = (l: Locale) => {
  try {
    document.documentElement.lang = l;
  } catch {
    /* no document */
  }
};

let switchSeq = 0;

/**
 * Saves the choice and switches once the new language's dictionary is in
 * (at once when it already is), so a screen is never half in English. Of two
 * quick switches the last one wins.
 */
export const setLocalePref = (next: LocalePref): Promise<void> => {
  pref = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* best effort */
  }
  const target = next === 'system' ? deviceLocale() : next;
  const seq = ++switchSeq;
  const apply = () => {
    if (seq !== switchSeq) return;
    locale = target;
    applyDocumentLang(target);
    notify();
  };
  if (isLocaleLoaded(target)) {
    apply();
    return Promise.resolve();
  }
  // The choice itself shows at once (Settings' radio follows `pref`).
  notify();
  return loadLocale(target).then(apply);
};

const interpolate = (text: string, vars?: TranslateVars) =>
  vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;

/**
 * Translates in the current language. In components use `useT()` so the screen updates when the language changes.
 * When one English word needs two translations, pass `{ context: 'day' }`: the entry "Free|day" wins over "Free".
 */
export const t = (source: string, vars?: TranslateVars): string => translate(getLocale(), source, vars);

/**
 * Same as `t()` but in a given language, e.g. a quote or contract written in
 * the client's language rather than the app's.
 */
export const translate = (l: Locale, source: string, vars?: TranslateVars): string => {
  if (l === 'en') return interpolate(source, vars);
  const dict = loaded[l];
  if (!dict) {
    // Not loaded yet: English now, the language as soon as it's in (screens
    // render again). Callers that send or save text await loadLocale first.
    const failed = failedAt[l];
    if (!failed || Date.now() - failed > 30_000) void loadLocale(l);
    return interpolate(source, vars);
  }
  const ctx = vars?.context;
  const text = (ctx !== undefined ? dict[`${source}|${ctx}`] : undefined) ?? dict[source] ?? source;
  return interpolate(text, vars);
};

/**
 * "a, b and c" in the current language. English keeps the app's style
 * (no comma before "and").
 */
export const formatList = (items: string[], type: 'conjunction' | 'disjunction' = 'conjunction'): string => {
  const l = getLocale();
  try {
    // Intl.ListFormat is ES2021; the project's TS lib target is older.
    const ListFormat = (Intl as unknown as { ListFormat: new (l: string, o: object) => { format: (i: string[]) => string } }).ListFormat;
    return new ListFormat(l === 'en' ? 'en-GB' : l, { style: 'long', type }).format(items);
  } catch {
    return items.join(', ');
  }
};

// ── Dates & numbers on screen ───────────────────────────────────
// Portuguese is Brazilian in the dictionary ("Equipe", "Aprendendo").
const INTL_TAGS: Record<Exclude<Locale, 'en'>, string> = { it: 'it-IT', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR' };

/**
 * Locale tag for `toLocaleDateString` / `toLocaleString` on screen.
 * English returns the tag the call already used (`undefined` = device default),
 * so English output stays exactly as it was; other languages use their own
 * day/month names, order and separators.
 * Client-facing text (quote share/PDF, contracts, emails) keeps its fixed tag.
 */
export const intlLocale = (en?: string, l: Locale = getLocale()): string | undefined =>
  l === 'en' ? en : INTL_TAGS[l];

/**
 * A month or weekday name on its own ("Mar", "Tue"), e.g. in a date tile.
 * Other languages drop the abbreviation dot ("janv." → "janv", "Di." → "Di").
 */
export const dateName = (d: Date, opts: Intl.DateTimeFormatOptions, en = 'en-US'): string => {
  const s = d.toLocaleDateString(intlLocale(en), opts);
  return getLocale() === 'en' ? s : s.replace(/\.$/, '');
};

/** Monday-first weekday initials for calendar headers (English: M T W T F S S). 2024-01-01 is a Monday. */
export const weekdayInitials = (): string[] =>
  getLocale() === 'en'
    ? ['M', 'T', 'W', 'T', 'F', 'S', 'S']
    : Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(intlLocale(), { weekday: 'narrow' }).toUpperCase());

/** "1.5" → "1,5" where the language writes a decimal comma (short amounts like "€1.5k"). */
export const localDecimal = (s: string): string => {
  if (getLocale() === 'en') return s;
  const sep = (1.5).toLocaleString(intlLocale()).charAt(1);
  return sep === '.' ? s : s.replace('.', sep);
};

const subscribe = (cb: () => void) => {
  window.addEventListener(CHANGED, cb);
  return () => window.removeEventListener(CHANGED, cb);
};

const getVersion = () => version;
const useDictionaryVersion = (): number => useSyncExternalStore(subscribe, getVersion, () => 0);

/** The app language; the component also renders again when a dictionary arrives. */
export const useLocale = (): Locale => {
  useDictionaryVersion();
  return useSyncExternalStore(subscribe, getLocale, () => 'en' as Locale);
};
export const useLocalePref = (): LocalePref => useSyncExternalStore(subscribe, getLocalePref, () => 'system' as LocalePref);

/** `const t = useT();` — same as `t()`, and re-renders the component when the language changes. */
export const useT = () => {
  const l = useLocale();
  const v = useDictionaryVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((source: string, vars?: TranslateVars) => t(source, vars), [l, v]);
};

/**
 * For a screen that writes in another language than the app's (a quote or
 * contract in the client's language): loads it, renders again when it's in,
 * and says whether it is.
 */
export const useLocaleReady = (l: Locale): boolean => {
  useDictionaryVersion();
  useEffect(() => {
    void loadLocale(l);
  }, [l]);
  return isLocaleLoaded(l);
};

/**
 * Before the first render: the app language's dictionary, so the first screen
 * is already translated (a local file in the iOS and Android apps). Waits at
 * most `capMs` on a slow connection; the texts switch when it arrives.
 */
export const localeReady = (capMs = 3000): Promise<void> =>
  Promise.race([loadLocale(getLocale()), new Promise<void>((r) => setTimeout(r, capMs))]);

// The page's lang attribute (screen readers, hyphenation) follows the choice
// from the start, and the language's dictionary starts loading at once.
if (typeof document !== 'undefined') {
  applyDocumentLang(getLocale());
  void loadLocale(getLocale());
}

/**
 * Short weekday name in the app language ('Mon' / 'lun'). `day` is either
 * a JS day index (0 = Sunday) or an English short name ('Mon', 'Tue'…), as
 * stored in rehearsal polls' preferred days.
 */
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const shortWeekday = (day: number | string): string => {
  const index = typeof day === 'number' ? day : EN_DAYS.findIndex((d) => d.toLowerCase() === String(day).slice(0, 3).toLowerCase());
  if (index < 0) return String(day);
  // 2024-01-07 was a Sunday.
  return dateName(new Date(2024, 0, 7 + index), { weekday: 'short' });
};
