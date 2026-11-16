/**
 * Inbox on the iPhone Duo in Laptop pose: like the full-screen forms
 * (`.bw-fold-form`, rules in index.css), the header holds the Display and the
 * rows scroll on the Deck, so no row rests across the fold.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }));
vi.mock('@/app/hooks/useLineupSoFar', () => ({ useLineupSoFar: () => null }));

import { NotificationDetailModal } from '../NotificationDetailModal';

const notif = (id: string, title: string) => ({
  id,
  type: 'general',
  title,
  body: 'Body',
  data: {},
  created_at: new Date().toISOString(),
  read: false,
});

describe('Inbox in the Duo Laptop pose', () => {
  it('the header holds the Display and the rows start below it, on the Deck', () => {
    render(
      <NotificationDetailModal
        isOpen
        onClose={() => {}}
        notification={null}
        notifications={[notif('n1', 'Lyrics correction'), notif('n2', 'Vote on rehearsal dates')]}
      />,
    );
    const header = document.querySelector('.bw-fold-form > header:first-child') as HTMLElement;
    expect(header).not.toBeNull();
    expect(header.textContent).toContain('Inbox');
    const row = screen.getByText('Lyrics correction');
    expect(header.contains(row)).toBe(false);
    // The rows scroll on their own (the Deck), not with the header.
    expect(row.closest('.overflow-y-auto')?.parentElement).toBe(header.parentElement);
  });
});
