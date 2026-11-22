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
 * Round 3: everything here belongs to the account signed in; another
 * account on the device (or none) starts from nothing, and an old-link
 * question answered "no" is asked again on the next open.
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
/** Mounted one-event buttons: told when a tap made the link of their key (`user|event|date`). */
const eventTokenMadeListeners = new Set<(key: string, token: string) => void>();
/**
 * The database has no one-event links yet (182 not applied: PGRST202, the
 * function is not found). Claude review #285 r5 (M4): Add to calendar then
 * uses the link of builds before 182 (memberCalendarUrl with eventId).
 * Cleared by the first answer from a 182 function.
 */
let eventLinksMissing = false;
/** True once a 182 one-event function was not found on the database. */
export const eventCalendarLinksMissing = () => eventLinksMissing;
const endEventTokens = () => {
  eventTokens.clear();
  eventTokenValues.clear();
  eventTokensInFlight.clear();
  eventTokenListeners.forEach((l) => l());
};
/** The account-link request on its way: whose, and in which account generation. */
let pending: { userId: string; gen: number; run: Promise<string | null> } | null = null;
/**
 * Bumped when the account on the device changes (Codex review #285 round 5,
 * B2): an answer asked for before is dropped, never cached or shown.
 */
let accountGen = 0;
/** Still the account (and generation) the request was made for? */
const sameAccount = (userId: string, gen: number) =>
  gen === accountGen && (authUserId === undefined || authUserId === userId);
const listeners = new Set<(token: string | null) => void>();
/** Mounted account-link hooks: told when another account signs in. */
const accountListeners = new Set<() => void>();

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/** The signed-in user's link token (created on first use); rotate = a new one. */
export async function myCalendarToken(rotate = false): Promise<string | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  if (!rotate && cached?.userId === userId) return cached.token;
  const gen = accountGen;
  if (!rotate && pending?.userId === userId && pending.gen === gen) return pending.run;
  const run = (async () => {
    const { data, error } = await supabase.rpc('bw_my_calendar_token', { p_rotate: rotate });
    // Another account signed in meanwhile: not this one's link.
    if (!sameAccount(userId, gen)) return null;
    if (error || typeof data !== 'string' || !/^[0-9a-f]{64}$/.test(data)) return null;
    cached = { userId, token: data };
    listeners.forEach((l) => l(data));
    if (rotate) {
      // A new account link starts unmarked (182): ask the server again.
      settleReview();
      // It ends the one-event links too (182: they hang off it).
      endEventTokens();
    }
    return data;
  })();
  if (!rotate) pending = { userId, gen, run };
  try {
    return await run;
  } finally {
    if (pending?.run === run) pending = null;
  }
}

