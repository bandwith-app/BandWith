/**
 * 183 round 5 (Codex review of 8f5922d7): the share sheet sends on what it
 * opened with. A sheet that read no link publishes with version 0, so a link
 * made since (another admin) refuses it. Right before every publish the
 * client saved now is read again: another contact than the sheet's summary
 * and PDF are for, and nothing goes out (round 6: open the quote again).
 */
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

vi.setConfig({ testTimeout: 30_000 });

const TOKEN_B = 'b'.repeat(64);
const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  publish: vi.fn(),
  markSent: vi.fn(),
  contact: vi.fn(),
  state: vi.fn(),
  email: vi.fn(),
  writeText: vi.fn(async () => {}),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/usePlan', () => ({ fetchBandPlan: vi.fn(async () => null) }));
vi.mock('@/lib/nativeFiles', () => ({ shareFile: vi.fn(), saveFile: vi.fn(), openExternal: vi.fn(async () => {}) }));
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
  getQuoteLinkState: mocks.state,
  getQuoteContact: mocks.contact,
  publishQuoteLink: mocks.publish,
  sendQuoteEmail: mocks.email,
  markQuoteLinkSent: mocks.markSent,
}));

import { QuoteShareModal } from '../QuoteShareModal';
import { openExternal } from '@/lib/nativeFiles';

const quote = {
  id: '00000000-0000-0000-0000-000000000042', quoteNumber: 'Q-2027-0042', status: 'SENT', clientName: 'Jordan Lee',
  clientEmail: 'jordan@brooklynevents.example', clientPhone: '+1 646 555 0199', currency: 'USD', total: 4200,
  eventName: 'Rooftop wedding', eventDate: '2099-06-12', musicians: [], customItems: [],
} as any;
const jordan = { client_name: 'Jordan Lee', client_email: 'jordan@brooklynevents.example', client_phone: '+1 646 555 0199', total: 4200, currency: 'USD' };
const linkB = { id: 'link-b', token: TOKEN_B, status: 'sent', lang: 'en', revoked_at: null, version: 2 };

const button = (title: string) => screen.getByText(title).closest('button') as HTMLButtonElement;
const open = () =>
  render(<QuoteShareModal isOpen quote={quote} bandId="00000000-0000-0000-0000-000000000001" bandName="The Night Shift" onClose={() => {}} />);
const ready = () => waitFor(() => expect(button('Copy message & link').disabled).toBe(false), { timeout: 20_000 });

beforeEach(() => {
  window.open = vi.fn(() => null) as never;
  mocks.generate.mockImplementation(async () => ({ pdfBlob: new Blob(['%PDF']), pdfFile: new File(['%PDF'], 'q.pdf'), pageDataUrls: [], fileName: 'q.pdf' }));
  mocks.markSent.mockResolvedValue({ data: 'sent', error: null });
  mocks.contact.mockResolvedValue({ data: jordan, error: null });
  mocks.state.mockResolvedValue({ data: { link: linkB, activity: [] }, error: null });
  mocks.publish.mockResolvedValue({ data: { token: TOKEN_B, status: 'sent', version: 3, revoked: false }, error: null });
  mocks.email.mockResolvedValue({ ok: true });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: mocks.writeText }, configurable: true });
});
afterEach(() => {
  cleanup();
  for (const m of Object.values(mocks)) m.mockReset();
  vi.mocked(openExternal).mockClear();
});

