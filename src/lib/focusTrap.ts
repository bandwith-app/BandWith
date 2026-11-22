import { useEffect, type RefObject } from 'react';

/**
 * Keyboard focus for modal layers (BwSheet, the iPad composer): on open,
 * focus moves into the layer; Tab and Shift+Tab wrap inside it, so they never
 * reach the controls behind the scrim; on close, focus goes back to what
 * opened it (not into a text field: that would raise the on-screen keyboard).
 *
 * Only the top layer traps, and the order the layers opened in decides which
 * one that is, not where they sit in the page. A dialog, popover or menu that
 * opens while a trap is on (a portal on <body> such as the input-list editor,
 * a select's list) becomes the top layer by itself, but only if it is really
 * above: shown (not hidden, aria-hidden, inert or display:none), modal
 * (not aria-modal="false", like the band invite card), and not covered at its
 * centre by the layer on top (the scrim). A list that belongs to the top
 * layer (inside it, or controlled from it with aria-controls, like the venue
 * suggestions) is part of that layer. Focus moves into a new dialog (a
 * popover places its own), and when it goes, focus returns to what opened it
 * in the layer beneath. When the last layer of useFocusTrap closes, the trap
 * lets go of the page. Pointer input is left alone: on the iPhone Duo the
 * rail beside a sheet stays usable.
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

/** A field that raises the on-screen keyboard when focused. */
const TEXT_FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const isTextField = (el: Element | null | undefined): boolean => !!el?.matches?.(TEXT_FIELD);

/**
 * Lists a layer owns without containing them: popovers on <body> that a
 * control inside it points at with aria-controls / aria-owns.
 */
const ownedPopups = (root: HTMLElement): HTMLElement[] => {
  const out: HTMLElement[] = [];
  root.querySelectorAll('[aria-controls],[aria-owns]').forEach((c) => {
    const ids = `${c.getAttribute('aria-controls') ?? ''} ${c.getAttribute('aria-owns') ?? ''}`.split(/\s+/);
    for (const id of ids) {
      const el = id ? document.getElementById(id) : null;
      if (el && !root.contains(el) && el.matches(POPOVER)) out.push(el);
    }
  });
  return out;
};
/** `node` is in the layer, or in a list the layer owns. */
const inLayer = (root: HTMLElement, node: Node | null): boolean =>
  !!node && (root.contains(node) || ownedPopups(root).some((p) => p.contains(node)));

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

/**
 * Layers that appeared, with what had focus then: checked on the next frame,
 * once laid out, or at the next Tab if that comes first.
 */
const pending = new Map<HTMLElement, HTMLElement | null>();
let pendingFrame = 0;
const flushPending = () => {
  if (pending.size) considerPending();
};

/** Direction of the Tab being handled, until the browser has moved focus. */
let tabbing: { backwards: boolean } | null = null;

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== 'Tab' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  flushPending();
  const root = top();
  if (!root || !root.isConnected) return;
  const active = document.activeElement as HTMLElement | null;
  // Anything outside the top layer is beneath it (layers above it would be on top).
  const inside = inLayer(root, active);
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
  if (!tabbing || !root || !root.isConnected || !target || inLayer(root, target)) return;
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

/**
 * Focus into a layer that just opened (unless something in it took it
 * already): its first control that is not a text field, so the on-screen
 * keyboard stays down and Escape still reaches the layer; else the layer.
 */
const focusInto = (el: HTMLElement) => {
  if (!el.isConnected || el.contains(document.activeElement)) return;
  if (el.hasAttribute('tabindex') || !focusFirstOf(tabbables(el).filter((c) => !isTextField(c)))) {
    if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
    el.focus({ preventScroll: true });
  }
};

const restore = (opener: HTMLElement | null) => {
  const typing = isTextField(opener);
  if (opener && opener.isConnected && opener !== document.body && !typing) opener.focus({ preventScroll: true });
};

/** A layer closed: focus back to what opened it, or else into the layer now on top. */
const backToTrap = (opener: HTMLElement | null) => {
  restore(opener);
  const root = top();
  if (root && root.isConnected && !root.contains(document.activeElement)) {
    const typing = isTextField(opener);
    // A text field that opened it keeps the on-screen keyboard down: leave focus be.
    if (!(typing && opener?.isConnected && root.contains(opener))) focusInto(root);
  }
};

