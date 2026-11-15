/**
 * Detail screens share the right pane on the iPad and the open Duo, each with
 * a fixed z-index. A screen opened from the list column while a higher one
 * already fills the pane (Edit profile, a chat) would open underneath it and
 * the tap would look dead. Used as a ref callback, this lifts the screen just
 * above the detail screens already showing, staying under the app's own
 * confirm sheets (z-170) and the Duo rail (z-190).
 */
const CEILING = 160;

export function raiseAboveOpenPanes(el: HTMLElement | null): void {
  if (!el || typeof window === 'undefined') return;
  const own = Number.parseInt(window.getComputedStyle(el).zIndex, 10) || 0;
  let top = own;
  document.querySelectorAll<HTMLElement>('.bw-pane-detail').forEach((other) => {
    if (other === el || other.contains(el) || el.contains(other)) return;
    if (other.getClientRects().length === 0) return;
    const z = Number.parseInt(window.getComputedStyle(other).zIndex, 10);
    if (Number.isFinite(z) && z >= top) top = z + 1;
  });
  if (top > own) el.style.zIndex = String(Math.min(top, CEILING));
}

/**
 * Ref callback for a row's pop-up menu: a row low on the screen scrolls so
 * the whole menu shows above the tab bar (give the menu a scroll-margin-bottom).
 * A module-level function, so React calls it once on mount, not on every render.
 */
export function revealMenu(el: HTMLElement | null): void {
  if (el) requestAnimationFrame(() => el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }));
}

/** The scroll margin that keeps a revealed menu clear of the floating tab bar. */
export const MENU_SCROLL_MARGIN = { scrollMarginBottom: 'calc(var(--safe-bottom, 0px) + 112px)' } as const;
