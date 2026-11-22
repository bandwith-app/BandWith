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
 * here (no emails, ids, long numbers, tokens, quoted text or URL queries),
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

export function readCrashReportsEnabled(): boolean {
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
  } catch {
    /* crash reporting must never break the app */
  }
}

export function setCrashReportsEnabled(on: boolean) {
  try {
    localStorage.setItem(CRASH_REPORTS_KEY, on ? 'on' : 'off');
  } catch {
    /* storage blocked: applies to this run */
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
const LONG_TOKEN = /\b[A-Za-z0-9_-]{24,}\b/g;
const URL_QUERY = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#'"`)]*)[?#][^\s'"`)]*/gi;
const PHONE_OR_NUMBER = /\+?\d[\d\s().-]{5,}\d/g;
/** Quoted text that isn't a plain identifier ('map', "length") is user content: dropped. */
const QUOTED = /(["'`“‘])([^"'`”’\n]*)(["'`”’])/g;
const IDENT = /^[A-Za-z_$][\w$.-]{0,40}$/;

function scrubCommon(s: string): string {
  return s
    .replace(URL_QUERY, '$1')
    .replace(EMAIL, '<email>')
    .replace(UUID, '<id>')
    .replace(JWT, '<token>');
}

export function scrubMessage(raw: string): string {
  const s = scrubCommon(String(raw ?? ''))
    .replace(QUOTED, (all, open: string, body: string, close: string) => (IDENT.test(body) ? all : `${open}…${close}`))
    .replace(PHONE_OR_NUMBER, '<n>')
    .replace(LONG_TOKEN, '<token>')
    .replace(/\s+/g, ' ')
    .trim();
  return s.slice(0, MESSAGE_MAX);
}

export function scrubStack(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const lines = String(raw)
    .split('\n')
    .slice(0, STACK_LINES)
    .map((l) => scrubCommon(l).replace(QUOTED, (all, o: string, b: string, c: string) => (IDENT.test(b) ? all : `${o}…${c}`)).trimEnd());
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
const pending: Array<Record<string, unknown>> = [];

async function send(args: Record<string, unknown>): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('bw_report_client_error', args);
    return !error;
  } catch {
    return false;
  }
}

/** Not signed in yet (or no signal): kept for the next chance, a few at most. */
async function flushPending() {
  while (pending.length) {
    const next = pending[0];
    if (!(await send(next))) return;
    pending.shift();
  }
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
    if (pending.length) await flushPending();
    if (!(await send(args)) && pending.length < MAX_PENDING) pending.push(args);
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
}
