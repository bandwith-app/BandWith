/**
 * 183 round 4: a draft reply belongs to the client it was started for. If
 * the quote goes to another client while it is being written, it is never
 * sent to them: the admin can copy or discard it. The conversation shows
 * where the current client's part starts, and who a reply goes to.
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
const TOKEN_C = 'c'.repeat(64);
const quote = { id: '00000000-0000-0000-0000-000000000042', quoteNumber: 'Q-2027-0042', clientName: 'Jordan Lee', clientEmail: 'jordan@brooklynevents.example', status: 'SENT' } as any;
const at = (min: number) => new Date(Date.UTC(2026, 10, 20, 15, min)).toISOString();
const linkB = { id: 'link-b', quote_id: quote.id, token: TOKEN_B, lang: 'en', status: 'sent', version: 1, revoked_at: null };
const linkC = { ...linkB, id: 'link-c', token: TOKEN_C, status: 'draft' };
const activity = [
  { id: 'a1', kind: 'client_message', body: 'Can you do two sets?', channel: null, version: 1, created_at: at(1), link_id: 'link-a' },
  { id: 'a2', kind: 'link_rotated', body: 'recipient_changed', channel: null, version: 1, created_at: at(4), link_id: 'link-b' },
  { id: 'a3', kind: 'client_message', body: 'Is parking included?', channel: null, version: 1, created_at: at(9), link_id: 'link-b' },
];

afterEach(() => {
  cleanup();
  mocks.state.mockReset();
  mocks.reply.mockReset();
  mocks.email.mockReset();
});

const typeDraft = async (text: string) =>
  fireEvent.change(await screen.findByLabelText('Reply to the client'), { target: { value: text } });

describe('QuoteClientLink: the draft stays with its client', () => {
  it('the quote goes to another client mid-draft: says so, never sends, Copy and Discard', async () => {
    mocks.state.mockResolvedValue({ data: { link: linkB, activity }, error: null });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const view = render(<QuoteClientLink quote={quote} onSend={() => {}} notify={vi.fn()} refreshKey={0} />);
    await typeDraft('Parking is on us.');

    // Another admin gives the quote to a new client: the next refresh has link C.
    mocks.state.mockResolvedValue({ data: { link: linkC, activity }, error: null });
    await act(async () => { view.rerender(<QuoteClientLink quote={quote} onSend={() => {}} notify={vi.fn()} refreshKey={1} />); });

    expect(await screen.findByText('The recipient changed: this draft was for the previous client.')).toBeTruthy();
    // The new client's link waits to be published: no way to send the draft on it.
    const send = screen.queryByText('Send reply')?.closest('button') as HTMLButtonElement | undefined;
    if (send) {
      expect(send.disabled).toBe(true);
      fireEvent.click(send);
    }
    expect(mocks.reply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Parking is on us.'));
    fireEvent.click(screen.getByText('Discard'));
    expect(screen.queryByText('The recipient changed: this draft was for the previous client.')).toBeNull();
  });

  it('a reply goes out on the link it was written on, its email too', async () => {
    mocks.state.mockResolvedValue({ data: { link: linkB, activity }, error: null });
    mocks.reply.mockResolvedValue({ data: 'ok', error: null });
    mocks.email.mockResolvedValue({ ok: true });
    render(<QuoteClientLink quote={quote} onSend={() => {}} notify={vi.fn()} />);
    await typeDraft('Parking is on us.');
    fireEvent.click(screen.getByText('Send reply'));
    await waitFor(() => expect(mocks.email).toHaveBeenCalled());
    expect(mocks.reply).toHaveBeenCalledWith(quote.id, 'Parking is on us.', TOKEN_B);
    expect(mocks.email).toHaveBeenCalledWith(quote.id, 'reply', 'link-b');
  });

  it('a divider where the current client’s conversation starts, and who the reply goes to', async () => {
    mocks.state.mockResolvedValue({ data: { link: linkB, activity }, error: null });
    render(<QuoteClientLink quote={quote} onSend={() => {}} />);
    await screen.findByText('Is parking included?');
    const divider = screen.getByRole('separator');
    expect(divider.textContent).toContain('From here: Jordan Lee');
    const items = [...document.querySelectorAll('ol > li')].map((li) => li.textContent || '');
    expect(items.findIndex((x) => x.includes('two sets'))).toBeLessThan(items.findIndex((x) => x.includes('From here')));
    expect(items.findIndex((x) => x.includes('From here'))).toBeLessThan(items.findIndex((x) => x.includes('parking')));
    expect(screen.getByText('You’re writing to Jordan Lee')).toBeTruthy();
  });

  // Round 6 (Codex, QuoteClientLink.tsx:268): "New link" for the same client
  // renews the token of the same link: the draft follows it and goes out on
  // the new token (it used to go on the old one and be refused).
  it('the link renewed mid-draft (same client): the reply goes out on the new token', async () => {
    mocks.state.mockResolvedValue({ data: { link: linkB, activity }, error: null });
    mocks.reply.mockResolvedValue({ data: 'ok', error: null });
    mocks.email.mockResolvedValue({ ok: true });
    const view = render(<QuoteClientLink quote={quote} onSend={() => {}} notify={vi.fn()} refreshKey={0} />);
    await typeDraft('Parking is on us.');
    const renewed = { ...linkB, token: 'd'.repeat(64) };
    mocks.state.mockResolvedValue({ data: { link: renewed, activity }, error: null });
    await act(async () => { view.rerender(<QuoteClientLink quote={quote} onSend={() => {}} notify={vi.fn()} refreshKey={1} />); });
    await waitFor(() => expect(screen.queryByText('The recipient changed: this draft was for the previous client.')).toBeNull());
    fireEvent.click(screen.getByText('Send reply'));
    await waitFor(() => expect(mocks.reply).toHaveBeenCalled());
    expect(mocks.reply).toHaveBeenCalledWith(quote.id, 'Parking is on us.', 'd'.repeat(64));
  });

  it('a reply refused because the link changed: the draft stays, the text says to check it and send again', async () => {
    const { linkChangedError } = { linkChangedError: Object.assign(new Error('BW_LINK_CHANGED: this conversation is with a client the quote is no longer for'), { code: 'P0001' }) };
    mocks.state.mockResolvedValue({ data: { link: linkB, activity }, error: null });
    mocks.reply.mockResolvedValue({ data: null, error: linkChangedError });
    const notify = vi.fn();
    render(<QuoteClientLink quote={quote} onSend={() => {}} notify={notify} />);
    await typeDraft('Parking is on us.');
    fireEvent.click(screen.getByText('Send reply'));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('The client link changed meanwhile. Your reply was not sent: check it and send it again.', 'error'));
    expect((screen.getByLabelText('Reply to the client') as HTMLTextAreaElement).value).toBe('Parking is on us.');
  });
});

