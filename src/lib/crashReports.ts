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
import { currentScreenName, onAnalyticsConsentChange, readCrashlyticsConsent } from '@/lib/appAnalytics';

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
 * Off for this run: storage is blocked or full, or another tab said no over
 * the BroadcastChannel. Only ever OFF: where storage works it is the truth
 * (shared by every tab), so no tab can turn reports back on over an opt-out
 * made in another one.
 */
let blockedOptOut = false;
/** The last answer read or written here: what holds when storage stops answering. */
let lastKnown: boolean | null = null;
/** The last choice could not be saved anywhere (Settings says so). */
let saveFailed = false;

/**
 * Where the choice goes when localStorage is full: IndexedDB (review #277,
 * Codex). Replaced in tests. No IndexedDB at all (some private modes): nothing
 * can have been saved there, so it reads as empty.
 */
export type ChoiceStore = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> };
const IDB_NAME = 'bw-privacy';
const IDB_STORE = 'choices';
const IDB_TIMEOUT_MS = 3000;
const idbRequest = <T,>(run: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T | null> =>
  new Promise<T | null>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      if (mode === 'readonly') resolve(null);
      else reject(new Error('no IndexedDB'));
      return;
    }
    const timer = setTimeout(() => reject(new Error('IndexedDB timeout')), IDB_TIMEOUT_MS);
    const done = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };
    const open = indexedDB.open(IDB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(IDB_STORE);
    open.onerror = () => done(() => reject(open.error));
    open.onsuccess = () => {
      const db = open.result;
      try {
        const req = run(db.transaction(IDB_STORE, mode).objectStore(IDB_STORE));
        req.onsuccess = () => done(() => resolve((req.result as T) ?? null));
        req.onerror = () => done(() => reject(req.error));
      } catch (e) {
        done(() => reject(e));
      } finally {
        db.close();
      }
    };
  });
const idbStore: ChoiceStore = {
  get: (key) => idbRequest<string>((st) => st.get(key) as IDBRequest<string>, 'readonly'),
  set: (key, value) => idbRequest((st) => st.put(value, key), 'readwrite').then(() => undefined),
};
let choiceStore: ChoiceStore = idbStore;
/** What the second store holds: 'off' there wins over anything in localStorage. */
let storedElsewhere: string | null = null;
/** 'unread' until it is read; 'failed' when it can't be (no reports until it can). */
let elsewhereState: 'unread' | 'read' | 'failed' = 'unread';
let elsewhereRead: Promise<void> | null = null;
let writes = 0;

/** Reads the second store once (again after a failure). Never throws. */
function ensureChoiceRead(): Promise<void> {
  if (elsewhereState === 'read') return Promise.resolve();
  return (elsewhereRead ??= (async () => {
    const before = writes;
    try {
      const v = await choiceStore.get(CRASH_REPORTS_KEY);
      if (writes === before) storedElsewhere = v;
      elsewhereState = 'read';
    } catch {
      elsewhereState = 'failed';
    } finally {
      elsewhereRead = null;
    }
    if (storedElsewhere === 'off') changed();
  })());
}

/** What storage says, or null when it can't be read. */
function readStored(): boolean | null {
  if (storedElsewhere === 'off') return false;
  try {
    return localStorage.getItem(CRASH_REPORTS_KEY) !== 'off';
  } catch {
    return null;
  }
}

/** Storage unreadable: the last answer this run saw, else off (fails closed). */
export function readCrashReportsEnabled(): boolean {
  if (blockedOptOut) return false;
  const stored = readStored();
  if (stored === null) return lastKnown ?? false;
  lastKnown = stored;
  return stored;
}

/** Reporting: the switch, and only once the choice could be read everywhere it may be (never on a guess). */
async function reportingAllowed(): Promise<boolean> {
  if (!readCrashReportsEnabled()) return false;
  await ensureChoiceRead();
  return elsewhereState === 'read' && readCrashReportsEnabled();
}

/** The last choice could not be saved: Settings shows "Couldn't save the choice, free up some space". */
export const readCrashReportsSaveFailed = () => saveFailed;

/** Tells the other tabs at once (a failed write fires no storage event). */
const CHANNEL_NAME = 'bw-crash-reports';
let channel: BroadcastChannel | null = null;
function openChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (e: MessageEvent) => {
      const on = (e.data as { on?: unknown } | null)?.on;
      if (on === false) blockedOptOut = true;
      else if (on === true) blockedOptOut = false;
      else return;
      changed();
    };
  } catch {
    channel = null;
  }
  return channel;
}

