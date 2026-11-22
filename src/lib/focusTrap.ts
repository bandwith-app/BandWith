import { useEffect, type RefObject } from 'react';

/**
 * Keyboard focus for modal layers (BwSheet, the iPad composer): on open,
 * focus moves into the layer; Tab and Shift+Tab wrap inside it, so they never
 * reach the controls behind the scrim; on close, focus goes back to what
 * opened it (not into a text field: that would raise the on-screen keyboard).
 *
 * Only the top layer traps. A layer opened above (a picker sheet, a popover
 * or menu on <body>) keeps its own focus. Pointer input is left alone: on the
 * iPhone Duo the rail beside a sheet stays usable.
 */

const stack: HTMLElement[] = [];

const TABBABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

/** Layers that sit above a sheet when they are portaled to <body>. */
const LAYER = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]';

const visible = (el: HTMLElement): boolean => {
  if (el.closest('[hidden],[inert]')) return false;
  const check = (el as HTMLElement & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (typeof check === 'function') return check.call(el, { visibilityProperty: true });
  // No layout at all (tests): count it as visible.
  if (!document.documentElement.getClientRects().length) return true;
  return el.getClientRects().length > 0;
};

export const tabbables = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => el.tabIndex >= 0 && visible(el));

/** Focus the first of `list` that takes it (some can't, e.g. hidden by CSS). */
const focusFirstOf = (list: HTMLElement[]): boolean =>
  list.some((el) => {
    el.focus({ preventScroll: true });
    return document.activeElement === el;
  });

/** A layer above `root` (a popover or picker on <body>) keeps its own focus. */
const inLayerAbove = (el: Element, root: HTMLElement): boolean => {
  const layer = el.closest(LAYER);
  return !!layer && layer !== root && !layer.contains(root);
};

const wrapInto = (root: HTMLElement, backwards: boolean) => {
  const items = tabbables(root);
  if (!focusFirstOf(backwards ? [...items].reverse() : items)) root.focus({ preventScroll: true });
};

/** Direction of the Tab being handled, until the browser has moved focus. */
let tabbing: { backwards: boolean } | null = null;

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== 'Tab' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const root = stack[stack.length - 1];
  if (!root || !root.isConnected) return;
  const active = document.activeElement as HTMLElement | null;
  const inside = !!active && root.contains(active);
  if (!inside && active && active !== document.body && inLayerAbove(active, root)) return;
  const items = tabbables(root);
  if (!inside || !items.length) {
    // Focus behind the layer (or nothing to focus in it): bring it back in.
    e.preventDefault();
    wrapInto(root, e.shiftKey);
    return;
  }
  if (e.shiftKey ? active === items[0] || active === root : active === items[items.length - 1]) {
    e.preventDefault();
    wrapInto(root, e.shiftKey);
    return;
  }
  // Otherwise the browser moves focus. Its tab order can differ from ours
  // (Safari skips buttons unless the user turned that on): if focus lands
  // outside the layer, onFocusIn wraps it.
  tabbing = { backwards: e.shiftKey };
  window.setTimeout(() => {
    tabbing = null;
  }, 0);
};

const onFocusIn = (e: FocusEvent) => {
  const root = stack[stack.length - 1];
  const target = e.target as Element | null;
  if (!tabbing || !root || !root.isConnected || !target || root.contains(target)) return;
  if (!target.hasAttribute?.('data-bw-focus-guard') && inLayerAbove(target, root)) return;
  wrapInto(root, tabbing.backwards);
};

/**
 * Focusable edges of the page while a trap is on: Tab past the last control
 * of the page lands here (and comes back into the layer) instead of leaving
 * for the browser's toolbar.
 */
let guards: HTMLElement[] = [];
const makeGuard = () => {
  const g = document.createElement('span');
  g.tabIndex = 0;
  g.setAttribute('data-bw-focus-guard', '');
  g.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none;outline:none';
  return g;
};

let listening = false;
const push = (el: HTMLElement) => {
  stack.push(el);
  if (!listening) {
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn, true);
    guards = [makeGuard(), makeGuard()];
    document.body.prepend(guards[0]);
    document.body.append(guards[1]);
    listening = true;
  }
};
const remove = (el: HTMLElement) => {
  const i = stack.lastIndexOf(el);
  if (i >= 0) stack.splice(i, 1);
  if (!stack.length && listening) {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('focusin', onFocusIn, true);
    guards.forEach((g) => g.remove());
    guards = [];
    tabbing = null;
    listening = false;
  }
};

/**
 * Traps keyboard focus in `ref` while `active`. The element needs
 * tabIndex={-1} so it can take focus itself when it has no control.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement as HTMLElement | null;
    // Registered at once (above the layer that opened it); focus moves on the
    // next frame, once the layer is on screen.
    let el: HTMLElement | null = ref.current;
    if (el) push(el);
    const id = window.requestAnimationFrame(() => {
      if (!el) {
        el = ref.current;
        if (el) push(el);
      }
      if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(id);
      if (el) remove(el);
      const typing = opener?.matches?.('input, textarea, select, [contenteditable="true"]');
      if (opener && opener.isConnected && opener !== document.body && !typing) opener.focus({ preventScroll: true });
    };
  }, [active, ref]);
}
