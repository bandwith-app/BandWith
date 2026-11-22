/**
 * Crash reports (migration 174). Settings › Privacy & account › "Send crash
 * reports", on by default, per device.
 *
 * - Native crashes (iOS, Android): Firebase Crashlytics, switched on or off
 *   with the same setting (Crashlytics keeps the choice across launches).
 * - JavaScript errors (the web app and the apps' WebView): window errors,
 *   unhandled promise rejections and screens that fail to draw
 *   (ErrorBoundary), sent to `bw_report_client_error`.
 *
 * No personal data and no user content: only the message and stack, scrubbed
 * here line by line (no emails, ids, long numbers, tokens, quoted text of any
 * kind, or query strings on any link, relative ones too),
 * the app version, the platform and the screen name ("Stage", "Gig").
 * At most 10 per session, each error once; the server caps it again.
 * Reporting never throws and never reports itself.
 */
import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';
import { currentPlatform, installedVersion } from '@/lib/minVersion';
import { currentScreenName } from '@/lib/appAnalytics';

export type ClientErrorKind = 'error' | 'rejection' | 'render';

export const CRASH_REPORTS_KEY = 'bw.crash_reports';
const MAX_PER_SESSION = 10;
const MAX_PENDING = 5;
const MESSAGE_MAX = 300;
const STACK_LINES = 15;
const STACK_MAX = 4000;

// ------------------------------------------------------------ the switch --

const listeners = new Set<() => void>();
/** This run's choice: wins over storage (blocked storage must not turn it back on). */
let override: boolean | null = null;

export function readCrashReportsEnabled(): boolean {
  if (override !== null) return override;
  try {
    return localStorage.getItem(CRASH_REPORTS_KEY) !== 'off';
  } catch {
    return true;
  }
}

let pluginPromise: Promise<typeof import('@capacitor-firebase/crashlytics')> | null = null;
const loadPlugin = () => (pluginPromise ??= import('@capacitor-firebase/crashlytics'));

/** Crashlytics follows the setting (native only; no Firebase config in a build → nothing happens). */
async function applyNative(on: boolean) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { FirebaseCrashlytics } = await loadPlugin();
    await FirebaseCrashlytics.setEnabled({ enabled: on });
    // Off: crashes recorded but not uploaded yet never leave either.
    if (!on) await FirebaseCrashlytics.deleteUnsentReports();
  } catch {
    /* crash reporting must never break the app */
  }
}

export function setCrashReportsEnabled(on: boolean) {
  override = on;
  try {
    localStorage.setItem(CRASH_REPORTS_KEY, on ? 'on' : 'off');
  } catch {
    /* storage blocked: the override holds for this run */
  }
  if (!on) pending.length = 0;
  listeners.forEach((l) => l());
  void applyNative(on);
}

export const useCrashReportsEnabled = (): boolean =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    readCrashReportsEnabled,
    () => true,
  );

