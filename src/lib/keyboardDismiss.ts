const FIELD_TAGS = ['INPUT', 'TEXTAREA', 'SELECT'];

/** Longest wait for the click a tap ends in, after the finger lifts. */
const CLICK_WAIT = 400;

/**
 * A touch outside the field being typed in closes the on-screen keyboard
 * (WKWebView keeps the field focused, so its keyboard would stay up).
 *
 * It closes once the tap is over, not when the finger lands. Closing it gives
 * the web view its height back and moves everything on screen: with the
 * keyboard up, a sheet's CANCEL or SAVE under the finger at touchstart was
 * 300 px lower by touchend, so a normal press (Android, ~120 ms) only closed
 * the keyboard and the tap went to whatever was now under the finger. Only an
 * instant tap beat the resize.
 *
 * So: a tap closes it after its click has run (the button got the tap); a
 * touch that turns into a scroll (touchcancel) or ends without a click
 * closes it then. If the tap moved focus to another field, that field keeps
 * the keyboard; if it moved focus off the field (Android focuses the button),
 * the WebView closes the keyboard itself.
 *
 * Areas marked data-keep-keyboard (the chat) keep it up: there it closes with
 * a swipe down on the messages or Android Back. data-keep-keyboard="android"
 * keeps it up on Android only.
 */
export function installKeyboardDismissOnTouch(opts: { hide: () => void; platform: string }): () => void {
  const { hide, platform } = opts;
  let pending: { field: Element; timer?: ReturnType<typeof setTimeout> } | null = null;

  const finish = () => {
    const p = pending;
    pending = null;
    if (!p) return;
    clearTimeout(p.timer);
    if (document.activeElement === p.field) hide();
  };

  const onTouchStart = (e: TouchEvent) => {
    const target = e.target as HTMLElement | null;
    const active = document.activeElement as HTMLElement | null;
    if (!target || !active || !FIELD_TAGS.includes(active.tagName) || FIELD_TAGS.includes(target.tagName)) return;
    const keep = target.closest?.('[data-keep-keyboard]') as HTMLElement | null;
    if (keep && (keep.dataset.keepKeyboard !== 'android' || platform === 'android')) return;
    if (pending) clearTimeout(pending.timer);
    pending = { field: active };
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (!pending) return;
    // A handler that took the tap on touchend (preventDefault) stops the click.
    if (e.defaultPrevented) return finish();
    clearTimeout(pending.timer);
    pending.timer = setTimeout(finish, CLICK_WAIT);
  };
  // Captured (a handler that stops the click's propagation still counts); the
  // keyboard closes in a task after it, once the click's own handlers ran.
  const onClick = () => {
    if (pending) setTimeout(finish, 0);
  };

  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
  document.addEventListener('touchcancel', finish, { passive: true });
  document.addEventListener('click', onClick, true);
  return () => {
    if (pending) clearTimeout(pending.timer);
    pending = null;
    document.removeEventListener('touchstart', onTouchStart);
    document.removeEventListener('touchend', onTouchEnd);
    document.removeEventListener('touchcancel', finish);
    document.removeEventListener('click', onClick, true);
  };
}
