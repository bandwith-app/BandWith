/**
 * Codex #281 / #289 round 2: WhatsApp and Email share the PDF as a file. A
 * desktop browser without file sharing only downloaded it, and neither
 * button opened its channel. Now the PDF is downloaded AND WhatsApp / the
 * mail app opens with the message, so the user attaches the file there.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent, screen } from '@testing-library/react';

vi.setConfig({ testTimeout: 30_000 });

const mocks = vi.hoisted(() => ({ generate: vi.fn(), shareFile: vi.fn(), openExternal: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(async () => ({ data: null, error: null })), from: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/usePlan', () => ({ fetchBandPlan: vi.fn(async () => null) }));
vi.mock('@/lib/services/pricing', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/pricing')>()),
  getBandPricing: vi.fn(async () => ({ currency: 'USD' })),
}));
vi.mock('@/lib/services/quotePdf', () => ({
  generateQuotePdf: mocks.generate,
  uploadQuotePdfForSharing: vi.fn(async () => null),
}));
vi.mock('@/lib/nativeFiles', async (orig) => ({
  ...(await orig<typeof import('@/lib/nativeFiles')>()),
  shareFile: mocks.shareFile,
  openExternal: mocks.openExternal,
}));

import { QuoteShareModal } from '../QuoteShareModal';

afterEach(() => cleanup());
beforeEach(() => {
  mocks.shareFile.mockReset();
  mocks.openExternal.mockReset();
  mocks.generate.mockImplementation(async () => ({ pdfBlob: new Blob(['%PDF']), pdfFile: new File(['%PDF'], 'q.pdf'), pageDataUrls: [], fileName: 'q.pdf' }));
});

// An event that has no saved quote yet: no client link, the PDF goes as a file.
const quote = {
  id: 'event-quote-preview', quoteNumber: 'Q-2027-0042', status: 'DRAFT', clientName: 'Jordan Lee', clientPhone: '+1 917 555 0101',
  clientEmail: 'jordan@example.com', currency: 'USD', total: 4200, eventName: 'Rooftop wedding', eventDate: '2099-06-12',
  musicians: [], customItems: [],
} as any;

const open = async () => {
  render(<QuoteShareModal isOpen quote={quote} bandId="00000000-0000-0000-0000-000000000001" bandName="The Night Shift" onClose={() => {}} />);
  await waitFor(() => expect(mocks.generate).toHaveBeenCalled(), { timeout: 20_000 });
  await new Promise((r) => setTimeout(r, 200));
};
const tap = async (label: RegExp) => {
  const el = (await screen.findAllByText(label))[0].closest('button') as HTMLButtonElement;
  await waitFor(() => expect(el.disabled).toBe(false), { timeout: 20_000 });
  fireEvent.click(el);
};

describe('QuoteShareModal: WhatsApp and Email without file sharing', () => {
  it('WhatsApp: the PDF downloads and WhatsApp opens with the message', async () => {
    mocks.shareFile.mockResolvedValue('downloaded');
    await open();
    await tap(/^WhatsApp$/);
    await waitFor(() => expect(mocks.openExternal).toHaveBeenCalled());
    expect(String(mocks.openExternal.mock.calls[0][0])).toMatch(/^https:\/\/wa\.me\/19175550101\?text=/);
  });

  it('Email: the PDF downloads and the mail app opens to the client', async () => {
    mocks.shareFile.mockResolvedValue('downloaded');
    await open();
    await tap(/^Email client$/);
    await waitFor(() => expect(mocks.openExternal).toHaveBeenCalled());
    expect(String(mocks.openExternal.mock.calls[0][0])).toMatch(/^mailto:jordan%40example\.com\?subject=.+&body=/);
  });

  it('with file sharing, the system sheet is enough', async () => {
    mocks.shareFile.mockResolvedValue('shared');
    await open();
    await tap(/^WhatsApp$/);
    await waitFor(() => expect(mocks.shareFile).toHaveBeenCalled());
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });
});