// ------------------------------------------------------------- scrubbing --

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const JWT = /\beyJ[\w-]*\.[\w-]+\.[\w-]+/g;
/** Random-looking: 20+ characters with a digit, or 40+ of anything (long function names stay). */
const LONG_TOKEN = /\b(?:(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{40,})\b/g;
/** Any query string, on full and relative links alike (/deputy.html?deputy=…, /quote.html?t=…). */
const QUERY = /\?[^\s'"`()]+/g;
/** A fragment after a path (#418 in "Minified React error #418" stays). */
const FRAGMENT = /(\/[^\s#'"`()]*)#[^\s'"`()]+/g;
const PHONE_OR_NUMBER = /\+?\d[\d\s().-]{5,}\d/g;
/** All quoted text: it can be anything the user typed, even one word (a song called "Yesterday"). */
const QUOTED = /(["'`“‘])([^"'`”’\n]*)(["'`”’])/g;
/** A stack line's position (file:line:col), kept as it is. */
const POSITION = /:\d+:\d+\)?$/;

/** The one scrub, for the message and for every stack line. */
function scrubText(s: string): string {
  return s
    .replace(QUERY, '')
    .replace(FRAGMENT, '$1')
    .replace(EMAIL, '<email>')
    .replace(UUID, '<id>')
    .replace(JWT, '<token>')
    .replace(QUOTED, (_all, open: string, _body: string, close: string) => `${open}…${close}`)
    .replace(LONG_TOKEN, '<token>')
    .replace(PHONE_OR_NUMBER, '<n>');
}

export function scrubMessage(raw: string): string {
  return scrubText(String(raw ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MESSAGE_MAX);
}

export function scrubStack(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const lines = String(raw)
    .split('\n')
    .slice(0, STACK_LINES)
    .map((l) => {
      // The position's numbers are not a phone number: scrub the rest, keep it.
      const pos = POSITION.exec(l)?.[0] ?? '';
      return (scrubText(pos ? l.slice(0, -pos.length) : l) + pos).trimEnd();
    });
  return lines.join('\n').slice(0, STACK_MAX) || null;
}

/** Browser noise with nothing to learn from. */
const IGNORED = [/^Script error\.?$/i, /ResizeObserver loop/i, /chrome-extension:|moz-extension:|safari-extension:/i];

function describe(err: unknown): { message: string; stack: string | null } {
  if (err instanceof Error) {
    const head = err.name && !err.message.startsWith(err.name) ? `${err.name}: ${err.message}` : err.message;
    return { message: head || err.name || 'Error', stack: err.stack ?? null };
  }
  if (typeof err === 'string') return { message: err, stack: null };
  // A rejected promise with a plain object: its type only, never its content.
  return { message: err === undefined || err === null ? String(err) : `Non-error ${typeof err} thrown`, stack: null };
}

// ------------------------------------------------------------- reporting --

let sent = 0;
const seen = new Set<string>();
/** Waiting to go out, oldest first (not signed in yet, no signal), a few at most. */
const pending: Array<Record<string, unknown>> = [];

async function send(args: Record<string, unknown>): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('bw_report_client_error', args);
    return !error;
  } catch {
    return false;
  }
}

let flushing: Promise<void> | null = null;

/** One flush at a time: every report goes once, in order. Switched off: nothing leaves, the queue goes. */
function flushPending(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    while (pending.length) {
      if (!readCrashReportsEnabled()) {
        pending.length = 0;
        return;
      }
      const next = pending[0];
      const ok = await send(next);
      // Switched off while the request was out: drop whatever is left.
      if (!readCrashReportsEnabled()) {
        pending.length = 0;
        return;
      }
      if (!ok) return;
      if (pending[0] === next) pending.shift();
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Report one error. Never throws. */
export async function reportClientError(kind: ClientErrorKind, err: unknown): Promise<void> {
  try {
    if (!readCrashReportsEnabled()) return;
    const raw = describe(err);
    if (IGNORED.some((re) => re.test(raw.message) || re.test(raw.stack ?? ''))) return;
    const message = scrubMessage(raw.message);
    const stack = scrubStack(raw.stack);
    const signature = `${kind}|${message}`;
    if (!message || seen.has(signature) || sent >= MAX_PER_SESSION) return;
    seen.add(signature);
    sent++;
    const args = {
      p_kind: kind,
      p_message: message,
      p_stack: stack,
      p_app_version: await installedVersion().catch(() => null),
      p_platform: currentPlatform(),
      p_route: currentScreenName()?.slice(0, 60) ?? null,
    };
    // Switched off while the version was read: not sent, not kept.
    if (!readCrashReportsEnabled() || pending.length >= MAX_PENDING) return;
    pending.push(args);
    await flushPending();
    // The flush running before this one was pushed may have stopped early: one more go.
    if (pending.includes(args)) await flushPending();
  } catch {
    /* the reporter never reports itself */
  }
}

let installed = false;

/** At app start: native Crashlytics follows the switch; JS errors are caught. Returns a stop (tests). */
export function installCrashReports(): () => void {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;
  void applyNative(readCrashReportsEnabled());
  const onError = (e: ErrorEvent) => void reportClientError('error', e.error ?? e.message);
  const onRejection = (e: PromiseRejectionEvent) => void reportClientError('rejection', (e as { reason?: unknown }).reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection as EventListener);
  // Errors from before sign-in go out once there is a session.
  let unsubscribe: (() => void) | undefined;
  try {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') void flushPending();
    });
    unsubscribe = () => data.subscription.unsubscribe();
  } catch {
    /* no auth in this build (tests, demo) */
  }
  return () => {
    installed = false;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection as EventListener);
    unsubscribe?.();
  };
}

export function __resetCrashReportsForTest() {
  sent = 0;
  seen.clear();
  pending.length = 0;
  listeners.clear();
  override = null;
  flushing = null;
  installed = false;
}
