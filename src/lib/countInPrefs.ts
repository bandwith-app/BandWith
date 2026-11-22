/**
 * Count-in on this device (plan live-offline-and-tempo §6.1): vibrate on
 * every beat, a sound in headphones, and whether that sound may also come
 * out of the phone's own speaker. Kept on the device; every Stage screen
 * shares one copy.
 */
import { useSyncExternalStore } from 'react';

export type CountInSound = 'off' | 'click';

export interface CountInPrefs {
  vibrate: boolean;
  sound: CountInSound;
  /** Also through the device's speaker (off: headphones, an interface, a mixer). */
  speaker: boolean;
}

export const COUNTIN_PREFS_KEY = 'bw.countin.prefs';
export const COUNTIN_PREFS_DEFAULT: CountInPrefs = { vibrate: false, sound: 'off', speaker: false };

let cached: CountInPrefs | null = null;
const listeners = new Set<() => void>();

export function parseCountInPrefs(raw: string | null | undefined): CountInPrefs {
  try {
    const p = raw ? (JSON.parse(raw) as Partial<CountInPrefs>) : {};
    return {
      vibrate: p.vibrate === true,
      sound: p.sound === 'click' ? 'click' : 'off',
      speaker: p.speaker === true,
    };
  } catch {
    return { ...COUNTIN_PREFS_DEFAULT };
  }
}

export function getCountInPrefs(): CountInPrefs {
  if (cached) return cached;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(COUNTIN_PREFS_KEY);
  } catch {
    /* private mode */
  }
  cached = parseCountInPrefs(raw);
  return cached;
}

export function setCountInPrefs(next: Partial<CountInPrefs>): void {
  cached = { ...getCountInPrefs(), ...next };
  try {
    localStorage.setItem(COUNTIN_PREFS_KEY, JSON.stringify(cached));
  } catch {
    /* kept for this session */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useCountInPrefs = (): CountInPrefs => useSyncExternalStore(subscribe, getCountInPrefs, getCountInPrefs);

/**
 * May the count be heard on this output? Headphones, an interface, a mixer
 * yes; the phone's own speaker only when chosen. In a browser the output
 * can't be told apart, so it needs the same choice.
 */
export const countInAudible = (prefs: CountInPrefs, output: { kind: string } | null): boolean =>
  prefs.sound !== 'off' && (prefs.speaker || (!!output && output.kind !== 'speaker'));

/** Test hook. */
export const __resetCountInPrefs = () => {
  cached = null;
};
