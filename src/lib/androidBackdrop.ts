import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * The colour behind the web view, Android app only.
 *
 * With a System WebView older than 140, Capacitor's SystemBars does not let
 * the page draw under the status bar and the camera cutout: it pads the web
 * view instead, and that padding showed the window's white. Over Stage mode's
 * black (and in its full screen, where the bars are hidden but the cutout
 * stays) that was a white band at the top. Here the padding takes the colour
 * at the top of the page, through the app's BwBackdrop plugin
 * (android/…/BackdropPlugin.java). Newer WebViews draw under the bars and the
 * padding is never seen. iOS and the web draw under the bars: nothing to do.
 */
const Backdrop = registerPlugin<{ set(options: { color: string }): Promise<void> }>('BwBackdrop');

/** The elements under the top of the page, topmost first (document.elementsFromPoint). */
type ElementsAtTop = () => Element[];

const atTop: ElementsAtTop = () =>
  typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(Math.round(window.innerWidth / 2), 1) : [];

const hex = (rgb: string): string | null => {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(rgb);
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (!(alpha >= 0.5)) return null;
  return '#' + [m[1], m[2], m[3]].map((c) => Number(c).toString(16).padStart(2, '0')).join('');
};

/**
 * The first solid background under the top of the page, as #rrggbb. A see-
 * through layer on top (a sheet's scrim) is looked through, to the surface
 * under it.
 */
export function topSurfaceColor(find: ElementsAtTop = atTop): string | null {
  for (const el of find()) {
    const c = hex(getComputedStyle(el).backgroundColor);
    if (c) return c;
  }
  return hex(getComputedStyle(document.body).backgroundColor) ?? hex(getComputedStyle(document.documentElement).backgroundColor);
}

let last: string | null = null;
let frame = 0;

/**
 * Matches the backdrop to the top of the page, after the next paint (a layer
 * that just opened is on screen by then). Called whenever the system bars'
 * tone changes and when Stage mode enters or leaves full screen.
 */
export function syncAndroidBackdrop(find: ElementsAtTop = atTop): void {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  if (typeof requestAnimationFrame !== 'function') return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      const color = topSurfaceColor(find);
      if (!color || color === last) return;
      last = color;
      // Apps built before the plugin don't have it: the band stays as it was.
      void Backdrop.set({ color }).catch(() => {
        last = null;
      });
    });
  });
}

export function resetAndroidBackdropForTests(): void {
  last = null;
  cancelAnimationFrame(frame);
}
