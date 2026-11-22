/**
 * Inbox → RSVP: answering an invitation from the inbox closes the inbox and
 * opens the RSVP sheet in one go. The RSVP sheet has its own focus trap, so
 * it takes the focus over (and the bell as its opener): focus never lands on
 * the bell behind it, Tab stays in the sheet, and closing it goes back to the
 * bell.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/app/hooks/useLineupSoFar', () => ({ useLineupSoFar: () => null }));
vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { BwSheet } from '@/app/components/bw/Screen';
import { EventRSVPSheet } from '../EventRSVPSheet';
import type { Notification } from '@/lib/services/notifications';

afterEach(cleanup);

const invite = {
  id: 'n1',
  user_id: 'u1',
  type: 'event_invite',
  title: 'Gig invitation',
  data: { event_id: 'e1', event_title: 'Rooftop Session', venue: 'Brooklyn Bowl', event_date: '2026-12-05', event_type: 'gig' },
  read: false,
  created_at: '2026-11-22T10:00:00Z',
} as unknown as Notification;

const Page: React.FC = () => {
  const [inbox, setInbox] = useState(false);
  const [rsvp, setRsvp] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setInbox(true)}>
        Bell
      </button>
      {/* Stands in for the inbox: a trapped layer whose RSVP closes it and opens the sheet. */}
      <BwSheet open={inbox} onClose={() => setInbox(false)} title="Notifications">
        <button
          type="button"
          onClick={() => {
            setInbox(false);
            setRsvp(true);
          }}
        >
          Answer
        </button>
      </BwSheet>
      {rsvp && <EventRSVPSheet notification={invite} onAccept={async () => {}} onDecline={async () => {}} onClose={() => setRsvp(false)} />}
    </>
  );
};

describe('inbox → RSVP', () => {
  it('the RSVP sheet takes the focus over: never the bell, Tab stays in it, closing goes back to the bell', async () => {
    render(<Page />);
    const bell = screen.getByRole('button', { name: 'Bell' });
    bell.focus();
    fireEvent.click(bell);
    const inbox = await screen.findByRole('dialog', { name: 'Notifications' });
    await waitFor(() => expect(inbox.contains(document.activeElement)).toBe(true));
    let bellFocused = 0;
    bell.addEventListener('focus', () => bellFocused++);
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    const sheet = await screen.findByRole('dialog', { name: /RSVP/ });
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    expect(bellFocused).toBe(0);
    const stops = Array.from(sheet.querySelectorAll<HTMLElement>('button:not([disabled]), textarea, input, [tabindex="0"]'));
    stops[stops.length - 1].focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(sheet.contains(document.activeElement)).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: /close/i })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /RSVP/ })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(bell));
  });
});