let pluginPromise: Promise<typeof import('@capacitor-firebase/crashlytics')> | null = null;
const loadPlugin = () => (pluginPromise ??= import('@capacitor-firebase/crashlytics'));

/**
 * Crashlytics: only with a usage statistics yes given under the wording that
 * names crash details (an older yes is asked again), and this switch on.
 */
const nativeAllowed = () => readCrashReportsEnabled() && readCrashlyticsConsent();

/** Native only; no Firebase config in a build → nothing happens. */
async function applyNative() {
  if (!Capacitor.isNativePlatform()) return;
  await ensureChoiceRead();
  const on = elsewhereState === 'read' && nativeAllowed();
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

/**
 * Saves the choice: localStorage, else IndexedDB (storage full). Takes effect
 * at once for this run either way, and the other tabs hear it. Resolves true
 * when the choice will read back after a reload; false: nothing could save it,
 * Settings says so, and an off still holds for the whole session.
 */
export async function setCrashReportsEnabled(on: boolean): Promise<boolean> {
  const value = on ? 'on' : 'off';
  writes++;
  blockedOptOut = !on; // until a save is confirmed, an off holds in memory
  lastKnown = on;
  let local = false;
  try {
    localStorage.setItem(CRASH_REPORTS_KEY, value);
    local = true;
  } catch {
    /* full or blocked: IndexedDB below */
  }
  changed();
  try {
    openChannel()?.postMessage({ on });
  } catch {
    /* no other tabs to tell */
  }
  let elsewhere = false;
  try {
    await choiceStore.set(CRASH_REPORTS_KEY, value);
    storedElsewhere = value;
    elsewhereState = 'read';
    elsewhere = true;
  } catch {
    /* no IndexedDB, or full too */
  }
  // Saved = a reload reads this choice back: off in either store, on only where nothing says off.
  const saved = on ? local && storedElsewhere !== 'off' : local || elsewhere;
  const before = readCrashReportsEnabled();
  saveFailed = !saved;
  blockedOptOut = !on && !saved;
  if (readCrashReportsEnabled() !== before) changed();
  else listeners.forEach((l) => l()); // the "couldn't save" line
  return saved;
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

/** Settings: the last choice could not be saved anywhere. */
export const useCrashReportsSaveFailed = (): boolean =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    readCrashReportsSaveFailed,
    () => false,
  );

// ------------------------------------------------------------- scrubbing --

/** Also URL-encoded (mary%40gmail.com). */
const EMAIL = /[\w.+-]+(?:@|%40)[\w-]+(\.[\w-]+)+/gi;
/**
 * Postgres detail: "Key (email)=(mary@x.com) already exists": the key stays,
 * the values go, whatever their shape. The key is read with its brackets
 * balanced (an expression key: lower(name::text)); the value runs to the
 * message's next words, or to the end of the line (a message cut short), so
 * brackets inside it (a song "Yesterday (Live)", a time range) don't end it.
 */
const KEY_START = /\b([Kk])ey \(/g;
const KEY_TAILS = [' already exists', ' is not present', ' is still referenced', ' conflicts with'];

function scrubKeyDetails(line: string): string {
  let out = '';
  let from = 0;
  KEY_START.lastIndex = 0;
  for (let m = KEY_START.exec(line); m; m = KEY_START.exec(line)) {
    const keyFrom = m.index + m[0].length;
    let i = keyFrom;
    for (let depth = 1; i < line.length && depth; i++) {
      if (line[i] === '(') depth++;
      else if (line[i] === ')') depth--;
    }
    if (!line.startsWith('=(', i)) continue;
    const valueFrom = i + 2;
    const tails = KEY_TAILS.map((t) => line.indexOf(t, valueFrom)).filter((x) => x !== -1);
    const stop = tails.length ? Math.min(...tails) : line.length;
    const close = line.lastIndexOf(')', stop - 1);
    const end = close >= valueFrom ? close + 1 : stop;
    out += `${line.slice(from, m.index)}${m[1]}ey (${line.slice(keyFrom, i - 1)})=(…)`;
    from = end;
    KEY_START.lastIndex = end;
  }
  return out + line.slice(from);
}
const BEARER = /\bBearer\s+[^\s'"`]+/gi;
/** Keys with a known prefix (sk_live_…, pk_test_…, sb_publishable_…, whsec_…), even without a digit. */
const PREFIXED_KEY = /\b(?:sk|pk|rk|sb|whsec)_[A-Za-z0-9_]{6,}/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** A JWT, or just its first part (eyJhbGciOi…). */
const JWT = /\beyJ[\w-]{6,}(?:\.[\w-]*)*/g;
/** Random-looking: 16+ characters with a digit, or 40+ of anything (long function names stay). */
const LONG_TOKEN = /\b(?:(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{16,}|[A-Za-z0-9_-]{40,})\b/g;
/** Any query string, on full and relative links alike (/deputy.html?deputy=…, /quote.html?t=…). */
const QUERY = /\?(?:[^\s'"`()<>]|\([^\s'"`()<>]*\)?)+/g;
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
// A path segment: its characters, and brackets inside it (Chart(Private%20Gig).pdf);
// a frame's own closing bracket "(…/a.js:1:2)" is not part of it.
const SEGMENT = `(?:[^\\s'"\`()<>/]|\\([^\\s'"\`()<>/]*\\)?)+`;
const ORIGIN = `[a-z][a-z0-9+.-]*:\\/\\/[^\\s/'"\`()<>]+`;
const LINK = new RegExp(
  `(${ORIGIN})?((?:\\/${SEGMENT})+\\/?)((?:\\s+[^\\s/'"\`<>]+)*?\\.[A-Za-z0-9]{2,5}\\b\\)?)?`,
  'gi',
);
const APP_FILE = /^\/(?:assets\/[^\s/]+(?:\/[^\s/]+)*|[\w.-]+\.(?:html|js))$/;
/** Our own origins: only there is /assets/… the app's bundle (any host can have an /assets/ folder). */
const OWN_ORIGIN = /^(?:https:\/\/(?:app\.)?bandwith\.fun|capacitor:\/\/localhost|https?:\/\/localhost(?::\d+)?)$/i;
const ownOrigin = (origin: string | undefined) => {
  if (!origin) return true; // a relative path is the page's own
  if (OWN_ORIGIN.test(origin)) return true;
  try {
    return typeof location !== 'undefined' && origin.toLowerCase() === location.origin.toLowerCase();
  } catch {
    return false;
  }
};

/**
 * Where a redacted path ends (review #277, Codex): greedily, at the last file
 * extension on the line, or at the end of the line when none follows and the
 * path has none (a name can hold apostrophes, brackets and spaces:
 * /Charts/Guns N' Roses.pdf). A frame's closing bracket at the end of the
 * line stays when its opening one is before the path.
 */
const EXTENSION = /\.[A-Za-z0-9]{2,5}\b/g;
function pathEnd(line: string, pathFrom: string | number, matchEnd: number, hasExtension: boolean): number {
  const from = typeof pathFrom === 'number' ? pathFrom : line.indexOf(pathFrom);
  let end = -1;
  EXTENSION.lastIndex = matchEnd;
  for (let m = EXTENSION.exec(line); m; m = EXTENSION.exec(line)) end = m.index + m[0].length;
  if (end === -1) end = hasExtension ? matchEnd : line.length;
  if (end === line.length && /\)\s*$/.test(line) && line.lastIndexOf('(', from) !== -1) end = line.lastIndexOf(')');
  return Math.max(end, matchEnd);
}
const ENDS_WITH_EXTENSION = /\.[A-Za-z0-9]{2,5}\)?$/;

function scrubLinksLine(line: string): string {
  let out = '';
  let last = 0;
  LINK.lastIndex = 0;
  for (let m = LINK.exec(line); m; m = LINK.exec(line)) {
    const [all, origin, path, tail] = m as unknown as [string, string | undefined, string, string | undefined];
    if (!all) {
      LINK.lastIndex++;
      continue;
    }
    const offset = m.index;
    // A relative path only after a space, a bracket, a quote or the start ("a/b" is not a link).
    if (!origin && offset > 0 && !/[\s('"=,:[]/.test(line[offset - 1])) continue;
    if (!tail && APP_FILE.test(path) && ownOrigin(origin)) continue;
    const end = pathEnd(line, offset, offset + all.length, ENDS_WITH_EXTENSION.test(all));
    out += `${line.slice(last, offset)}${origin ?? ''}/…`;
    last = end;
    LINK.lastIndex = end;
  }
  return out + line.slice(last);
}

function scrubLinks(s: string): string {
  return s.split('\n').map(scrubLinksLine).join('\n');
}

/**
 * A path with spaces in a folder name (…/audio/[Mirage] Mary Smith/x.pdf):
 * the plain link rules stop at the space and would keep "Mary Smith/x.pdf".
 * When a link's path goes on after a space with another "/", the whole rest
 * goes, up to the end of the line or a quote; a frame's closing bracket at
 * the end stays. The origin stays, as for any link.
 */
const LINE_QUOTE = /['"`“”‘’„‚«»‹›]/;
const SPACED_START = new RegExp(`(${ORIGIN}|file:\\/\\/)|(^|[\\s('"=,:[])(?=\\/[^\\s/'"\`<>]+\\/)`, 'gi');

function scrubSpacedLine(line: string): string {
  let out = '';
  let last = 0;
  SPACED_START.lastIndex = 0;
  for (let m = SPACED_START.exec(line); m; m = SPACED_START.exec(line)) {
    const origin = m[1];
    const pathStart = m.index + m[0].length;
    if (m[0].length === 0) SPACED_START.lastIndex++; // a bare start of line: don't loop on it
    const quote = line.slice(pathStart).search(LINE_QUOTE);
    let end = quote === -1 ? line.length : pathStart + quote;
    let rest = line.slice(pathStart, end);
    const frameClose = quote === -1 ? /\)\s*$/.exec(rest) : null;
    if (frameClose) {
      rest = rest.slice(0, frameClose.index);
      end = pathStart + frameClose.index;
    }
    const space = rest.search(/\s/);
    if (space === -1 || !rest.slice(space).includes('/')) continue;
    if (origin && origin.toLowerCase() !== 'file://' && !rest.startsWith('/')) continue; // a bare host
    out += line.slice(last, pathStart) + (origin?.toLowerCase() === 'file://' ? '…' : '/…');
    last = end;
    SPACED_START.lastIndex = end;
  }
  return out + line.slice(last);
}

function scrubSpacedPaths(s: string): string {
  return s.split('\n').map(scrubSpacedLine).join('\n');
}

/**
 * file:// paths (a WebView, a download): the whole path goes, with the words
 * after it up to a file extension (…/Documents/Mary Smith - Yesterday.mp3).
 * Only a file of the app's own bundle keeps its name.
 */
// Brackets inside a name go with it (chart%20(Private%20Gig).pdf); a frame's own closing one stays.
const FILE_LINK = /file:\/\/(?:[^\s'"`()<>]|\([^\s'"`()<>]*\)?)*(?:(?:\s+[^\s/'"`<>]+)*?\.[A-Za-z0-9]{2,5}\b\)?)?/gi;
const BUNDLE_PATH = /^file:\/\/(?:\/[^\s]*\/App\.app\/public\/|\/android_asset\/public\/)/i;
// The bundle file's name, with a frame's line and column (index-B4xK9q1a.js:1:2).
const BUNDLE_FILE = /\/([\w.-]+\.(?:js|mjs|css|html)(?::\d+){0,2})$/;

function scrubFileLinesLine(line: string): string {
  let out = '';
  let last = 0;
  FILE_LINK.lastIndex = 0;
  for (let m = FILE_LINK.exec(line); m; m = FILE_LINK.exec(line)) {
    const all = m[0];
    const name = BUNDLE_PATH.test(all) && !all.includes('..') ? BUNDLE_FILE.exec(all)?.[1] : undefined;
    // The app's own bundle file keeps its name; any other path goes whole (greedy, as links do).
    const end = name ? m.index + all.length : pathEnd(line, m.index, m.index + all.length, ENDS_WITH_EXTENSION.test(all));
    out += line.slice(last, m.index) + (name ? `file://…/${name}` : 'file://…');
    last = end;
    FILE_LINK.lastIndex = Math.max(end, m.index + 1);
  }
  return out + line.slice(last);
}

function scrubFileLinks(s: string): string {
  return s.split('\n').map(scrubFileLinesLine).join('\n');
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
  // No lookbehind (Safari before 16.4 throws at load): the character before is captured and put back.
  const lead = apostrophes ? '(^|[^\\p{L}\\p{N}])' : '()';
  const trail = apostrophes ? '(?![\\p{L}\\p{N}])' : '';
  return {
    closed: new RegExp(`${lead}${O}${body}${C}${trail}`, 'gu'),
    // Left open: the rest of that line ('m': a stack has more lines after it).
    open: new RegExp(`${lead}${O}[^${C}\\n]*$`, 'mu'),
    o,
    c,
  };
};
const QUOTE_RES = [...DOUBLE_PAIRS.map((p) => pairRe(p, false)), ...SINGLE_PAIRS.map((p) => pairRe(p, true))];

function scrubQuotes(s: string): string {
  // Closed pairs become markers first, so their quote marks can't open or close another pair.
  const done: string[] = [];
  const mark = (text: string) => `\u0001${done.push(text) - 1}\u0001`;
  let out = s;
  for (const q of QUOTE_RES) out = out.replace(q.closed, (_m, pre: string) => pre + mark(`${q.o}…${q.c}`));
  for (const q of QUOTE_RES) out = out.replace(q.open, (_m, pre: string) => pre + mark(`${q.o}…`));
  return out.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => done[Number(i)]);
}

/**
 * A JSON parse error or another SyntaxError can quote the text it read
 * ('[ "Lola", no ]' is not valid JSON) or echo it (/Mary Smith(/ in a bad
 * regular expression), with quotes inside quotes that no pairing can follow.
 * On such a line everything from the first quote (or the echoed /…/) goes;
 * the engine's own words at the end stay (is not valid JSON, in JSON at position 10).
 */
const ECHOING = /JSON|SyntaxError/;
const ECHO_START = /["'`“”‘’„‚«»‹›]|: \//;
const ECHO_TAIL = /\s(?:is not valid JSON|in JSON at position \d+(?: \(line \d+ column \d+\))?)\s*$/;

function scrubEchoes(line: string): string {
  if (!ECHOING.test(line)) return line;
  const at = line.search(ECHO_START);
  if (at === -1) return line;
  const cut = line[at] === ':' ? at + 1 : at;
  const tail = ECHO_TAIL.exec(line.slice(cut))?.[0] ?? '';
  return `${line.slice(0, cut).trimEnd()} …${tail}`;
}

/** The one scrub, for the message and for every stack line. */
function scrubText(s: string): string {
  const out = scrubFileLinks(scrubLinks(scrubSpacedPaths(scrubKeyDetails(scrubEchoes(s))).replace(QUERY, '').replace(FRAGMENT, '$1')))
    .replace(EMAIL, '<email>')
    .replace(UUID, '<id>')
    .replace(JWT, '<token>')
    .replace(BEARER, 'Bearer <token>')
    .replace(PREFIXED_KEY, '<token>');
  return scrubQuotes(out)
    .replace(LONG_TOKEN, (t, offset: number, all: string) => (insideAppFile(all, offset) ? t : '<token>'))
    .replace(PHONE_OR_NUMBER, '<n>');
}

/** A bundle name like /assets/EventDetailWorkspace-B4xK9q1aZ2.js is ours: it stays. */
function insideAppFile(all: string, offset: number): boolean {
  const before = all.lastIndexOf('/assets/', offset);
  return before !== -1 && !/[\s'"`()<>]/.test(all.slice(before, offset));
}

/** No NUL or other control characters (C0, except tab and line breaks): they can't forge a quote marker. */
const CONTROL = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(8) + String.fromCharCode(11, 12) + String.fromCharCode(14) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']', 'g');
const noControl = (s: string) => s.replace(CONTROL, '');

/** One line first: quoted text across a line break (a lyric) is still one quote. */
export function scrubMessage(raw: string): string {
  return scrubText(noControl(String(raw ?? '')).replace(/\s+/g, ' '))
    .trim()
    .slice(0, MESSAGE_MAX);
}

/** A stack frame: "    at f (…:1:2)" (Chrome, Android), "f@…:1:2" (Safari), "[native code]". */
const FRAME = /^\s*at\s|:\d+:\d+\)?$|\[native code\]$/;

export function scrubStack(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const all = noControl(String(raw)).split('\n');
  // The lines before the first frame repeat the message (Chrome): one line, scrubbed like it.
  let first = all.findIndex((l) => FRAME.test(l));
  if (first === -1) first = all.length;
  const head = all.slice(0, first).join(' ').trim();
  const frames = all
    .slice(first)
    .slice(0, STACK_LINES - (head ? 1 : 0))
    .map((l) => {
      // The position's numbers are not a phone number: scrub the rest, keep it.
      const pos = POSITION.exec(l)?.[0] ?? '';
      return (scrubText(pos ? l.slice(0, -pos.length) : l) + pos).trimEnd();
    });
  const lines = head ? [scrubMessage(head), ...frames] : frames;
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
/** Errors queued this session: each goes once. Marked only once queued (an error dropped on the way can come again). */
const seen = new Set<string>();
/** Being prepared now (the version lookup): a second copy meanwhile is the same error. */
const preparing = new Set<string>();
/** Waiting to go out, oldest first (not signed in yet, no signal), a few at most. */
const pending: Array<Record<string, unknown>> = [];

/** Requests out now: an opt-out aborts them, even one still waiting for a session refresh. */
const inFlight = new Set<AbortController>();

/** A 4xx the same report would get again: dropped, so it can't hold up the queue. Not signed in, slow or busy: kept. */
const KEEP_FOR_LATER = new Set([401, 403, 408, 429]);

/** Signed in now. No auth, or no answer: no (nothing leaves unauthenticated). */
async function hasSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return !!data?.session;
  } catch {
    return false;
  }
}

/** 'sent', 'later' (kept for the next go) or 'drop' (refused for good). */
async function send(args: Record<string, unknown>): Promise<'sent' | 'later' | 'drop'> {
  if (!readCrashReportsEnabled()) return 'later';
  // Signed out (the sign-in screen): kept on the device until sign-in, never sent without a session.
  if (!(await hasSession())) return 'later';
  if (!readCrashReportsEnabled()) return 'later';
  const ctl = new AbortController();
  inFlight.add(ctl);
  try {
    const { error, status } = await supabase.rpc('bw_report_client_error', args).abortSignal(ctl.signal);
    if (!error) return 'sent';
    return status >= 400 && status < 500 && !KEEP_FOR_LATER.has(status) ? 'drop' : 'later';
  } catch {
    return 'later';
  } finally {
    inFlight.delete(ctl);
  }
}

let flushing: Promise<void> | null = null;

/** One flush at a time: every report goes once, in order. Switched off: nothing leaves, the queue goes. */
function flushPending(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    if (pending.length && !(await reportingAllowed())) {
      if (!readCrashReportsEnabled()) pending.length = 0;
      return;
    }
    while (pending.length) {
      if (!readCrashReportsEnabled()) {
        pending.length = 0;
        return;
      }
      const next = pending[0];
      const result = await send(next);
      // Switched off while the request was out: drop whatever is left.
      if (!readCrashReportsEnabled()) {
        pending.length = 0;
        return;
      }
      if (result === 'later') return;
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
    if (!(await reportingAllowed())) return;
    const raw = describe(err);
    if (IGNORED.some((re) => re.test(raw.message) || re.test(raw.stack ?? ''))) return;
    const message = scrubMessage(raw.message);
    const stack = scrubStack(raw.stack);
    const signature = `${kind}|${message}`;
    if (!message || seen.has(signature) || preparing.has(signature) || sent >= MAX_PER_SESSION) return;
    // The screen in view now, before any wait (navigating meanwhile would name the next one).
    const route = currentScreenName()?.slice(0, 60) ?? null;
    preparing.add(signature);
    let args: Record<string, unknown>;
    try {
      args = {
        p_kind: kind,
        p_message: message,
        p_stack: stack,
        p_app_version: await installedVersion().catch(() => null),
        p_platform: currentPlatform(),
        p_route: route,
      };
      // Switched off while the version was read: not sent, not kept, not seen.
      if (!readCrashReportsEnabled()) return;
      // Queue full (no signal for a while): try to send the kept ones first.
      if (pending.length >= MAX_PENDING) await flushPending();
      if (!readCrashReportsEnabled() || pending.length >= MAX_PENDING || sent >= MAX_PER_SESSION) return;
      pending.push(args);
      seen.add(signature);
      sent++;
    } finally {
      preparing.delete(signature);
    }
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
  openChannel();
  void ensureChoiceRead();
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
  // Kept reports go out when the signal is back, and when the user comes back to the app.
  const onOnline = () => void flushPending();
  const onVisible = () => {
    if (document.visibilityState === 'visible') void flushPending();
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
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
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    offConsent();
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection as EventListener);
    unsubscribe?.();
    channel?.close();
    channel = null;
  };
}

/** Tests: the second store (null: the real IndexedDB, empty in jsdom). Kept across a reset, like a reload. */
export function __setChoiceStoreForTest(store: ChoiceStore | null) {
  choiceStore = store ?? idbStore;
  storedElsewhere = null;
  elsewhereState = 'unread';
  elsewhereRead = null;
}

export function __resetCrashReportsForTest() {
  sent = 0;
  seen.clear();
  preparing.clear();
  saveFailed = false;
  storedElsewhere = null;
  elsewhereState = 'unread';
  elsewhereRead = null;
  channel?.close();
  channel = null;
  pending.length = 0;
  listeners.clear();
  blockedOptOut = false;
  lastKnown = null;
  inFlight.clear();
  flushing = null;
  installed = false;
}
