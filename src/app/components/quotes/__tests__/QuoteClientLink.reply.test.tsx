/**
 * 183 round 3: a conversation belongs to one link (one client). A message
 * from the previous client's link is labelled so, and a reply written on a
 * link that was replaced meanwhile is not sent and says why.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ state: vi.fn(), reply: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/lib/services/quoteLinks', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/quoteLinks')>()),
  getQuoteLinkState: mocks.state,
  replyToQuoteClient: mocks.reply,
}));

import { QuoteClientLink } from '../QuoteClientLink';

const TOKEN_B = 'b'.repeat(64);
const quote = { id: '00000000-0000-0000-0000-000000000042', quoteNumber: 'Q-2027-0042', clientName: 'Jordan Lee', clientEmail: 'jordan@brooklynevents.example', status: 'SENT' } as any;
const at = (min: number) => new Date(Date.UTC(2026, 10, 20, 15, min)).toISOString();
const state = {
  link: { id: 'link-b', quote_id: quote.id, token: TOKEN_B, lang: 'en', status: 'sent', version: 1, revoked_at: null },
  activity: [
    // Written on the previous client's link, after the link_id column existed.
    { id: 'a1', kind: 'client_message', body: 'Can you do two sets?', channel: null, version: 1, created_at: at(1), link_id: 'link-a' },
    { id: 'a2', kind: 'sent', body: null, channel: 'copy', version: 1, created_at: at(5), link_id: 'link-b' },
    { id: 'a3', kind: 'client_message', body: 'Is parking included?', channel: null, version: 1, created_at: at(9), link_id: 'link-b' },
  ],
};

afterEach(() => {
  cleanup();
  mocks.state.mockReset();
  mocks.reply.mockReset();
});

describe('QuoteClientLink: one conversation per client', () => {
  it('labels the previous client’s message by its link, the current one by name', async () => {
    mocks.state.mockResolvedValue({ data: state, error: null });
    render(<QuoteClientLink quote={quote} onSend={() => {}} />);
    const old = await screen.findByText('Can you do two sets?');
    expect(old.textContent).toMatch(/Previous client/);
    expect(screen.getByText('Is parking included?').textContent).toMatch(/Jordan Lee/);
  });

  it('a reply on a link replaced meanwhile: not sent, says why, reloads', async () => {
    mocks.state.mockResolvedValue({ data: state, error: null });
    mocks.reply.mockResolvedValue({ data: null, error: new Error('BW_LINK_CHANGED: this conversation is with a client the quote is no longer for') });
    const notify = vi.fn();
    render(<QuoteClientLink quote={quote} onSend={() => {}} notify={notify} />);
    fireEvent.change(await screen.findByLabelText('Reply to the client'), { target: { value: 'Yes, two sets.' } });
    fireEvent.click(screen.getByText('Send reply'));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(mocks.reply).toHaveBeenCalledWith(quote.id, 'Yes, two sets.', TOKEN_B);
    expect(notify.mock.calls[0][0]).toMatch(/previous client\. Your reply was not sent/);
    expect(notify.mock.calls[0][1]).toBe('error');
    await waitFor(() => expect(mocks.state.mock.calls.length).toBeGreaterThan(1));
  });
});
