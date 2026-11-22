/**
 * Claude review of #298 @ 841db7c7 (NIT, HomeView RSVP items): the RSVP loop
 * skipped dates by `String(e.eventId || e.id).includes('-occ-')`, which is the
 * series id on an expanded date, so it never matched. A pending repeating
 * rehearsal gave one RSVP item per date, all keyed `rsvp-<series>`.
 * Expanded dates carry `occurrence_of` (round 12); the loop groups them by
 * occurrence_of and keeps the first.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

vi.mock('@/lib/BandContext', async (orig) => ({
  ...(await orig<typeof import('@/lib/BandContext')>()),
  useBand: () => ({ isAdmin: false, selectedBand: { id: 'b1', name: 'Band' } }),
  useOptionalBand: () => ({ isAdmin: false, selectedBand: { id: 'b1', name: 'Band' } }),
}));

// The desk shows only in the laptop pose; the stand-in lists what Home hands it,
// keyed like the real list, so a repeated key still warns.
const seen: { id: string }[][] = [];
vi.mock('@/app/components/duo', async (orig) => ({
  ...(await orig<typeof import('@/app/components/duo')>()),
  BandDeskMode: ({ actionItems }: { actionItems: { id: string; title: string; detail?: string; onSelect?: () => void }[] }) => {
    seen.push(actionItems);
    return (
      <ul data-testid="desk-items">
        {actionItems.map((it) => (
          <li key={it.id}>
            <button type="button" data-item={it.id} onClick={() => it.onSelect?.()}>
              {it.title}
            </button>
          </li>
        ))}
      </ul>
    );
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
  vi.restoreAllMocks();
});

const rule = { frequency: 'weekly', interval: 1, until: '2099-03-31' };
const series = {
  id: 'r1',
  title: 'Weekly Jam',
  event_type: 'rehearsal',
  status: 'rehearsal',
  event_date: '2099-01-07',
  start_time: '19:00',
  is_recurring: true,
  recurrence_rule: rule,
};
// What AuthenticatedApp's liveUpcomingEvents hands Home: the series row and its marked dates.
const upcomingEvents = [
  series,
  ...['2099-01-14', '2099-01-21', '2099-01-28'].map((d) => ({
    ...series,
    id: `r1-occ-${d}`,
    eventId: 'r1',
    occurrence_of: 'r1',
    event_date: d,
    date: d,
  })),
];

const gig = {
  id: 'g1',
  title: 'Club Night',
  event_type: 'gig',
  status: 'confirmed',
  event_date: '2099-01-10',
  start_time: '21:00',
};

const renderHome = (events: any[], onSelectEvent?: (id: string) => void) =>
  render(
    <HomeView
      selectedBand={{ id: 'b1', name: 'Band' } as any}
      expandedCard={null as any}
      setExpandedCard={() => {}}
      upcomingRehearsals={[]}
      currentRehearsal={null}
      onRehearsalClick={() => {}}
      isHidden={false}
      dashboardData={{ upcomingEvents: events, recentQuotes: [] } as any}
      isAdmin={false}
      currentUserId="u1"
      eventMembersMap={{
        r1: [{ name: 'Me', userId: 'u1', status: 'pending' }],
        g1: [{ name: 'Me', userId: 'u1', status: 'pending' }],
      }}
      onSelectEvent={onSelectEvent}
    />,
  );

describe('Home: one RSVP item for a pending repeating rehearsal', () => {
  it('series started in the past: only its dates are listed, still one item, on the first date', () => {
    // liveUpcomingEvents keeps the series row only while its first date is ahead.
    renderHome(upcomingEvents.slice(1));
    const items = (seen[seen.length - 1] ?? []) as { id: string; detail?: string }[];
    const rsvp = items.filter((it) => it.id.startsWith('rsvp-'));
    expect(rsvp.map((it) => it.id)).toEqual(['rsvp-r1']);
    expect(rsvp[0].detail).toMatch(/14/);
  });

  it('one item, unique keys, no duplicate-key warning', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHome(upcomingEvents);
    const items = seen[seen.length - 1] ?? [];
    const rsvp = items.filter((it) => it.id.startsWith('rsvp-'));
    expect(rsvp.map((it) => it.id)).toEqual(['rsvp-r1']);
    expect(new Set(items.map((it) => it.id)).size).toBe(items.length);
    const dupWarnings = errors.mock.calls.filter((c) => c.some((a) => String(a).includes('same key')));
    expect(dupWarnings).toHaveLength(0);
  });

  it('tapping the item opens the series', () => {
    const onSelectEvent = vi.fn();
    renderHome(upcomingEvents.slice(1), onSelectEvent);
    fireEvent.click(screen.getByRole('button', { name: 'Weekly Jam' }));
    expect(onSelectEvent).toHaveBeenCalledTimes(1);
    expect(onSelectEvent.mock.calls[0][0]).toBe('r1');
  });

  it('a pending one-off gig next to the series keeps its own item', () => {
    const onSelectEvent = vi.fn();
    renderHome([series, gig, ...upcomingEvents.slice(1)], onSelectEvent);
    const items = seen[seen.length - 1] ?? [];
    expect(items.filter((it) => it.id.startsWith('rsvp-')).map((it) => it.id).sort()).toEqual(['rsvp-g1', 'rsvp-r1']);
    fireEvent.click(screen.getByRole('button', { name: 'Club Night' }));
    expect(onSelectEvent).toHaveBeenCalledTimes(1);
    expect(onSelectEvent.mock.calls[0][0]).toBe('g1');
  });
});
