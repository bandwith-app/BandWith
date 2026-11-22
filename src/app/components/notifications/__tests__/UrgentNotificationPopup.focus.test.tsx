/**
 * The urgent pop-up (a gig invitation, a rehearsal poll) draws above an open
 * sheet. Keyboard users reach it: it is a modal alert dialog that takes the
 * focus and holds it, and gives it back to what had it when it goes. It
 * carries data-bw-urgent, which #271's useLayerOpen excludes so the pop-up
 * does not wait for itself. Escape (and Android Back) close the pop-up, not
 * the sheet beneath it; its Tab cycle leaves out the Duo rail's actions (they
 * belong to the sheet). While a text field or an open picker has the focus,
 * the app keeps it waiting (useTypingFocus in AuthenticatedApp) and shows it
 * when the field or picker lets go; and a pop-up that goes because a field
 * on the other Duo page took the focus never pulls the focus back.
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
import { useTypingFocus } from '@/lib/focusTrap';
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

/** Like AuthenticatedApp: the pop-up shows only while the focus is not busy (useTypingFocus). */
const App: React.FC<{ urgent: boolean; picker?: boolean; withOpener?: boolean }> = ({ urgent, picker, withOpener }) => {
  const typing = useTypingFocus();
  const [shown, setShown] = useState(false);
  const on = urgent || shown;
  return (
    <>
      <BwSheet open onClose={() => {}} title="Create" footer={<button type="button">Create gig</button>}>
        <input aria-label="Gig title" />
        <button type="button">New gig</button>
        {withOpener && (
          <button type="button" onClick={() => setShown(true)}>
            Show alert
          </button>
        )}
        {picker && (
          <div data-radix-popper-content-wrapper="">
            <div role="listbox" aria-label="Start time">
              <div role="option" aria-selected="false" tabIndex={-1}>
                8:00 PM
              </div>
            </div>
          </div>
        )}
      </BwSheet>
      {on && !typing && <UrgentNotificationPopup notification={invite} onOpen={() => setShown(false)} onDismiss={() => setShown(false)} />}
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

  it('Escape closes the pop-up, not the sheet beneath it', async () => {
    const closeSheet = vi.fn();
    const dismiss = vi.fn();
    render(
      <>
        <BwSheet open onClose={closeSheet} title="Create" footer={<button type="button">Create gig</button>}>
          <button type="button">New gig</button>
        </BwSheet>
        <UrgentNotificationPopup notification={invite} onOpen={() => {}} onDismiss={dismiss} />
      </>,
    );
    const popup = await screen.findByRole('alertdialog');
    await waitFor(() => expect(popup.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(closeSheet).not.toHaveBeenCalled();
  });

  it("Tab cycles in the pop-up only, leaving out the Duo rail's actions", async () => {
    render(
      <>
        <BwSheet open onClose={() => {}} title="Create" footer={<button type="button">Create gig</button>}>
          <button type="button">New gig</button>
        </BwSheet>
        <div role="toolbar" data-bw-trap-include="">
          <button type="button">Close sheet</button>
        </div>
        <UrgentNotificationPopup notification={invite} onOpen={() => {}} onDismiss={() => {}} />
      </>,
    );
    const popup = await screen.findByRole('alertdialog');
    await waitFor(() => expect(popup.contains(document.activeElement)).toBe(true));
    const controls = Array.from(popup.querySelectorAll<HTMLElement>('button, [role="button"][tabindex="0"]'));
    controls[controls.length - 1].focus();
    tab();
    expect(document.activeElement).toBe(controls[0]);
    tab(true);
    expect(document.activeElement).toBe(controls[controls.length - 1]);
  });

  it('waits while a text field has the focus, then shows when it lets go', async () => {
    const { rerender } = render(<App urgent={false} />);
    const field = screen.getByRole('textbox', { name: 'Gig title' });
    field.focus();
    rerender(<App urgent />);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(field);
    screen.getByRole('button', { name: 'New gig' }).focus();
    const popup = await screen.findByRole('alertdialog');
    await waitFor(() => expect(popup.contains(document.activeElement)).toBe(true));
  });

  it('waits while an open picker or popover has the focus, then shows when it closes', async () => {
    const { rerender } = render(<App urgent={false} picker />);
    const option = screen.getByRole('option', { name: '8:00 PM' });
    option.focus();
    rerender(<App urgent picker />);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(option);
    // The picker closes (unmounted with the focus in it, no focus event).
    rerender(<App urgent />);
    const popup = await screen.findByRole('alertdialog');
    await waitFor(() => expect(popup.contains(document.activeElement)).toBe(true));
  });

  it('on the Duo, tapping a field on the other page while it shows: focus stays in the field', async () => {
    render(<App urgent={false} withOpener />);
    const opener = screen.getByRole('button', { name: 'Show alert' });
    opener.focus();
    fireEvent.click(opener);
    const popup = await screen.findByRole('alertdialog');
    await waitFor(() => expect(popup.contains(document.activeElement)).toBe(true));
    const field = screen.getByRole('textbox', { name: 'Gig title' });
    field.focus();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    expect(document.activeElement).toBe(field);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
