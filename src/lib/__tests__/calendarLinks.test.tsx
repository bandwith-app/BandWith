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

import { calendarFile, deputyFeedCalendar, gigEvent, isOccurrence, memberFeedCalendar, monthlyDate, recurrenceRule, type DeputyFeedGig, type MemberFeedEvent } from '../deputyCalendar';
import { RRule } from 'rrule';
import monthlyVectorsSrc from '../../../supabase/tests/monthly-clamp-vectors.json?raw';
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

// Coordinator round 3: #297 deletes one date of a series
// (recurrence_rule.skip_dates); #298 keeps a monthly series on the 29th-31st
// on the last day of shorter months. External calendars must show the same.
describe('series dates the app shows, in external calendars', () => {
  it('a deleted date is an EXDATE with the start time of the entry', () => {
    const skipped = { ...weekly, recurrence: { frequency: 'weekly', interval: 1, skip_dates: ['2026-12-01', 'junk', '2026-12-15'] } };
    const ics = memberFeedCalendar([skipped], { lang: 'en', site: SITE, now: NOW }) as string;
    expect(ics).toContain('DTSTART:20261124T190000');
    expect(ics).toContain('EXDATE:20261201T190000');
    expect(ics).toContain('EXDATE:20261215T190000');
    expect(ics).not.toMatch(/EXDATE:.*junk/);
    // Load-in first: the entry (and so the EXDATE) starts at load-in.
    const early = memberFeedCalendar([{ ...skipped, load_in_time: '18:30:00' }], { lang: 'en', site: SITE, now: NOW }) as string;
    expect(early).toContain('DTSTART:20261124T183000');
    expect(early).toContain('EXDATE:20261201T183000');
    // No times: an all-day series, all-day EXDATE.
    const allDay = memberFeedCalendar([{ ...skipped, start_time: null, end_time: null }], { lang: 'en', site: SITE, now: NOW }) as string;
    expect(allDay).toContain('DTSTART;VALUE=DATE:20261124');
    expect(allDay).toContain('EXDATE;VALUE=DATE:20261201');
  });

  it('no skip_dates (before #297): no EXDATE; a one-date file never has one', () => {
    expect(memberFeedCalendar([weekly], { lang: 'en', site: SITE, now: NOW })).not.toContain('EXDATE');
    const skipped = { ...weekly, recurrence: { frequency: 'weekly', skip_dates: ['2026-12-01'] } };
    expect(memberFeedCalendar([skipped], { lang: 'en', site: SITE, one: 'ev-1', occurrence: '2026-12-08', now: NOW })).not.toContain('EXDATE');
  });

  it('a deleted date is no occurrence: its one-date file is gone', () => {
    const skipped = { ...weekly, recurrence: { frequency: 'weekly', skip_dates: ['2026-12-01'] } };
    expect(isOccurrence(skipped.recurrence, '2026-11-24', '2026-12-01')).toBe(false);
    expect(isOccurrence(skipped.recurrence, '2026-11-24', '2026-12-08')).toBe(true);
    expect(memberFeedCalendar([skipped], { lang: 'en', site: SITE, one: 'ev-1', occurrence: '2026-12-01', now: NOW })).toBeNull();
  });

  it('monthly on the 29th-31st: the last day of shorter months, as the app', () => {
    expect(recurrenceRule({ frequency: 'monthly' }, '2027-01-31')).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1');
    // The 30th stays the 30th in a month that has a 31st (Jan 30 -> Mar 30).
    expect(recurrenceRule({ frequency: 'monthly', interval: 2 }, '2027-01-30')).toBe('FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=28,29,30;BYSETPOS=-1');
    expect(recurrenceRule({ frequency: 'monthly' }, '2027-01-29')).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=28,29;BYSETPOS=-1');
    expect(recurrenceRule({ frequency: 'monthly' }, '2027-01-28')).toBe('FREQ=MONTHLY;INTERVAL=1');
    expect(recurrenceRule({ frequency: 'monthly' }, '2027-01-15')).toBe('FREQ=MONTHLY;INTERVAL=1');
    const monthly = { ...weekly, event_date: '2027-01-31', recurrence: { frequency: 'monthly' } };
    expect(memberFeedCalendar([monthly], { lang: 'en', site: SITE, now: NOW })).toContain('RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1');
    expect(isOccurrence({ frequency: 'monthly' }, '2027-01-31', '2027-02-28')).toBe(true);
    expect(isOccurrence({ frequency: 'monthly' }, '2027-01-31', '2027-03-31')).toBe(true);
    expect(isOccurrence({ frequency: 'monthly' }, '2027-01-31', '2027-03-03')).toBe(false);
    expect(isOccurrence({ frequency: 'monthly' }, '2028-01-31', '2028-02-29')).toBe(true);
    expect(isOccurrence({ frequency: 'monthly' }, '2027-01-30', '2027-03-30')).toBe(true);
  });

  // Round 5 (coordinator): the shared vectors, identical in PGlite (SQL):
  // starts on Jan 29, 30 and 31 of 2027 and 2028 (leap year), 14 months each.
  it('monthly vectors (29th-31st, 2027 and 2028, 14 months): the ICS side gives every date', () => {
    const { vectors } = JSON.parse(monthlyVectorsSrc) as { vectors: { start: string; dates: string[] }[] };
    expect(vectors).toHaveLength(6);
    for (const { start, dates } of vectors) {
      expect(dates).toHaveLength(14);
      expect(dates.map((_, k) => monthlyDate(start, k))).toEqual(dates);
      for (const d of dates) expect(isOccurrence({ frequency: 'monthly' }, start, d), `${start} -> ${d}`).toBe(true);
      // Never the overflow-carried date (Mar 28 after a February clamp).
      const y = start.slice(0, 4);
      if (start.endsWith('-31') || start.endsWith('-30')) expect(isOccurrence({ frequency: 'monthly' }, start, `${y}-03-28`)).toBe(false);
    }
  });

  // Codex review of #298 (M4): #298's app side writes no RRULE of its own;
  // the calendar feed 182 serves (member-calendar -> memberFeedCalendar) must
  // put Feb 28 in a monthly series from Jan 31, for the client too.
  it('the member feed of a monthly series from Jan 31 2027 includes Feb 28 (as served, and expanded by rrule)', () => {
    const ev: MemberFeedEvent = {
      id: '11111111-2222-4333-8444-555555555555', type: 'rehearsal', title: 'Month-end rehearsal', band_name: 'Velvet Static',
      event_date: '2027-01-31', start_time: '19:00:00', end_time: '21:00:00', load_in_time: null, soundcheck_time: null,
      venue_name: 'Studio B', venue_city: 'Queens', venue_address: null, role: null,
      recurrence: { frequency: 'monthly', interval: 1 }, updated_at: '2026-11-22T10:00:00Z',
    };
    const ics = memberFeedCalendar([ev], { lang: 'en', site: 'https://app.bandwith.fun', now: new Date(Date.UTC(2026, 10, 22)) })!;
    const lines = ics.split('\r\n');
    const dtstart = lines.find((l) => l.startsWith('DTSTART'))!;
    const rrule = lines.find((l) => l.startsWith('RRULE:'))!;
    expect(dtstart).toBe('DTSTART:20270131T190000');
    expect(rrule).toContain('BYMONTHDAY=-1');
    // What a calendar client sees: rrule 2.8.1 over the served lines.
    const r = RRule.fromString(`DTSTART:20270131T190000Z\n${rrule}`);
    const seen = r.between(new Date(Date.UTC(2027, 0, 1)), new Date(Date.UTC(2027, 5, 1))).map((d) => d.toISOString().slice(0, 10));
    expect(seen).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
    // A plain FREQ=MONTHLY (what the app would write without 182's rule) skips it.
    const plain = RRule.fromString('DTSTART:20270131T190000Z\nRRULE:FREQ=MONTHLY;INTERVAL=1');
    expect(plain.between(new Date(Date.UTC(2027, 0, 1)), new Date(Date.UTC(2027, 2, 1))).map((d) => d.toISOString().slice(0, 10))).not.toContain('2027-02-28');
  });

  // Claude review #285 r5 (M1): what a calendar does with the RRULE we
  // write, expanded by a real RFC 5545 engine (rrule, devDependency), gives
  // the shared vectors exactly.
  it('the exported RRULE, expanded by rrule, gives every vector date (29th-31st, 2027 and 2028)', () => {
    const { vectors } = JSON.parse(monthlyVectorsSrc) as { vectors: { start: string; dates: string[] }[] };
    for (const { start, dates } of vectors) {
      const rule = recurrenceRule({ frequency: 'monthly' }, start) as string;
      const [y, m, d] = start.split('-').map(Number);
      const r = new RRule({ ...RRule.parseString(rule), dtstart: new Date(Date.UTC(y, m - 1, d, 12)), count: dates.length });
      expect(r.all().map((x) => x.toISOString().slice(0, 10)), `${start} ${rule}`).toEqual(dates);
    }
    // A plain monthly rule would skip the short months: the check would see it.
    const plain = new RRule({ ...RRule.parseString('FREQ=MONTHLY;INTERVAL=1'), dtstart: new Date(Date.UTC(2027, 0, 31, 12)), count: 3 });
    expect(plain.all().map((x) => x.toISOString().slice(0, 10))).toEqual(['2027-01-31', '2027-03-31', '2027-05-31']);
  });

  // Claude review #285 item 6: the 31st is the month's last day (BYMONTHDAY=-1);
  // the 29th and 30th keep the latest of 28..d.
  it('the RRULE of a series on the 31st is BYMONTHDAY=-1; the 29th and 30th keep 28..d with BYSETPOS=-1', () => {
    expect(recurrenceRule({ frequency: 'monthly' }, '2028-01-31')).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1');
    expect(recurrenceRule({ frequency: 'monthly', interval: 3 }, '2027-03-31', { timed: true })).toBe('FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=-1');
    expect(recurrenceRule({ frequency: 'monthly' }, '2027-01-30')).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=28,29,30;BYSETPOS=-1');
    expect(recurrenceRule({ frequency: 'monthly' }, '2028-01-29')).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=28,29;BYSETPOS=-1');
  });

  // Codex review #285 round 5: one rule for the monthly date, in one helper
  // (= bw_calendar_monthly_date in 182): counted from the first date, a short
  // month takes its last day and carries nothing over.
  it('monthly from Jan 31 2027: Feb 28, Mar 31, Apr 30, through one helper', () => {
    expect([1, 2, 3].map((k) => monthlyDate('2027-01-31', k))).toEqual(['2027-02-28', '2027-03-31', '2027-04-30']);
    expect(monthlyDate('2028-01-31', 1)).toBe('2028-02-29');
    expect(monthlyDate('2026-12-31', 2)).toBe('2027-02-28');
    expect(monthlyDate('2027-01-30', 0)).toBe('2027-01-30');
    expect(monthlyDate('junk', 1)).toBeNull();
    expect(isOccurrence({ frequency: 'monthly', skip_dates: ['2027-02-28'] }, '2027-01-31', '2027-03-31')).toBe(true);
    expect(isOccurrence({ frequency: 'monthly' }, '2027-01-31', '2027-04-03')).toBe(false);
  });
});

