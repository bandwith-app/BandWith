import { getPosture } from './posture';

/** Window event fired as the keyboard shows or hides: detail `{ open: boolean }`. */
export const KEYBOARD_EVENT = 'bwkeyboard';

/** True while the software keyboard is up (native builds only). */
export function isKeyboardOpen(): boolean {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-keyboard') === 'open';
}

/** A vertical span in viewport px. */
export interface Span {
  top: number;
  bottom: number;
}

/** Room kept between the field being typed in and the fold, the keyboard or an edge. */
const GAP = 8;
/** The highest a field may rest on the Display (clear of the clock block). */
const DISPLAY_TOP = 64;

/**
 * Laptop pose (iPhone Duo half folded) with the keyboard up: how far to
 * scroll so the field being typed in rests where it can be read.
 *
 * The web view ends at the keyboard but the fold stays where it is on the
 * screen, so only a strip of the Deck is left between the fold band and the
 * keys. The field goes there, just above the keyboard, like typing on a
 * laptop; if it does not fit, it rests on the Display just above the fold.
 * Never on the fold band, and never outside `clip`: the part of its scroller
 * that shows, below any header pinned at its top.
 *
 * Returns the scroll delta (positive: the content moves up), 0 when the field
 * already rests in its place, or null when it fits nowhere.
 */
export function laptopRevealDelta(
  field: Span,
  clip: Span,
  bands: { displayH: number; deckTop: number },
  viewH: number,
  /** How far the content can still move down (the scroller's scrollTop). */
  maxDown = Infinity,
): number | null {
  const height = field.bottom - field.top;
  const zone = (top: number, bottom: number): Span | null => {
    const z = { top: Math.max(top, clip.top), bottom: Math.min(bottom, clip.bottom) };
    if (z.bottom - z.top < height) return null;
    if (inside(z)) return z;
    // Content already at its top cannot move down to it.
    return field.bottom - z.bottom < -maxDown - 0.5 ? null : z;
  };
  const inside = (z: Span) => field.top >= z.top - 0.5 && field.bottom <= z.bottom + 0.5;
  const place = zone(bands.deckTop + GAP, viewH - GAP) ?? zone(DISPLAY_TOP, bands.displayH - GAP);
  if (!place) return null;
  return inside(place) ? 0 : field.bottom - place.bottom;
}

const FIELD = 'input, textarea, select';

/**
 * The box the person sees as the field: an input often sits in a styled
 * wrapper (icon, Show password) that has to show whole, not only the input.
 * Wrappers with text of their own (a label) are not part of it.
 */
function fieldBox(el: HTMLElement): HTMLElement {
  let box = el;
  for (let i = 0, p = el.parentElement; i < 3 && p; i++, p = p.parentElement) {
    if (p.querySelectorAll(FIELD).length !== 1 || (p.textContent ?? '').trim() !== '') break;
    if (p.getBoundingClientRect().height > el.getBoundingClientRect().height + 48) break;
    box = p;
  }
  return box;
}

/** The box the field scrolls in: its nearest scrolling ancestor, or the page. */
function scrollerOf(el: HTMLElement): HTMLElement {
  for (let s = el.parentElement; s && s !== document.body && s !== document.documentElement; s = s.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(s).overflowY)) return s;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

const isPage = (s: HTMLElement) => s === document.scrollingElement || s === document.documentElement;

/** The part of a scroller that shows, below a header pinned at its top. */
function clipOf(scroller: HTMLElement, field: HTMLElement): Span {
  const r = isPage(scroller) ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
  let top = Math.max(0, r.top);
  for (const child of Array.from(scroller.children) as HTMLElement[]) {
    if (child.contains(field) || getComputedStyle(child).position !== 'sticky') continue;
    const c = child.getBoundingClientRect();
    if (c.height > 0 && c.top <= top + 1) top = Math.max(top, c.bottom);
  }
  return { top, bottom: Math.min(window.innerHeight, r.bottom) };
}

/**
 * Marks <html data-keyboard="open"> while the software keyboard is up, and
 * keeps the field being typed in where it can be read.
 *
 * Keyboard resize is 'native' (capacitor.config.ts), so the web view already
 * ends at the top of the keyboard. The home-indicator / navigation-bar inset
 * in --safe-bottom then only adds dead space above the keyboard; theme.css
 * zeroes it while this attribute is set.
 *
 * It follows the window events the Keyboard plugin fires on iOS and Android
 * (`keyboardWillShow`, `keyboardDidShow`, `keyboardWillHide`,
 * `keyboardDidHide`); in a browser nothing fires them and it stays idle.
 */
