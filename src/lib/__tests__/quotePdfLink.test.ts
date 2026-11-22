import { describe, it, expect } from 'vitest';
import { clientQuotePdfUrl, isQuoteStoragePdf, quotePdfGateUrl } from '../quotePdfLink';
import shareModal from '../../app/components/quotes/QuoteShareModal.tsx?raw';

// 176/177: a client never gets the storage URL of a quote PDF (it outlived
// "Turn off link"); only the gated link, which the server checks each time.
const SB = 'https://elvlzpowkohjbhxjasvd.supabase.co';
const BAND = '11111111-2222-3333-4444-555555555555';
const STORED = `${SB}/storage/v1/object/public/quotes/quotes/${BAND}/Q-2026-014_ab12cd34_Quote_Hudson_Horns_Client.pdf`;
const TOKEN = 'a'.repeat(64);
// A document's own key (bw_quote_link_pdf_keys, 176), random on the server.
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

  it('passes the page language to the gate', () => {
    expect(clientQuotePdfUrl(STORED, SB, KEY, 'doc', 'it')).toBe(`${SB}/functions/v1/quote-pdf?p=${KEY}&l=it`);
    expect(clientQuotePdfUrl(STORED, SB, KEY, 'balance', 'pt')).toBe(`${SB}/functions/v1/quote-pdf?p=${KEY}&k=balance&l=pt`);
    expect(clientQuotePdfUrl(STORED, SB, KEY, 'doc', 'x&y')).toBe(`${SB}/functions/v1/quote-pdf?p=${KEY}`);
  });

  // Round 2: one key per document, from the server (no key from the token).
  it('the page takes its keys from bw_quote_link_pdf_keys', async () => {
    const page = (await import('../../quote.ts?raw')).default as string;
    expect(page).toMatch(/bw_quote_link_pdf_keys/);
    expect(page).toMatch(/pdfKeys\.balance : pdfKeys\.doc/);
    expect(page).not.toMatch(/quotePdfKey/);
  });

  // Codex review #281: "PDF only" shares put the client's token link in the text.
  it('band shares of the PDF carry no client link', () => {
    expect(shareModal).not.toMatch(/quotePdfGateUrl|functions\/v1\/quote-pdf/);
  });
});
