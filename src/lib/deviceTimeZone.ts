import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * The device's IANA time zone ("America/New_York"), or null when the platform
 * has none. Codex #297 r8: every profile held 004's default (Europe/Rome)
 * because the app never wrote it, so the server's "today" was Rome's for a
 * New York admin. The zone goes with each date action (p_tz on
 * bw_skip/restore/move_rehearsal_date) and to the profile on sign-in.
 * profiles.timezone is VARCHAR(50): a longer name is not a zone.
 */
export function deviceTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.length > 0 && tz.length <= 50 ? tz : null;
  } catch {
    return null;
  }
}

/**
 * Keeps profiles.timezone equal to the device's zone, as useServerLocaleSync
 * does preferred_language, so the server's other "today" logic (vote
 * deadlines, 117) is the user's for new builds too. One write per change,
 * none when the profile already says so; the column default is left alone.
 */
export function useServerTimezoneSync(userId: string | null | undefined, serverTz: string | null | undefined) {
  const zone = deviceTimeZone();
  // The last value written and the profile value it was written over: the
  // profile in memory isn't read again after the write.
  const sent = useRef<{ userId: string; tz: string; over: string | null | undefined } | null>(null);
  useEffect(() => {
    if (!userId || !zone) return;
    const last = sent.current;
    const serverHas = last && last.userId === userId && last.over === serverTz ? last.tz : serverTz;
    if (serverHas === zone) return;
    const entry = { userId, tz: zone, over: serverTz };
    sent.current = entry;
    void supabase
      .from('profiles')
      .update({ timezone: zone })
      .eq('id', userId)
      .then(({ error }) => {
        // Try again on the next render (back online, next launch).
        if (error && sent.current === entry) sent.current = null;
      });
  }, [userId, serverTz, zone]);
}
