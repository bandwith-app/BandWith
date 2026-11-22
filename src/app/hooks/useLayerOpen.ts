import { useLayoutEffect, useState } from 'react';

/**
 * Is a sheet, a modal, a full-screen editor or Stage mode open? Sheets,
 * Stage and hubs are a `role="dialog"` or `role="alertdialog"`; the gig
 * editor and the quote wizard mark themselves `data-modal-open="true"`
 * (also read by safetyNetPoll), other modals `aria-modal="true"`. Plain
 * screens have none of these on any device. Layers that announce
 * themselves (the urgent pop-up, toasts) step aside while one is open.
 */
const URGENT = '[data-bw-urgent]';
// The urgent pop-up (`data-bw-urgent`) is what steps aside, never a layer
// itself: as a modal alert dialog (#298) it would wait on itself and leave
// in a loop. Nor is anything inside it.
const SELECTOR = ['[role="dialog"]', '[role="alertdialog"]', '[data-modal-open="true"]', '[aria-modal="true"]']
  .map((s) => `${s}:not(${URGENT})`)
  .join(', ');
const WATCHED = ['role', 'hidden', 'data-modal-open', 'aria-modal', 'data-bw-urgent'];

const shown = (el: Element): boolean => {
  if (!el.isConnected || el.closest('[hidden]') || el.closest(URGENT)) return false;
  const style = (el as HTMLElement).style;
  return !style || style.display !== 'none';
};

export function anyLayerOpen(root: ParentNode = document): boolean {
  return Array.from(root.querySelectorAll(SELECTOR)).some(shown);
}

/**
 * Follows sheets and modals opening and closing (one check per task at most).
 * `watch`: false while nothing needs to know (no DOM watching then).
 */
export function useLayerOpen(watch = true): boolean {
  const hasDom = typeof document !== 'undefined';
  const [open, setOpen] = useState(() => (hasDom ? anyLayerOpen() : false));
  // Has the watcher answered since watching started? Until then `open` may be
  // stale (a sheet opened while nobody watched): the render that starts
  // watching reads the page itself, so an urgent pop-up never mounts for one
  // frame over a sheet that is already open (it would flash and leave).
  const [synced, setSynced] = useState(false);
  if (!watch && synced) setSynced(false);
  useLayoutEffect(() => {
    if (!watch || !hasDom || typeof MutationObserver === 'undefined') return;
    let queued = false;
    const check = () => {
      queued = false;
      setOpen(anyLayerOpen());
      setSynced(true);
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      // A microtask, not a frame: rAF stops in a background tab.
      queueMicrotask(check);
    };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: WATCHED });
    check();
    return () => mo.disconnect();
  }, [watch, hasDom]);
  if (watch && !synced) return hasDom ? anyLayerOpen() : false;
  return open;
}
