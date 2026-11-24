/**
 * Facebook's and Instagram's in-app browsers: the page opened from a post
 * runs inside the app, where Google sign-in is usually refused, an APK
 * download often doesn't start, and the session is gone once the visitor
 * moves to their real browser. The site says so in a slim bar at the top
 * (content/render.ts, inAppBar) and offers the way out.
 *
 * The functions are pure and stand alone: every page runs their source
 * inline, right after the bar, so it is there (or not) before the first
 * paint. Keep them free of imports, closures and comments inside the body.
 */
export type InApp = 'facebook' | 'instagram';

/** sessionStorage: the visitor closed the bar (it stays away for this visit). */
export const INAPP_CLOSED_KEY = 'bw-inapp-bar';

/**
 * Which in-app browser this user agent is, or null for a real browser.
 * Instagram first: its user agent names Instagram and, on some versions,
 * Facebook's tokens too. FBAN / FBAV (iPhone and Android apps, Messenger
 * included) and FB_IAB (Android) are Facebook's.
 */
export function inAppBrowser(ua: string): InApp | null {
  if (/Instagram/.test(ua)) return 'instagram';
  if (/FBAN|FBAV|FB_IAB/.test(ua)) return 'facebook';
  return null;
}

/**
 * An Android link that opens the same address in Chrome. If Chrome isn't
 * there, Android follows the plain https address given as the fallback. The
 * page's #fragment is left out: in an intent link the fragment is the intent.
 * Anything that isn't an http(s) address comes back as it is.
 */
export function chromeIntentUrl(href: string): string {
  var m = /^https?:\/\/([^#]+)/.exec(href);
  if (!m) return href;
  return 'intent://' + m[1] + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent('https://' + m[1]) + ';end';
}
