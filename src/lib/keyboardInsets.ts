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
    const close = () => {
      root.removeAttribute('data-keyboard');
      tell(false);
    };
    // The field being typed in stays in sight: on a short screen (a phone in
    // landscape: ~216 px left) it could sit under the keyboard or a pinned
    // footer, and the web view does not scroll it up by itself.
    const reveal = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !(el.matches('input, textarea, select') || el.isContentEditable)) return;
      requestAnimationFrame(() => el.scrollIntoView?.({ block: 'center', inline: 'nearest' }));
    };
    void Keyboard.addListener('keyboardWillShow', open).catch(() => {});
    void Keyboard.addListener('keyboardDidShow', reveal).catch(() => {});
    void Keyboard.addListener('keyboardWillHide', close).catch(() => {});
    // Moving to another field while the keyboard stays up.
    document.addEventListener('focusin', () => {
      if (root.getAttribute('data-keyboard') === 'open') setTimeout(reveal, 50);
    });
  } catch {
    // Plugin missing on this build: keep the default insets.
  }
}
