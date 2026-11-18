/**
 * Replies to BandWith emails must reach a person: band and account emails
 * reply to the EMAIL_REPLY_TO inbox (ciao@bandwith.fun), quote emails to the
 * band admin who sent the quote, so the client's answer reaches the band.
 */
import { describe, expect, it } from 'vitest';
import { replyTo } from '../../../supabase/functions/_shared/email-reply-to';

const RAW = import.meta.glob('../../../supabase/functions/send-email/index.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const sendEmail = Object.values(RAW)[0];

describe('email reply-to', () => {
  it('uses the configured inbox', () => {
    expect(replyTo({ configured: 'ciao@bandwith.fun' })).toEqual({ reply_to: 'ciao@bandwith.fun' });
  });

  it('prefers the person who sent the email', () => {
    expect(replyTo({ configured: 'ciao@bandwith.fun', person: ' Admin@Band.it ' })).toEqual({
      reply_to: 'admin@band.it',
    });
  });

  it('falls back to the inbox when the person has no valid address', () => {
    expect(replyTo({ configured: 'ciao@bandwith.fun', person: null })).toEqual({ reply_to: 'ciao@bandwith.fun' });
    expect(replyTo({ configured: 'ciao@bandwith.fun', person: 'not-an-email' })).toEqual({
      reply_to: 'ciao@bandwith.fun',
    });
  });

  it('adds nothing when no address is set', () => {
    expect(replyTo({ configured: undefined })).toEqual({});
    expect(replyTo({ configured: '  ' })).toEqual({});
  });

  it('is applied to every email send-email posts to Resend', () => {
    const sends = sendEmail.match(/from: FROM_EMAIL[^\n]*/g) ?? [];
    expect(sends.length).toBeGreaterThanOrEqual(3);
    for (const line of sends) expect(line).toMatch(/replyTo\(|\.\.\.REPLY/);
    expect(sendEmail).toMatch(/replyTo\(\{ configured: REPLY_TO, person: caller\.email \}\)/);
  });
});
