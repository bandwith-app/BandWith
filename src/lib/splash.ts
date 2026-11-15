/**
 * The animated splash in index.html covers the app at launch. Anything native
 * that would show over it (the Face ID / fingerprint prompt) waits until it
 * has gone: index.html sets window.__bwSplashGone and fires 'bw:splash-gone'.
 */
const SAFETY_MS = 5000;

type SplashWindow = Window & { __bwSplashGone?: boolean };

export function splashGone(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true;
  return !!(window as SplashWindow).__bwSplashGone || !document.getElementById('bw-splash');
}

/** Resolves once the splash has gone (at once when there is none), at the latest after 5 s. */
export function whenSplashGone(): Promise<void> {
  if (splashGone()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('bw:splash-gone', done);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, SAFETY_MS);
    window.addEventListener('bw:splash-gone', done);
  });
}
