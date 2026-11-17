/**
 * keyboardInsets: where the field being typed in ends up once the keyboard is
 * up (iPhone and Android, upright; the Laptop pose has its own tests).
 *
 * Numbers from the emulator check (Maestro keyboard probe):
 * - iPhone 17 Pro Max: the web view shrinks 956 → 609. For a few frames
 *   WKWebView reports innerHeight 609 while fixed layers still end at 956, so
 *   the gig title in its sheet read as 552 (under the keyboard) although it
 *   lands at 205. Scrolling on that put it under the sheet's header.
 * - Pixel 7 (API 36): the WebView shrinks 815 → 520 and usually scrolls the
 *   poll's Location field (at 550) into view by itself, animated (550 → 545 →
 *   279 → 249 over ~450 ms); scrolling it as well stacked both moves and the
 *   field ended above the top edge. Sometimes it does not scroll at all and
 *   the field stayed under the keyboard. The WebView has shrunk already by
 *   keyboardWillShow, ~700 ms before that scroll.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installKeyboardInsets } from '../keyboardInsets';

interface Box {
  top: number;
  bottom: number;
}
let viewH = 956;
let fixedBottom = 956;
let fieldBox: Box = { top: 0, bottom: 0 };
let field: HTMLInputElement;
let scrolls: number;

const rect = (b: Box, width = 300) =>
  ({ top: b.top, bottom: b.bottom, left: 0, right: width, width, height: b.bottom - b.top, x: 0, y: b.top, toJSON() {} }) as DOMRect;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => viewH });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, get: () => viewH });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el === field) return rect(fieldBox);
    // keyboardInsets' fixed-layout probe: position fixed, bottom 0.
    if (el.style?.position === 'fixed' && el.style.bottom === '0px') return rect({ top: fixedBottom, bottom: fixedBottom }, 1);
    return rect({ top: 0, bottom: 0 }, 0);
  });
  installKeyboardInsets();
});

beforeEach(() => {
  document.body.innerHTML = '<form><input id="f" /></form>';
  field = document.getElementById('f') as HTMLInputElement;
  scrolls = 0;
  field.scrollIntoView = () => {
    scrolls++;
  };
  field.focus();
  document.documentElement.removeAttribute('data-platform');
  viewH = 956;
  fixedBottom = 956;
});

afterEach(() => {
  window.dispatchEvent(new Event('keyboardWillHide'));
  vi.advanceTimersByTime(1000);
});

/** The keyboard comes up and the web view shrinks to `h`. */
function keyboardUp(h: number) {
  window.dispatchEvent(new Event('keyboardWillShow'));
  viewH = h;
  window.dispatchEvent(new Event('resize'));
  window.dispatchEvent(new Event('keyboardDidShow'));
}

describe('iPhone: fixed layers a few frames behind the web view', () => {
  it('does not scroll on the old layout: the gig title lands in sight by itself', () => {
    fieldBox = { top: 552, bottom: 596 }; // the sheet still on the old bottom
    keyboardUp(609); // fixed layers still end at 956
    vi.advanceTimersByTime(48); // three frames
    expect(scrolls).toBe(0);
    // WKWebView catches up: the sheet ends at 609, the title at 205.
    fixedBottom = 609;
    fieldBox = { top: 205, bottom: 249 };
    vi.advanceTimersByTime(600);
    expect(scrolls).toBe(0);
  });

  it('still brings up a field the keyboard really covers, once the layout has caught up', () => {
    fieldBox = { top: 880, bottom: 924 };
    keyboardUp(609);
    vi.advanceTimersByTime(48);
    expect(scrolls).toBe(0);
    fixedBottom = 609;
    vi.advanceTimersByTime(32);
    expect(scrolls).toBeGreaterThan(0);
  });

  it('a field below the keyboard is scrolled up on iOS (WKWebView leaves it there)', () => {
    fieldBox = { top: 700, bottom: 744 };
    fixedBottom = 609;
    keyboardUp(609);
    vi.advanceTimersByTime(32);
    expect(scrolls).toBeGreaterThan(0);
  });
});

