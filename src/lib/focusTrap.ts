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

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== 'Tab' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const root = stack[stack.length - 1];
  if (!root || !root.isConnected) return;
  const active = document.activeElement as HTMLElement | null;
  const inside = !!active && root.contains(active);
  if (!inside && active && active !== document.body) {
    // In a layer opened above this one (it handles its own focus).
    const layer = active.closest(LAYER);
    if (layer && layer !== root && !layer.contains(root)) return;
  }
  const items = tabbables(root);
  if (!items.length) {
    e.preventDefault();
    root.focus({ preventScroll: true });
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (!inside) {
    // Focus behind the layer: bring it back in.
    e.preventDefault();
    focusFirstOf(e.shiftKey ? [...items].reverse() : items);
  } else if (e.shiftKey && (active === first || active === root)) {
    e.preventDefault();
    focusFirstOf([...items].reverse());
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    focusFirstOf(items);
  }
};

let listening = false;
const push = (el: HTMLElement) => {
  stack.push(el);
  if (!listening) {
    document.addEventListener('keydown', onKeyDown);
    listening = true;
  }
};
const remove = (el: HTMLElement) => {
  const i = stack.lastIndexOf(el);
  if (i >= 0) stack.splice(i, 1);
  if (!stack.length && listening) {
    document.removeEventListener('keydown', onKeyDown);
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
