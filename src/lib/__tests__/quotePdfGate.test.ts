import { describe, it, expect } from 'vitest';
import {
  checkedQuotePath,
  quoteStoragePath,
  signQuotePdf,
  pickPdfGateLang,
  pdfGateText,
} from '../../../supabase/functions/_shared/quote-pdf-path';
import gateSrc from '../../../supabase/functions/quote-pdf/index.ts?raw';
import emailSrc from '../../../supabase/functions/send-email/index.ts?raw';
import quotePageSrc from '../../quote.ts?raw';

// Round 2 of the #281 review (Codex + Claude).
const BAND = '11111111-2222-3333-4444-555555555555';

describe('quote-pdf: the path from the database is checked, not decoded again', () => {
  it('accepts a decoded name of the band', () => {
    expect(checkedQuotePath(`quotes/${BAND}/Q-2026-014_Quote Hudson Horns.pdf`, BAND)).toBe(
      `quotes/${BAND}/Q-2026-014_Quote Hudson Horns.pdf`,
    );
  });

  it('refuses "%", "..", separators and control characters in the name', () => {
    // A literal %2F would turn into "/" if anything decoded it once more.
    expect(checkedQuotePath(`quotes/${BAND}/a%2Fb.pdf`, BAND)).toBeNull();
    expect(checkedQuotePath(`quotes/${BAND}/a%25.pdf`, BAND)).toBeNull();
    expect(checkedQuotePath(`quotes/${BAND}/x..pdf`, BAND)).toBeNull();
    expect(checkedQuotePath(`quotes/${BAND}/..`, BAND)).toBeNull();
    expect(checkedQuotePath(`quotes/${BAND}/a\\b.pdf`, BAND)).toBeNull();
    expect(checkedQuotePath(`quotes/${BAND}/a/b.pdf`, BAND)).toBeNull();
    expect(checkedQuotePath(`quotes/${BAND}/a\nb.pdf`, BAND)).toBeNull();
    expect(checkedQuotePath(`quotes/${BAND}/x.pdf`, '99999999-8888-7777-6666-555555555555')).toBeNull();
  });

  it('stored (encoded) names: ".." anywhere is refused after decoding', () => {
    expect(quoteStoragePath(`quotes/${BAND}/x%2E%2Epdf`, BAND)).toBeNull();
    expect(quoteStoragePath(`quotes/${BAND}/x..pdf`, BAND)).toBeNull();
    expect(quoteStoragePath(`quotes/${BAND}/a%2525.pdf`, BAND)).toBeNull();
  });

  it('the gate never decodes what the database already decoded', () => {
    expect(gateSrc).toMatch(/checkedQuotePath\(/);
    expect(gateSrc).not.toMatch(/quoteStoragePath\(/);
  });
});

describe('quote-pdf answers in the page language', () => {
  it('picks the l= parameter, then Accept-Language, then English', () => {
    expect(pickPdfGateLang('it', 'fr-FR,fr;q=0.9')).toBe('it');
    expect(pickPdfGateLang(null, 'fr-FR,fr;q=0.9,en;q=0.5')).toBe('fr');
    expect(pickPdfGateLang('xx', 'pt-BR')).toBe('pt');
    expect(pickPdfGateLang(null, null)).toBe('en');
    expect(pickPdfGateLang('', 'ja-JP')).toBe('en');
  });

  it('has every message in the six page languages', () => {
    const langs = ['en', 'it', 'es', 'fr', 'de', 'pt'] as const;
    for (const k of ['inactive', 'retry', 'method'] as const) {
      const all = langs.map((l) => pdfGateText(l, k));
      expect(all.every((s) => typeof s === 'string' && s.length > 3)).toBe(true);
      expect(new Set(all).size).toBe(langs.length);
    }
    expect(pdfGateText('en', 'inactive')).toBe('This link is not active.');
  });

  it('the gate uses them, and the page passes its language', () => {
    expect(gateSrc).toMatch(/pdfGateText\(/);
    expect(gateSrc).not.toMatch(/plain\("This link is not active\."/);
    expect(quotePageSrc).toMatch(/clientQuotePdfUrl\([^)]*lang/);
  });
});

describe('send-email: a PDF that cannot be signed is an error, not a silent omission', () => {
  const stored = `https://abc.supabase.co/storage/v1/object/public/quotes/quotes/${BAND}/Q-1_Quote.pdf`;

  it('signs the band file', async () => {
    const r = await signQuotePdf(async (p) => ({ url: `https://signed.example/${p}` }), stored, BAND);
    expect(r).toEqual({ url: `https://signed.example/quotes/${BAND}/Q-1_Quote.pdf`, failed: false });
  });

  it('a storage error fails the send', async () => {
    const r = await signQuotePdf(async () => ({ error: 'storage down' }), stored, BAND);
    expect(r.failed).toBe(true);
    expect(r.url).toBeNull();
    const t = await signQuotePdf(async () => {
      throw new Error('network');
    }, stored, BAND);
    expect(t.failed).toBe(true);
  });

  it('no PDF (or not this band\'s file): nothing to attach, not an error', async () => {
    expect(await signQuotePdf(async () => ({ url: 'x' }), null, BAND)).toEqual({ url: null, failed: false });
    expect(await signQuotePdf(async () => ({ url: 'x' }), 'https://evil.example/x.pdf', BAND)).toEqual({ url: null, failed: false });
  });

  it('send-email answers 503 instead of sending without the PDF', () => {
    expect(emailSrc).toMatch(/signQuotePdf\(/);
    expect(emailSrc).toMatch(/code: "pdf_unavailable"/);
  });
});
