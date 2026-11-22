import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
const rpc = vi.hoisted(() => vi.fn());
const who = vi.hoisted(() => ({ id: 'user-1', onAuth: null as null | ((event: string, session: unknown) => void) }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc,
    auth: {
      getSession: async () => ({ data: { session: who.id ? { user: { id: who.id } } : null } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        who.onAuth = cb;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
    },
  },
}));

import { calendarFile, gigEvent, googleCalendarUrl, recurrenceRule } from '../deputyCalendar';
import {
  _resetCalendarTokenCache,
  googleSubscribeUrl,
  memberCalendarUrl,
  memberEventCalendarUrl,
  keepMyCalendarLink,
  myCalendarLinkReview,
  myCalendarToken,
  useCalendarLinkReview,
  useCalendarToken,
  myEventCalendarToken,
  useEventCalendarToken,
  webcalUrl,
} from '../memberCalendar';

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

describe('member calendar: one-event links (182)', () => {
  beforeEach(() => {
    rpc.mockReset();
    _resetCalendarTokenCache();
  });

  it('asks for a token bound to that event and date, once per event and date', async () => {
    const EV = '11111111-2222-4333-8444-555555555555';
    rpc.mockResolvedValueOnce({ data: 'd'.repeat(64), error: null }).mockResolvedValueOnce({ data: 'e'.repeat(64), error: null });
    expect(await myEventCalendarToken(EV, '2026-12-08')).toBe('d'.repeat(64));
    expect(await myEventCalendarToken(EV, '2026-12-08')).toBe('d'.repeat(64));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenLastCalledWith('bw_my_event_calendar_link', { p_event_id: EV, p_date: '2026-12-08' });
    expect(await myEventCalendarToken(EV, '2026-12-15')).toBe('e'.repeat(64));
    expect(rpc).toHaveBeenCalledTimes(2);
    // Making a new account link (rotate) also ends the event links.
    rpc.mockResolvedValueOnce({ data: TOKEN, error: null }).mockResolvedValueOnce({ data: 'f'.repeat(64), error: null });
    await myCalendarToken(true);
    expect(await myEventCalendarToken(EV, '2026-12-08')).toBe('f'.repeat(64));
  });

  // Claude review #285 round 5: opening an event reads only; the tap makes it.
  it('opening reads the link (bw_my_event_calendar_link); only a tap makes one (bw_my_event_calendar_token)', async () => {
    const EV = '11111111-2222-4333-8444-555555555555';
    rpc.mockImplementation(async (fn: string) => ({ data: fn === 'bw_my_event_calendar_token' ? 'd'.repeat(64) : null, error: null }));
    const { result } = renderHook(() => useEventCalendarToken(EV, '2026-12-08'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.token).toBeNull();
    expect(rpc).toHaveBeenCalledWith('bw_my_event_calendar_link', { p_event_id: EV, p_date: '2026-12-08' });
    expect(rpc).not.toHaveBeenCalledWith('bw_my_event_calendar_token', expect.anything());
    expect(await myEventCalendarToken(EV, '2026-12-08', { create: true })).toBe('d'.repeat(64));
    expect(rpc).toHaveBeenLastCalledWith('bw_my_event_calendar_token', { p_event_id: EV, p_date: '2026-12-08' });
    rpc.mockClear();
    // Made: a second tap reuses it.
    expect(await myEventCalendarToken(EV, '2026-12-08', { create: true })).toBe('d'.repeat(64));
    expect(rpc).not.toHaveBeenCalled();
  });

  it('null for a draft id, a bad date or no answer from the server', async () => {
    expect(await myEventCalendarToken('draft-1', '2026-12-08')).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'missing function' } });
    expect(await myEventCalendarToken('11111111-2222-4333-8444-555555555555', null)).toBeNull();
  });

  it('builds the one-event link without the account token', () => {
    expect(memberEventCalendarUrl('d'.repeat(64), 'it')).toMatch(/\/functions\/v1\/member-calendar\?o=d{64}&l=it$/);
    expect(memberEventCalendarUrl('nope')).toBeNull();
  });
});

