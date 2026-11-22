/**
 * Crash reports (migration 174). Settings › Privacy & account › "Send crash
 * reports", on by default, per device.
 *
 * - Native crashes (iOS, Android): Firebase Crashlytics, only with the usage
 *   statistics consent (src/lib/appAnalytics.ts, #238) AND this switch on.
 *   Off from the very first launch (Info.plist / AndroidManifest), so no
 *   collection and no installation ID until the user says yes; while it is
 *   off, the reports it kept are deleted at every start.
 * - JavaScript errors (the web app and the apps' WebView): window errors,
 *   unhandled promise rejections and screens that fail to draw
 *   (ErrorBoundary), sent to `bw_report_client_error`.
 *
 * No personal data and no user content: only the message and stack, scrubbed
 * here line by line (no emails, ids, long numbers, tokens, quoted text of any
 * kind, link paths other than the app's own files, or query strings),
 * the app version, the platform and the screen name ("Stage", "Gig").
 * At most 10 per session, each error once; the server caps it again.
 * Reporting never throws and never reports itself.
 */
import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';
import { currentPlatform, installedVersion } from '@/lib/minVersion';
import { currentScreenName, onAnalyticsConsentChange, readAnalyticsConsent } from '@/lib/appAnalytics';

export type ClientErrorKind = 'error' | 'rejection' | 'render';

export const CRASH_REPORTS_KEY = 'bw.crash_reports';
const MAX_PER_SESSION = 10;
const MAX_PENDING = 5;
const MESSAGE_MAX = 300;
const STACK_LINES = 15;
const STACK_MAX = 4000;

// ------------------------------------------------------------ the switch --

const listeners = new Set<() => void>();
/**
 * Off for this run because storage is blocked. Only ever OFF: where storage
 * works it is the truth (shared by every tab), so no tab can turn reports
 * back on over an opt-out made in another one.
 */
let blockedOptOut = false;

export function readCrashReportsEnabled(): boolean {
  if (blockedOptOut) return false;
  try {
    return localStorage.getItem(CRASH_REPORTS_KEY) !== 'off';
  } catch {
    return true;
  }
}

let pluginPromise: Promise<typeof import('@capacitor-firebase/crashlytics')> | null = null;
const loadPlugin = () => (pluginPromise ??= import('@capacitor-firebase/crashlytics'));

/** Crashlytics: only with the usage statistics consent and this switch on. */
const nativeAllowed = () => readCrashReportsEnabled() && readAnalyticsConsent() === 'granted';

/** Native only; no Firebase config in a build → nothing happens. */
async function applyNative() {
  if (!Capacitor.isNativePlatform()) return;
  const on = nativeAllowed();
  try {
    const { FirebaseCrashlytics } = await loadPlugin();
    await FirebaseCrashlytics.setEnabled({ enabled: on });
    // Off: crashes recorded but not uploaded yet never leave either.
    if (!on) await FirebaseCrashlytics.deleteUnsentReports();
  } catch {
    /* crash reporting must never break the app */
  }
}

/** Switched off (here or in another tab): nothing queued or in flight leaves. */
function stopEverything() {
  pending.length = 0;
  inFlight.forEach((c) => c.abort());
  inFlight.clear();
}

function changed() {
  if (!readCrashReportsEnabled()) stopEverything();
  listeners.forEach((l) => l());
  void applyNative();
}

