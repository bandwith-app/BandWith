import { createRoot } from 'react-dom/client';
import { LANG, type Lang } from './lang';
import { setTexts } from '../content/active';
import type { AreaText } from '../content/types';
// Geist Mono from the web bundle, shared with the app (no Google Fonts request)
import '@/styles/geist-mono.css';
import './styles.css';

/** One chunk per language: the reader downloads only theirs (and it ships with the app, so it opens offline). */
const LOAD: Record<Exclude<Lang, 'en'>, () => Promise<{ default: AreaText[] }>> = {
  it: () => import('../content/i18n/it'),
  es: () => import('../content/i18n/es'),
  fr: () => import('../content/i18n/fr'),
  de: () => import('../content/i18n/de'),
  pt: () => import('../content/i18n/pt'),
};

async function start() {
  if (LANG !== 'en') {
    try {
      setTexts((await LOAD[LANG]()).default);
    } catch {
      /* the translation didn't load: show the English guide */
    }
  }
  // The guide reads the language's texts when it loads, so load it after them.
  const { App } = await import('./App');
  createRoot(document.getElementById('root')!).render(<App />);
}

void start();
