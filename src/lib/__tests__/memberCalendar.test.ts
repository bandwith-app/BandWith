import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc,
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }) },
  },
}));

import { calendarFile, gigEvent, googleCalendarUrl, recurrenceRule } from '../deputyCalendar';
import { _resetCalendarTokenCache, googleSubscribeUrl, memberCalendarUrl, myCalendarToken, webcalUrl } from '../memberCalendar';

const L = { loadIn: 'Load-in', soundcheck: 'Soundcheck', show: 'Show', role: 'Role', rehearsal: 'Rehearsal' };
const TOKEN = 'a'.repeat(64);

describe('member calendar: recurring rehearsals', () => {
  it('turns the app recurrence rule into an RRULE', () => {
    expect(recurrenceRule({ frequency: 'weekly', interval: 1 })).toBe('FREQ=WEEKLY;INTERVAL=1');
    expect(recurrenceRule({ freq: 'biweekly' })).toBe('FREQ=WEEKLY;INTERVAL=2');
    expect(recurrenceRule({ frequency: 'monthly', interval: 2, until: '2027-06-30' })).toBe('FREQ=MONTHLY;INTERVAL=2;UNTIL=20270630');
    // The app counts the repeats after the first date.
    expect(recurrenceRule({ frequency: 'weekly', count: 9 })).toBe('FREQ=WEEKLY;INTERVAL=1;COUNT=10');
    expect(recurrenceRule({ frequency: 'custom' })).toBeNull();
    expect(recurrenceRule(null)).toBeNull();
    expect(recurrenceRule({ frequency: 'weekly', interval: 'x' })).toBe('FREQ=WEEKLY;INTERVAL=1');
  });

  it('writes the RRULE and a rehearsal label into the entry', () => {
    const lines = gigEvent(
      { title: 'Weekly', bandName: 'Velvet Static', kind: 'rehearsal', date: '2026-11-24', start: '19:00:00', end: '22:00:00' },
      L,
      'event-1',
      { rrule: 'FREQ=WEEKLY;INTERVAL=1', now: new Date(Date.UTC(2026, 10, 19)) },
    );
    expect(lines).toContain('RRULE:FREQ=WEEKLY;INTERVAL=1');
    expect(lines.join('\n')).toContain('DESCRIPTION:Rehearsal 19:00–22:00');
  });

  it('titles a personal gig without a band', () => {
    const ics = calendarFile([gigEvent({ title: 'Solo set', bandName: '', date: '2026-12-01' }, L, 'event-2')], 'BandWith', 'Member');
    expect(ics).toContain('SUMMARY:Solo set\r\n');
    expect(ics).toContain('PRODID:-//BandWith//Member//EN');
    expect(ics).toContain('X-WR-CALNAME:BandWith');
    expect(googleCalendarUrl({ title: 'Solo set', bandName: '', date: '2026-12-01' }, L)).toContain('text=Solo+set&');
  });
});

describe('member calendar: links', () => {
  beforeEach(() => {
    rpc.mockReset();
    _resetCalendarTokenCache();
  });

  it('builds the feed, one-event, webcal and Google links', () => {
    const feed = memberCalendarUrl(TOKEN, { lang: 'it' });
    expect(feed).toMatch(/\/functions\/v1\/member-calendar\?t=a{64}&l=it$/);
    expect(memberCalendarUrl(TOKEN, { eventId: 'e-1', lang: 'en' })).toMatch(/&e=e-1$/);
    expect(memberCalendarUrl('not-a-token')).toBeNull();
    expect(webcalUrl(feed!)).toMatch(/^webcal:\/\//);
    expect(googleSubscribeUrl(feed!)).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?cid=webcal%3A%2F%2F/);
  });

  it('asks the server once, and again with rotate', async () => {
    rpc.mockResolvedValueOnce({ data: TOKEN, error: null }).mockResolvedValueOnce({ data: 'b'.repeat(64), error: null });
    expect(await myCalendarToken()).toBe(TOKEN);
    expect(await myCalendarToken()).toBe(TOKEN);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenLastCalledWith('bw_my_calendar_token', { p_rotate: false });
    expect(await myCalendarToken(true)).toBe('b'.repeat(64));
    expect(rpc).toHaveBeenLastCalledWith('bw_my_calendar_token', { p_rotate: true });
    expect(await myCalendarToken()).toBe('b'.repeat(64));
  });

  it('gives null when the server has no link', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'missing function' } });
    expect(await myCalendarToken()).toBeNull();
  });
});
