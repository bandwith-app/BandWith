/**
 * The inbox on a two-pane iPhone Duo (or iPad sidebar): the list on one
 * page, the open notification on the other. They are one modal dialog with
 * one focus trap: keyboard focus moves between the list and the detail
 * (the detail is a labelled region in it, not a dialog of its own). The bell
 * can open it over a sheet; the sheet's trap hands over to the whole inbox.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }));
vi.mock('@/app/hooks/useLineupSoFar', () => ({ useLineupSoFar: () => null }));
vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));
vi.mock('@/lib/deviceRegions', async (orig) => ({
  ...(await orig<typeof import('@/lib/deviceRegions')>()),
  useRailLayout: () => ({ rail: true, twoPane: true, wide: false, railEdge: 'right' }),
}));
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { BwSheet } from '@/app/components/bw/Screen';
import { NotificationDetailModal } from '../NotificationDetailModal';

afterEach(cleanup);

const notif = (id: string, title: string) => ({
  id,
  type: 'general',
  title,
  body: 'Body',
  data: {},
  created_at: new Date().toISOString(),
  read: false,
});

const Inbox: React.FC<{ open: boolean }> = ({ open }) => (
  <>
    <BwSheet open onClose={() => {}} title="Create" footer={<button type="button">Create gig</button>}>
      <button type="button">New gig</button>
    </BwSheet>
    <NotificationDetailModal
      isOpen={open}
      onClose={() => {}}
      notification={null}
      notifications={[notif('n1', 'Lyrics correction'), notif('n2', 'Vote on rehearsal dates')]}
    />
  </>
);

describe('inbox on two panes', () => {
  it('list and detail are one modal dialog; the detail is a region in it', async () => {
    const { rerender } = render(<Inbox open={false} />);
    rerender(<Inbox open />);
    const inbox = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(inbox.getAttribute('aria-modal')).toBe('true');
    const detail = screen.getByRole('region', { name: 'Lyrics correction' });
    expect(inbox.contains(detail)).toBe(true);
    expect(detail.hasAttribute('aria-modal')).toBe(false);
    expect(inbox.contains(screen.getAllByText('Vote on rehearsal dates')[0])).toBe(true);
  });

  it('over a sheet, Tab reaches the second notification in the list and moves on from it', async () => {
    const { rerender } = render(<Inbox open={false} />);
    const sheet = screen.getByRole('dialog', { name: 'Create' });
    await waitFor(() => expect(document.activeElement).toBe(sheet));
    rerender(<Inbox open />);
    const inbox = await screen.findByRole('dialog', { name: 'Notifications' });
    await waitFor(() => expect(inbox.contains(document.activeElement)).toBe(true));
    const second = screen.getAllByText('Vote on rehearsal dates')[0].closest<HTMLElement>('button, [role="button"], [tabindex="0"]')!;
    expect(second).not.toBeNull();
    second.focus();
    // The trap leaves this Tab to the browser: the row is inside the trapped layer.
    expect(fireEvent.keyDown(second, { key: 'Tab' })).toBe(true);
    expect(document.activeElement).toBe(second);
    // From the last control of the inbox, Tab wraps to its first one (in the list).
    const all = Array.from(inbox.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]'));
    all[all.length - 1].focus();
    fireEvent.keyDown(all[all.length - 1], { key: 'Tab' });
    expect(inbox.contains(document.activeElement)).toBe(true);
  });
});