export function installKeyboardInsets(): void {
  if (typeof document === 'undefined') return;
  const w = window as Window & { __bwKeyboardInsets?: boolean };
  if (w.__bwKeyboardInsets) return;
  w.__bwKeyboardInsets = true;
  const root = document.documentElement;
  const tell = (open: boolean) => window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT, { detail: { open } }));
  // A keyboard is up only for a field being typed in. iOS can report one
  // while rotating (the Duo between postures) with nothing focused: a flag
  // left on then would hide the Duo rail in the laptop pose for good.
  const typing = () => {
    const el = document.activeElement as HTMLElement | null;
    return !!el && (el.matches(FIELD) || el.isContentEditable);
  };
  const open = () => {
    if (!typing()) return;
    root.setAttribute('data-keyboard', 'open');
    tell(true);
  };
  // Room added under a scroller so its last field can rise above the keyboard.
  const padded = new Map<HTMLElement, string>();
  const pad = (box: HTMLElement, extra: number) => {
    if (!padded.has(box)) padded.set(box, box.style.paddingBottom);
    const base = parseFloat(getComputedStyle(box).paddingBottom) || 0;
    box.style.paddingBottom = `${base + extra}px`;
  };
  const unpad = () => {
    padded.forEach((value, scroller) => { scroller.style.paddingBottom = value; });
    padded.clear();
  };
  const close = () => {
    root.removeAttribute('data-keyboard');
    unpad();
    tell(false);
  };
  // Laptop pose: the field rests on the strip of the Deck above the keyboard
  // (or on the Display), never on the fold band (laptopRevealDelta). A field
  // near the end of its scroller first gets room below it to rise into.
  const revealInLaptopPose = (el: HTMLElement, bands: { displayH: number; deckTop: number }) => {
    const scroller = scrollerOf(el);
    const r = fieldBox(el).getBoundingClientRect();
    const delta = laptopRevealDelta({ top: r.top, bottom: r.bottom }, clipOf(scroller, el), bands, window.innerHeight, scroller.scrollTop);
    if (!delta) return;
    const short = Math.ceil(scroller.scrollTop + delta - (scroller.scrollHeight - scroller.clientHeight));
    // The page itself gets its room on <body>.
    if (delta > 0 && short > 0) pad(isPage(scroller) ? document.body : scroller, short);
    scroller.scrollTop += delta;
  };
  // The field being typed in stays in sight: on a short screen (a phone in
  // landscape: ~216 px left) it could sit under the keyboard or a pinned
  // footer, and the web view does not scroll it up by itself.
  const reveal = () => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || !(el.matches(FIELD) || el.isContentEditable)) return;
    const p = getPosture();
    if (p.posture === 'tabletop' && p.fold?.orientation === 'horizontal' && p.bands) {
      revealInLaptopPose(el, p.bands);
      return;
    }
    const r = el.getBoundingClientRect();
    // Already well inside the visible area (clear of a pinned footer): leave it.
    const limit = window.innerHeight - 96;
    if (r.top >= 64 && r.bottom <= limit) return;
    el.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    // A field near the end of its scroller (a form's last fields) cannot
    // scroll any higher: give that scroller room below, then scroll again.
    requestAnimationFrame(() => {
      const after = el.getBoundingClientRect();
      if (after.bottom <= limit || document.activeElement !== el) return;
      let scroller = el.parentElement;
      while (scroller && !(/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight)) {
        scroller = scroller.parentElement;
      }
      if (!scroller) return;
      const extra = Math.ceil(after.bottom - limit) + 16;
      pad(scroller, extra);
      scroller.scrollTop += extra;
    });
  };
  // The web view shrinks to the keyboard's top only after keyboardDidShow
  // on some devices, so reveal again once its size has settled.
  let settle: ReturnType<typeof setTimeout> | undefined;
  const revealSoon = () => {
    requestAnimationFrame(reveal);
    clearTimeout(settle);
    settle = setTimeout(reveal, 320);
  };
  window.addEventListener('keyboardWillShow', open);
  window.addEventListener('keyboardDidShow', revealSoon);
  window.addEventListener('keyboardWillHide', close);
  window.addEventListener('keyboardDidHide', () => {
    if (root.getAttribute('data-keyboard') === 'open') close();
  });
  // The flag never outlives the field: after a rotation or a blur with no
  // hide event, drop it once nothing is being typed in.
  const dropIfIdle = () => {
    if (root.getAttribute('data-keyboard') === 'open' && !typing()) close();
  };
  window.addEventListener('resize', () => {
    if (root.getAttribute('data-keyboard') !== 'open') return;
    if (!typing()) return close();
    revealSoon();
  });
  document.addEventListener('focusout', () => setTimeout(dropIfIdle, 400));
  // Moving to another field while the keyboard stays up.
  document.addEventListener('focusin', () => {
    if (root.getAttribute('data-keyboard') === 'open') setTimeout(revealSoon, 50);
  });
}
