/**
 * 183 round 3: a quote given to a new client gets a new, empty link. The
 * share sheet hands out no link (Copy, WhatsApp, SMS, email) until its
 * version is published on that very link, and never shares from a copy of
 * the quote made for another client.
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
    data: { link: { id: 'link-b', token: 'b'.repeat(64), status: 'draft', lang: 'en', revoked_at: null }, activity: [] },
    error: null,
  })),
  getQuoteContact: mocks.contact,
  publishQuoteLink: mocks.publish,
  sendQuoteEmail: vi.fn(async () => ({ ok: true })),
  markQuoteLinkSent: mocks.markSent,
}));

import { QuoteShareModal } from '../QuoteShareModal';

const quote = {
  id: '00000000-0000-0000-0000-000000000042', quoteNumber: 'Q-2027-0042', status: 'DRAFT', clientName: 'Jordan Lee',
  clientEmail: 'jordan@brooklynevents.example', clientPhone: '+1 646 555 0199', currency: 'USD', total: 4200,
  eventName: 'Rooftop wedding', eventDate: '2099-06-12', musicians: [], customItems: [],
} as any;
const jordan = { client_name: 'Jordan Lee', client_email: 'jordan@brooklynevents.example', client_phone: '+1 646 555 0199' };

const button = (title: string) => screen.getByText(title).closest('button') as HTMLButtonElement;
const bySubtitle = (subtitle: string) => screen.getByText(subtitle).closest('button') as HTMLButtonElement;
// A link channel is off: not offered at all, or offered but disabled.
const linkOff = (title: string) => {
  const b = screen.queryByText(title)?.closest('button') as HTMLButtonElement | null | undefined;
  return !b || b.disabled;
};
const open = () =>
  render(<QuoteShareModal isOpen quote={quote} bandId="00000000-0000-0000-0000-000000000001" bandName="The Night Shift" onClose={() => {}} />);

beforeEach(() => {
  mocks.generate.mockImplementation(async () => ({ pdfBlob: new Blob(['%PDF']), pdfFile: new File(['%PDF'], 'q.pdf'), pageDataUrls: [], fileName: 'q.pdf' }));
  mocks.markSent.mockResolvedValue({ data: 'sent', error: null });
  mocks.contact.mockResolvedValue({ data: jordan, error: null });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: mocks.writeText }, configurable: true });
});
afterEach(() => {
  cleanup();
  for (const m of Object.values(mocks)) m.mockClear();
});

describe('QuoteShareModal: a new client’s link is shared only once published', () => {
  it('keeps Copy and WhatsApp off until the publish on that link succeeded, then records that link and version', async () => {
    let finish: (v: unknown) => void = () => {};
    mocks.publish.mockImplementation(() => new Promise((r) => { finish = r; }));
    open();
    await waitFor(() => expect(mocks.publish).toHaveBeenCalled(), { timeout: 20_000 });
    expect(mocks.publish.mock.calls[0][4]).toBe(TOKEN_B);
    // Publishing: nothing to share yet, and a tap puts nothing on the clipboard.
    expect(button('Copy message & link').disabled).toBe(true);
    for (const b of screen.getAllByText('Message with the quote link')) expect((b.closest('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button('Copy message & link'));
    expect(mocks.writeText).not.toHaveBeenCalled();

    finish({ data: { token: TOKEN_B, status: 'draft', version: 3, revoked: false }, error: null });
    await waitFor(() => expect(button('Copy message & link').disabled).toBe(false));
    fireEvent.click(button('Copy message & link'));
    await waitFor(() => expect(mocks.markSent).toHaveBeenCalled());
    expect(String((mocks.writeText.mock.calls[0] as unknown[])[0])).toContain(TOKEN_B);
    expect(mocks.markSent.mock.calls[0][3]).toEqual({ token: TOKEN_B, version: 3 });
  });

  it('a failed publish keeps the link channels off and offers Try again', async () => {
    mocks.publish.mockResolvedValue({ data: null, error: new Error('network') });
    open();
    await screen.findByText('Try again', undefined, { timeout: 20_000 });
    expect(button('Copy message & link').disabled).toBe(true);
    mocks.publish.mockResolvedValue({ data: { token: TOKEN_B, status: 'draft', version: 3, revoked: false }, error: null });
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(button('Copy message & link').disabled).toBe(false));
  });

  it('opened from a copy of the quote made for the previous client: shares nothing, asks to open it again', async () => {
    mocks.publish.mockResolvedValue({ data: { token: TOKEN_B, status: 'draft', version: 3, revoked: false }, error: null });
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
    await new Promise((r) => setTimeout(r, 300));
    expect(mocks.publish).not.toHaveBeenCalled();
    // No link channel, and none of the PDF's (Emma's quote) either.
    for (const title of ['Copy message & link', 'Message with the quote link']) expect(linkOff(title)).toBe(true);
    expect(bySubtitle('Native share sheet').disabled).toBe(true);
    expect(bySubtitle('Save to your computer').disabled).toBe(true);
  });

  it('a send not recorded because another version went out meanwhile says so', async () => {
    mocks.publish.mockResolvedValue({ data: { token: TOKEN_B, status: 'draft', version: 3, revoked: false }, error: null });
    mocks.markSent.mockResolvedValue({ data: null, error: new Error('BW_VERSION_CHANGED: the quote was updated after this was sent') });
    open();
    await waitFor(() => expect(button('Copy message & link').disabled).toBe(false), { timeout: 20_000 });
    fireEvent.click(button('Copy message & link'));
    await screen.findByText(/so this send was not recorded/);
    expect(linkOff('Copy message & link')).toBe(true);
  });
});
