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

/**
 * The part of a scroller that shows, below a header pinned at its top, and
 * the pinned headers that cut it.
 */
function clipOf(scroller: HTMLElement, field: HTMLElement): Span & { heads: HTMLElement[] } {
  const r = isPage(scroller) ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
  let top = Math.max(0, r.top);
  const heads: HTMLElement[] = [];
  for (const child of Array.from(scroller.children) as HTMLElement[]) {
    if (child.contains(field) || getComputedStyle(child).position !== 'sticky') continue;
    const c = child.getBoundingClientRect();
    if (c.height > 0 && c.top <= top + 1) {
      top = Math.max(top, c.bottom);
      heads.push(child);
    }
  }
  return { top, bottom: Math.min(window.innerHeight, r.bottom), heads };
}

/**
 * Android: how long the WebView gets to start scrolling a hidden field into
 * view itself after keyboardDidShow (it starts 20-100 ms after it on a Pixel
 * 7), how long a scroll of it may pause between frames on a busy device, and
 * the frame or so after its scrollend.
 */
const WEBVIEW_SCROLL_WAIT = 250;
const WEBVIEW_SCROLL_QUIET = 400;
const WEBVIEW_SCROLL_SETTLE = 50;

let fixedProbe: HTMLElement | null = null;

/**
 * True while fixed layers are still laid out for the web view's previous
 * size. Right after the web view shrinks to the keyboard (native resize),
 * WKWebView reports the new height (innerHeight 609 on an iPhone 17 Pro Max)
 * a few frames before its fixed-position layout follows: a layer pinned to
 * the bottom still ends at the old bottom (956), so a field in a sheet reads
 * as under the keyboard although it lands well in sight. Scrolling on those
 * numbers put the gig title under its sheet's header.
 */
export function fixedLayoutStale(): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  if (!fixedProbe || !fixedProbe.isConnected) {
    fixedProbe = document.createElement('div');
    fixedProbe.setAttribute('aria-hidden', 'true');
    fixedProbe.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:0;visibility:hidden;pointer-events:none';
    document.body.appendChild(fixedProbe);
  }
  const r = fixedProbe.getBoundingClientRect();
  // No layout at all (a test DOM): nothing to wait for.
  if (!r.width) return false;
  return Math.abs(r.bottom - document.documentElement.clientHeight) > 1;
}

