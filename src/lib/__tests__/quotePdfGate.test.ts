import { describe, it, expect } from 'vitest';
import {
  checkedQuotePath,
  quoteStoragePath,
  signQuotePdf,
  pickPdfGateLang,
  pdfGateText,
  serveQuotePdf,
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

  it('the gate never decodes what the database already decoded', async () => {
    expect(gateSrc).not.toMatch(/quoteStoragePath\(/);
    // serveQuotePdf checks the decoded path (checkedQuotePath): a literal %2F
    // from the database is refused, not decoded into another folder.
    let downloaded = false;
    const res = await serveQuotePdf(new Request(`https://x.supabase.co/functions/v1/quote-pdf?p=${'f'.repeat(64)}`), {
      lookup: async () => ({ path: `quotes/${BAND}/a%2Fb.pdf`, error: null }),
      download: async () => {
        downloaded = true;
        return { data: { arrayBuffer: async () => new ArrayBuffer(1) }, error: null };
      },
    });
    expect(res.status).toBe(404);
    expect(downloaded).toBe(false);
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
    // (the texts are used by serveQuotePdf, tested below)
    expect(gateSrc).toMatch(/serveQuotePdf\(/);
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

// Round 4 (Codex #281, quote-pdf/index.ts:55): a redirect to a signed URL
// shows the storage path, and with the bucket still public that path keeps
// opening the PDF after the link is turned off. The gate streams the file.
describe('quote-pdf streams the PDF and never reveals where it is stored', () => {
  const KEY = 'f'.repeat(64);
  const FILE = `quotes/${BAND}/Q-2026-014_Quote Hudson Horns.pdf`;
  const pdfBytes = new TextEncoder().encode('%PDF-1.7 test');
  const deps = (over: Partial<Parameters<typeof serveQuotePdf>[1]> = {}) => {
    const calls: string[] = [];
    return {
      calls,
      deps: {
        lookup: async (key: string, kind: 'doc' | 'balance') => {
          calls.push(`lookup ${kind}`);
          return { path: key === KEY ? FILE : null, error: null };
        },
        download: async (path: string) => {
          calls.push(`download ${path}`);
          // (stored as text/html: the answer is a PDF all the same)
          return { data: { arrayBuffer: async () => pdfBytes.slice().buffer, type: 'text/html' }, error: null };
        },
        ...over,
      },
    };
  };
  const get = (q: string, method = 'GET') => new Request(`https://x.supabase.co/functions/v1/quote-pdf?${q}`, { method });

  it('answers with the PDF itself: no redirect, no storage path anywhere', async () => {
    const { deps: d } = deps();
    const res = await serveQuotePdf(get(`p=${KEY}`), d);
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    expect(res.headers.get('content-disposition')).toBe('inline; filename="quote.pdf"');
    const all = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
    expect(all).not.toMatch(/storage|quotes\/|Hudson|Q-2026/);
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(pdfBytes));
  });

  it('balance PDFs get their own generic name; HEAD has no body', async () => {
    const { deps: d } = deps();
    const res = await serveQuotePdf(get(`p=${KEY}&k=balance`), d);
    expect(res.headers.get('content-disposition')).toBe('inline; filename="balance.pdf"');
    const head = await serveQuotePdf(get(`p=${KEY}`, 'HEAD'), d);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('a turned-off or unknown key: 404 in the page language, nothing downloaded', async () => {
    const { deps: d, calls } = deps();
    const res = await serveQuotePdf(get(`p=${'e'.repeat(64)}&l=it`), d);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(pdfGateText('it', 'inactive'));
    expect(calls.some((c) => c.startsWith('download'))).toBe(false);
    const bad = await serveQuotePdf(get('p=../x'), d);
    expect(bad.status).toBe(404);
  });

  it('lookup or storage failures: 503 "try again", never the path', async () => {
    let r = await serveQuotePdf(get(`p=${KEY}`), deps({ lookup: async () => ({ path: null, error: 'db down' }) }).deps);
    expect(r.status).toBe(503);
    r = await serveQuotePdf(get(`p=${KEY}`), deps({ download: async () => ({ data: null, error: 'Object not found' }) }).deps);
    expect(r.status).toBe(503);
    expect(await r.text()).toBe(pdfGateText('en', 'retry'));
    r = await serveQuotePdf(get(`p=${KEY}`, 'POST'), deps().deps);
    expect(r.status).toBe(405);
  });

  it('the function itself only wires the database and storage in', () => {
    expect(gateSrc).toMatch(/serveQuotePdf\(/);
    expect(gateSrc).not.toMatch(/createSignedUrl|Location|302/);
  });
});
