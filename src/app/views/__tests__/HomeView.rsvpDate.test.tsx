/**
 * Claude review of #298 @ 3b9b6de3: Home's RSVP item for a repeating rehearsal
 * reads "RSVP · <the date listed>", so tapping it must open that date, not the
 * series' first date months back. HomeView hands the date shown to
 * onSelectEvent (Codex #297 B1), and AuthenticatedApp's navigateToEvent opens
 * the series on it (openDateFor + occurrenceOn).
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { occurrenceOn, openDateFor } from '@/lib/recurrenceSkips';
import appSrc from '@/app/AuthenticatedApp.tsx?raw';

vi.mock('@/lib/BandContext', async (orig) => ({
  ...(await orig<typeof import('@/lib/BandContext')>()),
  useBand: () => ({ isAdmin: false, selectedBand: { id: 'b1', name: 'Band' } }),
  useOptionalBand: () => ({ isAdmin: false, selectedBand: { id: 'b1', name: 'Band' } }),
}));

type Item = { id: string; title: string; detail?: string; onSelect?: () => void };
const seen: Item[][] = [];
vi.mock('@/app/components/duo', async (orig) => ({
  ...(await orig<typeof import('@/app/components/duo')>()),
  BandDeskMode: ({ actionItems }: { actionItems: Item[] }) => {
    seen.push(actionItems);
    return null;
  },
}));

import { HomeView } from '../HomeView';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  seen.length = 0;
});

const rule = { frequency: 'weekly', interval: 1, until: '2099-03-31' };
const series = {
  id: 'r1',
  eventId: 'r1',
  title: 'Weekly Jam',
  event_type: 'rehearsal',
  status: 'rehearsal',
  event_date: '2099-01-07',
  date: '2099-01-07',
  start_time: '19:00',
  is_recurring: true,
  recurrence_rule: rule,
};
// The series began before the list: only its marked dates are handed to Home.
const upcomingEvents = ['2099-01-14', '2099-01-21'].map((d) => ({
  ...series,
  id: `r1-occ-${d}`,
  occurrence_of: 'r1',
  event_date: d,
  date: d,
}));

describe('Home: the RSVP item opens the date it shows', () => {
  it('a series that began in the past: the series id and the date listed', () => {
    const onSelectEvent = vi.fn();
    render(
      <HomeView
        selectedBand={{ id: 'b1', name: 'Band' } as any}
        expandedCard={null as any}
        setExpandedCard={() => {}}
        upcomingRehearsals={[]}
        currentRehearsal={null}
        onRehearsalClick={() => {}}
        isHidden={false}
        dashboardData={{ upcomingEvents, recentQuotes: [] } as any}
        isAdmin={false}
        currentUserId="u1"
        eventMembersMap={{ r1: [{ name: 'Me', userId: 'u1', status: 'pending' }] }}
        onSelectEvent={onSelectEvent}
      />,
    );
    const rsvp = (seen[seen.length - 1] ?? []).find((it) => it.id === 'rsvp-r1');
    expect(rsvp?.detail).toMatch(/14/);
    rsvp?.onSelect?.();
    expect(onSelectEvent).toHaveBeenCalledWith('r1', '2099-01-14');
  });

  it('the detail opens on that date, not on the series start', () => {
    const date = openDateFor('r1', '2099-01-14', null);
    const opened = occurrenceOn(series, date);
    expect(opened).toMatchObject({ eventId: 'r1', date: '2099-01-14', seriesDate: '2099-01-07' });
    // Home's onSelectEvent is navigateToEvent, which opens through those two.
    expect(appSrc).toMatch(/onSelectEvent=\{navigateToEvent\}/);
    expect(appSrc).toMatch(/const navigateToEvent = useCallback\(async \(eventDbId: string, asked\?: string \| null\) => \{\s*const date = openDateFor\(eventDbId, asked, editReturnRef\.current\);/);
    expect(appSrc).toMatch(/occurrenceOn\(item, date\)/);
  });
});
