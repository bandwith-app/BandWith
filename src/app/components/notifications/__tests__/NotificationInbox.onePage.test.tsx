/**
 * The inbox on one page (phone, Duo closed): a modal dialog with its own
 * focus trap, so Tab never leaves it for the page behind (the bell).
 * When the Duo folds from two pages to one, the inbox goes from its two-page
 * frame to this one: focus moves straight into it, never to the bell behind
 * it on the way, and closing it still gives focus back to the bell.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

const layout = vi.hoisted(() => ({ twoPane: false }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }));
vi.mock('@/app/hooks/useLineupSoFar', () => ({ useLineupSoFar: () => null }));
vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));
vi.mock('@/lib/deviceRegions', async (orig) => ({
  ...(await orig<typeof import('@/lib/deviceRegions')>()),
  useRailLayout: () => ({ rail: layout.twoPane, twoPane: layout.twoPane, wide: false, railEdge: 'right' }),
}));
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { NotificationDetailModal } from '../NotificationDetailModal';

afterEach(() => {
  cleanup();
  layout.twoPane = false;
});

const notif = (id: string, title: string) => ({
  id,
  type: 'general',
  title,
  body: 'Body',
  data: {},
  created_at: new Date().toISOString(),
  read: false,
});
const list = [notif('n1', 'Lyrics correction'), notif('n2', 'Vote on rehearsal dates')];

const tab = (shift = false) => fireEvent.keyDown(document.activeElement || document.body, { key: 'Tab', shiftKey: shift });
const stops = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]'));

describe('inbox on one page', () => {
  it('over the page, Tab wraps inside the inbox and never reaches the bell behind it', async () => {
    const Page: React.FC<{ open: boolean }> = ({ open }) => (
      <>
        <button type="button">Bell</button>
        <NotificationDetailModal isOpen={open} onClose={() => {}} notification={null} notifications={list} />
      </>
    );
    const { rerender } = render(<Page open={false} />);
    const bell = screen.getByRole('button', { name: 'Bell' });
    bell.focus();
    rerender(<Page open />);
    const inbox = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(inbox.getAttribute('aria-modal')).toBe('true');
    await waitFor(() => expect(inbox.contains(document.activeElement)).toBe(true));
    const all = stops(inbox);
    all[all.length - 1].focus();
    tab();
    expect(document.activeElement).toBe(all[0]);
    tab(true);
    expect(document.activeElement).toBe(all[all.length - 1]);
    rerender(<Page open={false} />);
    await waitFor(() => expect(document.activeElement).toBe(bell));
  });

  it('folding from two pages to one moves focus into the inbox, never to the bell; closing goes back to it', async () => {
    layout.twoPane = true;
    const Page: React.FC<{ open: boolean }> = ({ open }) => (
      <>
        <button type="button">Bell</button>
        <NotificationDetailModal isOpen={open} onClose={() => {}} notification={null} notifications={list} />
      </>
    );
    const { rerender } = render(<Page open={false} />);
    const bell = screen.getByRole('button', { name: 'Bell' });
    bell.focus();
    rerender(<Page open />);
    const split = await screen.findByRole('dialog', { name: 'Notifications' });
    await waitFor(() => expect(split.contains(document.activeElement)).toBe(true));
    let bellFocused = 0;
    bell.addEventListener('focus', () => bellFocused++);
    layout.twoPane = false;
    rerender(<Page open />);
    await waitFor(() => {
      const one = screen.getAllByRole('dialog', { name: 'Notifications' }).find((d) => d.classList.contains('bw-pane-detail'))!;
      expect(one.contains(document.activeElement)).toBe(true);
    });
    expect(bellFocused).toBe(0);
    rerender(<Page open={false} />);
    await waitFor(() => expect(document.activeElement).toBe(bell));
  });
});
