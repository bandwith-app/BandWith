import type { Locator } from '@playwright/test';
import type { App } from '../fixtures';

/**
 * The on-screen keyboard, as the native shell reports it.
 *
 * Keyboard resize is 'native' (capacitor.config.ts): the web view itself
 * ends at the top of the keyboard, and the Keyboard plugin fires window
 * events around it (`keyboardWillShow` → the web view shrinks →
 * `keyboardDidShow`, and the same for hiding). The suite does exactly that:
 * the same events, and a viewport that loses the keyboard's height, so
 * src/lib/keyboardInsets.ts runs as on the device. The fold of a Duo in
 * Laptop pose stays where it is on the screen meanwhile (its regions do not
 * change), as on the simulator.
 */

/** iPhone Duo keyboard in Laptop pose (951 → 601 pt on the simulator). */
export const DUO_KEYBOARD_H = 350;
/**
 * The keyboard of the EV Duo simulator in Laptop pose: it covers the whole
 * Deck (951 → 456 pt: the web view ends at the fold, `--bw-deck-h: 0`).
 */
export const DUO_KEYBOARD_DECK_H = 495;

const fire = (app: App, name: string, height?: number) =>
  app.page.evaluate(
    ({ name, height }) => {
      const e = new Event(name) as Event & { keyboardHeight?: number };
      if (height !== undefined) e.keyboardHeight = height;
      window.dispatchEvent(e);
    },
    { name, height },
  );

/**
 * Taps `field` and raises the keyboard. `scrolledTo`: where WebKit's own
 * focus scroll left the field (its top, in viewport px) before the app could
 * react, as seen on a device.
 */
export async function showKeyboard(app: App, field: Locator, opts: { height?: number; scrolledTo?: number } = {}) {
  const height = opts.height ?? DUO_KEYBOARD_H;
  const vp = app.page.viewportSize();
  if (!vp) throw new Error('no viewport');
  // The person scrolls the field up from the bottom edge (bars live there) and taps it.
  await field.scrollIntoViewIfNeeded();
  await field.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.bottom <= window.innerHeight * 0.85) return;
    for (let s = el.parentElement; s; s = s.parentElement) {
      const box = s === document.body ? (document.scrollingElement as HTMLElement) : s;
      if (box.scrollHeight > box.clientHeight && (box === document.scrollingElement || /(auto|scroll)/.test(getComputedStyle(box).overflowY))) {
        box.scrollTop += r.bottom - window.innerHeight * 0.75;
        return;
      }
    }
  });
  await field.click();
  await fire(app, 'keyboardWillShow', height);
  await app.page.setViewportSize({ width: vp.width, height: vp.height - height });
  if (opts.scrolledTo !== undefined) {
    await field.evaluate((el, y) => {
      let s: HTMLElement | null = el.parentElement;
      while (s && !(/(auto|scroll)/.test(getComputedStyle(s).overflowY) && s.scrollHeight > s.clientHeight)) s = s.parentElement;
      const box = s ?? (document.scrollingElement as HTMLElement);
      box.scrollTop += el.getBoundingClientRect().top - y;
    }, opts.scrolledTo);
  }
  await fire(app, 'keyboardDidShow', height);
  // keyboardInsets reveals at once and again 320 ms later (sizes settling).
  await app.page.waitForTimeout(450);
  return {
    /** Lowers the keyboard and gives the web view its height back. */
    hide: async () => {
      await fire(app, 'keyboardWillHide');
      await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await app.page.setViewportSize(vp);
      await fire(app, 'keyboardDidHide');
      await app.settle();
    },
  };
}

/**
 * Where the focused field rests and whether it shows: its box, and whether
 * the point at its centre (and near its top) is the field itself, not a
 * header or layer over it.
 */
export function focusedField(app: App) {
  return app.page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const own = (y: number) => {
      const at = document.elementFromPoint(r.left + Math.min(24, r.width / 2), y);
      return !!at && (at === el || el.contains(at));
    };
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      viewH: window.innerHeight,
      shows: own((r.top + r.bottom) / 2) && own(r.top + 4),
    };
  });
}
