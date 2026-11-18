import { onAppResume } from '@/lib/appResume';

/**
 * A slow background refresh for lists that Realtime already keeps fresh.
 *
 * Home, the calendar and the bell used to re-fetch every 30–60 s while the
 * app was open, which was most of our Supabase egress and API logs. Changes
 * now arrive through Realtime and when the app comes back to the front; this
 * timer only catches what a dropped socket may have missed.
 */
export const SAFETY_NET_POLL_MS = 5 * 60_000;

/** A modal or full-screen layer is open: refreshing under it can move the keyboard or the scroll. */
const layerOpen = () =>
  !!(document.querySelector('[data-modal-open="true"]') || document.querySelector('.fixed.inset-0.z-\\[100\\]'));

/**
 * Runs `refresh` every `intervalMs` while the page is visible and no layer is
 * open, and once each time the app comes back to the front. Returns the stop
 * function for a useEffect cleanup.
 */
export function startSafetyNetPoll(refresh: () => unknown, intervalMs: number = SAFETY_NET_POLL_MS): () => void {
  const id = setInterval(() => {
    if (document.visibilityState === 'visible' && !layerOpen()) void refresh();
  }, intervalMs);
  const offResume = onAppResume(() => { void refresh(); });
  return () => {
    clearInterval(id);
    offResume();
  };
}
