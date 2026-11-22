/**
 * Calendar sync for an account (migration 165, edge function member-calendar):
 * a private link that shows the user's gigs, rehearsals and personal gigs in
 * Apple / Google / Outlook calendars and keeps them up to date, plus
 * "Add to calendar" for one event.
 *
 * "Add to calendar" uses its own link, bound to that one event and date
 * (migration 182): a forwarded one-event link never opens the whole feed.
 *
 * The tokens are fetched once per session and cached, so the buttons can
 * open the link straight from the tap (a link opened after an await is a
 * blocked pop-up on the web).
 */
import { isDemoMode, supabase } from '@/lib/supabase';
import { getLocale } from '@/lib/i18n';
import { useEffect, useState } from 'react';

let cached: { userId: string; token: string } | null = null;
/** One-event link tokens by `user|event|date`. */
const eventTokens = new Map<string, Promise<string | null>>();
let pending: Promise<string | null> | null = null;
const listeners = new Set<(token: string | null) => void>();

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/** The signed-in user's link token (created on first use); rotate = a new one. */
export async function myCalendarToken(rotate = false): Promise<string | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  if (!rotate && cached?.userId === userId) return cached.token;
  if (!rotate && pending) return pending;
  const run = (async () => {
    const { data, error } = await supabase.rpc('bw_my_calendar_token', { p_rotate: rotate });
    if (error || typeof data !== 'string' || !/^[0-9a-f]{64}$/.test(data)) return null;
    cached = { userId, token: data };
    // A new account link ends the one-event links too (182: they hang off it).
    if (rotate) eventTokens.clear();
    listeners.forEach((l) => l(data));
    return data;
  })();
  if (!rotate) pending = run;
  try {
    return await run;
  } finally {
    if (!rotate) pending = null;
  }
}

/** The token for the signed-in user (null while loading or unavailable). */
export function useCalendarToken(enabled = true): { token: string | null; loading: boolean } {
  const [token, setToken] = useState<string | null>(cached?.token ?? null);
  const [loading, setLoading] = useState(enabled && !cached);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    listeners.add(setToken);
    void myCalendarToken().then((t) => {
      if (!alive) return;
      setToken(t);
      setLoading(false);
    });
    return () => {
      alive = false;
      listeners.delete(setToken);
    };
  }, [enabled]);
  return { token, loading };
}

/**
 * The feed (all events). `eventId` is how builds before 182 asked for one
 * event (the account token in a shareable link): use memberEventCalendarUrl.
 */
export function memberCalendarUrl(token: string, opts: { eventId?: string; lang?: string } = {}): string | null {
  // The demo (and e2e) has no server: a placeholder address that goes nowhere.
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || (isDemoMode ? 'https://demo.invalid' : undefined);
  if (!base || !/^[0-9a-f]{64}$/.test(token)) return null;
  const q = new URLSearchParams({ t: token, l: opts.lang ?? getLocale() });
  if (opts.eventId) q.set('e', opts.eventId);
  return `${base}/functions/v1/member-calendar?${q.toString()}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The signed-in user's link to one event (182). `date`: the date shown
 * (one date of a repeating rehearsal); the server keeps it only for a
 * repeating event.
 */
export async function myEventCalendarToken(eventId: string, date: string | null): Promise<string | null> {
  if (!UUID.test(eventId)) return null;
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  const userId = await currentUserId();
  if (!userId) return null;
  const key = `${userId}|${eventId.toLowerCase()}|${day ?? ''}`;
  const known = eventTokens.get(key);
  if (known) return known;
  const run = (async () => {
    const { data, error } = await supabase.rpc('bw_my_event_calendar_token', { p_event_id: eventId, p_date: day });
    if (error || typeof data !== 'string' || !/^[0-9a-f]{64}$/.test(data)) {
      eventTokens.delete(key);
      return null;
    }
    return data;
  })();
  eventTokens.set(key, run);
  return run;
}

/** The one-event token for the signed-in user (null while loading or unavailable). */
export function useEventCalendarToken(eventId: string, date: string | null): { token: string | null; loading: boolean } {
  const [state, setState] = useState<{ key: string; token: string | null; loading: boolean }>({ key: '', token: null, loading: true });
  const key = `${eventId}|${date ?? ''}`;
  useEffect(() => {
    let alive = true;
    setState({ key, token: null, loading: true });
    void myEventCalendarToken(eventId, date).then((t) => {
      if (alive) setState({ key, token: t, loading: false });
    });
    return () => {
      alive = false;
    };
  }, [eventId, date, key]);
  return state.key === key ? { token: state.token, loading: state.loading } : { token: null, loading: true };
}

/** One event as a file to import once (182): no account token in it. */
export function memberEventCalendarUrl(eventToken: string, lang?: string): string | null {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || (isDemoMode ? 'https://demo.invalid' : undefined);
  if (!base || !/^[0-9a-f]{64}$/.test(eventToken)) return null;
  const q = new URLSearchParams({ o: eventToken, l: lang ?? getLocale() });
  return `${base}/functions/v1/member-calendar?${q.toString()}`;
}

/** Apple Calendar / Outlook subscribe through webcal:. */
export const webcalUrl = (feedUrl: string) => feedUrl.replace(/^https?:/, 'webcal:');

/** Google Calendar's "add calendar from URL" with the feed filled in. */
export const googleSubscribeUrl = (feedUrl: string) =>
  `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(feedUrl))}`;

/** For tests. */
export function _resetCalendarTokenCache() {
  cached = null;
  pending = null;
  eventTokens.clear();
}
