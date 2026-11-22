/**
 * 183 round 5 (Codex review of 8f5922d7): the share sheet sends on what it
 * opened with. A sheet that read no link publishes with version 0, so a link
 * made since (another admin) refuses it. Right before WhatsApp, SMS or
 * email the client saved now is read again: another contact than the sheet
 * shows, and nothing goes out until the admin taps again.
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

  it('the phone changed since the sheet opened: WhatsApp sends nothing, says who it goes to now, the second tap sends there', async () => {
    open();
    await ready();
    // Saved now: Jordan's phone written again (another admin fixed it).
    mocks.contact.mockResolvedValue({ data: { ...jordan, client_phone: '+1 646 555 0123' }, error: null });
    fireEvent.click(button('WhatsApp'));
    const notice = await screen.findByTestId('quote-recipient-changed');
    expect(notice.textContent).toContain('This quote now goes to Jordan Lee · jordan@brooklynevents.example');
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Send to Jordan Lee'));
    await waitFor(() => expect(openExternal).toHaveBeenCalled());
    expect(String(vi.mocked(openExternal).mock.calls[0][0])).toContain('wa.me/16465550123');
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it('the email changed since the sheet opened: no email, the notice; the second tap emails', async () => {
    open();
    await ready();
    mocks.contact.mockResolvedValue({ data: { ...jordan, client_email: 'jordan.lee@brooklynevents.example' }, error: null });
    fireEvent.click(screen.getByText('Email').closest('button') as HTMLButtonElement);
    await screen.findByTestId('quote-recipient-changed');
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Send to Jordan Lee'));
    await waitFor(() => expect(mocks.email).toHaveBeenCalledTimes(1));
    await screen.findByText('Email sent to jordan.lee@brooklynevents.example');
  });
});