// Claude review of #285 r5 (M2): a carriage return in a text field (title,
// band, venue, calendar name) must never start a new property line.
describe('ICS text: no injected lines', () => {
  it('\\r, \\r\\n and \\n in every text field are escaped as \\n', () => {
    const ev = gigEvent(
      { title: 'Gig\rATTENDEE:mailto:x@example.com', bandName: 'Band\r\nX-INJ:1', date: '2026-12-01', start: '20:00', venue: 'Hall\rX-VENUE:1', city: 'Queens', address: '1 Main St\nX-ADDR:1', role: 'Bass\r', url: 'https://bandwith.fun/x\rX-URL:1' },
      { loadIn: 'Load-in', soundcheck: 'Soundcheck', show: 'Show', role: 'Role', rehearsal: 'Rehearsal' },
      'ev-inj\rX-UID:1',
    );
    const ics = calendarFile([ev], 'Cal\rX-NAME:1', 'Member');
    const lines = ics.split(/\r\n|\r|\n/).filter((l) => !l.startsWith(' '));
    expect(lines.some((l) => /^(ATTENDEE|X-INJ|X-VENUE|X-ADDR|X-NAME|X-URL|X-UID)/.test(l))).toBe(false);
    expect(ics.replace(/\r\n /g, '')).toContain('SUMMARY:Gig\\nATTENDEE:mailto:x@example.com · Band\\nX-INJ:1');
    expect(ics.split('\r\n').every((l) => !l.includes('\r'))).toBe(true);
  });
});

