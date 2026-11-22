import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }));
vi.mock('@/app/hooks/useLineupSoFar', () => ({ useLineupSoFar: () => null }));

import { NotificationDetailModal } from '../NotificationDetailModal';

/**
 * Review #273 round 4: the item open in detail is tracked by id. When the
 * list changes under it (live_pack switched off hides its items), the detail
 * must not go blank or move to another item, and Delete must never be called
 * without an id (the app used to read that as "delete all of them").
 */
const n = (id: string, type: string, title: string) => ({
  id,
  type,
  title,
  body: `${title} body`,
  data: {},
  created_at: new Date().toISOString(),
  read: true,
});
const pack = n('lp', 'live_pack_ready', 'Setlist ready offline');
const invite = n('inv', 'event_invite', 'Gig at Blue Room');

describe('Inbox: the open item is tracked by id', () => {
  it('an item hidden above the open one: the detail stays on it, and Delete deletes it', () => {
    const onDelete = vi.fn();
    const props = { isOpen: true, onClose: () => {}, notification: null, onDelete };
    const { rerender } = render(<NotificationDetailModal {...props} notifications={[pack, invite]} />);
    fireEvent.click(screen.getByText('Gig at Blue Room').closest('button')!);
    rerender(<NotificationDetailModal {...props} notifications={[invite]} />);
    expect(screen.getAllByText('Gig at Blue Room').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText('Delete notification'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('inv');
  });

  it('the open item itself goes: back to the list, and no Delete without an id', () => {
    const onDelete = vi.fn();
    const props = { isOpen: true, onClose: () => {}, notification: null, onDelete };
    const { rerender } = render(<NotificationDetailModal {...props} notifications={[invite, pack]} />);
    fireEvent.click(screen.getByText('Gig at Blue Room').closest('button')!);
    rerender(<NotificationDetailModal {...props} notifications={[pack]} />);
    expect(screen.queryByLabelText('Delete notification')).toBeNull();
    expect(screen.getByText('Setlist ready offline')).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