/**
 * Marks <html data-keyboard="open"> while the software keyboard is up, and
 * keeps the field being typed in where it can be read.
 *
 * Keyboard resize is 'native' (capacitor.config.ts), so the web view already
 * ends at the top of the keyboard. The home-indicator / navigation-bar inset
 * in --safe-bottom then only adds dead space above the keyboard. On iOS
 * env(safe-area-inset-bottom) drops to 0 by itself once the web view ends
 * above the home indicator, in step with the layout; on Android the inset
 * Capacitor injects does not, and theme.css zeroes it while this attribute
 * is set.
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
    // Android has already shrunk the WebView by keyboardWillShow: a hidden
    // field moves now, with the keyboard, well before the WebView's own scroll.
    if (root.getAttribute('data-platform') === 'android') requestAnimationFrame(() => reveal(true));
  };
  // A scroll the WebView is animating (Android): last scroll event, until scrollend.
  let lastScroll = -Infinity;
  document.addEventListener('scroll', () => { lastScroll = performance.now(); }, { capture: true, passive: true });
  document.addEventListener('scrollend', () => { lastScroll = -Infinity; }, { capture: true, passive: true });
  const scrollInFlight = () => performance.now() - lastScroll < WEBVIEW_SCROLL_QUIET;
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
  // Pinned headers let go of their scroller's top while the keyboard is up.
  const unpinned = new Map<HTMLElement, string>();
  const unpin = (head: HTMLElement) => {
    if (!unpinned.has(head)) unpinned.set(head, head.style.position);
    head.style.position = 'relative';
  };
  const repin = () => {
    unpinned.forEach((value, head) => { head.style.position = value; });
    unpinned.clear();
  };
  const close = () => {
    webViewWait?.stop();
    root.removeAttribute('data-keyboard');
    unpad();
    repin();
    tell(false);
  };
  // Laptop pose: the field rests on the strip of the Deck above the keyboard
  // (or on the Display), never on the fold band (laptopRevealDelta). A field
  // near the end of its scroller first gets room below it to rise into.
  // When the keyboard covers the whole Deck (the iPhone Duo's: the web view
  // ends at the fold) a hub's header, pinned over the Display, covers all of
  // the web view and leaves the field no place: that header lets go of the
  // top while the keyboard is up and scrolls away, and the field rests on
  // the Display just above the fold.
  const revealInLaptopPose = (el: HTMLElement, bands: { displayH: number; deckTop: number }) => {
    const scroller = scrollerOf(el);
    const where = () => {
      const r = fieldBox(el).getBoundingClientRect();
      const clip = clipOf(scroller, el);
      return { clip, delta: laptopRevealDelta({ top: r.top, bottom: r.bottom }, clip, bands, window.innerHeight, scroller.scrollTop) };
    };
    let { clip, delta } = where();
    if (delta === null && clip.heads.length) {
      clip.heads.forEach(unpin);
      ({ delta } = where());
    }
    if (!delta) return;
    const short = Math.ceil(scroller.scrollTop + delta - (scroller.scrollHeight - scroller.clientHeight));
    // The page itself gets its room on <body>.
    if (delta > 0 && short > 0) pad(isPage(scroller) ? document.body : scroller, short);
    scroller.scrollTop += delta;
  };
  // The field being typed in stays in sight: on a short screen (a phone in
  // landscape: ~216 px left) it could sit under the keyboard or a pinned
  // footer, and the web view does not scroll it up by itself.
  // Frames waited for fixed layers to catch up with the web view's size.
  let staleFrames = 0;
  const reveal = (early = false) => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || !(el.matches(FIELD) || el.isContentEditable)) return;
    // Measure only once fixed layers sit where they will be painted
    // (fixedLayoutStale); the next frame usually has them.
    if (fixedLayoutStale()) {
      if (staleFrames++ < 30) requestAnimationFrame(() => reveal(early));
      return;
    }
    staleFrames = 0;
    const p = getPosture();
    if (p.posture === 'tabletop' && p.fold?.orientation === 'horizontal' && p.bands) {
      revealInLaptopPose(el, p.bands);
      return;
    }
    const r = el.getBoundingClientRect();
    if (root.getAttribute('data-platform') === 'android' && (r.top < 0 || r.bottom > window.innerHeight) && (!early || scrollInFlight())) {
      awaitWebViewScroll(el);
      return;
    }
    bringIntoSight(el, r);
  };
  const bringIntoSight = (el: HTMLElement, r: DOMRect) => {
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
  // Android: the WebView usually scrolls a focused field it cannot show into
  // view by itself just after keyboardDidShow (centred, animated, on the
  // compositor: a scroll of ours while it runs is added to its own, and the
  // poll's Location field went past the top). Not always, though: then the
  // field stayed under the keyboard. A hidden field is moved at
  // keyboardWillShow (above), long before that scroll, which then finds it in
  // sight and does nothing. Later on (or while a scroll is running) wait until
  // the WebView has scrolled and come to rest (scrollend, or no scroll for a
  // while), or clearly is not going to, then move the field if still hidden.
  let webViewWait: { el: HTMLElement; stop: () => void } | null = null;
  const awaitWebViewScroll = (el: HTMLElement) => {
    if (webViewWait?.el === el) return;
    webViewWait?.stop();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(done, ms);
    };
    const onScroll = () => later(WEBVIEW_SCROLL_QUIET);
    const onScrollEnd = () => later(WEBVIEW_SCROLL_SETTLE);
    const stop = () => {
      clearTimeout(timer);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('scrollend', onScrollEnd, true);
      if (webViewWait === wait) webViewWait = null;
    };
    const done = () => {
      stop();
      if (document.activeElement !== el || root.getAttribute('data-keyboard') !== 'open') return;
      bringIntoSight(el, el.getBoundingClientRect());
    };
    const wait = { el, stop };
    webViewWait = wait;
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('scrollend', onScrollEnd, true);
    later(WEBVIEW_SCROLL_WAIT);
  };
  // The web view shrinks to the keyboard's top only after keyboardDidShow
  // on some devices, so reveal again once its size has settled.
  let settle: ReturnType<typeof setTimeout> | undefined;
  const revealSoon = () => {
    requestAnimationFrame(() => reveal());
    clearTimeout(settle);
    settle = setTimeout(() => reveal(), 320);
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