describe('Android: the WebView scrolls a hidden field into view itself, mostly', () => {
  beforeEach(() => document.documentElement.setAttribute('data-platform', 'android'));

  /** The poll's Location field (550-580) once the WebView ends at 520. */
  const LOCATION = { top: 550, bottom: 580 };
  const webViewScrolls = (top: number) => {
    fieldBox = { top, bottom: top + 30 };
    document.querySelector('form')!.dispatchEvent(new Event('scroll'));
  };
  const webViewScrollEnds = () => document.querySelector('form')!.dispatchEvent(new Event('scrollend'));

  it('moves a hidden field at keyboardWillShow, once, before the WebView\'s own scroll (which then finds it in sight)', () => {
    // The WebView has already shrunk by keyboardWillShow.
    viewH = 520;
    fixedBottom = 520;
    fieldBox = { ...LOCATION };
    field.scrollIntoView = () => {
      scrolls++;
      webViewScrolls(249);
    };
    window.dispatchEvent(new Event('keyboardWillShow'));
    vi.advanceTimersByTime(16);
    expect(scrolls).toBe(1);
    vi.advanceTimersByTime(700); // the keyboard's animation
    window.dispatchEvent(new Event('keyboardDidShow'));
    vi.advanceTimersByTime(1000);
    expect(scrolls).toBe(1);
  });

  it('a field hidden only from keyboardDidShow is left to the WebView when it scrolls it (no second scroll on top of its own)', () => {
    window.dispatchEvent(new Event('keyboardWillShow')); // the WebView not shrunk yet: in sight
    fieldBox = { ...LOCATION };
    vi.advanceTimersByTime(16);
    viewH = 520;
    fixedBottom = 520;
    window.dispatchEvent(new Event('keyboardDidShow'));
    vi.advanceTimersByTime(60);
    webViewScrolls(545);
    vi.advanceTimersByTime(150);
    webViewScrolls(279);
    vi.advanceTimersByTime(285); // a slow frame on a busy emulator
    webViewScrolls(249);
    webViewScrollEnds();
    vi.advanceTimersByTime(1000);
    expect(scrolls).toBe(0);
  });

  it('…and brought up, once, soon after keyboardDidShow when the WebView leaves it under the keyboard', () => {
    field.scrollIntoView = () => {
      scrolls++;
      fieldBox = { top: 249, bottom: 279 };
    };
    window.dispatchEvent(new Event('keyboardWillShow'));
    fieldBox = { ...LOCATION };
    vi.advanceTimersByTime(16);
    viewH = 520;
    fixedBottom = 520;
    window.dispatchEvent(new Event('keyboardDidShow'));
    vi.advanceTimersByTime(150);
    expect(scrolls).toBe(0); // the WebView's turn first
    vi.advanceTimersByTime(250);
    expect(scrolls).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(scrolls).toBe(1);
  });

  it('keyboardWillShow while a WebView scroll is running: waits for its end, then finishes what it left', () => {
    viewH = 520;
    fixedBottom = 520;
    webViewScrolls(600);
    window.dispatchEvent(new Event('keyboardWillShow'));
    vi.advanceTimersByTime(16);
    expect(scrolls).toBe(0);
    webViewScrolls(530); // stops short, still under the keyboard
    webViewScrollEnds();
    vi.advanceTimersByTime(100);
    expect(scrolls).toBe(1);
  });

  it('nothing once the keyboard is down again', () => {
    window.dispatchEvent(new Event('keyboardWillShow'));
    fieldBox = { ...LOCATION };
    vi.advanceTimersByTime(16);
    viewH = 520;
    fixedBottom = 520;
    window.dispatchEvent(new Event('keyboardDidShow'));
    vi.advanceTimersByTime(50);
    window.dispatchEvent(new Event('keyboardWillHide'));
    vi.advanceTimersByTime(1000);
    expect(scrolls).toBe(0);
  });

  it('still lifts a field the WebView shows but a pinned bar covers', () => {
    viewH = 520;
    fixedBottom = 520;
    fieldBox = { top: 460, bottom: 500 }; // in the view, under a bottom bar
    window.dispatchEvent(new Event('keyboardWillShow'));
    window.dispatchEvent(new Event('keyboardDidShow'));
    vi.advanceTimersByTime(32);
    expect(scrolls).toBeGreaterThan(0);
  });
});
