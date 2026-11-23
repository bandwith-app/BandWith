import { describe, expect, it } from 'vitest';
import { MUSICIANS, BAND_FEE, initialMoney, togglePaid, markAllPaid, dueTotal, payoutsTotal, bandFund, seesList, paidLine, type MoneyState } from '../src/ui/demos/money';
import { makeTranslator } from '../src/i18n/translate';
import { SAME } from '../src/i18n/same';
import { it as IT } from '../src/i18n/dict/it';
import { es as ES } from '../src/i18n/dict/es';

describe('money demo: fees and payouts', () => {
  it('matches the home page card: band fee €2,400, five fees €1,900, Sara €400', () => {
    expect(BAND_FEE).toBe(2400);
    expect(MUSICIANS).toHaveLength(5);
    expect(payoutsTotal()).toBe(1900);
    expect(MUSICIANS.find((m) => m.id === 'sara')?.fee).toBe(400);
    expect(bandFund()).toBe(500);
  });

  it('counts payouts due down as musicians are marked paid, and back up on undo', () => {
    let s = initialMoney();
    expect(dueTotal(s)).toBe(1900);
    s = togglePaid(s, 'sara');
    expect(dueTotal(s)).toBe(1500);
    s = togglePaid(s, 'sara');
    expect(dueTotal(s)).toBe(1900);
    expect(dueTotal(markAllPaid(s))).toBe(0);
  });

  it('never puts the band fee or other fees on Sara’s phone', () => {
    const s = { ...togglePaid(initialMoney(), 'sara'), role: 'member' as const };
    const shown = seesList(s).filter((x) => x.yes).map((x) => x.v).join(' ');
    expect(shown).toContain('€400');
    expect(shown).toContain('Paid');
    expect(shown).not.toMatch(/2,400|1,900|€500|€480|€420|€180/);
  });

  // Every line the log can write, whatever the order of taps: each of the 32 sets of paid
  // musicians, and from each one a tap on any of the five switches.
  const lines = () => {
    const out = new Set<string>();
    for (let mask = 0; mask < 1 << MUSICIANS.length; mask++) {
      const s: MoneyState = { role: 'admin', paid: Object.fromEntries(MUSICIANS.map((m, i) => [m.id, !!(mask & (1 << i))])) };
      for (const m of MUSICIANS) {
        const next = togglePaid(s, m.id);
        out.add(paidLine(m, !!next.paid[m.id], dueTotal(next)));
      }
    }
    return [...out];
  };

  it('writes one line per tap: paid or back to pending, and what is still due', () => {
    const [leo, sara] = MUSICIANS;
    expect(paidLine(leo, true, 1420)).toBe('Leo M. paid · <b>€1,420</b> still due');
    expect(paidLine(sara, false, 400)).toBe('Sara back to pending · <b>€400</b> still due');
    expect(paidLine(leo, true, 0)).toBe('Leo M. paid · <b>everyone paid</b> · the gig leaves Payouts on Home');
    // 5 "everyone paid" lines, and each musician paid or pending with every sum of the others' fees.
    expect(lines().length).toBeGreaterThan(100);
  });

  for (const [lang, dict] of [['it', IT], ['es', ES]] as const) {
    it(`${lang}: every line of the log is translated, in any order of taps`, () => {
      const t = makeTranslator(lang, dict, SAME);
      const missing = lines().filter((l) => t.html(l) == null);
      expect(missing).toEqual([]);
      // The amount is written the language's way, and no English is left.
      const out = t.html(paidLine(MUSICIANS[0], false, 1420))!;
      expect(out).toContain(lang === 'it' ? '<b>1.420 €</b>' : '<b>1420 €</b>');
      expect(lines().map((l) => t.html(l)!).join(' ')).not.toMatch(/\bpaid\b|still due|back to pending|everyone/);
    });
  }
});
