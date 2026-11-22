/**
 * Round 4 (183): two sends of a quote email at the same moment send one
 * email; a balance email names the balance version the admin saw.
 */
import { describe, it, expect, vi } from 'vitest';
import { claimQuoteEmailSlot, staleBalanceVersion, type ClaimClient } from '../../../supabase/functions/_shared/quote-email-claim';

const RAW = import.meta.glob('../../../supabase/functions/send-email/index.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sendEmail = Object.values(RAW)[0];

const LINK = '33333333-3333-4333-8333-333333333333';

/** A quote_links table holding one row: the conditional update runs as Postgres would. */
const table = (row: { last_emailed_at: string | null }) => {
  const calls: Array<Record<string, unknown>> = [];
  const client: ClaimClient = {
    from: () => ({
      update: (values: Record<string, unknown>) => {
        const conds: Array<(r: typeof row) => boolean> = [];
        const apply = () => {
          const hit = conds.every((c) => c(row));
          if (hit) Object.assign(row, values);
          calls.push(values);
          return hit;
        };
        const f: any = {
          eq: (col: string, v: unknown) => { if (col !== 'id') conds.push((r: any) => r[col] === v); return f; },
          or: (expr: string) => {
            const cutoff = expr.split('last_emailed_at.lt.')[1];
            conds.push((r) => r.last_emailed_at === null || r.last_emailed_at < cutoff);
            return f;
          },
          select: () => Promise.resolve({ data: apply() ? [{ id: LINK }] : [], error: null }),
          then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null, hit: apply() }).then(res),
        };
        return f;
      },
    }),
  };
  return { client, row, calls };
};

describe('claimQuoteEmailSlot', () => {
  it('two sends at the same moment: one gets the slot, the other nothing', async () => {
    const t = table({ last_emailed_at: null });
    const now = Date.parse('2026-11-22T15:00:00Z');
    const [a, b] = await Promise.all([
      claimQuoteEmailSlot(t.client, LINK, null, 60_000, now),
      claimQuoteEmailSlot(t.client, LINK, null, 60_000, now + 5),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
  it('a send within the minute after the last one: nothing', async () => {
    const t = table({ last_emailed_at: '2026-11-22T14:59:30.000Z' });
    expect(await claimQuoteEmailSlot(t.client, LINK, '2026-11-22T14:59:30.000Z', 60_000, Date.parse('2026-11-22T15:00:00Z'))).toBeNull();
  });
  it('after the minute: the slot, and a failed send gives it back', async () => {
    const t = table({ last_emailed_at: '2026-11-22T14:58:00.000Z' });
    const slot = await claimQuoteEmailSlot(t.client, LINK, '2026-11-22T14:58:00.000Z', 60_000, Date.parse('2026-11-22T15:00:00Z'));
    expect(slot).not.toBeNull();
    expect(t.row.last_emailed_at).toBe('2026-11-22T15:00:00.000Z');
    await slot!.release();
    expect(t.row.last_emailed_at).toBe('2026-11-22T14:58:00.000Z');
  });
  it('a release never undoes a later send’s slot', async () => {
    const t = table({ last_emailed_at: null });
    const slot = await claimQuoteEmailSlot(t.client, LINK, null, 60_000, Date.parse('2026-11-22T15:00:00Z'));
    t.row.last_emailed_at = '2026-11-22T15:01:30.000Z';
    await slot!.release();
    expect(t.row.last_emailed_at).toBe('2026-11-22T15:01:30.000Z');
  });
});

describe('staleBalanceVersion', () => {
  it('the admin saw another version than the page has: stale', () => {
    expect(staleBalanceVersion(2, 3)).toBe(true);
    expect(staleBalanceVersion(3, 3)).toBe(false);
    expect(staleBalanceVersion(undefined, 3)).toBe(false); // older builds say nothing
  });
});

describe('send-email uses them (both quote handlers)', () => {
  it('claims with the conditional update and sends nothing without a row', () => {
    expect(sendEmail.match(/await claimQuoteEmailSlot\(/g)?.length).toBe(2);
    expect(sendEmail).not.toMatch(/update\(\{ last_emailed_at: new Date\(\)\.toISOString\(\) \}\)/);
  });
  it('a balance email for another version: 409 before anything is sent', () => {
    const balance = sendEmail.slice(sendEmail.indexOf('async function sendQuoteBalanceEmail'));
    const stale = balance.indexOf('staleBalanceVersion(');
    expect(stale).toBeGreaterThan(0);
    expect(balance.slice(stale, stale + 300)).toMatch(/409/);
    expect(stale).toBeLessThan(balance.indexOf('claimQuoteEmailSlot('));
  });
  it('the address is the link’s recipient, never the quote’s contact now', () => {
    expect(sendEmail).not.toMatch(/quote\.client_email/);
  });
});
