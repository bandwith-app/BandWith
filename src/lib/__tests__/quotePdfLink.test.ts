import { describe, it, expect } from 'vitest';
import { clientQuotePdfUrl, isQuoteStoragePdf, quotePdfGateUrl, quotePdfKey } from '../quotePdfLink';
import shareModal from '../../app/components/quotes/QuoteShareModal.tsx?raw';

// 176/177: a client never gets the storage URL of a quote PDF (it outlived
// "Turn off link"); only the gated link, which the server checks each time.
const SB = 'https://elvlzpowkohjbhxjasvd.supabase.co';
const BAND = '11111111-2222-3333-4444-555555555555';
const STORED = `${SB}/storage/v1/object/public/quotes/quotes/${BAND}/Q-2026-014_ab12cd34_Quote_Hudson_Horns_Client.pdf`;
const TOKEN = 'a'.repeat(64);
// sha256('a' x 64): the PDF-only key, so a forwarded PDF link is not the client page.
const KEY = 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb';

describe('quote PDF link', () => {
  it('recognises the stored PDF URL the app uploads', () => {
    expect(isQuoteStoragePdf(STORED)).toBe(true);
    expect(isQuoteStoragePdf(`${SB}/storage/v1/object/public/avatars/x.png`)).toBe(false);
    expect(isQuoteStoragePdf('https://evil.example/storage/v1/object/public/quotes/quotes/x/y.pdf')).toBe(false);
    expect(isQuoteStoragePdf('not a url')).toBe(false);
  });

  it('gives the client the gated link, never the storage URL', () => {
    const out = clientQuotePdfUrl(STORED, SB, KEY);
    expect(out).toBe(`${SB}/functions/v1/quote-pdf?p=${KEY}`);
    expect(out).not.toContain('/storage/');
    expect(out).not.toContain(TOKEN);
  });

  it('balance PDFs use their own kind', () => {
    expect(clientQuotePdfUrl(STORED, SB, KEY, 'balance')).toBe(`${SB}/functions/v1/quote-pdf?p=${KEY}&k=balance`);
    expect(quotePdfGateUrl(`${SB}/`, KEY)).toBe(`${SB}/functions/v1/quote-pdf?p=${KEY}`);
  });

  it('nothing without a valid token or a stored PDF', () => {
    expect(clientQuotePdfUrl(STORED, SB, 'demo')).toBeNull();
    expect(clientQuotePdfUrl(STORED, SB, null)).toBeNull();
    expect(clientQuotePdfUrl(null, SB, KEY)).toBeNull();
    expect(clientQuotePdfUrl('https://elsewhere.example/file.pdf', SB, KEY)).toBeNull();
  });

  it('the PDF key is sha256 of the token, never the token', () => {
    expect(quotePdfKey(TOKEN)).toBe(KEY);
    expect(quotePdfKey('0123456789abcdef'.repeat(4))).toBe('a8ae6e6ee929abea3afcfc5258c8ccd6f85273e0d4626d26c7279f3250f77c8e');
    expect(quotePdfKey('demo')).toBeNull();
    expect(quotePdfKey(null)).toBeNull();
  });

  // Codex review #281: "PDF only" shares put the client's token link in the text.
  it('band shares of the PDF carry no client link', () => {
    expect(shareModal).not.toMatch(/quotePdfGateUrl|functions\/v1\/quote-pdf/);
  });
});
