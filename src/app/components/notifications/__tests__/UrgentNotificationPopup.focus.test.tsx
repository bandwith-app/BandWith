/**
 * The urgent pop-up (a gig invitation, a rehearsal poll) draws above an open
 * sheet. Keyboard users reach it: it is a modal alert dialog that takes the
 * focus and holds it, and gives it back to what had it when it goes. It
 * carries data-bw-urgent, which #271's useLayerOpen excludes so the pop-up
 * does not wait for itself.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { BwSheet } from '@/app/components/bw/Screen';
import { UrgentNotificationPopup } from '../UrgentNotificationPopup';
import type { Notification } from '@/lib/services/notifications';

afterEach(cleanup);

const tab = (shift = false) => fireEvent.keyDown(document.activeElement || document.body, { key: 'Tab', shiftKey: shift });

const invite = {
  id: 'n1',
  user_id: 'u1',
  type: 'event_invite',
  title: 'Gig invitation',
  data: { event_title: 'Rooftop Session', venue: 'Brooklyn Bowl', event_type: 'gig' },
  read: false,
  created_at: '2026-11-22T10:00:00Z',
} as unknown as Notification;

const OverSheet: React.FC = () => {
  const [urgent, setUrgent] = useState(false);
  return (
    <>
      <BwSheet open onClose={() => {}} title="Create" footer={<button type="button">Create gig</button>}>
        <button type="button" onClick={() => setUrgent(true)}>
          New gig
        </button>
      </BwSheet>
      {urgent && <UrgentNotificationPopup notification={invite} onOpen={() => setUrgent(false)} onDismiss={() => setUrgent(false)} />}
    </>
  );
};

describe('the urgent pop-up over an open sheet', () => {
  it('is a modal alert dialog named by its title, marked data-bw-urgent for #271', async () => {
    render(<OverSheet />);
    fireEvent.click(screen.getByRole('button', { name: 'New gig' }));
    const popup = await screen.findByRole('alertdialog', { name: /Rooftop Session/ });
    expect(popup.getAttribute('aria-modal')).toBe('true');
    expect(popup.hasAttribute('data-bw-urgent')).toBe(true);
  });

  it('takes the focus from the sheet, holds it on Tab, and gives it back when dismissed', async () => {
    render(<OverSheet />);
    const sheet = screen.getByRole('dialog', { name: 'Create' });
    await waitFor(() => expect(document.activeElement).toBe(sheet));
    const opener = screen.getByRole('button', { name: 'New gig' });
    opener.focus();
    fireEvent.click(opener);
    const popup = await screen.findByRole('alertdialog');
    await waitFor(() => expect(popup.contains(document.activeElement)).toBe(true));
    const controls = Array.from(popup.querySelectorAll<HTMLElement>('button, [role="button"][tabindex="0"]'));
    controls[controls.length - 1].focus();
    tab();
    expect(popup.contains(document.activeElement)).toBe(true);
    tab(true);
    expect(popup.contains(document.activeElement)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss alert' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
