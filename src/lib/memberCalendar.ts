/**
 * Calendar sync for an account (migration 165, edge function member-calendar):
 * a private link that shows the user's gigs, rehearsals and personal gigs in
 * Apple / Google / Outlook calendars and keeps them up to date, plus
 * "Add to calendar" for one event.
 *
 * "Add to calendar" uses its own link, bound to that one event and date
 * (migration 182): a forwarded one-event link never opens the whole feed.
 *
 * The tokens are cached, so the buttons can open the link straight from the
 * tap (a link opened after an await is a blocked pop-up on the web). Codex
 * review #285 round 2: a one-event link is asked again each time an event
 * opens (the server may have ended it: 500 per account), every mounted
 * button follows a new account link, and a failed check is not kept.
 */
import { isDemoMode, supabase } from '@/lib/supabase';
import { getLocale } from '@/lib/i18n';
import { useEffect, useState } from 'react';

let cached: { userId: string; token: string } | null = null;
/** One-event link tokens by `user|event|date`: the last answer, and the request on its way. */
const eventTokens = new Map<string, Promise<string | null>>();
const eventTokenValues = new Map<string, string>();
const eventTokensInFlight = new Set<string>();
/** Mounted one-event buttons: told when every event link has ended (a new account link). */
const eventTokenListeners = new Set<() => void>();
const endEventTokens = () => {
  eventTokens.clear();
  eventTokenValues.clear();
  eventTokensInFlight.clear();
  eventTokenListeners.forEach((l) => l());
};
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
    listeners.forEach((l) => l(data));
    if (rotate) {
      // A new account link starts unmarked (182): nothing left to ask.
      setReview(userId, false);
      // It ends the one-event links too (182: they hang off it).
      endEventTokens();
    }
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
 * repeating event. `refresh`: ask the server again (it may have ended the
 * link); when that fails (offline) the last link is kept.
 */
export async function myEventCalendarToken(
  eventId: string,
  date: string | null,
  opts: { refresh?: boolean } = {},
): Promise<string | null> {
  if (!UUID.test(eventId)) return null;
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  const userId = await currentUserId();
  if (!userId) return null;
  const key = eventTokenKey(userId, eventId, day);
  const known = eventTokens.get(key);
  if (known && (!opts.refresh || eventTokensInFlight.has(key))) return known;
  const before = eventTokenValues.get(key) ?? null;
  // Assigned below; read only after the first await, to tell a stale reply.
  let run!: Promise<string | null>;
  run = (async () => {
    try {
      const { data, error } = await Promise.resolve(supabase.rpc('bw_my_event_calendar_token', { p_event_id: eventId, p_date: day })).catch(
        (e: unknown) => ({ data: null, error: e }),
      );
      if (eventTokens.get(key) !== run) return (await eventTokens.get(key)) ?? null; // ended meanwhile
      if (!error && typeof data === 'string' && /^[0-9a-f]{64}$/.test(data)) {
        eventTokenValues.set(key, data);
        return data;
      }
      if (error && before) return before; // not reached: keep the last link
      eventTokens.delete(key);
      eventTokenValues.delete(key);
      return null;
    } finally {
      if (eventTokens.get(key) === run) eventTokensInFlight.delete(key);
    }
  })();
  eventTokens.set(key, run);
  eventTokensInFlight.add(key);
  return run;
}

const eventTokenKey = (userId: string, eventId: string, day: string | null) => `${userId}|${eventId.toLowerCase()}|${day ?? ''}`;

/**
 * The one-event token for the signed-in user (null while loading or
 * unavailable). Shows the last known link at once (for the tap), asks the
 * server again on each mount, and follows a new account link.
 */
export function useEventCalendarToken(eventId: string, date: string | null): { token: string | null; loading: boolean } {
  const [state, setState] = useState<{ key: string; token: string | null; loading: boolean }>({ key: '', token: null, loading: true });
  const [generation, setGeneration] = useState(0);
  const key = `${eventId}|${date ?? ''}`;
  useEffect(() => {
    const l = () => setGeneration((g) => g + 1);
    eventTokenListeners.add(l);
    return () => {
      eventTokenListeners.delete(l);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
    const userId = cached?.userId ?? null;
    const last = userId && UUID.test(eventId) ? eventTokenValues.get(eventTokenKey(userId, eventId, day)) ?? null : null;
    setState({ key, token: last, loading: !last });
    void myEventCalendarToken(eventId, date, { refresh: true }).then((t) => {
      if (alive) setState({ key, token: t, loading: false });
    });
    return () => {
      alive = false;
    };
  }, [eventId, date, key, generation]);
  return state.key === key ? { token: state.token, loading: state.loading } : { token: null, loading: true };
}

/** One event as a file to import once (182): no account token in it. */
export function memberEventCalendarUrl(eventToken: string, lang?: string): string | null {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || (isDemoMode ? 'https://demo.invalid' : undefined);
  if (!base || !/^[0-9a-f]{64}$/.test(eventToken)) return null;
  const q = new URLSearchParams({ o: eventToken, l: lang ?? getLocale() });
  return `${base}/functions/v1/member-calendar?${q.toString()}`;
}

// ------------------------------------------- links shared before 182 --
// "Add to calendar" links made before 182 carry the account token; the app
// asks once to make a new link (bw_my_calendar_link_review).

let review: { userId: string; value: Promise<boolean> } | null = null;
const reviewListeners = new Set<(v: boolean) => void>();
const setReview = (userId: string, v: boolean) => {
  review = { userId, value: Promise.resolve(v) };
  reviewListeners.forEach((l) => l(v));
};

/** Whether to ask the signed-in user to replace their calendar link. */
export async function myCalendarLinkReview(): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId) return false;
  if (review?.userId === userId) return review.value;
  let value!: Promise<boolean>;
  value = (async () => {
    const { data, error } = await supabase.rpc('bw_my_calendar_link_review');
    // Not reached (offline): not kept, the next check asks again.
    if (error && review?.value === value) review = null;
    return !error && data === true;
  })();
  review = { userId, value };
  return value;
}

/** "Keep my link": don't ask again. */
export async function keepMyCalendarLink(): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId) return false;
  const { error } = await supabase.rpc('bw_my_calendar_link_keep');
  if (error) return false;
  setReview(userId, false);
  return true;
}

/** A new account link: the old one (and every link made with it) stops. */
export async function replaceMyCalendarLink(): Promise<boolean> {
  const next = await myCalendarToken(true);
  const userId = await currentUserId();
  if (next && userId) setReview(userId, false);
  return !!next;
}

export function useCalendarLinkReview(): boolean {
  const [needs, setNeeds] = useState(false);
  useEffect(() => {
    let alive = true;
    const l = (v: boolean) => alive && setNeeds(v);
    reviewListeners.add(l);
    void myCalendarLinkReview().then(l, () => l(false));
    return () => {
      alive = false;
      reviewListeners.delete(l);
    };
  }, []);
  return needs;
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
  eventTokenValues.clear();
  eventTokensInFlight.clear();
  review = null;
}
