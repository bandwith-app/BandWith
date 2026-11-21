/**
 * The Academy's own interface text in the reader's language.
 * The dictionaries live in ./uiText (plain data, shared with the static pages).
 *
 * u('English text', { n: 3 }) returns the text in the reader's language,
 * or the English when a translation is missing.
 */
import { LANG, type Lang } from './lang';
import { translate } from './uiText';

export { UI_DICTS } from './uiText';

/** Search ideas under an empty search field, as people would type them. */
const SUGGESTIONS: Record<Lang, string[]> = {
  en: ['invite members', 'deputy', 'setlist', 'Stage', 'laptop pose', 'quote', 'my fee'],
  it: ['invitare membri', 'sostituto', 'scaletta', 'Stage', 'laptop', 'preventivo', 'il mio compenso'],
  es: ['invitar miembros', 'sustituto', 'setlist', 'Stage', 'laptop', 'presupuesto', 'mi caché'],
  fr: ['inviter des membres', 'remplaçant', 'setlist', 'Stage', 'laptop', 'devis', 'mon cachet'],
  de: ['Mitglieder einladen', 'Vertretung', 'Setlist', 'Stage', 'Laptop', 'Angebot', 'meine Gage'],
  pt: ['convidar membros', 'substituto', 'setlist', 'Stage', 'laptop', 'orçamento', 'meu cachê'],
};
export const searchSuggestions = (): string[] => SUGGESTIONS[LANG];

export function u(s: string, vars?: Record<string, string | number>): string {
  return translate(LANG, s, vars);
}
