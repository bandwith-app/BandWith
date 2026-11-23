import { describe, it, expect } from 'vitest';
import { amountField, parseAmount } from '../amount';

// Audit of 383f15b, i18n #2/#3: "1.250" was saved as 1.25 and "1.250,00" read as NaN (0).
describe('parseAmount: amounts as people type them', () => {
  it('reads grouping and decimals the way each locale writes them', () => {
    expect(parseAmount('1.250', 'de-DE')).toBe(1250);
    expect(parseAmount('1.250', 'it-IT')).toBe(1250);
    expect(parseAmount('1.250', 'en-US')).toBe(1.25);
    expect(parseAmount('1,250', 'en-US')).toBe(1250);
    expect(parseAmount('1,250', 'de-DE')).toBe(1.25);
    expect(parseAmount('1.250,00', 'de-DE')).toBe(1250);
    expect(parseAmount('1.250,00', 'en-US')).toBe(1250);
    expect(parseAmount('1,250.00', 'it-IT')).toBe(1250);
    expect(parseAmount('1 250,50', 'fr-FR')).toBe(1250.5);
    expect(parseAmount('1 250,50', 'fr-FR')).toBe(1250.5);
    expect(parseAmount("1'250.50", 'de-CH')).toBe(1250.5);
    expect(parseAmount('1.250.000', 'en-US')).toBe(1250000);
    expect(parseAmount('1,250,000.75', 'en-US')).toBe(1250000.75);
  });

  it('reads plain decimals in any locale', () => {
    expect(parseAmount('12,5', 'en-US')).toBe(12.5);
    expect(parseAmount('12.50', 'de-DE')).toBe(12.5);
    expect(parseAmount('0.250', 'de-DE')).toBe(0.25);
    expect(parseAmount('300', 'de-DE')).toBe(300);
    expect(parseAmount('$300', 'en-US')).toBe(300);
    expect(parseAmount('300 €', 'it-IT')).toBe(300);
    expect(parseAmount('99.999', 'en-US')).toBe(100);
    expect(parseAmount('12,', 'it-IT')).toBe(12);
  });

  it('says when the text is not an amount, instead of 0 or NaN', () => {
    for (const bad of ['', '  ', 'abc', '1,2,5', '1.25.5', '1.250,00,5', '12,34.5,6', '-3', '1,25.000', '.']) {
      expect(parseAmount(bad, 'en-US')).toBeNull();
    }
    expect(amountField('1.250,00', 'de-DE')).toEqual({ value: 1250, empty: false, invalid: false });
    expect(amountField('1,2,5', 'de-DE')).toEqual({ value: null, empty: false, invalid: true });
    expect(amountField('', 'de-DE')).toEqual({ value: null, empty: true, invalid: false });
  });
});
