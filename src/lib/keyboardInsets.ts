import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

/** Window event fired as the keyboard shows or hides: detail `{ open: boolean }`. */
export const KEYBOARD_EVENT = 'bwkeyboard';

/** True while the software keyboard is up (native builds only). */
export function isKeyboardOpen(): boolean {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-keyboard') === 'open';
}

/**
 * Marks <html data-keyboard="open"> while the software keyboard is up.
 *
 * Keyboard resize is 'native' (capacitor.config.ts), so the web view already
 * ends at the top of the keyboard. The home-indicator / navigation-bar inset
 * in --safe-bottom then only adds dead space above the keyboard; theme.css
 * zeroes it while this attribute is set.
 */
export function installKeyboardInsets(): void {
  if (typeof document === 'undefined') return;
  try {
    if (!Capacitor.isNativePlatform()) return;
    const root = document.documentElement;
    const tell = (open: boolean) => window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT, { detail: { open } }));
    const open = () => {
      root.setAttribute('data-keyboard', 'open');
      tell(true);
    };
    // Room added under a scroller so its last field can rise above the keyboard.
    const padded = new Map<HTMLElement, string>();
    const unpad = () => {
      padded.forEach((value, scroller) => { scroller.style.paddingBottom = value; });
      padded.clear();
    };
    const close = () => {
      root.removeAttribute('data-keyboard');
      unpad();
      tell(false);
    };
    // The field being typed in stays in sight: on a short screen (a phone in
    // landscape: ~216 px left) it could sit under the keyboard or a pinned
    // footer, and the web view does not scroll it up by itself.
    const reveal = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !(el.matches('input, textarea, select') || el.isContentEditable)) return;
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
        if (!padded.has(scroller)) padded.set(scroller, scroller.style.paddingBottom);
        const base = parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
        scroller.style.paddingBottom = `${base + extra}px`;
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
    void Keyboard.addListener('keyboardWillShow', open).catch(() => {});
    void Keyboard.addListener('keyboardDidShow', revealSoon).catch(() => {});
    void Keyboard.addListener('keyboardWillHide', close).catch(() => {});
    window.addEventListener('resize', () => {
      if (root.getAttribute('data-keyboard') === 'open') revealSoon();
    });
    // Moving to another field while the keyboard stays up.
    document.addEventListener('focusin', () => {
      if (root.getAttribute('data-keyboard') === 'open') setTimeout(revealSoon, 50);
    });
  } catch {
    // Plugin missing on this build: keep the default insets.
  }
}
