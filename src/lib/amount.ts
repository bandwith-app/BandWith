/**
 * Money typed by people, in their own way of writing numbers.
 *
 * One parser for every amount typed in a text field (deposit received,
 * other payments, fees, transactions, purchase prices). "1.250" is one
 * thousand two hundred fifty for a German or Italian user and one and a
 * quarter for an American; "1.250,00" and "1,250.00" are the same amount.
 * Inputs of type="number" give the browser's own canonical value ("1250.5")
 * and don't need this.
 *
 * Rules, in order:
 * - spaces (also no-break and thin ones), apostrophes (Swiss "1'250") and
 *   currency signs are ignored;
 * - with both "." and ",", the last one is the decimal mark;
 * - one kind used more than once ("1.250.000") is grouping;
 * - used once followed by exactly 3 digits ("1.250", "1,250"), it is what
 *   the locale writes it as: grouping where it is not the decimal mark;
 * - otherwise ("12,5", "1.25") it is the decimal mark.
 * Anything else (letters, "1,2,5", "-3", two decimal marks) is not an
 * amount: null, so the form can say so instead of saving 0 or NaN.
 */
import { intlLocale } from '@/lib/i18n';

const decimalMarkOf = (locale?: string): '.' | ',' => {
  try {
    const part = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal');
    return part?.value === ',' ? ',' : '.';
  } catch {
    return '.';
  }
};

/** The amount typed, rounded to cents; null when empty or not an amount. */
export function parseAmount(text: unknown, locale: string | undefined = intlLocale('en-US')): number | null {
  if (typeof text === 'number') return Number.isFinite(text) && text >= 0 ? Math.round(text * 100) / 100 : null;
  let s = String(text ?? '')
    .trim()
    .replace(/[\s   '’]/g, '')
    .replace(/^[€$£]|^(?:CHF|EUR|USD|GBP)/i, '')
    .replace(/[€$£]$|(?:CHF|EUR|USD|GBP)$/i, '');
  if (!s || !/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return null;

  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;
  let decimal: '.' | ',' | null = null;
  if (dots && commas) {
    decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    if ((decimal === '.' ? dots : commas) > 1) return null;
    // Grouping only before the decimal mark, in threes.
    const [int] = s.split(decimal);
    if (!new RegExp(`^\\d{1,3}(\\${group}\\d{3})*$`).test(int)) return null;
    s = s.split(group).join('');
  } else if (dots + commas > 1) {
    const mark = dots ? '.' : ',';
    if (!new RegExp(`^\\d{1,3}(\\${mark}\\d{3})+$`).test(s)) return null;
    s = s.split(mark).join('');
  } else if (dots + commas === 1) {
    const mark = dots ? '.' : ',';
    const [int, frac] = s.split(mark);
    if (!int && !frac) return null;
    // "12," while typing: the whole amount so far.
    if (!frac) return Number(int);
    const grouping = frac.length === 3 && int.length >= 1 && int.length <= 3 && int !== '0' && decimalMarkOf(locale) !== mark;
    if (grouping) s = int + frac;
    else decimal = mark;
  }
  if (decimal) s = s.replace(decimal, '.');
  if (!/^\d*(\.\d+)?$/.test(s) || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** A field's state: empty, an amount, or text that is not an amount. */
export function amountField(text: string, locale?: string): { value: number | null; empty: boolean; invalid: boolean } {
  const empty = !String(text ?? '').trim();
  const value = empty ? null : parseAmount(text, locale);
  return { value, empty, invalid: !empty && value == null };
}

/** What an amount field lets people type: digits, separators, spaces. */
export const amountKeys = (text: string): string => text.replace(/[^0-9.,\s'’]/g, '');
