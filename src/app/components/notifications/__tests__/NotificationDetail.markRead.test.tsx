import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }));
vi.mock('@/app/hooks/useLineupSoFar', () => ({ useLineupSoFar: () => null }));

import { NotificationDetailModal } from '../NotificationDetailModal';

// Audit 07 #9: an unread gig invitation open in detail. The item is a
// snapshot (still "unread") and the app passes a new onMarkAsRead on every
// render; each call wrote, refetched and re-rendered: a request loop.
const invite = {
  id: 'n-invite',
  type: 'event_invite',
  title: 'Gig invitation',
  body: 'Rooftop Session, Sat 28 Nov',
  data: { event_id: 'gig-1' },
  created_at: new Date().toISOString(),
  read: false,
};

describe('notification detail: mark as read', () => {
  it('marks the open item read once, however often the app re-renders', () => {
    const calls: string[] = [];
    const view = (n: number) => (
      <NotificationDetailModal
        key="detail"
        isOpen
        onClose={() => {}}
        notification={invite}
        notifications={[]}
        // A new function each render, as AuthenticatedApp passes it.
        onMarkAsRead={(id?: string) => { calls.push(`${id}:${n}`); }}
      />
    );
    const { rerender } = render(view(0));
    for (let i = 1; i <= 5; i++) rerender(view(i));
    expect(calls).toEqual(['n-invite:0']);
  });

  it('opened again later, an item still unread is marked again', () => {
    const onMarkAsRead = vi.fn();
    const props = { onClose: () => {}, notification: invite, notifications: [], onMarkAsRead };
    const { rerender } = render(<NotificationDetailModal isOpen {...props} />);
    rerender(<NotificationDetailModal isOpen={false} {...props} />);
    rerender(<NotificationDetailModal isOpen {...props} />);
    expect(onMarkAsRead).toHaveBeenCalledTimes(2);
  });
});
