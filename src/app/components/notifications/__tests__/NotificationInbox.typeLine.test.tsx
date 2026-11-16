import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }));
vi.mock('@/app/hooks/useLineupSoFar', () => ({ useLineupSoFar: () => null }));

import { NotificationDetailModal } from '../NotificationDetailModal';

describe('Inbox', () => {
  it('a rehearsal notification does not say REHEARSAL twice above its title', () => {
    render(
      <NotificationDetailModal
        isOpen
        onClose={() => {}}
        notification={null}
        notifications={[
          {
            id: 'n1',
            type: 'event_confirmed',
            title: 'Rehearsal confirmed',
            body: 'Leo M. confirmed for "Weekly rehearsal"',
            data: { event_type: 'rehearsal', subtitle: 'Rehearsal · Weekly rehearsal' },
            created_at: new Date().toISOString(),
            read: false,
          },
        ]}
      />,
    );
    const line = screen.getByText(/Weekly rehearsal$/);
    expect(line.textContent).toBe('Rehearsal · Weekly rehearsal');
  });
});
