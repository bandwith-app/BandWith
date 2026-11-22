// Links shared before 182 carry the account's calendar token: the app asks
// once to make a new link (review of PR #285, finding 3).
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc,
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }) },
  },
  isDemoMode: false,
}));
vi.mock('@/lib/nativeFiles', () => ({ openExternal: vi.fn() }));

import { CalendarSyncSection } from '@/app/components/settings/CalendarSyncSection';
import { AddToCalendar } from '../AddToCalendar';
import { _resetCalendarTokenCache } from '@/lib/memberCalendar';
import it_ from '@/lib/i18n/locales/it';
import es from '@/lib/i18n/locales/es';
import fr from '@/lib/i18n/locales/fr';
import de from '@/lib/i18n/locales/de';
import pt from '@/lib/i18n/locales/pt';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const EV = '11111111-2222-4333-8444-555555555555';

const server = (review: boolean) =>
  rpc.mockImplementation(async (fn: string) => {
    if (fn === 'bw_my_calendar_link_review') return { data: review, error: null };
    if (fn === 'bw_my_calendar_link_keep') return { data: null, error: null };
    if (fn === 'bw_my_calendar_token') return { data: rpc.mock.calls.some(([f, a]) => f === fn && a?.p_rotate) ? B : A, error: null };
    if (fn === 'bw_my_event_calendar_token') return { data: 'd'.repeat(64), error: null };
    return { data: null, error: null };
  });

const NOTICE = 'calendar-link-review';

describe('ask once to replace a calendar link made before 182', () => {
  beforeEach(() => {
    cleanup();
    rpc.mockReset();
    _resetCalendarTokenCache();
  });

  it('Settings → Calendar sync: Keep my link closes it for good', async () => {
    server(true);
    render(<CalendarSyncSection />);
    const notice = await screen.findByTestId(NOTICE);
    expect(notice.textContent).toMatch(/Check your calendar link/);
    fireEvent.click(screen.getByRole('button', { name: 'Keep my link' }));
    await waitFor(() => expect(screen.queryByTestId(NOTICE)).toBeNull());
    expect(rpc).toHaveBeenCalledWith('bw_my_calendar_link_keep');
  });

  it('Make a new link from the notice rotates the account link and says to add it again', async () => {
    server(true);
    render(<CalendarSyncSection />);
    const notice = await screen.findByTestId(NOTICE);
    fireEvent.click(notice.querySelector('button') as HTMLElement);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('bw_my_calendar_token', { p_rotate: true }));
    expect(await screen.findByText(/Add it to your calendar again/)).toBeTruthy();
  });

  it('in the event, next to Add to calendar; nothing when there is nothing to check', async () => {
    server(true);
    render(<AddToCalendar event={{ eventId: EV, title: 'Rooftop Session', date: '2099-12-12' }} />);
    expect(await screen.findByTestId(NOTICE)).toBeTruthy();
    cleanup();
    _resetCalendarTokenCache();
    server(false);
    render(<AddToCalendar event={{ eventId: EV, title: 'Rooftop Session', date: '2099-12-12' }} />);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('bw_my_calendar_link_review'));
    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });

  it('is translated in all five app languages', () => {
    const keys = [
      'Check your calendar link',
      'Until now, “Add to calendar” links had your private calendar link inside. If you sent one to anyone, make a new link: with the old one they can see all your events. If you subscribed in a calendar, add the new link there again.',
      'Keep my link',
    ];
    for (const dict of [it_, es, fr, de, pt] as Record<string, string>[]) {
      for (const k of keys) expect(dict[k], k).toBeTruthy();
    }
  });
});
