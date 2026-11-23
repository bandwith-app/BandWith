/**
 * "Couldn't sign out" after a reload (release/2026-11-23, with #287 and #296).
 *
 * A sign-out that throws is answered by a wipe of this device (signOutWipe).
 * If the wipe itself throws, the page still reloads: #296's "Signing out…"
 * screen owns the page from the wipe's start, and only the reload ends it
 * (signOutWipeState). When the session survived, the person is then back in
 * the app, still signed in. That used to happen without a word. Now a
 * one-shot mark in sessionStorage crosses the reload:
 * - still signed in after it: the app says "Couldn't sign out. Try again."
 *   once (useSignOutFailedNotice, from AuthenticatedApp);
 * - signed out after it: the sign-out did happen, the mark just goes
 *   (useForgetSignOutFailed, from App).
 * sessionStorage: this tab only, gone with it. Blocked storage (private
 * mode): no mark, no notice, nothing else changes.
 */
const KEY = 'bw:sign-out-failed';

/** The wipe after a failed sign-out threw: say so after the reload, if still signed in. */
export function markSignOutFailed(): void {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    /* storage blocked: no notice */
  }
}

/** One shot: true when the mark was there. It is removed either way. */
export function takeSignOutFailed(): boolean {
  try {
    if (sessionStorage.getItem(KEY) === null) return false;
    sessionStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
