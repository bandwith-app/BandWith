import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { demoQuoteApi } from '../demo';

// Round 3 of the #281 review: the client page's PDF key must follow the
// document (republished PDF), survive a failed first request, and work before
// 176 is applied (no gate yet: the bucket is still public).
const TOKEN = 'a'.repeat(64);
const SB = 'https://abc.supabase.co';
const STORED = `${SB}/storage/v1/object/public/quotes/quotes/11111111-2222-3333-4444-555555555555/Q-1_Quote_Hudson_Horns.pdf`;
const K1 = '1'.repeat(64);
const K2 = '2'.repeat(64);

type Reply = { status: number; body: unknown };
let keyReplies: Reply[] = [];
let keyCalls = 0;

async function boot() {
  const view = { ...(await demoQuoteApi('').view()), pdf_url: STORED };
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).endsWith('/rpc/bw_quote_link_pdf_keys')) {
        const r = keyReplies[Math.min(keyCalls++, keyReplies.length - 1)];
        return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify(view), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  await import('../../quote');
  await vi.advanceTimersByTimeAsync(0);
}

const pdfHref = () =>
  [...document.querySelectorAll<HTMLAnchorElement>('a.btn.light')].map((a) => a.getAttribute('href') ?? '').find((h) => h.includes('quote-pdf') || h.endsWith('.pdf')) ?? null;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', SB);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  window.history.replaceState(null, '', `/quote.html?t=${TOKEN}&l=en`);
  document.body.innerHTML = '<div id="app"></div>';
  keyReplies = [];
  keyCalls = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('quote page: PDF keys', () => {
  it('a failed first key request is retried: the PDF button appears without a reload', async () => {
    keyReplies = [{ status: 503, body: {} }, { status: 200, body: { doc: K1 } }];
    await boot();
    expect(pdfHref()).toBeNull();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(pdfHref()).toContain(`p=${K1}`);
  });

  it('a republished PDF (new key) reaches an open page on the next poll', async () => {
    keyReplies = [{ status: 200, body: { doc: K1 } }];
    await boot();
    expect(pdfHref()).toContain(`p=${K1}`);
    keyReplies = [{ status: 200, body: { doc: K2 } }];
    keyCalls = 0;
    await vi.advanceTimersByTimeAsync(31_000);
    expect(pdfHref()).toContain(`p=${K2}`);
  });

  it('and when the page comes back to the screen', async () => {
    keyReplies = [{ status: 200, body: { doc: K1 } }];
    await boot();
    keyReplies = [{ status: 200, body: { doc: K2 } }];
    keyCalls = 0;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(pdfHref()).toContain(`p=${K2}`);
  });

  it('before 176 (no keys RPC): the stored PDF link, as today', async () => {
    keyReplies = [{ status: 404, body: { code: 'PGRST202' } }];
    await boot();
    expect(pdfHref()).toBe(STORED);
  });
});
