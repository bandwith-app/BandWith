import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));
vi.mock('@/lib/services/eventTasks', () => ({
  useEventTasks: () => ({ tasks: [], toggle: vi.fn(), error: null }),
}));
vi.mock('@/app/components/rehearsal/useRehearsalSetlist', () => ({ useRehearsalSetlist: () => [] }));

import { RehearsalExpanded } from '../RehearsalExpanded';
import type { EventItem } from '@/app/data/events';

afterEach(cleanup);

const rehearsal = {
  id: 2,
  eventId: '10000259-0000-4000-8000-000000000601',
  title: 'Weekly rehearsal',
  date: '2026-11-17',
  time: '19:00',
  location: 'Blackbox Studios',
  status: 'REHEARSAL',
  members: [],
} as unknown as EventItem;

/**
 * The Home rehearsal card's expanded view had its own local "live session"
 * (RehearsalLiveView / RehearsalPostView, removed 11-17). Its live buttons
 * now open the rehearsal in the one live mode (Stage mode for rehearsals).
 */
describe('Rehearsal card: live buttons', () => {
  it('"Enter live mode" and "Check in / live" open the rehearsal in live mode', () => {
    const onGoLive = vi.fn();
    const setMode = vi.fn();
    render(
      <RehearsalExpanded
        upcomingRehearsals={[rehearsal]}
        currentRehearsal={rehearsal}
        rehearsalIndex={0}
        setRehearsalIndex={vi.fn()}
        rehearsalViewMode="overview"
        setRehearsalViewMode={setMode}
        onGoLive={onGoLive}
        onClose={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Enter live mode/ }));
    fireEvent.click(screen.getByRole('button', { name: /Check in \/ live/ }));
    expect(onGoLive).toHaveBeenCalledTimes(2);
    // No local live view any more.
    expect(setMode).not.toHaveBeenCalledWith('live');
    expect(screen.queryByText('Live session')).toBeNull();
  });
});
