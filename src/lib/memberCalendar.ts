/**
 * Calendar sync for an account (migration 165, edge function member-calendar):
 * a private link that shows the user's gigs, rehearsals and personal gigs in
 * Apple / Google / Outlook calendars and keeps them up to date, plus
 * "Add to calendar" for one event.
 *
 * The link token is fetched once per session and cached, so the buttons can
 * open the link straight from the tap (a link opened after an await is a
 * blocked pop-up on the web).
 */
import { isDemoMode, supabase } from '@/lib/supabase';
import { getLocale } from '@/lib/i18n';
import { useEffect, useState } from 'react';

let cached: { userId: string; token: string } | null = null;
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

/** The feed (all events), or one event as a file to import (`eventId`). */
export function memberCalendarUrl(token: string, opts: { eventId?: string; lang?: string } = {}): string | null {
  // The demo (and e2e) has no server: a placeholder address that goes nowhere.
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || (isDemoMode ? 'https://demo.invalid' : undefined);
  if (!base || !/^[0-9a-f]{64}$/.test(token)) return null;
  const q = new URLSearchParams({ t: token, l: opts.lang ?? getLocale() });
  if (opts.eventId) q.set('e', opts.eventId);
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
}
