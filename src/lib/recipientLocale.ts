/**
 * Notifications the app writes for someone else, in that person's language.
 * profiles.preferred_language is kept equal to each account's app language
 * (serverLocale.ts); the database translates the kinds listed in migration
 * 090, and newer app-written kinds use this instead.
 */
import { supabase } from '@/lib/supabase';
import { LANGUAGES, type Locale } from '@/lib/i18n';

/** The app language for a stored preferred_language ("it", "pt-BR"…), English otherwise. */
export function localeOf(preferred: string | null | undefined): Locale {
  const base = (preferred || '').trim().toLowerCase().slice(0, 2);
  return (LANGUAGES.some((l) => l.id === base) ? base : 'en') as Locale;
}

/** Recipients grouped by language: one text per group. */
export function groupByLocale(userIds: string[], langs: Map<string, Locale>): Map<Locale, string[]> {
  const out = new Map<Locale, string[]>();
  for (const id of userIds) {
    const l = langs.get(id) ?? 'en';
    out.set(l, [...(out.get(l) || []), id]);
  }
  return out;
}

/** Each recipient's language (English when the profile can't be read). */
export async function recipientLocales(userIds: string[]): Promise<Map<string, Locale>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const map = new Map<string, Locale>();
  if (ids.length === 0) return map;
  const { data } = await supabase.from('profiles').select('id, preferred_language').in('id', ids);
  for (const p of (data || []) as { id: string; preferred_language?: string | null }[]) {
    map.set(p.id, localeOf(p.preferred_language));
  }
  return map;
}
