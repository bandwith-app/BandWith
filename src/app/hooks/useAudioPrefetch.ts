import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';
import { cachedAudio, downloadAudio } from '@/lib/regiaAudio';
import { localToday, prefetchSetlistIds, type PrefetchEvent } from '@/lib/audioPrefetch';

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/**
 * When the app opens with internet: an admin's phone downloads the song files
 * of the setlists of its confirmed gigs in the next few days (lib/audioPrefetch),
 * so the stage manager plays them at a venue with no signal. Native apps only
 * (the files go to the app's own storage; on the web the gig's
 * "Download audio" button does it). One file at a time; once per set of gigs,
 * and again when the internet comes back.
 */
export function useAudioPrefetch(events: PrefetchEvent[], isAdmin: (bandId?: string) => boolean) {
  const native = Capacitor.isNativePlatform();
  const ids = native ? prefetchSetlistIds(events, isAdmin, localToday()) : [];
  const key = ids.join('|');
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const done = useRef<string | null>(null);
  const running = useRef(false);
  /** A pass asked for while one runs (the gigs changed): runs after it. */
  const again = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (!key) return;
    let stopped = false;
    const run = async () => {
      if (running.current) {
        again.current = run;
        return;
      }
      if (stopped || !isOnline() || done.current === key) return;
      running.current = true;
      try {
        const { data, error } = await supabase.from('setlist_songs').select('setlist_id, song:songs(audio_url)').in('setlist_id', idsRef.current);
        if (error || !data) return;
        const refs = [
          ...new Set(
            (data as { song?: { audio_url?: string | null } | null }[])
              .map((r) => r.song?.audio_url)
              .filter((a): a is string => typeof a === 'string' && !!a),
          ),
        ];
        const have = await cachedAudio(refs);
        let offline = false;
        for (const ref of refs) {
          if (stopped) return;
          if (have.has(ref)) continue;
          const result = await downloadAudio(ref);
          if (!result.ok && result.reason === 'offline') offline = true;
        }
        // Fetched (or the links are broken: the gig's card says why). Lost
        // internet midway: the next 'online' tries again.
        if (!offline && !stopped) done.current = key;
      } catch {
        /* next time */
      } finally {
        running.current = false;
        const next = again.current;
        again.current = null;
        if (next) void next();
      }
    };
    const timer = window.setTimeout(() => void run(), 0);
    const back = () => void run();
    window.addEventListener('online', back);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener('online', back);
    };
  }, [key]);
}
