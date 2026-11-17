/**
 * keyboardInsets: on iOS the home-indicator inset (--safe-bottom) is zeroed
 * from the moment the keyboard covers the bottom of the view, not before
 * and not later (<html data-keyboard-covers>, theme.css).
 *
 * Emulator check, iPhone 17 Pro Max, the chat's message box (keyboard probe
 * trace "top 862 h956 sb34 > 515 h956 sb34 > 549 h609 sb0", 1 run in 15):
 * WKWebView moved 100vh to the keyboard (609) while the web view's height
 * (innerHeight) and env(safe-area-inset-bottom) were still 956 and 34. The
 * message box, in a layer pinned to the bottom of 100vh, rose with the
 * keyboard on the 34 px inset (515), then dropped 34 px when env() caught up
 * (549). Zeroing from keyboardWillShow instead, half a second before
 * anything moves, dropped it first (862 → 896 → 549).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installKeyboardInsets } from '../keyboardInsets';

let viewH = 956;
let vh = 956;
const observers: Array<() => void> = [];

class FakeResizeObserver {
  constructor(private cb: () => void) {}
  observe() {
    observers.push(this.cb);
  }
  unobserve() {}
  disconnect() {}
}

const root = document.documentElement;
const covers = () => root.hasAttribute('data-keyboard-covers');
/** WKWebView lays out a new frame: the 100vh box's ResizeObserver fires. */
const frame = () => observers.forEach((cb) => cb());

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => viewH });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    const h = el.style?.height === '100vh' ? vh : 0;
    return { top: 0, bottom: h, left: 0, right: 0, width: 0, height: h, x: 0, y: 0, toJSON() {} } as DOMRect;
  });
  root.classList.add('is-native');
  installKeyboardInsets();
});

beforeEach(() => {
  document.body.innerHTML = '<input id="f" />';
  (document.getElementById('f') as HTMLInputElement).focus();
  viewH = 956;
  vh = 956;
});

afterEach(() => {
  window.dispatchEvent(new Event('keyboardWillHide'));
  viewH = 956;
  vh = 956;
  window.dispatchEvent(new Event('resize'));
  vi.advanceTimersByTime(1000);
});

describe('iOS keyboard: the home-indicator inset goes to 0 when the keyboard covers the view', () => {
  it('not at keyboardWillShow: nothing has moved yet', () => {
    window.dispatchEvent(new Event('keyboardWillShow'));
    frame();
    expect(root.getAttribute('data-keyboard')).toBe('open');
    expect(covers()).toBe(false);
  });

  it('as soon as 100vh moves to the keyboard, ahead of the view and env() (the gate run)', () => {
    window.dispatchEvent(new Event('keyboardWillShow'));
    vh = 609; // innerHeight still 956
    frame();
    expect(covers()).toBe(true);
    // The view and env() catch up: it stays (no second move).
    viewH = 609;
    window.dispatchEvent(new Event('resize'));
    frame();
    expect(covers()).toBe(true);
  });

  it('as soon as the web view shrinks, when that comes first', () => {
    window.dispatchEvent(new Event('keyboardWillShow'));
    viewH = 609;
    vh = 609;
    window.dispatchEvent(new Event('resize'));
    expect(covers()).toBe(true);
  });

  it('the view already shrunk by keyboardWillShow', () => {
    vh = 609; // 100vh moved, the flag comes after
    frame();
    expect(covers()).toBe(false);
    window.dispatchEvent(new Event('keyboardWillShow'));
    expect(covers()).toBe(true);
  });

  it('back to the inset when the keyboard goes down', () => {
    window.dispatchEvent(new Event('keyboardWillShow'));
    vh = 609;
    frame();
    expect(covers()).toBe(true);
    window.dispatchEvent(new Event('keyboardWillHide'));
    expect(covers()).toBe(false);
    expect(root.hasAttribute('data-keyboard')).toBe(false);
  });

  it('an accessory bar or rounding is not a keyboard', () => {
    window.dispatchEvent(new Event('keyboardWillShow'));
    vh = 900;
    frame();
    expect(covers()).toBe(false);
  });
});