/** Shown: not hidden, aria-hidden, inert, display:none or visibility:hidden. */
const shown = (el: HTMLElement): boolean => {
  if (el.closest('[hidden],[inert],[aria-hidden="true"]') || !visible(el)) return false;
  if (typeof (el as { checkVisibility?: unknown }).checkVisibility === 'function') return true;
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  }
  return true;
};

/** z-index of the outermost ancestor that sets one (its place on the page), if any. */
const zOf = (el: HTMLElement): number | null => {
  let z: number | null = null;
  for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
    const v = Number.parseInt(getComputedStyle(n).zIndex, 10);
    if (Number.isFinite(v)) z = v;
  }
  return z;
};

/**
 * `el` is above the layer on top: at its centre (or its first controls') the
 * page shows `el`, not the scrim or the layer. Without a hit test (off
 * screen, or no layout) the z-index decides when both set one.
 */
const above = (el: HTMLElement, below: HTMLElement): boolean => {
  const hitTest = (document as { elementFromPoint?: unknown }).elementFromPoint;
  const r = el.getBoundingClientRect();
  if (typeof hitTest === 'function' && r.width > 0 && r.height > 0) {
    const points = [r, ...tabbables(el).slice(0, 3).map((c) => c.getBoundingClientRect())].map((q) => [
      q.left + q.width / 2,
      q.top + q.height / 2,
    ]);
    let covered = false;
    for (const [x, y] of points) {
      if (!(x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight)) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit) continue;
      if (el.contains(hit)) return true;
      covered = true;
    }
    if (covered) return false;
  }
  // A layer with no z-index of its own opened later: trust the order.
  const [mine, theirs] = [zOf(el), zOf(below)];
  return mine === null || theirs === null || mine >= theirs;
};


const consider = (el: HTMLElement, opener: HTMLElement | null) => {
  const below = topLayer();
  if (!below || !el.isConnected || entryOf(el)) return;
  // Not modal (the band invite card), or part of a layer already there.
  if (el.matches('[aria-modal="false"]') || el.contains(below.el) || stack.some((l) => l.el.contains(el))) return;
  const dialog = el.matches(DIALOG);
  if (!dialog && stack.some((l) => ownedPopups(l.el).includes(el))) return;
  // Waiting hidden (a popup that yields to the sheet), or under the scrim.
  if (!shown(el) || !above(el, below.el)) return;
  stack.push({ el, opener, auto: true, ownFocus: !dialog });
  if (dialog) focusInto(el);
};

const considerPending = () => {
  if (pendingFrame) window.cancelAnimationFrame(pendingFrame);
  pendingFrame = 0;
  const list = [...pending];
  pending.clear();
  for (const [el, opener] of list) consider(el, opener);
};

/** No layer of useFocusTrap left: the layers found above it go too, and the trap stops. */
const stopIfUnowned = () => {
  if (stack.some((l) => !l.auto)) return;
  stack.length = 0;
  stop();
};

/**
 * While a layer is trapped, dialogs, popovers and menus that appear (portals
 * on <body>) join the stack on top on their own if they are above it, and
 * leave it when they go.
 */
const onMutations = (records: MutationRecord[]) => {
  // Layers added later go after the end guard: keep it last on the page.
  const end = guards[1];
  if (end && document.body.lastElementChild !== end && document.activeElement !== end) document.body.append(end);
  const LAYERS = `${DIALOG},${POPOVER}`;
  for (const r of records) {
    r.addedNodes.forEach((n) => {
      if (!(n instanceof HTMLElement)) return;
      const found = [...(n.matches(LAYERS) ? [n] : []), ...Array.from(n.querySelectorAll<HTMLElement>(LAYERS))];
      for (const el of found) if (!pending.has(el)) pending.set(el, document.activeElement as HTMLElement | null);
    });
  }
  if (pending.size && !pendingFrame) pendingFrame = window.requestAnimationFrame(considerPending);
  // A dialog that went: back to what opened it, if focus went with it.
  for (let i = stack.length - 1; i >= 0; i--) {
    const l = stack[i];
    if (!l.auto || l.el.isConnected) continue;
    stack.splice(i, 1);
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) backToTrap(l.opener);
  }
  stopIfUnowned();
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
  if (pendingFrame) window.cancelAnimationFrame(pendingFrame);
  pendingFrame = 0;
  pending.clear();
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
  // Layers that opened above it and are still around stay on the stack while
  // another layer of useFocusTrap is open.
  stopIfUnowned();
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