/** The token for the signed-in user (null while loading or unavailable). */
export function useCalendarToken(enabled = true): { token: string | null; loading: boolean } {
  const mine = () => (cached && (authUserId === undefined || cached.userId === authUserId) ? cached.token : null);
  const [token, setToken] = useState<string | null>(mine);
  const [loading, setLoading] = useState(enabled && !mine());
  // A new account on the device: ask again, for that account.
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const l = () => setGeneration((g) => g + 1);
    accountListeners.add(l);
    return () => {
      accountListeners.delete(l);
    };
  }, []);
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
  }, [enabled, generation]);
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
 *
 * Opening an event only reads the link (bw_my_event_calendar_link: no write
 * on the server; Claude review #285 round 5). `create`: the tap on Add to
 * calendar, which makes it if there is none yet (bw_my_event_calendar_token).
 */
export async function myEventCalendarToken(
  eventId: string,
  date: string | null,
  opts: { refresh?: boolean; create?: boolean } = {},
): Promise<string | null> {
  if (!UUID.test(eventId)) return null;
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  const userId = await currentUserId();
  if (!userId) return null;
  const key = eventTokenKey(userId, eventId, day);
  const known = eventTokens.get(key);
  if (known && (!opts.refresh || eventTokensInFlight.has(key))) {
    if (!opts.create) return known;
    const have = await known;
    if (have) return have; // already made
  }
  const before = eventTokenValues.get(key) ?? null;
  const fn = opts.create ? 'bw_my_event_calendar_token' : 'bw_my_event_calendar_link';
  // Assigned below; read only after the first await, to tell a stale reply.
  let run!: Promise<string | null>;
  run = (async () => {
    try {
      const { data, error } = await Promise.resolve(supabase.rpc(fn, { p_event_id: eventId, p_date: day })).catch(
        (e: unknown) => ({ data: null, error: e }),
      );
      if (eventTokens.get(key) !== run) return (await eventTokens.get(key)) ?? null; // ended meanwhile
      eventLinksMissing = (error as { code?: string } | null)?.code === 'PGRST202';
      if (!error && typeof data === 'string' && /^[0-9a-f]{64}$/.test(data)) {
        eventTokenValues.set(key, data);
        // The buttons show this link from now on (only theirs: Codex review
        // #285 round 5, never a URL kept aside that a new link has ended).
        if (opts.create) eventTokenMadeListeners.forEach((l) => l(key, data));
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
export function useEventCalendarToken(
  eventId: string,
  date: string | null,
): { token: string | null; loading: boolean; legacy: boolean } {
  const [state, setState] = useState<{ key: string; token: string | null; loading: boolean; legacy?: boolean }>({
    key: '',
    token: null,
    loading: true,
  });
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
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
    const made = (k: string, token: string) => {
      if (!UUID.test(eventId)) return;
      // This event and date, for the account signed in now (when known).
      const same = authUserId ? k === eventTokenKey(authUserId, eventId, day) : k.endsWith(eventTokenKey('', eventId, day));
      if (same) setState({ key, token, loading: false });
    };
    eventTokenMadeListeners.add(made);
    return () => {
      eventTokenMadeListeners.delete(made);
    };
  }, [eventId, date, key]);
  useEffect(() => {
    let alive = true;
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
    // The last link of the account signed in now, never another's.
    const userId = authUserId !== undefined ? (cached?.userId === authUserId ? authUserId : null) : cached?.userId ?? null;
    const last = userId && UUID.test(eventId) ? eventTokenValues.get(eventTokenKey(userId, eventId, day)) ?? null : null;
    setState({ key, token: last, loading: !last });
    void myEventCalendarToken(eventId, date, { refresh: true }).then((t) => {
      if (alive) setState({ key, token: t, loading: false, legacy: !t && eventLinksMissing });
    });
    return () => {
      alive = false;
    };
  }, [eventId, date, key, generation]);
  return state.key === key
    ? { token: state.token, loading: state.loading, legacy: !!state.legacy }
    : { token: null, loading: true, legacy: false };
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

// Never remembered between opens (Codex review #285 round 4): the flag is
// set and cleared from elsewhere too (an old link used, "Keep my link" on
// another device), so every open asks the server and the question shows only
// on that answer. `review` only shares one request in flight; `reviewGen`
// turns an answer asked for before a keep or a new link into a "no".
let review: { userId: string; gen: number; value: Promise<boolean> } | null = null;
let reviewGen = 0;
const reviewListeners = new Set<(v: boolean) => void>();
const settleReview = () => {
  reviewGen += 1;
  review = null;
  reviewListeners.forEach((l) => l(false));
  // Read the server again (it keeps review_kept), never the earlier answer.
  if (reviewListeners.size) void myCalendarLinkReview().then((v) => reviewListeners.forEach((l) => l(v)), () => undefined);
};

/** Whether to ask the signed-in user to replace their calendar link. */
export async function myCalendarLinkReview(): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId) return false;
  if (review?.userId === userId && review.gen === reviewGen) return review.value;
  const gen = reviewGen;
  let value!: Promise<boolean>;
  value = (async () => {
    try {
      const { data, error } = await supabase.rpc('bw_my_calendar_link_review');
      // Offline or "no": nothing to ask. Asked before a keep or a new link: stale.
      return !error && data === true && gen === reviewGen;
    } finally {
      if (review?.value === value) review = null;
    }
  })();
  review = { userId, gen, value };
  return value;
}

/** "Keep my link": don't ask again. */
export async function keepMyCalendarLink(): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId) return false;
  const { error } = await supabase.rpc('bw_my_calendar_link_keep');
  if (error) return false;
  settleReview();
  return true;
}

/** A new account link: the old one (and every link made with it) stops. */
export async function replaceMyCalendarLink(): Promise<boolean> {
  const next = await myCalendarToken(true);
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

// -------------------------------------------- one account at a time --
// A sign-out, or another account signing in on this device, drops what the
// previous account had here (review of #285, round 3): its account link, its
// one-event links and its old-link answer. Mounted hooks start again.

/** The account the auth client reports (undefined until it has said). */
let authUserId: string | null | undefined;

function forgetAccount() {
  accountGen += 1;
  cached = null;
  pending = null;
  review = null;
  reviewGen += 1;
  reviewListeners.forEach((l) => l(false));
  listeners.forEach((l) => l(null));
  endEventTokens();
  accountListeners.forEach((l) => l());
}

try {
  if (typeof (supabase.auth as { onAuthStateChange?: unknown } | undefined)?.onAuthStateChange === 'function') {
    supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user?.id ?? null;
      const changed = authUserId !== undefined && next !== authUserId;
      authUserId = next;
      if (changed || (cached && cached.userId !== next)) forgetAccount();
    });
  }
} catch {
  /* demo / test clients without auth events */
}

/** For tests. */
export function _resetCalendarTokenCache() {
  cached = null;
  pending = null;
  eventTokens.clear();
  eventTokenValues.clear();
  eventTokensInFlight.clear();
  eventLinksMissing = false;
  review = null;
}