describe('QuoteShareModal round 5: the version and the client it opened with', () => {
  it('a sheet that read no link publishes with version 0 (a link made since refuses it)', async () => {
    mocks.state.mockResolvedValue({ data: { link: null, activity: [] }, error: null });
    open();
    await ready();
    fireEvent.click(button('Copy message & link'));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
    expect(mocks.publish.mock.calls[0][4]).toBeNull();
    expect(mocks.publish.mock.calls[0][5]).toBe(0);
  });

  // Round 6 (Codex): the summary and the PDF name the client the sheet
  // opened with; another one saved since: nothing is published or sent on
  // any channel (Copy too), and the sheet asks to open the quote again.
  it('the phone changed since the sheet opened: WhatsApp sends nothing, says who it goes to now and to open the quote again', async () => {
    open();
    await ready();
    mocks.contact.mockResolvedValue({ data: { ...jordan, client_phone: '+1 646 555 0123' }, error: null });
    fireEvent.click(button('WhatsApp'));
    const notice = await screen.findByTestId('quote-recipient-changed');
    expect(notice.textContent).toContain('This quote now goes to Jordan Lee · jordan@brooklynevents.example. Nothing was sent: close this and open the quote again.');
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    // No second tap sends the old summary and PDF to them.
    expect(screen.queryByText('Send to Jordan Lee')).toBeNull();
    expect(button('WhatsApp').disabled).toBe(true);
  });

  it('the email changed since the sheet opened: no email, nothing published', async () => {
    open();
    await ready();
    mocks.contact.mockResolvedValue({ data: { ...jordan, client_email: 'jordan.lee@brooklynevents.example' }, error: null });
    fireEvent.click(screen.getByText('Email').closest('button') as HTMLButtonElement);
    await screen.findByTestId('quote-recipient-changed');
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it('Copy checks the client too: another one saved since, nothing is published or copied', async () => {
    open();
    await ready();
    mocks.contact.mockResolvedValue({ data: { ...jordan, client_name: 'Emma Carter', client_email: 'emma.carter@example.com' }, error: null });
    fireEvent.click(button('Copy message & link'));
    await screen.findByTestId('quote-recipient-changed');
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.markSent).not.toHaveBeenCalled();
  });

  // Codex 11-22: the price too, not only on open. A draft with no link has
  // no version for the server to refuse, so a sheet opened at $1,000 could
  // send $1,000 after another device saved $1,500.
  describe('the terms saved now, read again right before a send (Codex 11-22)', () => {
    const CHANGED = 'This quote changed meanwhile (another client, or another admin). Close this and open the quote again.';
    const draft = { ...quote, status: 'DRAFT', total: 1000 };
    const openDraft = () => {
      mocks.state.mockResolvedValue({ data: { link: null, activity: [] }, error: null });
      mocks.contact.mockResolvedValue({ data: { ...jordan, total: 1000 }, error: null });
      return render(<QuoteShareModal isOpen quote={draft} bandId="00000000-0000-0000-0000-000000000001" bandName="The Night Shift" onClose={() => {}} />);
    };

    it('the total changed since the sheet opened: Copy publishes and copies nothing, and the sheet says the quote changed', async () => {
      openDraft();
      await ready();
      mocks.contact.mockResolvedValue({ data: { ...jordan, total: 1500 }, error: null });
      fireEvent.click(button('Copy message & link'));
      expect((await screen.findByRole('alert')).textContent).toBe(CHANGED);
      expect(mocks.publish).not.toHaveBeenCalled();
      expect(mocks.markSent).not.toHaveBeenCalled();
      expect(mocks.writeText).not.toHaveBeenCalled();
      // The same client: this is not the "now goes to" notice.
      expect(screen.queryByTestId('quote-recipient-changed')).toBeNull();
    });

    it('the total changed since the sheet opened: WhatsApp opens nothing', async () => {
      openDraft();
      await ready();
      mocks.contact.mockResolvedValue({ data: { ...jordan, total: 1500 }, error: null });
      fireEvent.click(button('WhatsApp'));
      expect((await screen.findByRole('alert')).textContent).toBe(CHANGED);
      expect(mocks.publish).not.toHaveBeenCalled();
      expect(openExternal).not.toHaveBeenCalled();
    });

    it('the currency changed since the sheet opened: no email, nothing published', async () => {
      openDraft();
      await ready();
      mocks.contact.mockResolvedValue({ data: { ...jordan, total: 1000, currency: 'EUR' }, error: null });
      fireEvent.click(screen.getByText('Email').closest('button') as HTMLButtonElement);
      expect((await screen.findByRole('alert')).textContent).toBe(CHANGED);
      expect(mocks.publish).not.toHaveBeenCalled();
      expect(mocks.email).not.toHaveBeenCalled();
    });

    it('unchanged terms still send: published once (no link read: version 0), recorded and copied', async () => {
      openDraft();
      await ready();
      fireEvent.click(button('Copy message & link'));
      await waitFor(() => expect(mocks.markSent).toHaveBeenCalledTimes(1));
      expect(mocks.publish).toHaveBeenCalledTimes(1);
      expect(mocks.publish.mock.calls[0][5]).toBe(0);
      expect(mocks.writeText).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('the summary names the client it was made for, for the server to check', async () => {
    open();
    await ready();
    fireEvent.click(button('Copy message & link'));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
    expect(mocks.publish.mock.calls[0][1].client).toEqual({ name: 'Jordan Lee', email: 'jordan@brooklynevents.example' });
  });
});
