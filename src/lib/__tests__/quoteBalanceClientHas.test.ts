/**
 * Review of #293 (BalanceRequestSheet.tsx:203): the sheet fell back to the
 * published balance when nothing was sent, so a trial amount the client
 * never received (an older build's Preview, or a version not sent yet)
 * counted as "what the client has": its other payments came back and the
 * next send was planned as an update of it.
 */
import { describe, expect, it } from 'vitest';
import * as qb from '@/lib/quoteBalance';
import sheetSrc from '../../app/components/quotes/BalanceRequestSheet.tsx?raw';

const bal = (amount: number) =>
  ({ v: 1, currency: 'USD', total: 2000, received: [], amount, amountLabel: `$${amount}`, dueDate: null, reference: 'Q-2027-0007 · Balance' }) as any;

describe('balanceClientHas', () => {
  it('is what was sent, never a balance only published', () => {
    expect(typeof (qb as any).balanceClientHas).toBe('function');
    // Published (a preview the old way), never sent.
    expect(qb.balanceClientHas({ balance: bal(900), balance_sent: null, balance_sent_at: null })).toBeNull();
    // Sent $500, then a $900 trial published: the client has $500.
    expect(qb.balanceClientHas({ balance: bal(900), balance_sent: bal(500), balance_sent_at: '2027-05-01T12:00:00Z' })?.amount).toBe(500);
    // A send on record, but 185's backfill could not tell which version: none.
    expect(qb.balanceClientHas({ balance: bal(900), balance_sent: null, balance_sent_at: '2027-05-01T12:00:00Z' })).toBeNull();
  });

  it('before 185 (no balance_sent column): the published balance once a send is recorded', () => {
    expect(qb.balanceClientHas({ balance: bal(700), balance_sent_at: '2027-05-01T12:00:00Z' })?.amount).toBe(700);
    expect(qb.balanceClientHas({ balance: bal(700), balance_sent_at: null })).toBeNull();
    expect(qb.balanceClientHas(null)).toBeNull();
  });

  it('the balance sheet uses it', () => {
    expect(sheetSrc).toContain('const prev = balanceClientHas(link);');
  });
});
