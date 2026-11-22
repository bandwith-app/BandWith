import { describe, it, expect, beforeEach } from 'vitest';
import {
  setActiveCurrency,
  getActiveSymbol,
  money,
  moneyShort,
  currencySymbol,
  findCountryPreset,
  countryName,
} from '@/lib/currency';
import { setLocalePref } from '@/lib/i18n';

describe('currency', () => {
  beforeEach(() => setActiveCurrency('EUR', 'band-a', true));

  it('maps codes to symbols and falls back to euro without a code', () => {
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('GBP')).toBe('£');
    expect(currencySymbol('CHF')).toBe('CHF ');
    // Round 4: another code shows itself, never another currency's sign.
    expect(currencySymbol('XYZ')).toBe('XYZ ');
    expect(currencySymbol(undefined)).toBe('€');
  });

  it('formats with the active band currency', () => {
    expect(money(1250)).toBe('€1,250');
    setActiveCurrency('USD', 'band-a');
    expect(money(1250.5, 'auto')).toBe('$1,250.50');
    expect(moneyShort(1500)).toBe('$1.5k');
    expect(moneyShort(2000)).toBe('$2k');
    expect(money(-40)).toBe('-$40');
  });

  it('ignores currency updates from a band that is not active', () => {
    setActiveCurrency('GBP', 'band-b');
    expect(getActiveSymbol()).toBe('€');
    setActiveCurrency('GBP', 'band-b', true);
    expect(getActiveSymbol()).toBe('£');
  });

  it('country presets carry currency and standard VAT', () => {
    expect(findCountryPreset('IT')).toMatchObject({ currency: 'EUR', vatRate: 22 });
    expect(findCountryPreset('GB')).toMatchObject({ currency: 'GBP', vatRate: 20 });
    expect(findCountryPreset('US')).toMatchObject({ currency: 'USD', vatRate: 0 });
    expect(findCountryPreset('ZZ')).toBeUndefined();
  });
});

describe('countryName', () => {
  it('names the tax country in the app language', () => {
    setLocalePref('en');
    expect(countryName(findCountryPreset('DE')!)).toBe('Germany');
    setLocalePref('it');
    expect(countryName(findCountryPreset('DE')!)).toBe('Germania');
    setLocalePref('fr');
    expect(countryName(findCountryPreset('US')!)).toBe('États-Unis');
    setLocalePref('en');
  });
});

// Review r4 of #293 (QuoteCreationWizard): a quote in a currency outside the
// four the band can pick showed €. Every ISO code gets its own symbol.
describe('currencySymbol: any currency a quote can carry', () => {
  it('CAD, AUD and SEK are not €', async () => {
    const { currencySymbol } = await import('../currency');
    expect(currencySymbol('CAD')).toBe('CA$');
    expect(currencySymbol('AUD')).toBe('A$');
    expect(currencySymbol('SEK')).toBe('SEK ');
    expect(currencySymbol('usd')).toBe('$');
  });
  it('the four the band picks, and no currency: as before', async () => {
    const { currencySymbol } = await import('../currency');
    expect([currencySymbol('EUR'), currencySymbol('USD'), currencySymbol('GBP'), currencySymbol('CHF')]).toEqual(['€', '$', '£', 'CHF ']);
    expect(currencySymbol(null)).toBe('€');
    expect(currencySymbol('nope')).toBe('€');
  });
  it('the quote wizard uses it', async () => {
    const src = (await import('@/app/components/quotes/QuoteCreationWizard.tsx?raw')).default as string;
    expect(src).toMatch(/const currencySymbol = useMemo\(\(\) => symbolOf\(quoteCurrency\), \[quoteCurrency\]\);/);
  });
});