export function setCrashReportsEnabled(on: boolean) {
  blockedOptOut = false;
  try {
    localStorage.setItem(CRASH_REPORTS_KEY, on ? 'on' : 'off');
  } catch {
    /* storage blocked: an opt-out still holds for this run */
    if (!on) blockedOptOut = true;
  }
  changed();
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
/** Random-looking: 16+ characters with a digit, or 40+ of anything (long function names stay). */
const LONG_TOKEN = /\b(?:(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{16,}|[A-Za-z0-9_-]{40,})\b/g;
/** Any query string, on full and relative links alike (/deputy.html?deputy=…, /quote.html?t=…). */
const QUERY = /\?[^\s'"`()]+/g;
/** A fragment after a path (#418 in "Minified React error #418" stays). */
const FRAGMENT = /(\/[^\s#'"`()]*)#[^\s'"`()]+/g;
const PHONE_OR_NUMBER = /\+?\d[\d\s().-]{5,}\d/g;
/** A stack line's position (file:line:col), kept as it is. */
const POSITION = /:\d+:\d+\)?$/;

/**
 * Links: the origin stays, and so do the app's own files (/assets/…, and a
 * page like /quote.html); any other path goes, whole: it can name a band, a
 * person or a file (/storage/v1/object/sign/audio/Mirage/Mary Smith - Yesterday.mp3),
 * so the words after it up to a file extension go too.
 */
const LINK_CHARS = `[^\\s'"\`()<>]`;
const ORIGIN = `[a-z][a-z0-9+.-]*:\\/\\/[^\\s/'"\`()<>]+`;
const LINK = new RegExp(
  `(${ORIGIN})?((?:\\/${LINK_CHARS.replace(']', '/]')}+)+\\/?)((?:\\s+[^\\s/'"\`()<>]+)*?\\.[A-Za-z0-9]{2,5}\\b)?`,
  'gi',
);
const APP_FILE = /^\/(?:assets\/[^\s/]+(?:\/[^\s/]+)*|[\w.-]+\.(?:html|js))$/;

function scrubLinks(s: string): string {
  return s.replace(LINK, (all, origin: string | undefined, path: string, tail: string | undefined, offset: number) => {
    // A relative path only after a space, a bracket, a quote or the start ("a/b" is not a link).
    if (!origin && offset > 0 && !/[\s('"=,:[]/.test(s[offset - 1])) return all;
    if (!tail && APP_FILE.test(path)) return all;
    return `${origin ?? ''}/…`;
  });
}

/**
 * All quoted text: it can be anything the user typed, even one word (a song
 * called "Yesterday"). Each opening quote with its own closing one; double
 * quotes first, so an apostrophe inside them ("Don't Stop Me Now") is just
 * text; for single quotes, an apostrophe between letters is text too. A
 * quote left open (a message cut short) hides the rest of the line.
 */
const DOUBLE_PAIRS: Array<[string, string]> = [['"', '"'], ['“', '”'], ['„', '“'], ['«', '»'], ['»', '«'], ['`', '`']];
const SINGLE_PAIRS: Array<[string, string]> = [["'", "'"], ['‘', '’'], ['‚', '‘'], ['‹', '›'], ['›', '‹']];
const esc = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pairRe = ([o, c]: [string, string], apostrophes: boolean) => {
  const [O, C] = [esc(o), esc(c)];
  // Single quotes: not opened by the apostrophe of a word (can't), not closed by one (Don't).
  const body = apostrophes ? `(?:[^${C}\\n]|${C}(?=[\\p{L}\\p{N}]))*` : `[^${C}\\n]*`;
  const lead = apostrophes ? '(?<![\\p{L}\\p{N}])' : '';
  const trail = apostrophes ? '(?![\\p{L}\\p{N}])' : '';
  return { closed: new RegExp(`${lead}${O}${body}${C}${trail}`, 'gu'), open: new RegExp(`${lead}${O}[^${C}\\n]*$`, 'u'), o, c };
};
const QUOTE_RES = [...DOUBLE_PAIRS.map((p) => pairRe(p, false)), ...SINGLE_PAIRS.map((p) => pairRe(p, true))];

function scrubQuotes(s: string): string {
  // Closed pairs become markers first, so their quote marks can't open or close another pair.
  const done: string[] = [];
  const mark = (text: string) => `\u0001${done.push(text) - 1}\u0001`;
  let out = s;
  for (const q of QUOTE_RES) out = out.replace(q.closed, () => mark(`${q.o}…${q.c}`));
  for (const q of QUOTE_RES) out = out.replace(q.open, () => mark(`${q.o}…`));
  return out.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => done[Number(i)]);
}

/** The one scrub, for the message and for every stack line. */
function scrubText(s: string): string {
  const out = scrubLinks(s.replace(QUERY, '').replace(FRAGMENT, '$1'))
    .replace(EMAIL, '<email>')
    .replace(UUID, '<id>')
    .replace(JWT, '<token>');
  return scrubQuotes(out)
    .replace(LONG_TOKEN, (t, offset: number, all: string) => (insideAppFile(all, offset) ? t : '<token>'))
    .replace(PHONE_OR_NUMBER, '<n>');
}

/** A bundle name like /assets/EventDetailWorkspace-B4xK9q1aZ2.js is ours: it stays. */
function insideAppFile(all: string, offset: number): boolean {
  const before = all.lastIndexOf('/assets/', offset);
  return before !== -1 && !/[\s'"`()<>]/.test(all.slice(before, offset));
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

/** Requests out now: an opt-out aborts them, even one still waiting for a session refresh. */
const inFlight = new Set<AbortController>();

async function send(args: Record<string, unknown>): Promise<boolean> {
  if (!readCrashReportsEnabled()) return false;
  const ctl = new AbortController();
  inFlight.add(ctl);
  try {
    const { error } = await supabase.rpc('bw_report_client_error', args).abortSignal(ctl.signal);
    return !error;
  } catch {
    return false;
  } finally {
    inFlight.delete(ctl);
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

/** At app start: native Crashlytics follows consent and the switch; JS errors are caught. Returns a stop (tests). */
export function installCrashReports(): () => void {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;
  void applyNative();
  // Another tab (web) changed the switch: storage is the truth.
  const onStorage = (e: StorageEvent) => {
    if (e.key === CRASH_REPORTS_KEY || e.key === null) changed();
  };
  window.addEventListener('storage', onStorage);
  // Crashlytics follows the usage statistics answer too.
  const offConsent = onAnalyticsConsentChange(() => void applyNative());
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
    window.removeEventListener('storage', onStorage);
    offConsent();
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
  blockedOptOut = false;
  inFlight.clear();
  flushing = null;
  installed = false;
}
