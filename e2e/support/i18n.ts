/**
 * The app's own dictionaries, so specs can find controls by the text the
 * user sees in any language: `tr('de', 'Close tour')` → "Tour schließen".
 * English text is the key (see src/lib/i18n/index.ts).
 */
import it from '../../src/lib/i18n/locales/it';
import es from '../../src/lib/i18n/locales/es';
import fr from '../../src/lib/i18n/locales/fr';
import de from '../../src/lib/i18n/locales/de';
import pt from '../../src/lib/i18n/locales/pt';
import { ACADEMY_STRINGS } from '../../src/lib/i18n/locales/academy';

export type Locale = 'en' | 'it' | 'es' | 'fr' | 'de' | 'pt';
export const LOCALES: Locale[] = ['en', 'it', 'es', 'fr', 'de', 'pt'];

const DICTS: Record<Exclude<Locale, 'en'>, Record<string, string>> = {
  it: { ...ACADEMY_STRINGS.it, ...it },
  es: { ...ACADEMY_STRINGS.es, ...es },
  fr: { ...ACADEMY_STRINGS.fr, ...fr },
  de: { ...ACADEMY_STRINGS.de, ...de },
  pt: { ...ACADEMY_STRINGS.pt, ...pt },
};

export function tr(locale: Locale, source: string, vars?: Record<string, string | number>): string {
  const text = locale === 'en' ? source : (DICTS[locale][source] ?? source);
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

/** Every translation of a string, e.g. for "Something went wrong" in any language. */
export function allTranslations(source: string): string[] {
  return [...new Set(LOCALES.map((l) => tr(l, source)))];
}

/** Escapes a string for use inside a RegExp. */
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
