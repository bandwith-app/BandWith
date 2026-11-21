import { afterEach, describe, expect, it } from 'vitest';
import { setLocalePref } from '@/lib/i18n';
import { legalUrl } from '../LegalSheet';

// The legal pages bundled with the app (public/legal).
const SHIPPED = new Set(
  Object.keys(import.meta.glob('../../../../../public/legal/*.html', { query: '?raw', import: 'default' })).map((k) =>
    k.slice(k.indexOf('/legal/')),
  ),
);

describe('legalUrl', () => {
  afterEach(() => setLocalePref('en'));

  it('opens the Privacy Policy in Italian or Spanish when the app is in that language', () => {
    setLocalePref('it');
    expect(legalUrl('privacy')).toBe('/legal/privacy-it.html');
    setLocalePref('es');
    expect(legalUrl('privacy')).toBe('/legal/privacy-es.html');
  });

  it('falls back to English for the other languages and for the Terms', () => {
    for (const l of ['en', 'fr', 'de', 'pt'] as const) {
      setLocalePref(l);
      expect(legalUrl('privacy')).toBe('/legal/privacy.html');
    }
    setLocalePref('it');
    expect(legalUrl('terms')).toBe('/legal/terms.html');
    expect(legalUrl('help')).toBe('/legal/help.html?lang=it');
  });

  it('every page it can open ships with the app', () => {
    for (const l of ['en', 'it', 'es', 'fr', 'de', 'pt'] as const) {
      setLocalePref(l);
      for (const d of ['privacy', 'terms'] as const) {
        expect(SHIPPED.has(legalUrl(d)), legalUrl(d)).toBe(true);
      }
    }
  });
});
