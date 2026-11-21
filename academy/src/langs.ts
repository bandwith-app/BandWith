/** The Academy's languages: the app's own six. Plain data (no browser globals). */
export type Lang = 'en' | 'it' | 'es' | 'fr' | 'de' | 'pt';

export const LANGS: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'it', name: 'Italiano' },
  { id: 'es', name: 'Español' },
  { id: 'fr', name: 'Français' },
  { id: 'de', name: 'Deutsch' },
  { id: 'pt', name: 'Português' },
];
