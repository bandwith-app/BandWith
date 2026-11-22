// Calendar entries and links never carry a feed or reply credential
// (migration 182; Codex audit of 383f15b, 02 #3/#5/#11, 03 #2/#6).
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

// Before the imports: DeputyGigsList reads the URL when it loads.
vi.hoisted(() => vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co'));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() }, isDemoMode: false }));
const cal = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock('@/lib/nativeFiles', async (orig) => ({ ...(await orig<typeof import('@/lib/nativeFiles')>()), openExternal: cal.openExternal }));
const lastOpened = () => cal.openExternal.mock.calls[cal.openExternal.mock.calls.length - 1]?.[0] as string | undefined;

import { deputyFeedCalendar, isOccurrence, memberFeedCalendar, type DeputyFeedGig, type MemberFeedEvent } from '../deputyCalendar';
import { DeputyGigCard } from '@/app/components/deputy/DeputyGigsList';
import type { DeputyGig } from '../services/deputies';

const REPLY_A = 'a'.repeat(64);
const REPLY_B = 'b'.repeat(64);
const CAL = 'c'.repeat(64);
const GIGCAL = 'e'.repeat(64);
const NOW = new Date(Date.UTC(2026, 10, 22, 12));
const SITE = 'https://app.bandwith.fun';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const dGig = (o: Partial<DeputyFeedGig & { mine: boolean }>): DeputyFeedGig & { mine?: boolean } => ({
  id: 'r-1', cancelled: false, role: 'Bass', event_title: 'Rooftop Session', event_date: '2026-12-05',
  start_time: '21:00:00', end_time: '23:30:00', load_in_time: '18:00:00', soundcheck_time: null,
  venue_name: 'The Loft', venue_city: 'Brooklyn', venue_address: '12 Water St', updated_at: '2026-11-20T10:00:00Z', ...o,
});

describe('deputy calendar feed (02 #3, 03 #2)', () => {
  it('no reply link or token in any entry, also when an older server still sends tokens', () => {
    const ics = deputyFeedCalendar(
      { band_name: 'Velvet Static', gigs: [dGig({ id: 'r-1', token: REPLY_A, mine: true }), dGig({ id: 'r-2', token: REPLY_B, event_date: '2026-12-12' })] },
      { token: CAL, lang: 'en', one: false, site: SITE, now: NOW },
    );
    expect(ics).toContain('UID:deputy-r-1@bandwith');
    expect(ics).toContain('UID:deputy-r-2@bandwith');
    expect(ics).not.toContain(REPLY_A);
    expect(ics).not.toContain(REPLY_B);
    expect(ics).not.toMatch(/deputy\.html/);
    expect(ics).not.toMatch(/^URL:/m);
  });

  it('one=1 is the gig of the link (flag from the server), not a token match', () => {
    const ics = deputyFeedCalendar(
      { band_name: 'Velvet Static', gigs: [dGig({ id: 'r-1', mine: true }), dGig({ id: 'r-2', event_date: '2026-12-12' })] },
      { token: CAL, lang: 'en', one: true, site: SITE, now: NOW },
    );
    expect(ics).toContain('UID:deputy-r-1@bandwith');
    expect(ics).not.toContain('UID:deputy-r-2@bandwith');
  });

  // Codex review #285 round 2: the functions are deployed before 182 (see its
  // header). On the database before 182 (084's feed: reply tokens, no `mine`)
  // the new function still finds the gig of a one=1 link, and writes no token.
  it('deployed before 182: one=1 still finds its gig on the old feed, without writing a token', () => {
    const ics = deputyFeedCalendar(
      { band_name: 'Velvet Static', gigs: [dGig({ id: 'r-1', token: REPLY_A }), dGig({ id: 'r-2', token: REPLY_B, event_date: '2026-12-12' })] },
      { token: REPLY_A, lang: 'en', one: true, site: SITE, now: NOW },
    );
    expect(ics).toContain('UID:deputy-r-1@bandwith');
    expect(ics).not.toContain('UID:deputy-r-2@bandwith');
    expect(ics).not.toContain(REPLY_A);
    expect(ics).not.toMatch(/deputy\.html/);
  });
});

const weekly: MemberFeedEvent = {
  id: 'ev-1', type: 'rehearsal', title: 'Weekly', band_name: 'Velvet Static', event_date: '2026-11-24',
  start_time: '19:00:00', end_time: '22:00:00', load_in_time: null, soundcheck_time: null, venue_name: 'Studio B',
  venue_city: 'Queens', venue_address: null, role: null, recurrence: { frequency: 'weekly', interval: 1 }, updated_at: null,
};

describe('one occurrence of a recurring rehearsal (02 #11)', () => {
  it('is that date alone, without the series rule', () => {
    const ics = memberFeedCalendar([weekly], { lang: 'en', site: SITE, one: 'ev-1', occurrence: '2026-12-08', now: NOW }) as string;
    expect(ics).toContain('DTSTART:20261208T190000');
    expect(ics).not.toContain('RRULE');
    // Its own UID: a second occurrence added later doesn't replace this one.
    expect(ics).toContain('UID:event-ev-1-20261208@bandwith');
  });

  it('a date the series never reaches is no event; a one-off ignores the date', () => {
    expect(memberFeedCalendar([weekly], { lang: 'en', site: SITE, one: 'ev-1', occurrence: '2026-12-09', now: NOW })).toBeNull();
    const gig: MemberFeedEvent = { ...weekly, id: 'ev-2', type: 'gig', recurrence: null, event_date: '2026-12-31' };
    const ics = memberFeedCalendar([gig], { lang: 'en', site: SITE, one: 'ev-2', occurrence: '2026-12-08', now: NOW }) as string;
    expect(ics).toContain('DTSTART:20261231T190000');
    expect(ics).toContain('UID:event-ev-2@bandwith');
  });

  it('a date the server already resolved (no rule in it) keeps its own UID (review of #285)', () => {
    const single: MemberFeedEvent = { ...weekly, event_date: '2026-12-08', recurrence: null };
    const ics = memberFeedCalendar([single], { lang: 'en', site: SITE, one: 'ev-1', occurrence: '2026-12-08', now: NOW }) as string;
    expect(ics).toContain('DTSTART:20261208T190000');
    expect(ics).toContain('UID:event-ev-1-20261208@bandwith');
    expect(ics).not.toContain('RRULE');
  });

  it('the subscription still repeats the series', () => {
    const ics = memberFeedCalendar([weekly], { lang: 'en', site: SITE, now: NOW }) as string;
    expect(ics).toContain('RRULE:FREQ=WEEKLY;INTERVAL=1');
    expect(ics).toContain('UID:event-ev-1@bandwith');
  });

  it('knows the dates the app shows for a series', () => {
    expect(isOccurrence({ frequency: 'weekly', interval: 1 }, '2026-11-24', '2026-11-24')).toBe(true);
    expect(isOccurrence({ frequency: 'weekly', interval: 1 }, '2026-11-24', '2026-12-01')).toBe(true);
    expect(isOccurrence({ frequency: 'weekly', interval: 2 }, '2026-11-24', '2026-12-01')).toBe(false);
    expect(isOccurrence({ freq: 'biweekly' }, '2026-11-24', '2026-12-08')).toBe(true);
    expect(isOccurrence({ frequency: 'monthly', interval: 1 }, '2026-11-24', '2027-01-24')).toBe(true);
    expect(isOccurrence({ frequency: 'weekly', until: '2026-12-01' }, '2026-11-24', '2026-12-08')).toBe(false);
    // count = repeats after the first date (as RRULE COUNT=count+1).
    expect(isOccurrence({ frequency: 'weekly', count: 2 }, '2026-11-24', '2026-12-08')).toBe(true);
    expect(isOccurrence({ frequency: 'weekly', count: 2 }, '2026-11-24', '2026-12-15')).toBe(false);
    expect(isOccurrence({ frequency: 'weekly' }, '2026-11-24', '2026-11-17')).toBe(false);
    expect(isOccurrence(null, '2026-11-24', '2026-12-01')).toBe(false);
  });
});

const myGig = (o: Partial<DeputyGig>): DeputyGig => ({
  id: 'g-1', token: REPLY_A, status: 'available', deputy_name: 'Leo', role: 'Bass', fee: 250, currency: 'USD', reply_note: null,
  responded_at: null, band_name: 'Velvet Static', event_title: 'Rooftop Session', event_type: 'gig', event_date: '2099-12-05',
  start_time: '21:00:00', end_time: null, load_in_time: null, soundcheck_time: null, venue_name: 'The Loft', venue_city: 'Brooklyn',
  venue_address: '12 Water St', event_cancelled: false, changes: [], before: {}, closed: false, ...o,
} as DeputyGig);

describe('deputy gigs in the app: calendar links (02 #3)', () => {
  it('Add to calendar uses the one-gig key, Subscribe the calendar key, never the reply token', () => {
    render(<DeputyGigCard gig={myGig({ calendar_token: CAL, gig_calendar_token: GIGCAL })} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    const file = lastOpened() as string;
    // Review of #285 (Codex B1): the file link must not be the subscription key.
    expect(file).toMatch(new RegExp(`/functions/v1/deputy-calendar\\?g=${GIGCAL}&l=en$`));
    expect(file).not.toContain(CAL);
    const sub = screen.getAllByRole('button').find((b) => /subscribe/i.test(b.textContent || ''));
    expect(sub).toBeTruthy();
    fireEvent.click(sub as HTMLElement);
    const feed = lastOpened() as string;
    expect(feed).toMatch(new RegExp(`^webcal://test\\.supabase\\.co/functions/v1/deputy-calendar\\?t=${CAL}&l=en$`));
    for (const [url] of cal.openExternal.mock.calls) expect(url).not.toContain(REPLY_A);
  });

  it('a server without calendar tokens yet: no file or subscription link (Google Calendar stays)', () => {
    render(<DeputyGigCard gig={myGig({ calendar_token: null, gig_calendar_token: null })} onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Add to calendar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Google Calendar' }));
    const google = lastOpened() as string;
    expect(google).toContain('calendar.google.com');
    expect(google).not.toContain(REPLY_A);
  });
});
