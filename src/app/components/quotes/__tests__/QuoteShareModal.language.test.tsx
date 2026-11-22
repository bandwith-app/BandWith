/**
 * Audit of 383f15b, i18n #10: a quote sent in French, reopened on an English
 * device with no saved choice for that client, went back to English: the
 * server's French came in, the PDF regenerated, and the regeneration reset
 * the language to the device's. A reminder then republished the page in
 * English. The language is now picked once per opening.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

vi.setConfig({ testTimeout: 30_000 });

const mocks = vi.hoisted(() => ({ generate: vi.fn(), publish: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/usePlan', () => ({ fetchBandPlan: vi.fn(async () => null) }));
vi.mock('@/lib/services/pricing', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/pricing')>()),
  getBandPricing: vi.fn(async () => ({ currency: 'USD' })),
}));
vi.mock('@/lib/services/quotePdf', () => ({
  generateQuotePdf: mocks.generate,
  uploadQuotePdfForSharing: vi.fn(async () => null),
}));
vi.mock('@/lib/services/quoteLinks', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/quoteLinks')>()),
  getQuoteLinkState: vi.fn(async () => ({
    data: { link: { token: 'c'.repeat(64), status: 'sent', lang: 'fr', revoked_at: null }, activity: [] },
    error: null,
  })),
  // 183: the sheet checks the client saved now (here: the same one).
  getQuoteContact: vi.fn(async () => ({ data: { client_name: 'Camille Martin', client_email: 'camille@example.com', client_phone: null }, error: null })),
  publishQuoteLink: mocks.publish,
  sendQuoteEmail: vi.fn(async () => ({ ok: true })),
  markQuoteLinkSent: vi.fn(async () => ({ data: 'sent', error: null })),
}));

import { QuoteShareModal } from '../QuoteShareModal';

afterEach(() => cleanup());

const quote = {
  id: '00000000-0000-0000-0000-000000000042', quoteNumber: 'Q-2027-0042', status: 'SENT', clientName: 'Camille Martin',
  clientEmail: 'camille@example.com', currency: 'USD', total: 4200, eventName: 'Rooftop wedding', eventDate: '2099-06-12',
  musicians: [], customItems: [],
} as any;

describe('QuoteShareModal: the client language stays', () => {
  it('keeps French from the sent link and resends in French', async () => {
    mocks.generate.mockImplementation(async () => ({ pdfBlob: new Blob(['%PDF']), pdfFile: new File(['%PDF'], 'q.pdf'), pageDataUrls: [], fileName: 'q.pdf' }));
    mocks.publish.mockResolvedValue({ data: { token: 'c'.repeat(64), status: 'sent', version: 1, revoked: false }, error: null });
    render(
      <QuoteShareModal isOpen quote={quote} bandId="00000000-0000-0000-0000-000000000001" bandName="The Night Shift" onClose={() => {}} autoSendEmail kind="reminder" />,
    );
    await waitFor(() => expect(mocks.publish).toHaveBeenCalled(), { timeout: 20_000 });
    // Settled: no regeneration left in another language.
    await new Promise((r) => setTimeout(r, 300));
    const langs = mocks.generate.mock.calls.map((c) => c[3]);
    expect(langs[langs.length - 1]).toBe('fr');
    expect(mocks.publish.mock.calls.every((c) => c[2] === 'fr')).toBe(true);
  });
});
