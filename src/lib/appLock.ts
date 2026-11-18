/**
 * App lock: when the app starts from scratch (it was closed or the system
 * ended it) with a saved session, it asks for Face ID / Touch ID /
 * fingerprint, or the device passcode, before showing anything. Coming back
 * from the background does not ask again: the JavaScript context, and with it
 * `unlockedThisRun` below, survives a trip to the background but not a cold
 * start.
 *
 * Native only (iOS, iPadOS, Android). On the web (app.bandwith.fun) there
 * is no device check a page can trust, and closing the tab of a shared
 * computer is what signing out is for, so the web never locks.
 *
 * The setting is per device (Settings › Privacy & account › App lock), on by
 * default, like the theme and the language.
 */
import { useSyncExternalStore } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { isDemoMode } from '@/lib/supabase';

const KEY = 'bw-app-lock-v1';
const CHANGED = 'bw:app-lock';

/** Set once the user has unlocked (or signed in) in this run of the app. */
let unlockedThisRun = false;

export const appLockSupported = (): boolean => Capacitor.isNativePlatform() && !isDemoMode;

const readEnabled = (): boolean => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
};

export const isAppLockEnabled = (): boolean => appLockSupported() && readEnabled();

/**
 * Privacy cover, native side: while the lock is on, the app switcher (iOS) and
 * Recents (Android) show no picture of the last screen, so no fees or totals
 * are seen before Face ID / the fingerprint (SceneDelegate.swift PrivacyCover,
 * android PrivacyPlugin.java).
 */
type PrivacyPlugin = { set(options: { on: boolean }): Promise<void> };
let androidPrivacy: PrivacyPlugin | null = null;
export const syncPrivacyCover = () => {
  try {
    if (!Capacitor.isNativePlatform()) return;
    const on = isAppLockEnabled();
    const ios = (window as unknown as {
      webkit?: { messageHandlers?: { bwPrivacyCover?: { postMessage: (v: unknown) => void } } };
    }).webkit?.messageHandlers?.bwPrivacyCover;
    if (ios) ios.postMessage(on);
    else if (Capacitor.getPlatform() === 'android') {
      androidPrivacy ??= registerPlugin<PrivacyPlugin>('BwPrivacy');
      void androidPrivacy.set({ on }).catch(() => {});
    }
  } catch {
    /* older shell without the cover: nothing to do */
  }
};
if (typeof window !== 'undefined') syncPrivacyCover();

export const setAppLockEnabled = (on: boolean) => {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, 'off');
  } catch {
    /* storage blocked: stays on */
  }
  try {
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    /* no window (tests) */
  }
  syncPrivacyCover();
};

const subscribe = (cb: () => void) => {
  window.addEventListener(CHANGED, cb);
  return () => window.removeEventListener(CHANGED, cb);
};

export const useAppLockEnabled = (): boolean => useSyncExternalStore(subscribe, isAppLockEnabled, () => false);

/**
 * Whether this launch must show the lock: native, setting on, a session that
 * was already saved when the app started, and not unlocked yet in this run.
 */
export const shouldLockOnLaunch = (hadSavedSession: boolean): boolean =>
  hadSavedSession && !unlockedThisRun && isAppLockEnabled();

export const markUnlocked = () => {
  unlockedThisRun = true;
};

export type DeviceAuthKind = 'faceId' | 'touchId' | 'fingerprint' | 'iris' | 'passcode' | 'none';

export interface DeviceAuthInfo {
  /** What the system will ask for first. */
  kind: DeviceAuthKind;
  /** Biometry or a device passcode/PIN/pattern is set, so the system can check it's the owner. */
  canCheck: boolean;
}

/** What this device can check, without prompting. */
export const getDeviceAuthInfo = async (): Promise<DeviceAuthInfo> => {
  if (!Capacitor.isNativePlatform()) return { kind: 'none', canCheck: false };
  try {
    const { BiometricAuth, BiometryType } = await import('@aparajita/capacitor-biometric-auth');
    const res = await BiometricAuth.checkBiometry();
    let kind: DeviceAuthKind = 'none';
    if (res.isAvailable) {
      switch (res.biometryType) {
        case BiometryType.faceId:
        case BiometryType.faceAuthentication:
          kind = 'faceId';
          break;
        case BiometryType.touchId:
          kind = 'touchId';
          break;
        case BiometryType.irisAuthentication:
          kind = 'iris';
          break;
        default:
          kind = 'fingerprint';
      }
    } else if (res.deviceIsSecure) {
      kind = 'passcode';
    }
    return { kind, canCheck: res.isAvailable || res.deviceIsSecure };
  } catch {
    // Some Android devices throw here although they can authenticate: let the
    // system prompt decide.
    return { kind: 'fingerprint', canCheck: true };
  }
};

export type DeviceAuthResult = 'ok' | 'cancelled' | 'unavailable' | 'failed';

/**
 * Face ID / Touch ID / fingerprint, falling back to the device passcode, PIN
 * or pattern (the system shows that option itself).
 */
export const authenticateDevice = async (
  reason: string,
  labels: { cancel: string; title: string }
): Promise<DeviceAuthResult> => {
  if (!Capacitor.isNativePlatform()) return 'unavailable';
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: labels.cancel,
      allowDeviceCredential: true,
      androidTitle: labels.title,
      androidSubtitle: reason,
      androidConfirmationRequired: false,
    });
    return 'ok';
  } catch (err) {
    const code = String((err as { code?: string })?.code || '');
    if (code === 'userCancel' || code === 'appCancel' || code === 'systemCancel' || code === 'userFallback') {
      return 'cancelled';
    }
    if (code === 'biometryNotAvailable' || code === 'biometryNotEnrolled' || code === 'passcodeNotSet' || code === 'noDeviceCredential') {
      return 'unavailable';
    }
    return 'failed';
  }
};
