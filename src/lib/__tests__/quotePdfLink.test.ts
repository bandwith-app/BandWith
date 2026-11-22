import { describe, it, expect } from 'vitest';
import { clientQuotePdfUrl, isQuoteStoragePdf, quotePdfGateUrl } from '../quotePdfLink';

// 176/177: a client never gets the storage URL of a quote PDF (it outlived
// "Turn off link"); only the gated link, which the server checks each time.
const SB = 'https://elvlzpowkohjbhxjasvd.supabase.co';
const BAND = '11111111-2222-3333-4444-555555555555';
const STORED = `${SB}/storage/v1/object/public/quotes/quotes/${BAND}/Q-2026-014_ab12cd34_Quote_Hudson_Horns_Client.pdf`;
const TOKEN = 'a'.repeat(64);

describe('quote PDF link', () => {
  it('recognises the stored PDF URL the app uploads', () => {
    expect(isQuoteStoragePdf(STORED)).toBe(true);
    expect(isQuoteStoragePdf(`${SB}/storage/v1/object/public/avatars/x.png`)).toBe(false);
    expect(isQuoteStoragePdf('https://evil.example/storage/v1/object/public/quotes/quotes/x/y.pdf')).toBe(false);
    expect(isQuoteStoragePdf('not a url')).toBe(false);
  });

  it('gives the client the gated link, never the storage URL', () => {
    const out = clientQuotePdfUrl(STORED, SB, TOKEN);
    expect(out).toBe(`${SB}/functions/v1/quote-pdf?t=${TOKEN}`);
    expect(out).not.toContain('/storage/');
  });

  it('balance PDFs use their own kind', () => {
    expect(clientQuotePdfUrl(STORED, SB, TOKEN, 'balance')).toBe(`${SB}/functions/v1/quote-pdf?t=${TOKEN}&k=balance`);
    expect(quotePdfGateUrl(`${SB}/`, TOKEN)).toBe(`${SB}/functions/v1/quote-pdf?t=${TOKEN}`);
  });

  it('nothing without a valid token or a stored PDF', () => {
    expect(clientQuotePdfUrl(STORED, SB, 'demo')).toBeNull();
    expect(clientQuotePdfUrl(STORED, SB, null)).toBeNull();
    expect(clientQuotePdfUrl(null, SB, TOKEN)).toBeNull();
    expect(clientQuotePdfUrl('https://elsewhere.example/file.pdf', SB, TOKEN)).toBeNull();
  });
});