// Claude review of #285, round 4. RFC 5545 3.3.10: UNTIL has DTSTART's value
// type, and with a floating DTSTART (a date with local time, no TZID, as
// these files are) it is a local date-time too. A DATE UNTIL after a
// DATE-TIME DTSTART is invalid, and calendars read it differently.
describe('UNTIL has the value type of DTSTART', () => {
  const until = (ics: string) => /RRULE:[^\r\n]*UNTIL=([0-9TZ]+)/.exec(ics)?.[1];
  const dtstart = (ics: string) => /DTSTART(;VALUE=DATE)?:([0-9TZ]+)/.exec(ics);
  const ending = { ...weekly, recurrence: { frequency: 'weekly', interval: 1, until: '2027-01-26' } };

  it('a rehearsal with a time: a local date-time at the end of the last day', () => {
    const ics = memberFeedCalendar([ending], { lang: 'en', site: SITE, now: NOW }) as string;
    expect(dtstart(ics)?.[0]).toBe('DTSTART:20261124T190000');
    expect(until(ics)).toBe('20270126T235959');
  });

  it('an all-day rehearsal: a date, like DTSTART', () => {
    const ics = memberFeedCalendar([{ ...ending, start_time: null, end_time: null }], { lang: 'en', site: SITE, now: NOW }) as string;
    expect(dtstart(ics)?.[1]).toBe(';VALUE=DATE');
    expect(until(ics)).toBe('20270126');
  });

  it('the rule builder takes the value type', () => {
    expect(recurrenceRule({ frequency: 'monthly', until: '2027-06-30' }, '2026-11-30', { timed: true })).toBe(
      'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=28,29,30;BYSETPOS=-1;UNTIL=20270630T235959',
    );
    expect(recurrenceRule({ frequency: 'monthly', until: '2027-06-30' }, '2026-11-30')).toBe(
      'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=28,29,30;BYSETPOS=-1;UNTIL=20270630',
    );
  });
});