// Codex review #285 round 2.
describe('member calendar: links stay current in a session', () => {
  const EV = '11111111-2222-4333-8444-555555555555';
  const D = 'd'.repeat(64);
  const F = 'f'.repeat(64);
  const G = 'c'.repeat(64);
  beforeEach(() => {
    rpc.mockReset();
    _resetCalendarTokenCache();
  });

  // "Make a new link" ends the event's link: the mounted button must not
  // keep it (it would open a 404).
  it('a mounted Add to calendar picks up the new event link after a rotation', async () => {
    let eventToken = D;
    rpc.mockImplementation(async (fn: string) => (fn === 'bw_my_event_calendar_link' ? { data: eventToken, error: null } : { data: TOKEN, error: null }));
    const { result } = renderHook(() => useEventCalendarToken(EV, '2026-12-08'));
    await waitFor(() => expect(result.current.token).toBe(D));
    eventToken = F; // the server ended D with the account link
    await act(async () => {
      await myCalendarToken(true);
    });
    await waitFor(() => expect(result.current.token).toBe(F));
  });

  // The server drops the oldest links past 500 per account: reopening the
  // event asks again instead of reusing a link that is gone.
  it('reopening an event asks the server again (an evicted link is replaced)', async () => {
    let eventToken = D;
    rpc.mockImplementation(async () => ({ data: eventToken, error: null }));
    const first = renderHook(() => useEventCalendarToken(EV, '2026-12-08'));
    await waitFor(() => expect(first.result.current.token).toBe(D));
    first.unmount();
    eventToken = G;
    const again = renderHook(() => useEventCalendarToken(EV, '2026-12-08'));
    await waitFor(() => expect(again.result.current.token).toBe(G));
  });

  it('a failed refresh (offline) keeps the link it had', async () => {
    rpc.mockResolvedValueOnce({ data: D, error: null });
    const first = renderHook(() => useEventCalendarToken(EV, '2026-12-08'));
    await waitFor(() => expect(first.result.current.token).toBe(D));
    first.unmount();
    rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
    const again = renderHook(() => useEventCalendarToken(EV, '2026-12-08'));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(again.result.current.token).toBe(D);
  });

  // Offline at the first check: the answer is not kept, the next check asks again.
  it('a failed review check is asked again later', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } });
    expect(await myCalendarLinkReview()).toBe(false);
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await myCalendarLinkReview()).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  // Codex review #285 round 4: "Keep my link" on another device. A "yes"
  // remembered here must not keep asking: every open asks the server, and
  // the question shows only once this open's answer is in.
  it('a yes from an earlier open is never shown again without asking the server', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const first = renderHook(() => useCalendarLinkReview());
    await waitFor(() => expect(first.result.current).toBe(true));
    first.unmount();
    let answer!: (v: unknown) => void;
    rpc.mockImplementation(() => new Promise((r) => (answer = r)));
    const again = renderHook(() => useCalendarLinkReview());
    await new Promise((r) => setTimeout(r, 10));
    expect(again.result.current).toBe(false); // nothing shown on the old answer
    await act(async () => answer({ data: false, error: null }));
    expect(again.result.current).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('after Keep my link the server is asked again, and an answer from before is ignored', async () => {
    let early!: (v: unknown) => void;
    rpc.mockImplementation((fn: string) =>
      fn === 'bw_my_calendar_link_review' && !early ? new Promise((r) => (early = r)) : Promise.resolve({ data: fn === 'bw_my_calendar_link_keep' ? null : false, error: null }),
    );
    const hook = renderHook(() => useCalendarLinkReview());
    await waitFor(() => expect(early).toBeTypeOf('function'));
    expect(await keepMyCalendarLink()).toBe(true);
    await act(async () => early({ data: true, error: null })); // asked before the keep
    expect(hook.result.current).toBe(false);
    expect(rpc.mock.calls.filter((c) => c[0] === 'bw_my_calendar_link_review').length).toBeGreaterThanOrEqual(2);
  });
});

// Codex review #285 round 3.
describe('member calendar: one device, two accounts', () => {
  const EV = '11111111-2222-4333-8444-555555555555';
  const A_LINK = 'd'.repeat(64);
  const B_LINK = 'e'.repeat(64);
  beforeEach(() => {
    rpc.mockReset();
    _resetCalendarTokenCache();
    who.id = 'user-1';
  });

  it("B never sees A's event link, not even while B's own request is on its way", async () => {
    rpc.mockImplementation(async (fn: string) => (fn === 'bw_my_event_calendar_link' ? { data: A_LINK, error: null } : { data: TOKEN, error: null }));
    await myCalendarToken(); // A opened Calendar sync
    const a = renderHook(() => useEventCalendarToken(EV, '2026-12-08'));
    await waitFor(() => expect(a.result.current.token).toBe(A_LINK));
    a.unmount();
    // A signs out, B signs in on the same device.
    who.id = 'user-2';
    who.onAuth?.('SIGNED_OUT', null);
    who.onAuth?.('SIGNED_IN', { user: { id: 'user-2' } });
    let answer: (v: unknown) => void = () => undefined;
    rpc.mockImplementation(() => new Promise((r) => (answer = r)));
    const b = renderHook(() => useEventCalendarToken(EV, '2026-12-08'));
    expect(b.result.current.token).toBeNull();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(b.result.current.token).toBeNull();
    await act(async () => answer({ data: B_LINK, error: null }));
    await waitFor(() => expect(b.result.current.token).toBe(B_LINK));
  });

  // Codex review #285 round 5 (B2): A's account-link answer arriving after
  // A signed out and B signed in is dropped: never on B's screen, never kept.
  it("a late account-link answer for A never reaches B", async () => {
    const A_TOKEN = 'b'.repeat(64);
    const B_TOKEN = 'c'.repeat(64);
    who.onAuth?.('SIGNED_IN', { user: { id: 'user-1' } });
    const answers: ((v: unknown) => void)[] = [];
    rpc.mockImplementation(() => new Promise((r) => answers.push(r)));
    const forA = myCalendarToken(); // A's request goes out
    await waitFor(() => expect(answers).toHaveLength(1));
    who.id = 'user-2';
    who.onAuth?.('SIGNED_OUT', null);
    who.onAuth?.('SIGNED_IN', { user: { id: 'user-2' } });
    const b = renderHook(() => useCalendarToken());
    await waitFor(() => expect(answers).toHaveLength(2));
    await act(async () => answers[0]({ data: A_TOKEN, error: null })); // A's answer, late
    expect(await forA).toBeNull();
    expect(b.result.current.token).not.toBe(A_TOKEN);
    await act(async () => answers[1]({ data: B_TOKEN, error: null }));
    await waitFor(() => expect(b.result.current.token).toBe(B_TOKEN));
    rpc.mockReset();
    expect(await myCalendarToken()).toBe(B_TOKEN); // B's, from the cache
    expect(rpc).not.toHaveBeenCalled();
  });

  // A "no" is not kept: the flag can be set from elsewhere (an old link used
  // on another device), so each time the notice shows it asks again.
  it('the old-link question is asked again on each open after a "no"', async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    const first = renderHook(() => useCalendarLinkReview());
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(first.result.current).toBe(false);
    first.unmount();
    rpc.mockResolvedValueOnce({ data: true, error: null });
    const again = renderHook(() => useCalendarLinkReview());
    await waitFor(() => expect(again.result.current).toBe(true));
  });
});
