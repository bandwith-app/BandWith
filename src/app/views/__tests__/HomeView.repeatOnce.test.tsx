/**
 * Codex #285 @ 6ab65eb9 M1: AuthenticatedApp already expands a repeating
 * rehearsal into its dates (`<id>-occ-<date>`) before Home gets them, and
 * Home expanded each of those dates again as if it started a new series.
 * A monthly series on Jan 31 then showed a phantom Mar 28 (Feb 28 + 1 month).
 * Home expands a series row once, never one of its dates.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
vi.mock('@/lib/BandContext', async (orig) => ({
  ...(await orig<typeof import('@/lib/BandContext')>()),
  useBand: () => ({ isAdmin: true, selectedBand: { id: 'b1', name: 'Band' } }),
  useOptionalBand: () => ({ isAdmin: true, selectedBand: { id: 'b1', name: 'Band' } }),
}));

import { HomeView } from '../HomeView';
import { repeatDates } from '@/lib/recurrence';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const rule = { frequency: 'monthly', interval: 1, until: '2099-06-30' };
const series = {
  id: 'r1',
  title: 'Monthly Jam',
  event_type: 'rehearsal',
  status: 'rehearsal',
  event_date: '2099-01-31',
  start_time: '19:00',
  is_recurring: true,
  recurrence_rule: rule,
};
// What AuthenticatedApp's dashboard list hands Home: the series row and its dates.
const dates = repeatDates('2099-01-31', rule, new Date(2099, 5, 30), 24).map(ymd);
const upcomingEvents = [
  series,
  ...dates.map((d) => ({ ...series, id: `r1-occ-${d}`, eventId: 'r1', event_date: d, date: d })),
];

afterEach(cleanup);

describe('Home: a repeating rehearsal is expanded once', () => {
  it('Jan 31 monthly: Jan 31, Feb 28, Mar 31 (no phantom Mar 28)', () => {
    expect(dates.slice(0, 2)).toEqual(['2099-02-28', '2099-03-31']);
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
        isAdmin
      />,
    );
    const rows = screen.getAllByText('Monthly Jam').map((el) => el.closest('button') ?? el.parentElement!);
    const days = rows.map((r) => r.textContent ?? '');
    expect(days).toHaveLength(3);
    expect(days[0]).toMatch(/31\s*Jan/);
    expect(days[1]).toMatch(/28\s*Feb/);
    expect(days[2]).toMatch(/31\s*Mar/);
    expect(days.join('|')).not.toMatch(/28\s*Mar/);
  });
});
