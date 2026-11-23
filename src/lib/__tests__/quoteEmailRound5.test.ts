/**
 * Round 5 (Claude review of 8f5922d7): a send that may have gone out keeps
 * its slot (no second email after a timeout), Resend gets one idempotency
 * key per slot, and the caller must be an admin of the quote's band before
 * send-email says anything about its link.
 */
import { describe, it, expect } from 'vitest';
import * as claim from '../../../supabase/functions/_shared/quote-email-claim';

const RAW = import.meta.glob('../../../supabase/functions/send-email/index.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sendEmail = Object.values(RAW)[0];
const mod = claim as unknown as Record<string, any>;

describe('the slot is given back only when nothing went out', () => {
  it('a refusal from Resend (4xx) sent nothing; a timeout, a 5xx or a 409 may have', () => {
    expect(typeof mod.sentNothing).toBe('function');
    const err = (status: number) => new mod.MailServiceError('Failed to send email', status);
    expect(mod.sentNothing(err(422))).toBe(true);
    expect(mod.sentNothing(err(429))).toBe(true);
    expect(mod.sentNothing(err(500))).toBe(false);
    expect(mod.sentNothing(err(409))).toBe(false);
    expect(mod.sentNothing(new Error('connection reset'))).toBe(false);
    expect(mod.sentNothing(new DOMException('The signal timed out', 'TimeoutError'))).toBe(false);
  });
  it('send-email releases only on sentNothing, and passes one idempotency key per slot', () => {
    expect(sendEmail).not.toMatch(/catch \(e\) \{\s*await slot\.release\(\);/);
    expect(sendEmail.match(/if \(sentNothing\(e\)\) \{\s*await slot\.release\(\);/g)?.length).toBe(2);
    expect(sendEmail.match(/quoteEmailIdempotencyKey\(link\.id, slot\.at\)/g)?.length).toBe(2);
    expect(sendEmail).toMatch(/"Idempotency-Key": idempotencyKey/);
    expect(mod.quoteEmailIdempotencyKey?.('l1', '2026-11-22T10:00:00.000Z')).toBe('quote-email/l1/2026-11-22T10:00:00.000Z');
  });
});

describe('send-email: admin of the quote band before the link is looked up', () => {
  it('both quote handlers check the band admin before the 410 link_changed', () => {
    for (const fn of ['async function sendQuoteClientEmail', 'async function sendQuoteBalanceEmail']) {
      const body = sendEmail.slice(sendEmail.indexOf(fn), sendEmail.indexOf('\n}\n', sendEmail.indexOf(fn)));
      const admin = body.indexOf('requireQuoteBandAdmin(admin, caller.id, quoteId)');
      const gone = body.indexOf('code: "link_changed"');
      expect(admin).toBeGreaterThan(-1);
      expect(admin).toBeLessThan(gone);
    }
  });
});

// Claude r9 (send-email:578/669): a refusal from Resend gave the app a 500
// with no code, so the balance sheet could not take back the send it had
// recorded before the email. Now both handlers say email_refused.
describe('a refused email says so', () => {
  it('both quote handlers answer email_refused when nothing went out, and still throw otherwise', () => {
    for (const fn of ['async function sendQuoteClientEmail', 'async function sendQuoteBalanceEmail']) {
      const body = sendEmail.slice(sendEmail.indexOf(fn), sendEmail.indexOf('\n}\n', sendEmail.indexOf(fn)));
      const refused = body.slice(body.indexOf('if (sentNothing(e)) {'));
      expect(refused).toMatch(/^if \(sentNothing\(e\)\) \{\s*await slot\.release\(\);[\s\S]*?return jsonResponse\(\{ success: false, code: "email_refused"[^}]*\}, 502\);\s*\}\s*throw e;/);
    }
  });
});
