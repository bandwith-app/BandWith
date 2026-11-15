import { describe, expect, it } from 'vitest';
import { groupByLocale, localeOf } from '../recipientLocale';

describe('localeOf', () => {
  it('maps stored languages to the app ones', () => {
    expect(localeOf('it')).toBe('it');
    expect(localeOf('pt-BR')).toBe('pt');
    expect(localeOf('ja')).toBe('en');
    expect(localeOf(null)).toBe('en');
  });
});

describe('groupByLocale', () => {
  it('groups recipients by language, English when unknown', () => {
    const groups = groupByLocale(['a', 'b', 'c'], new Map([['a', 'it' as const], ['b', 'it' as const]]));
    expect(groups.get('it')).toEqual(['a', 'b']);
    expect(groups.get('en')).toEqual(['c']);
  });
});
