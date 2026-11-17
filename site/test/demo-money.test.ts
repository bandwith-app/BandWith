import { describe, expect, it } from 'vitest';
import { MUSICIANS, BAND_FEE, initialMoney, togglePaid, markAllPaid, dueTotal, payoutsTotal, bandFund, seesList } from '../src/ui/demos/money';

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
});
