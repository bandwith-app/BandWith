import { useEffect, useState } from 'react';
import type { LivePack } from '@/lib/livePack';
import { LIVE_PACK_CHANGED, readPack } from '@/lib/livePackStore';

/** This event's live pack on the device (null: none), kept current. */
export function useLivePack(userId?: string | null, bandId?: string | null, eventId?: string | null): LivePack | null {
  const [pack, setPack] = useState<LivePack | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void readPack(userId, bandId, eventId).then((p) => {
        if (alive) setPack(p);
      });
    load();
    const on = (e: Event) => {
      if ((e as CustomEvent<{ eventId?: string }>).detail?.eventId === eventId) load();
    };
    window.addEventListener(LIVE_PACK_CHANGED, on);
    return () => {
      alive = false;
      window.removeEventListener(LIVE_PACK_CHANGED, on);
    };
  }, [userId, bandId, eventId]);
  return pack && pack.eventId === eventId ? pack : null;
}

/** The device has a network now (navigator.onLine, kept current). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
