/**
 * 183 round 5 (Codex review of 8f5922d7): the composer says who the reply
 * goes to from the conversation it loaded (the link's recipient), not from
 * the copy of the quote the screen got. If that recipient changes while a
 * reply is being written (the same link, a corrected name or email), a
 * banner says so and nothing is sent until the admin confirms.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ state: vi.fn(), reply: vi.fn(), email: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/lib/services/quoteLinks', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/quoteLinks')>()),
  getQuoteLinkState: mocks.state,
  replyToQuoteClient: mocks.reply,
  sendQuoteEmail: mocks.email,
}));

import { QuoteClientLink } from '../QuoteClientLink';

const TOKEN_B = 'b'.repeat(64);
// The screen's copy of the quote still says Emma (opened before the client changed).
const quote = { id: '00000000-0000-0000-0000-000000000042', quoteNumber: 'Q-2027-0042', clientName: 'Emma Carter', clientEmail: 'emma.carter@example.com', status: 'SENT' } as any;
const at = (min: number) => new Date(Date.UTC(2026, 10, 20, 15, min)).toISOString();
const linkB = { id: 'link-b', quote_id: quote.id, token: TOKEN_B, lang: 'en', status: 'sent', version: 2, revoked_at: null, recipient_name: 'Jordan Lee', recipient_email: 'jordan@brooklynevents.example' };
const activity = [
  { id: 'a1', kind: 'client_message', body: 'Can you do two sets?', channel: null, version: 1, created_at: at(1), link_id: 'link-a' },
  { id: 'a2', kind: 'link_rotated', body: 'recipient_changed', channel: null, version: 1, created_at: at(4), link_id: 'link-b' },
  { id: 'a3', kind: 'client_message', body: 'Is parking included?', channel: null, version: 2, created_at: at(9), link_id: 'link-b' },
];

afterEach(() => {
  cleanup();
  mocks.state.mockReset();
  mocks.reply.mockReset();
  mocks.email.mockReset();
});

const typeDraft = async (text: string) =>
  fireEvent.change(await screen.findByLabelText('Reply to the client'), { target: { value: text } });

describe('QuoteClientLink round 5: the conversation\'s recipient', () => {
  it('"You\'re writing to" and the email line come from the loaded link, not the quote copy', async () => {
    mocks.state.mockResolvedValue({ data: { link: linkB, activity }, error: null });
    render(<QuoteClientLink quote={quote} onSend={() => {}} notify={vi.fn()} />);
    expect(await screen.findByText('You’re writing to Jordan Lee')).toBeTruthy();
    expect(screen.getByText('Your reply shows on the client’s page, and jordan@brooklynevents.example gets it by email.')).toBeTruthy();
    expect(screen.queryByText('You’re writing to Emma Carter')).toBeNull();
  });

  it('the recipient is corrected while a reply is written: a banner, no send until confirmed', async () => {
    mocks.state.mockResolvedValue({ data: { link: linkB, activity }, error: null });
    mocks.reply.mockResolvedValue({ data: 'ok', error: null });
    mocks.email.mockResolvedValue({ ok: true });
    const view = render(<QuoteClientLink quote={quote} onSend={() => {}} notify={vi.fn()} refreshKey={0} />);
    await typeDraft('Parking is on us.');
    // Same link, the email fixed by another admin.
    mocks.state.mockResolvedValue({ data: { link: { ...linkB, recipient_email: 'jordan.lee@brooklynevents.example' }, activity }, error: null });
    await act(async () => { view.rerender(<QuoteClientLink quote={quote} onSend={() => {}} notify={vi.fn()} refreshKey={1} />); });

    const banner = await screen.findByTestId('quote-reply-readdressed');
    expect(banner.textContent).toContain('This conversation is now with Jordan Lee · jordan.lee@brooklynevents.example');
    const send = screen.getByText('Send reply').closest('button') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(mocks.reply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Write to Jordan Lee'));
    expect(screen.queryByTestId('quote-reply-readdressed')).toBeNull();
    fireEvent.click(screen.getByText('Send reply'));
    await waitFor(() => expect(mocks.reply).toHaveBeenCalledWith(quote.id, 'Parking is on us.', TOKEN_B));
  });
});
