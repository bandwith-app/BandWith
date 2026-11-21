/**
 * Only the language in use is loaded. The others come in with a dynamic
 * import when they are needed: switching the app language, or a document in
 * the client's language. A switch applies once the new dictionary is in, so
 * the screen never shows English halfway.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type I18n = typeof import('../index');

// A fresh module each time: nothing loaded yet (src/test/setup.ts preloads
// every dictionary for the other tests).
const fresh = async (pref?: string): Promise<I18n> => {
  localStorage.clear();
  if (pref) localStorage.setItem('bw-locale-v1', pref);
  vi.resetModules();
  return import('../index');
};

describe('lazy dictionaries', () => {
  beforeEach(() => localStorage.clear());

  it('starts with no dictionary but the one in use', async () => {
    const i18n = await fresh('de');
    await i18n.loadLocale(i18n.getLocale());
    expect(i18n.isLocaleLoaded('de')).toBe(true);
    for (const l of ['it', 'es', 'fr', 'pt'] as const) expect(i18n.isLocaleLoaded(l), l).toBe(false);
    expect(i18n.t('Notifications')).toBe('Mitteilungen');
  });

  it('loads a language when the user switches to it, then switches', async () => {
    const i18n = await fresh('en');
    expect(i18n.isLocaleLoaded('fr')).toBe(false);
    const switching = i18n.setLocalePref('fr');
    // Still English until French is in: no half-translated screen.
    expect(i18n.getLocale()).toBe('en');
    await switching;
    expect(i18n.isLocaleLoaded('fr')).toBe(true);
    expect(i18n.getLocale()).toBe('fr');
    expect(i18n.t('Settings')).toBe('Réglages');
  });

  it('the last of two quick switches wins', async () => {
    const i18n = await fresh('en');
    const a = i18n.setLocalePref('it');
    const b = i18n.setLocalePref('es');
    await Promise.all([a, b]);
    expect(i18n.getLocale()).toBe('es');
  });

  it('tells the screens when a dictionary arrives', async () => {
    const i18n = await fresh('en');
    const seen = vi.fn();
    window.addEventListener('bw:locale', seen);
    try {
      await i18n.loadLocale('pt');
      expect(seen).toHaveBeenCalled();
    } finally {
      window.removeEventListener('bw:locale', seen);
    }
  });

  it('translate() in a language not loaded yet falls back to English and loads it', async () => {
    const i18n = await fresh('en');
    expect(i18n.translate('pt', 'Best regards,')).toBe('Best regards,');
    await i18n.loadLocale('pt');
    expect(i18n.translate('pt', 'Best regards,')).toBe('Atenciosamente,');
  });

  it('keeps the Academy strings with each language', async () => {
    const i18n = await fresh('it');
    await i18n.loadLocale('it');
    expect(i18n.isLocaleLoaded('it')).toBe(true);
    expect(i18n.t('Help for this screen')).toBe('Aiuto per questa schermata');
  });
});
