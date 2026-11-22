import { useLayoutEffect, useState } from 'react';

/**
 * Is a sheet, a modal or Stage mode open? Every one of them is a
 * `role="dialog"` (BwSheet, Stage, hubs) or `role="alertdialog"`; plain
 * screens have none on any device. Layers that announce themselves (the
 * urgent pop-up, toasts) step aside while one is open.
 */
const SELECTOR = '[role="dialog"], [role="alertdialog"]';

const shown = (el: Element): boolean => {
  if (!el.isConnected || el.closest('[hidden]')) return false;
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
  const [open, setOpen] = useState(() => (typeof document === 'undefined' ? false : anyLayerOpen()));
  // Layout effect: checked before paint when watching starts, so nothing
  // flashes over a sheet that was already open.
  useLayoutEffect(() => {
    if (!watch || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    let queued = false;
    const check = () => {
      queued = false;
      setOpen(anyLayerOpen());
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      // A microtask, not a frame: rAF stops in a background tab.
      queueMicrotask(check);
    };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'hidden'] });
    check();
    return () => mo.disconnect();
  }, [watch]);
  return open;
}
