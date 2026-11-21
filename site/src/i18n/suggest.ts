/**
 * Which language to suggest from the visitor's country (Vercel's
 * x-vercel-ip-country and x-vercel-ip-country-region, read by /api/geo).
 *
 * - A Spanish-speaking country → Spanish.
 * - Italy, San Marino, Vatican City, and Switzerland's Ticino → Italian.
 * - An English-speaking country → English.
 * - Anywhere else (or unknown) → nothing: the page stays as it is.
 *
 * The popup shows only when the suggestion differs from the page's language
 * and the visitor hasn't chosen yet (a yes, a no or the switcher).
 */
import type { Lang } from './langs';

/** Spanish is the (main) official language. The US is English, Andorra Catalan. */
const SPANISH = ['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'GT', 'CU', 'BO', 'DO', 'HN', 'PY', 'SV', 'NI', 'CR', 'PA', 'UY', 'PR', 'GQ', 'EA', 'IC'];
/** Italian: the country, or Switzerland's Italian-speaking canton. */
const ITALIAN = ['IT', 'SM', 'VA'];
const ITALIAN_REGIONS: Record<string, string[]> = { CH: ['TI'] };
/** English is the main language people use. */
const ENGLISH = [
  'US', 'GB', 'IE', 'CA', 'AU', 'NZ', 'JM', 'TT', 'BS', 'BB', 'BZ', 'GY', 'AG', 'DM', 'GD', 'KN', 'LC', 'VC',
  'MT', 'GI', 'IM', 'JE', 'GG', 'BM', 'KY', 'VG', 'VI', 'TC', 'AI', 'MS', 'FK', 'GU', 'AS', 'MP', 'UM', 'SH',
];

export type Geo = { country: string | null; region?: string | null };

export function languageFor(geo: Geo): Lang | null {
  const c = (geo.country ?? '').toUpperCase();
  const r = (geo.region ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  if (ITALIAN.includes(c) || ITALIAN_REGIONS[c]?.includes(r)) return 'it';
  if (SPANISH.includes(c)) return 'es';
  if (ENGLISH.includes(c)) return 'en';
  return null;
}

/** The visitor's stored choice: a language (picked or accepted) or "no" (popup dismissed). */
export type Choice = Lang | 'no' | null;

export function suggestion(geo: Geo, page: Lang, choice: Choice): Lang | null {
  if (choice) return null;
  const want = languageFor(geo);
  return want && want !== page ? want : null;
}

/** The popup's words, in the language it suggests (the visitor may not read the page's). */
export const POPUP: Record<Lang, { q: string; yes: string; stay: Record<Lang, string>; close: string; label: string }> = {
  en: {
    q: 'View the site in English?',
    yes: 'Switch to English',
    stay: { en: '', it: 'Stay in Italian', es: 'Stay in Spanish' },
    close: 'Close',
    label: 'Language suggestion',
  },
  it: {
    q: 'Vuoi vedere il sito in italiano?',
    yes: 'Passa all’italiano',
    stay: { en: 'Resta in inglese', it: '', es: 'Resta in spagnolo' },
    close: 'Chiudi',
    label: 'Suggerimento lingua',
  },
  es: {
    q: '¿Ver el sitio en español?',
    yes: 'Cambiar a español',
    stay: { en: 'Seguir en inglés', it: 'Seguir en italiano', es: '' },
    close: 'Cerrar',
    label: 'Sugerencia de idioma',
  },
};

/** Ticino has a name of its own worth showing; elsewhere the country is enough. */
export function placeName(geo: Geo, lang: Lang): string {
  const c = (geo.country ?? '').toUpperCase();
  let country = c;
  try {
    country = new Intl.DisplayNames([lang], { type: 'region' }).of(c) ?? c;
  } catch { /* old browser: the code */ }
  if (c === 'CH' && (geo.region ?? '').toUpperCase() === 'TI') {
    return lang === 'it' ? 'Ticino, Svizzera' : lang === 'es' ? 'Tesino, Suiza' : 'Ticino, Switzerland';
  }
  return country;
}

/** The country's flag as an emoji (regional indicator letters). */
export const flagEmoji = (code: string) =>
  code.toUpperCase().replace(/[A-Z]/g, (ch) => String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65));
