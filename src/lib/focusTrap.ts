import { useEffect, type RefObject } from 'react';

/**
 * Keyboard focus for modal layers (BwSheet, the iPad composer): on open,
 * focus moves into the layer; Tab and Shift+Tab wrap inside it, so they never
 * reach the controls behind the scrim; on close, focus goes back to what
 * opened it (not into a text field: that would raise the on-screen keyboard).
 *
 * Only the top layer traps, and the order the layers opened in decides which
 * one that is, not where they sit in the page. Any dialog, popover or menu
 * that opens while a trap is on (a portal on <body> such as the input-list
 * editor, a nested sheet, a select's list) becomes the top layer by itself:
 * focus moves into a dialog (a popover places its own), and when the layer
 * goes, focus returns to what opened it in the layer beneath. Pointer input
 * is left alone: on the iPhone Duo the rail beside a sheet stays usable.
 */

interface Layer {
  el: HTMLElement;
  /** What had focus when the layer opened. */
  opener: HTMLElement | null;
  /** Found on the page (a layer that opened above), not registered by useFocusTrap. */
  auto: boolean;
  /** A popover or menu: it handles Tab and focus itself while it is on top. */
  ownFocus?: boolean;
}

const stack: Layer[] = [];
const topLayer = (): Layer | undefined => stack[stack.length - 1];
/** The layer that traps, if the top one leaves focus to the trap. */
const top = (): HTMLElement | undefined => {
  const l = topLayer();
  return l && !l.ownFocus ? l.el : undefined;
};
const entryOf = (el: HTMLElement) => stack.find((l) => l.el === el);

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

/** Dialogs: a new one above the top layer takes the focus over. */
const DIALOG = '[role="dialog"],[role="alertdialog"],[aria-modal="true"]';
/** Popovers and menus, which handle their own focus. */
const POPOVER = '[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]';

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

/**
 * Focus the first of `list` that takes it (some can't, e.g. hidden by CSS),
 * and bring it into view: wrapping can land on a control far below.
 */
const focusFirstOf = (list: HTMLElement[]): boolean =>
  list.some((el) => {
    el.focus({ preventScroll: true });
    if (document.activeElement !== el) return false;
    el.scrollIntoView?.({ block: 'nearest' });
    return true;
  });

const wrapInto = (root: HTMLElement, backwards: boolean) => {
  const items = tabbables(root);
  if (!focusFirstOf(backwards ? [...items].reverse() : items)) root.focus({ preventScroll: true });
};

/** Direction of the Tab being handled, until the browser has moved focus. */
let tabbing: { backwards: boolean } | null = null;

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== 'Tab' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const root = top();
  if (!root || !root.isConnected) return;
  const active = document.activeElement as HTMLElement | null;
  // Anything outside the top layer is beneath it (layers above it would be on top).
  const inside = !!active && root.contains(active);
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
  const root = top();
  const target = e.target as Element | null;
  if (!tabbing || !root || !root.isConnected || !target || root.contains(target)) return;
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

/** Focus into a layer that just opened (unless something in it took it already). */
const focusInto = (el: HTMLElement) => {
  if (!el.isConnected || el.contains(document.activeElement)) return;
  if (el.hasAttribute('tabindex') || !focusFirstOf(tabbables(el))) {
    if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
    el.focus({ preventScroll: true });
  }
};

const restore = (opener: HTMLElement | null) => {
  const typing = opener?.matches?.('input, textarea, select, [contenteditable="true"]');
  if (opener && opener.isConnected && opener !== document.body && !typing) opener.focus({ preventScroll: true });
};

/** A layer closed: focus back to what opened it, or else into the layer now on top. */
const backToTrap = (opener: HTMLElement | null) => {
  restore(opener);
  const root = top();
  if (root && root.isConnected && !root.contains(document.activeElement)) {
    const typing = opener?.matches?.('input, textarea, select, [contenteditable="true"]');
    // A text field that opened it keeps the on-screen keyboard down: leave focus be.
    if (!(typing && opener?.isConnected && root.contains(opener))) focusInto(root);
  }
};

/**
 * While a layer is trapped, dialogs, popovers and menus that appear (portals
 * on <body>, nested sheets) join the stack on top on their own, and leave it
 * when they go.
 */
const onMutations = (records: MutationRecord[]) => {
  // Layers added later go after the end guard: keep it last on the page.
  const end = guards[1];
  if (end && document.body.lastElementChild !== end && document.activeElement !== end) document.body.append(end);
  for (const r of records) {
    r.addedNodes.forEach((n) => {
      if (!(n instanceof HTMLElement)) return;
      const LAYERS = `${DIALOG},${POPOVER}`;
      const found = [...(n.matches(LAYERS) ? [n] : []), ...Array.from(n.querySelectorAll<HTMLElement>(LAYERS))];
      for (const el of found) {
        const below = topLayer()?.el;
        // Opened after the top layer, so above it, wherever it is in the page.
        if (entryOf(el) || el.closest('[hidden]') || !below || el.contains(below)) continue;
        const ownFocus = !el.matches(DIALOG) && !!el.closest(POPOVER);
        stack.push({ el, opener: document.activeElement as HTMLElement | null, auto: true, ownFocus });
        if (!ownFocus)
          window.requestAnimationFrame(() => {
            if (top() === el) focusInto(el);
          });
      }
    });
  }
  // A dialog that went: back to what opened it, if focus went with it.
  for (let i = stack.length - 1; i >= 0; i--) {
    const l = stack[i];
    if (!l.auto || l.el.isConnected) continue;
    stack.splice(i, 1);
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) backToTrap(l.opener);
  }
  if (!stack.length) stop();
};

let observer: MutationObserver | null = null;
let listening = false;
const start = () => {
  if (listening) return;
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('focusin', onFocusIn, true);
  guards = [makeGuard(), makeGuard()];
  document.body.prepend(guards[0]);
  document.body.append(guards[1]);
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  listening = true;
};
const stop = () => {
  if (!listening) return;
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('focusin', onFocusIn, true);
  observer?.disconnect();
  observer = null;
  guards.forEach((g) => g.remove());
  guards = [];
  tabbing = null;
  listening = false;
};

/** A layer registered by useFocusTrap (it may already be on the stack, found as it opened). */
const push = (el: HTMLElement, opener: HTMLElement | null): Layer => {
  const found = entryOf(el);
  if (found) {
    found.auto = false;
    return found;
  }
  const layer: Layer = { el, opener, auto: false };
  stack.push(layer);
  start();
  return layer;
};
const remove = (layer: Layer) => {
  const i = stack.indexOf(layer);
  if (i >= 0) stack.splice(i, 1);
  // Layers that opened above it and are still around stay on the stack.
  if (!stack.length) stop();
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
    let layer: Layer | null = ref.current ? push(ref.current, opener) : null;
    const id = window.requestAnimationFrame(() => {
      if (!layer && ref.current) layer = push(ref.current, opener);
      const el = layer?.el;
      if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(id);
      if (!layer) return;
      remove(layer);
      backToTrap(layer.opener);
    };
  }, [active, ref]);
}
