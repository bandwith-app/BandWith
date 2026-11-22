/**
 * 183 round 3 / 4: a quote given to a new client gets a new, empty link.
 * Opening the share sheet publishes nothing (round 4): a send (Copy,
 * WhatsApp, SMS, email) publishes the sheet's version on the link and the
 * version it read, and hands the link out only once that worked. It never
 * shares from a copy of the quote made for another client, or with an older
 * price.
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
  // The new client's link: made by the server when the client changed, nothing on it yet.
  getQuoteLinkState: vi.fn(async () => ({
    data: { link: { id: 'link-b', token: 'b'.repeat(64), status: 'draft', lang: 'en', revoked_at: null, version: 2 }, activity: [] },
    error: null,
  })),
  getQuoteContact: mocks.contact,
  publishQuoteLink: mocks.publish,
  sendQuoteEmail: vi.fn(async () => ({ ok: true })),
  markQuoteLinkSent: mocks.markSent,
}));

import { QuoteShareModal } from '../QuoteShareModal';
import { openExternal } from '@/lib/nativeFiles';

const quote = {
  id: '00000000-0000-0000-0000-000000000042', quoteNumber: 'Q-2027-0042', status: 'DRAFT', clientName: 'Jordan Lee',
  clientEmail: 'jordan@brooklynevents.example', clientPhone: '+1 646 555 0199', currency: 'USD', total: 4200,
  eventName: 'Rooftop wedding', eventDate: '2099-06-12', musicians: [], customItems: [],
} as any;
const jordan = { client_name: 'Jordan Lee', client_email: 'jordan@brooklynevents.example', client_phone: '+1 646 555 0199', total: 4200, currency: 'USD' };

const button = (title: string) => screen.getByText(title).closest('button') as HTMLButtonElement;
const bySubtitle = (subtitle: string) => screen.getByText(subtitle).closest('button') as HTMLButtonElement;
// A link channel is off: not offered at all, or offered but disabled.
const linkOff = (title: string) => {
  const b = screen.queryByText(title)?.closest('button') as HTMLButtonElement | null | undefined;
  return !b || b.disabled;
};
const open = () =>
  render(<QuoteShareModal isOpen quote={quote} bandId="00000000-0000-0000-0000-000000000001" bandName="The Night Shift" onClose={() => {}} />);

const ready = () => waitFor(() => expect(button('Copy message & link').disabled).toBe(false), { timeout: 20_000 });

beforeEach(() => {
  window.open = vi.fn(() => null) as never;
  mocks.generate.mockImplementation(async () => ({ pdfBlob: new Blob(['%PDF']), pdfFile: new File(['%PDF'], 'q.pdf'), pageDataUrls: [], fileName: 'q.pdf' }));
  mocks.markSent.mockResolvedValue({ data: 'sent', error: null });
  mocks.contact.mockResolvedValue({ data: jordan, error: null });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: mocks.writeText }, configurable: true });
});
afterEach(() => {
  cleanup();
  for (const m of Object.values(mocks)) m.mockClear();
});

describe('QuoteShareModal: a link goes out only after its publish', () => {
  it('opening the sheet publishes nothing; Copy publishes on the version read, then copies that link and records it', async () => {
    let finish: (v: unknown) => void = () => {};
    mocks.publish.mockImplementation(() => new Promise((r) => { finish = r; }));
    open();
    await ready();
    await new Promise((r) => setTimeout(r, 300));
    expect(mocks.publish).not.toHaveBeenCalled();

    fireEvent.click(button('Copy message & link'));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
    expect(mocks.publish.mock.calls[0][4]).toBe(TOKEN_B);
    expect(mocks.publish.mock.calls[0][5]).toBe(2); // the version the admin sees
    // Publishing: nothing on the clipboard yet, and nothing else can go.
    expect(mocks.writeText).not.toHaveBeenCalled();
    expect(button('Copy message & link').disabled).toBe(true);

    finish({ data: { token: TOKEN_B, status: 'draft', version: 3, revoked: false }, error: null });
    await waitFor(() => expect(mocks.markSent).toHaveBeenCalled());
    expect(String((mocks.writeText.mock.calls[0] as unknown[])[0])).toContain(TOKEN_B);
    expect(mocks.markSent.mock.calls[0][3]).toEqual({ token: TOKEN_B, version: 3 });
  });

  it('a failed publish copies nothing and the admin can try again', async () => {
    mocks.publish.mockResolvedValue({ data: null, error: new Error('network') });
    open();
    await ready();
    fireEvent.click(button('Copy message & link'));
    await screen.findByText('The client page could not be updated. Try again.');
    expect(mocks.writeText).not.toHaveBeenCalled();
    expect(mocks.markSent).not.toHaveBeenCalled();
    await waitFor(() => expect(button('Copy message & link').disabled).toBe(false));
  });

  it('another version published meanwhile: nothing goes out, the sheet asks to open the quote again', async () => {
    mocks.publish.mockResolvedValue({ data: null, error: new Error('BW_VERSION_CHANGED: another version was published meanwhile') });
    open();
    await ready();
    fireEvent.click(screen.getAllByText('Message with the quote link')[0].closest('button') as HTMLButtonElement);
    await screen.findAllByText(/This quote changed meanwhile/);
    // At most the blank window of the tap: no address with the link was opened.
    expect((window.open as unknown as ReturnType<typeof vi.fn>).mock.calls.every((c) => !c[0])).toBe(true);
    expect(openExternal).not.toHaveBeenCalled();
    expect(mocks.markSent).not.toHaveBeenCalled();
    expect(linkOff('Copy message & link')).toBe(true);
  });

  it('opened from a copy of the quote made for the previous client: shares nothing, asks to open it again', async () => {
    // Saved now: Jordan. This sheet got Emma's quote (another admin changed the client meanwhile).
    render(
      <QuoteShareModal
        isOpen
        quote={{ ...quote, clientName: 'Emma Carter', clientEmail: 'emma.carter@example.com', clientPhone: '+1 917 555 0101' }}
        bandId="00000000-0000-0000-0000-000000000001"
        bandName="The Night Shift"
        onClose={() => {}}
      />,
    );
    await screen.findByText(/This quote changed meanwhile/, undefined, { timeout: 20_000 });
    for (const title of ['Copy message & link', 'Message with the quote link']) expect(linkOff(title)).toBe(true);
    expect(bySubtitle('Native share sheet').disabled).toBe(true);
    expect(bySubtitle('Save to your computer').disabled).toBe(true);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('opened with an older price than the one saved: shares nothing', async () => {
    mocks.contact.mockResolvedValue({ data: { ...jordan, total: 4600 }, error: null });
    open();
    await screen.findByText(/This quote changed meanwhile/, undefined, { timeout: 20_000 });
    expect(linkOff('Copy message & link')).toBe(true);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('a send not recorded because another version went out meanwhile says so', async () => {
    mocks.publish.mockResolvedValue({ data: { token: TOKEN_B, status: 'draft', version: 3, revoked: false }, error: null });
    mocks.markSent.mockResolvedValue({ data: null, error: new Error('BW_VERSION_CHANGED: the quote was updated after this was sent') });
    open();
    await ready();
    fireEvent.click(button('Copy message & link'));
    await screen.findByText(/so this send was not recorded/);
    expect(linkOff('Copy message & link')).toBe(true);
  });

  it('switching the language publishes nothing', async () => {
    open();
    await ready();
    fireEvent.click(screen.getByText('IT'));
    await new Promise((r) => setTimeout(r, 500));
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
