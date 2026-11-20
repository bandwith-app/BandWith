/**
 * Stage / Live mode full screen. One tap gives the live view the whole
 * screen:
 * - the app's chrome goes: the iPhone Duo rail, the list pane beside Stage
 *   mode on two-pane layouts, the tablet nav (src/styles/stage.css);
 * - the system's too: the status bar and the home indicator / navigation
 *   bar in the native apps (Capacitor's SystemBars, Android immersive), the
 *   browser's own full screen on the web (Fullscreen API, where it exists);
 * - the screen stays on (useKeepAwake, already on in Stage mode).
 * The choice is per device and applies to Stage mode, rehearsal Live mode
 * and their Laptop pose (FloorWedgeMode). Exit: the button, or system Back.
 *
 * While it is on, <html> carries `data-bw-stage-full`.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { Capacitor, SystemBars } from '@capacitor/core';

const KEY = 'bw-stage-bar-hidden-v1';
const CHANGED = 'bw:stage-bar';
export const STAGE_FULL_ATTR = 'data-bw-stage-full';

const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

/** Fallback when localStorage throws (private mode). */
let memory: boolean | null = null;
const snapshot = () => memory ?? read();

const subscribe = (cb: () => void) => {
  window.addEventListener(CHANGED, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(CHANGED, cb);
    window.removeEventListener('storage', cb);
  };
};

export function setStageBarHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the choice lasts until the page reloads */
    memory = hidden;
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** The remembered choice: true = Stage / Live mode opens full screen (the key predates phones: it was "hide the side bar"). */
export function useStageBarHidden(): [boolean, (hidden: boolean) => void] {
  const hidden = useSyncExternalStore(subscribe, snapshot, () => false);
  const set = useCallback((v: boolean) => setStageBarHidden(v), []);
  return [hidden, set];
}

/**
 * Marks <html> while Stage mode is full screen, and in the native apps hides
 * the system bars. A layout effect, so Stage mode can measure its new box in
 * its own layout effects declared after it.
 */
export function useStageFullScreen(on: boolean): void {
  useLayoutEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    root.setAttribute(STAGE_FULL_ATTR, '');
    const native = Capacitor.isNativePlatform();
    if (native) void SystemBars.hide().catch(() => {});
    return () => {
      root.removeAttribute(STAGE_FULL_ATTR);
      if (native) void SystemBars.show().catch(() => {});
    };
  }, [on]);
}

type FsElement = HTMLElement & {
  requestFullscreen?: (o?: FullscreenOptions) => Promise<void>;
  webkitRequestFullscreen?: () => void;
};
type FsDocument = Document & {
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => void;
};

const fullscreenElement = () => {
  const d = document as FsDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
};

/**
 * The browser's own full screen (web build, iPad Safari, desktop): hides its
 * toolbars too. Needs a tap, so it is asked from the Full screen button.
 * The native apps hide the system bars instead (useStageFullScreen).
 * True when the browser was asked.
 */
export async function requestBrowserFullScreen(): Promise<boolean> {
  if (typeof document === 'undefined' || Capacitor.isNativePlatform()) return false;
  if (fullscreenElement()) return true;
  const el = document.documentElement as FsElement;
  try {
    if (typeof el.requestFullscreen === 'function') {
      await el.requestFullscreen({ navigationUI: 'hide' });
      return true;
    }
    if (typeof el.webkitRequestFullscreen === 'function') {
      el.webkitRequestFullscreen();
      return true;
    }
  } catch {
    /* refused (iPhone Safari, an iframe): the app's own full screen still applies */
  }
  return false;
}

/** Leaves the browser's full screen, if it is on. */
export async function exitBrowserFullScreen(): Promise<void> {
  if (typeof document === 'undefined' || !fullscreenElement()) return;
  const d = document as FsDocument;
  try {
    if (typeof d.exitFullscreen === 'function') await d.exitFullscreen();
    else if (typeof d.webkitExitFullscreen === 'function') d.webkitExitFullscreen();
  } catch {
    /* already left */
  }
}

/**
 * The person left the browser's full screen from outside (Escape, the
 * browser's own UI): `onExit` turns the app's full screen off too, so the
 * Full screen button never shows the wrong state.
 */
export function useBrowserFullScreenExit(on: boolean, onExit: () => void): void {
  const cb = useRef(onExit);
  cb.current = onExit;
  useEffect(() => {
    if (!on || typeof document === 'undefined') return;
    let was = !!fullscreenElement();
    const onChange = () => {
      const now = !!fullscreenElement();
      if (was && !now) cb.current();
      was = now;
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, [on]);
}

/**
 * "Song only" (11-20): the current song clean and full screen, with only
 * Show everything, Prev, the click and Next at the bottom. Shared by Stage
 * mode and its Laptop pose (FloorWedgeMode), so folding keeps it; not
 * remembered: Stage mode always opens with everything shown, and leaving
 * Stage mode turns it off. While on, Stage mode applies full screen
 * (useStageFullScreen) whatever the remembered Full screen choice.
 */
const SONG_ONLY = 'bw:stage-song-only';
let songOnly = false;

export function setStageSongOnly(on: boolean): void {
  if (songOnly === on) return;
  songOnly = on;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SONG_ONLY));
}

const subscribeSongOnly = (cb: () => void) => {
  window.addEventListener(SONG_ONLY, cb);
  return () => window.removeEventListener(SONG_ONLY, cb);
};

export function useStageSongOnly(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribeSongOnly, () => songOnly, () => false);
  return [on, setStageSongOnly];
}
