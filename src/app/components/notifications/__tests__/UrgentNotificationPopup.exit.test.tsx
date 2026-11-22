// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { AnimatePresence } from 'motion/react';
import { UrgentNotificationPopup } from '../UrgentNotificationPopup';
import type { Notification } from '@/lib/services/notifications';

/**
 * The pop-up steps aside when a sheet or Stage opens (#271). While it fades
 * out, its dimmed backdrop and card are still on top for a moment: a tap
 * meant for Stage must not dismiss (or open) the waiting invitation.
 */
const note = {
  id: 'n1',
  type: 'event_invite',
  title: 'Gig invitation',
  data: { event_title: 'The Loft, Brooklyn' },
} as unknown as Notification;

const Host = ({ show, onDismiss, onOpen }: { show: boolean; onDismiss: () => void; onOpen: () => void }) => (
  <AnimatePresence>{show && <UrgentNotificationPopup key="n1" notification={note} onDismiss={onDismiss} onOpen={onOpen} />}</AnimatePresence>
);

describe('the urgent pop-up while it leaves', () => {
  it('a tap on the fading backdrop or card does nothing, and they let taps through', () => {
    const onDismiss = vi.fn();
    const onOpen = vi.fn();
    const { container, rerender, getByRole } = render(<Host show onDismiss={onDismiss} onOpen={onOpen} />);
    const backdrop = container.ownerDocument.querySelector('.bw-pane-dialog') as HTMLElement;
    const card = getByRole('alert');
    // Shown: tapping the dimmed screen dismisses it, as before.
    expect(backdrop.style.pointerEvents).not.toBe('none');

    rerender(<Host show={false} onDismiss={onDismiss} onOpen={onOpen} />);
    // Still in the page while it fades out.
    expect(backdrop.isConnected).toBe(true);
    expect(backdrop.style.pointerEvents).toBe('none');
    expect(card.style.pointerEvents).toBe('none');
    fireEvent.click(backdrop);
    fireEvent.click(card.querySelector('[role="button"]')!);
    fireEvent.click(card.querySelector('button[aria-label]')!);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shown, a tap on the dimmed screen still dismisses it', () => {
    const onDismiss = vi.fn();
    const { container } = render(<Host show onDismiss={onDismiss} onOpen={() => undefined} />);
    fireEvent.click(container.ownerDocument.querySelector('.bw-pane-dialog')!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
