/**
 * Every translated dictionary, loaded (the app loads only the language in
 * use; src/lib/i18n/index.ts). For tests that check all languages.
 */
import { loadDictionary, type Dictionary, type Locale } from '@/lib/i18n';

export const TRANSLATED = ['it', 'es', 'fr', 'de', 'pt'] as const satisfies readonly Exclude<Locale, 'en'>[];

export const loadAllDictionaries = async (): Promise<Record<(typeof TRANSLATED)[number], Dictionary>> =>
  Object.fromEntries(await Promise.all(TRANSLATED.map(async (l) => [l, await loadDictionary(l)] as const))) as Record<
    (typeof TRANSLATED)[number],
    Dictionary
  >;
