import { describe, it, expect, vi, beforeEach } from 'vitest';

// Crash reports (174): JS errors → bw_report_client_error, scrubbed, rate-limited,
// off with the Settings switch. Native crashes → Crashlytics, same switch.
const h = vi.hoisted(() => ({
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: true as unknown, error: null as unknown, status: 200 as number | undefined } as { data: unknown; error: unknown; status?: number },
  native: false,
  setEnabled: [] as boolean[],
  deleted: 0,
  /** The next rpc calls wait for this (a request in flight). */
  rpcGate: null as Promise<void> | null,
  version: async () => '1.0.14' as string | null,
  auth: null as ((event: string) => void) | null,
  /** Requests that actually left (an aborted one never does). */
  wire: [] as Array<Record<string, unknown>>,
  signals: [] as AbortSignal[],
  consent: null as 'granted' | 'denied' | null,
  consentListeners: [] as Array<(c: 'granted' | 'denied' | null) => void>,
  screen: 'Stage' as string | null,
  /** The signed-in session (null: signed out, nothing may be sent). */
  session: { access_token: 'x' } as unknown,
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    // Like supabase-js: a builder with abortSignal(); the request leaves only after
    // the gate (the session refresh), and an aborted signal stops it there.
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.rpc.push({ fn, args });
      const result = h.rpcResult;
      let signal: AbortSignal | undefined;
      const run = async () => {
        if (h.rpcGate) await h.rpcGate;
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        h.wire.push(args);
        return result;
      };
      const builder = {
        abortSignal(s: AbortSignal) {
          signal = s;
          h.signals.push(s);
          return builder;
        },
        then<T>(ok: (v: typeof result) => T, bad?: (e: unknown) => T) {
          return run().then(ok, bad);
        },
      };
      return builder;
    },
    auth: {
      getSession: async () => ({ data: { session: h.session }, error: null }),
      onAuthStateChange: (cb: (event: string) => void) => {
        h.auth = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  },
}));
vi.mock('@capacitor/core', async (orig) => ({
  ...(await orig<typeof import('@capacitor/core')>()),
  Capacitor: { isNativePlatform: () => h.native, getPlatform: () => (h.native ? 'android' : 'web') },
}));
vi.mock('@capacitor-firebase/crashlytics', () => ({
  FirebaseCrashlytics: {
    setEnabled: async ({ enabled }: { enabled: boolean }) => {
      h.setEnabled.push(enabled);
    },
    deleteUnsentReports: async () => {
      h.deleted++;
    },
  },
}));
vi.mock('@/lib/minVersion', () => ({ currentPlatform: () => (h.native ? 'android' : 'web'), installedVersion: () => h.version() }));
vi.mock('@/lib/appAnalytics', () => ({
  currentScreenName: () => h.screen,
  readAnalyticsConsent: () => h.consent,
  readCrashlyticsConsent: () => h.consent === 'granted',
  onAnalyticsConsentChange: (fn: (c: 'granted' | 'denied' | null) => void) => {
    h.consentListeners.push(fn);
    return () => {
      h.consentListeners = h.consentListeners.filter((l) => l !== fn);
    };
  },
}));

import {
  CRASH_REPORTS_KEY,
  __resetCrashReportsForTest,
  installCrashReports,
  readCrashReportsEnabled,
  reportClientError,
  scrubMessage,
  scrubStack,
  setCrashReportsEnabled,
  readCrashReportsSaveFailed,
  __setChoiceStoreForTest,
} from '../crashReports';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  h.rpc = [];
  h.rpcResult = { data: true, error: null, status: 200 };
  h.native = false;
  h.setEnabled = [];
  h.deleted = 0;
  h.rpcGate = null;
  h.version = async () => '1.0.14';
  h.auth = null;
  h.wire = [];
  h.signals = [];
  h.consent = null;
  h.consentListeners = [];
  h.screen = 'Stage';
  h.session = { access_token: 'x' };
  vi.unstubAllGlobals();
  __resetCrashReportsForTest();
  __setChoiceStoreForTest(null);
});

const gate = () => {
  let open = () => {};
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
};

describe('scrubbing: no personal data, no user content', () => {
  it('removes emails, ids, numbers, tokens, quoted text and URL queries', () => {
    const m = scrubMessage(
      'Failed for leo@brooklynband.com on 3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f: "Hudson Line lyrics…" was not found, call +1 718 555 0199 at https://app.bandwith.fun/x?token=abc#frag eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl',
    );
    expect(m).not.toMatch(/leo@|brooklynband|3f2b8c1e|Hudson|718|555|token=abc|#frag|eyJ/);
    expect(m).toContain('<email>');
    expect(m).toContain('<id>');
    expect(m).toContain('https://app.bandwith.fun/…');
  });

  it('keeps the error name and shape, never quoted text (it can be a song title)', () => {
    expect(scrubMessage("TypeError: Cannot read properties of undefined (reading 'map')")).toBe(
      "TypeError: Cannot read properties of undefined (reading '…')",
    );
    // A JSON error: everything from the first quote goes (round 5).
    expect(scrubMessage('SyntaxError: Unexpected token \'Y\', "Yesterday" is not valid JSON')).toBe(
      'SyntaxError: Unexpected token … is not valid JSON',
    );
  });

  it('relative links lose their query too (deputy and quote links carry tokens)', () => {
    const m = scrubMessage('Failed to load /deputy.html?deputy=9f8e7d6c5b4a39281706 and /quote.html?t=k1Lm2Np3Qr4St5#x');
    expect(m).not.toMatch(/9f8e7d|k1Lm2|deputy=|t=/);
    expect(m).toContain('/deputy.html');
    expect(m).toContain('/quote.html');
  });

  it('every stack line gets the full scrub (the first one repeats the message)', () => {
    const stack = [
      'SyntaxError: "Hudson Line" from leo@nyc.com, 7185550199, k9X2mQ7vL4pR8sT1wZ3yB6nD',
      '    at parseSongFromClipboardTextLong (https://app.bandwith.fun/assets/index-B4xK9q.js:1:1234567)',
      '    at open (/quote.html?t=k1Lm2Np3Qr4St5Uv6Wx7Yz8:3:9)',
    ].join('\n');
    const s = scrubStack(stack)!;
    expect(s).not.toMatch(/Hudson|leo@|7185550199|k9X2mQ7|k1Lm2|t=/);
    // What finds the bug stays: function names, files, line and column.
    expect(s).toContain('parseSongFromClipboardTextLong');
    expect(s).toContain('index-B4xK9q.js:1:1234567');
    expect(s).toContain('/quote.html:3:9');
  });

  it('cuts long messages and stacks', () => {
    expect(scrubMessage('x'.repeat(1000)).length).toBeLessThanOrEqual(300);
    const stack = Array.from({ length: 40 }, (_, i) => `    at fn${i} (https://app.bandwith.fun/assets/index.js?v=1:1:${i})`).join('\n');
    const s = scrubStack(stack)!;
    expect(s.split('\n').length).toBeLessThanOrEqual(15);
    expect(s).not.toContain('?v=1');
  });
});

describe('scrubbing: quotes and links (review #277)', () => {
  it('an apostrophe inside quoted text does not end it', () => {
    expect(scrubMessage(`SyntaxError: Unexpected token 'D', "Don't Stop Me Now" is not valid JSON`)).toBe(
      `SyntaxError: Unexpected token … is not valid JSON`,
    );
    expect(scrubMessage(`Error: no song 'Don't Stop Me Now' in set`)).toBe(`Error: no song '…' in set`);
    expect(scrubMessage(`Error: can't open 'Ain’t No Sunshine'`)).toBe(`Error: can't open '…'`);
  });

  it('typographic quotes of every kind, and a quote left open', () => {
    for (const q of ['“Hudson Line”', '‘Hudson Line’', '«Hudson Line»', '„Hudson Line“', '‚Hudson Line‘', '‹Hudson Line›', '« Hudson Line »']) {
      expect(scrubMessage(`Error: ${q} failed`), q).not.toMatch(/Hudson|Line/);
    }
    expect(scrubMessage('Error: "Hudson Line is cut off')).not.toMatch(/Hudson|Line/);
  });

  it('links keep the origin and the app files, never a path that can name a band, a person or a file', () => {
    const m = scrubMessage(
      'Failed to fetch https://xyz.supabase.co/storage/v1/object/sign/audio/Mirage/Mary Smith - Yesterday.mp3 and /storage/v1/object/public/abcDEF123ghiJKL456/x.pdf',
    );
    expect(m).not.toMatch(/storage|Mirage|Mary|Smith|Yesterday|abcDEF123|x\.pdf/);
    expect(m).toContain('<url>'); // another domain goes whole (round 6)
    const s = scrubStack(
      '    at a (https://app.bandwith.fun/assets/EventDetailWorkspace-B4xK9q1aZ2.js:1:2)\n    at b (capacitor://localhost/assets/index-Q1w2e3r4.js:3:4)',
    )!;
    expect(s).toContain('https://app.bandwith.fun/assets/EventDetailWorkspace-B4xK9q1aZ2.js:1:2');
    expect(s).toContain('capacitor://localhost/assets/index-Q1w2e3r4.js:3:4');
  });

  it('shorter random tokens go too', () => {
    expect(scrubMessage('Error: bad key abcDEF123ghiJKL456')).toBe('Error: bad key <token>');
  });
});

describe('reporting', () => {
  it('sends only message, stack, version, platform and screen', async () => {
    await reportClientError('error', new TypeError('Boom on leo@nyc.com'));
    expect(h.rpc).toHaveLength(1);
    expect(h.rpc[0].fn).toBe('bw_report_client_error');
    expect(Object.keys(h.rpc[0].args).sort()).toEqual(['p_app_version', 'p_kind', 'p_message', 'p_platform', 'p_route', 'p_stack']);
    expect(h.rpc[0].args).toMatchObject({ p_kind: 'error', p_app_version: '1.0.14', p_platform: 'web', p_route: 'Stage' });
    expect(String(h.rpc[0].args.p_message)).toBe('TypeError: Boom on <email>');
  });

  it('is on by default, and off sends nothing', async () => {
    expect(readCrashReportsEnabled()).toBe(true);
    setCrashReportsEnabled(false);
    expect(localStorage.getItem(CRASH_REPORTS_KEY)).toBe('off');
    await reportClientError('error', new Error('nope'));
    expect(h.rpc).toHaveLength(0);
  });

  it('the same error once per session, and at most 10 in all', async () => {
    await reportClientError('error', new Error('same'));
    await reportClientError('error', new Error('same'));
    expect(h.rpc).toHaveLength(1);
    for (let i = 0; i < 20; i++) await reportClientError('error', new Error(`different ${String.fromCharCode(97 + i)}`));
    expect(h.rpc).toHaveLength(10);
  });

  it('ignores browser noise with nothing to learn from', async () => {
    await reportClientError('error', 'Script error.');
    await reportClientError('error', new Error('ResizeObserver loop completed with undelivered notifications.'));
    expect(h.rpc).toHaveLength(0);
  });

  it('never throws, even when the server says no', async () => {
    h.rpcResult = { data: null, error: { code: '42501', message: 'permission denied' } };
    await expect(reportClientError('error', new Error('signed out'))).resolves.toBeUndefined();
  });

  it('catches window errors and unhandled rejections', async () => {
    const stop = installCrashReports();
    window.dispatchEvent(new ErrorEvent('error', { message: 'Uncaught Error: stage', error: new Error('stage') }));
    const ev = new Event('unhandledrejection') as Event & { reason?: unknown };
    ev.reason = new Error('lost promise');
    window.dispatchEvent(ev);
    await flush();
    await flush();
    expect(h.rpc.map((c) => c.args.p_kind)).toEqual(['error', 'rejection']);
    stop();
  });
});

describe('switched off: nothing leaves, whatever is in flight', () => {
  it('off while the app version is being read: that error is not sent', async () => {
    const g = gate();
    h.version = () => g.p.then(() => '1.0.14');
    const p = reportClientError('error', new Error('during lookup'));
    setCrashReportsEnabled(false);
    g.open();
    await p;
    expect(h.rpc).toHaveLength(0);
  });

  it('a request that fails after switching off is not kept for later', async () => {
    const stop = installCrashReports();
    const g = gate();
    h.rpcGate = g.p;
    h.rpcResult = { data: null, error: { message: 'offline' } };
    const p = reportClientError('error', new Error('in flight'));
    await flush();
    setCrashReportsEnabled(false);
    g.open();
    await p;
    h.rpcGate = null;
    h.rpcResult = { data: true, error: null };
    setCrashReportsEnabled(true);
    h.auth?.('SIGNED_IN');
    await flush();
    await flush();
    expect(h.rpc.filter((c) => c.args.p_message === 'Error: in flight')).toHaveLength(1);
    stop();
  });

  it('storage blocked: the switch still holds for this run', async () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked, key: blocked, length: 0 });
    setCrashReportsEnabled(false);
    expect(readCrashReportsEnabled()).toBe(false);
    await reportClientError('error', new Error('nope'));
    expect(h.rpc).toHaveLength(0);
  });

  it('kept reports go out once each, even with two flushes at the same time', async () => {
    const stop = installCrashReports();
    h.rpcResult = { data: null, error: { message: 'not signed in' } };
    await reportClientError('error', new Error('first'));
    await reportClientError('error', new Error('second'));
    h.rpc = [];
    h.rpcResult = { data: true, error: null };
    h.auth?.('SIGNED_IN');
    h.auth?.('TOKEN_REFRESHED');
    for (let i = 0; i < 5; i++) await flush();
    expect(h.rpc.map((c) => c.args.p_message)).toEqual(['Error: first', 'Error: second']);
    stop();
  });
});

describe('opt-out wins everywhere (review #277)', () => {
  it('an opt-out made in another tab wins over this tab turning it on', async () => {
    const stop = installCrashReports();
    setCrashReportsEnabled(true);
    localStorage.setItem(CRASH_REPORTS_KEY, 'off');
    window.dispatchEvent(new StorageEvent('storage', { key: CRASH_REPORTS_KEY, newValue: 'off' }));
    expect(readCrashReportsEnabled()).toBe(false);
    await reportClientError('error', new Error('after the other tab said no'));
    expect(h.wire).toHaveLength(0);
    stop();
  });

  it('a request waiting for the session refresh never leaves after the opt-out', async () => {
    const g = gate();
    h.rpcGate = g.p;
    const p = reportClientError('error', new Error('waiting for the token'));
    await flush();
    await flush();
    expect(h.rpc).toHaveLength(1);
    setCrashReportsEnabled(false);
    expect(h.signals[0]?.aborted).toBe(true);
    g.open();
    await p;
    expect(h.wire).toHaveLength(0);
  });
});

describe('native: Crashlytics only with the usage statistics consent', () => {
  it('a fresh install with no answer never turns Crashlytics on, and clears what it kept', async () => {
    h.native = true;
    const stop = installCrashReports();
    await flush();
    await flush();
    expect(h.setEnabled).toEqual([false]);
    expect(h.deleted).toBe(1);
    stop();
  });

  it('on once the user allows usage statistics, off again when they say no', async () => {
    h.native = true;
    const stop = installCrashReports();
    await flush();
    h.consent = 'granted';
    h.consentListeners.forEach((l) => l('granted'));
    await flush();
    await flush();
    expect(h.setEnabled).toEqual([false, true]);
    h.consent = 'denied';
    h.consentListeners.forEach((l) => l('denied'));
    await flush();
    await flush();
    expect(h.setEnabled).toEqual([false, true, false]);
    stop();
  });

  it('consent given but crash reports off: Crashlytics stays off and its unsent reports go', async () => {
    h.native = true;
    h.consent = 'granted';
    const stop = installCrashReports();
    await flush();
    await flush();
    expect(h.setEnabled).toEqual([true]);
    setCrashReportsEnabled(false);
    await flush();
    await flush();
    // Set again from the final state after every change (round 6): never back on.
    expect(h.setEnabled[0]).toBe(true);
    expect(h.setEnabled.slice(1).length).toBeGreaterThan(0);
    expect(h.setEnabled.slice(1).every((on) => on === false)).toBe(true);
    expect(h.deleted).toBeGreaterThanOrEqual(1);
    stop();
  });
});

describe('scrubbing, round 2 (review #277)', () => {
  it('quoted text that spans lines goes, in the message and in the stack', () => {
    expect(scrubMessage(`Error: no song 'Mary Smith\nverse two' here`)).toBe(`Error: no song '…' here`);
    expect(scrubMessage('Error: lyric "first line\n\tsecond line" too long')).toBe('Error: lyric "…" too long');
    const s = scrubStack(
      'Error: lyric "first line\nsecond line" too long\n    at f (https://app.bandwith.fun/assets/index-B4xK9q1a.js:1:2)',
    )!;
    expect(s).not.toMatch(/first|second/);
    expect(s).toContain('https://app.bandwith.fun/assets/index-B4xK9q1a.js:1:2');
    // A quote left open on a line that is not the last one.
    expect(scrubStack("Error: open 'Mary Smith\n    at f (https://app.bandwith.fun/assets/a.js:1:2)")).not.toMatch(/Mary|Smith/);
  });

  it('/assets/ is kept only on our own origins', () => {
    const m = scrubMessage('Error: failed https://files.test/assets/Mary-Smith/Yesterday.mp3 and https://cdn.evil.test/assets/Mirage.js');
    expect(m).not.toMatch(/Mary|Smith|Yesterday|Mirage/);
    expect(m).toContain('<url>'); // another domain goes whole (round 6)
    for (const own of [
      'https://app.bandwith.fun/assets/index-B4xK9q1a.js',
      'https://bandwith.fun/assets/site-Q1w2e3r4.js',
      'capacitor://localhost/assets/index-Q1w2e3r4.js',
      'https://localhost/assets/index-Q1w2e3r4.js',
      'http://localhost:5173/assets/index-Q1w2e3r4.js',
    ]) {
      expect(scrubMessage(`Error: at ${own}`), own).toContain(own);
    }
  });

  it('file:// paths: only an app bundle file keeps its name', () => {
    const m = scrubMessage('Error: cannot read file:///var/mobile/Containers/Data/Application/ABC/Documents/Mary Smith - Yesterday.mp3 now');
    expect(m).not.toMatch(/var|mobile|Documents|Mary|Smith|Yesterday/);
    expect(m).toContain('<url>'); // a file outside the bundle goes whole (round 6)
    expect(scrubMessage('Error: at file:///private/var/containers/Bundle/Application/X1/App.app/public/assets/index-B4xK9q1a.js')).toContain(
      'file://…/index-B4xK9q1a.js',
    );
    expect(scrubMessage('Error: at file:///android_asset/public/assets/index-B4xK9q1a.js')).toContain('file://…/index-B4xK9q1a.js');
    expect(scrubMessage('Error: at file:///android_asset/../../data/Mirage/Mary.mp3')).not.toMatch(/Mirage|Mary/);
  });

  it('prefixed tokens, encoded emails and Postgres key values go', () => {
    const m = scrubMessage(
      'Error: sk_live_abcdefghijklmnopqrst pk_test_abcdefghijk rk_abcdefghij Bearer abcdefghij.klmno eyJhbGciOiJIUzI1NiJ9 mary.smith%40gmail.com',
    );
    expect(m).not.toMatch(/abcdefghij|klmno|eyJ|mary|gmail/);
    expect(m).toContain('Bearer <token>');
    expect(m).toContain('<email>');
    expect(scrubMessage('duplicate key value violates unique constraint. Key (email, band_id)=(mary@x.com, Mirage Music) already exists.')).toBe(
      'duplicate key value violates unique constraint. Key (email, band_id)=(…) already exists.',
    );
  });
});

describe('queued reports go out on reconnect and on return (review #277)', () => {
  it('five kept offline, a sixth error still flushes, and "online" or coming back sends them', async () => {
    const stop = installCrashReports();
    h.rpcResult = { data: null, error: { message: 'offline' } };
    for (let i = 0; i < 5; i++) await reportClientError('error', new Error(`offline ${i}`));
    h.rpcResult = { data: true, error: null };
    h.wire = [];
    await reportClientError('error', new Error('sixth'));
    await flush();
    expect(h.wire.map((a) => a.p_message)).toEqual([
      'Error: offline 0',
      'Error: offline 1',
      'Error: offline 2',
      'Error: offline 3',
      'Error: offline 4',
      'Error: sixth',
    ]);
    stop();
  });

  it('"online" sends what was kept', async () => {
    const stop = installCrashReports();
    h.rpcResult = { data: null, error: { message: 'offline' } };
    await reportClientError('error', new Error('kept'));
    h.rpcResult = { data: true, error: null };
    h.wire = [];
    window.dispatchEvent(new Event('online'));
    await flush();
    await flush();
    expect(h.wire.map((a) => a.p_message)).toEqual(['Error: kept']);
    stop();
  });

  it('coming back to the app sends what was kept', async () => {
    const stop = installCrashReports();
    h.rpcResult = { data: null, error: { message: 'offline' } };
    await reportClientError('error', new Error('kept'));
    h.rpcResult = { data: true, error: null };
    h.wire = [];
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    await flush();
    expect(h.wire.map((a) => a.p_message)).toEqual(['Error: kept']);
    stop();
  });
});

describe('round 4 (review #277)', () => {
  it('a file link with brackets and encoded spaces goes whole', () => {
    for (const raw of [
      'Error: cannot open file:///var/mobile/Documents/chart%20(Private%20Gig).pdf now',
      'Error: cannot open file:///var/mobile/Documents/chart (Private Gig).pdf now',
      'Error: cannot open file:///var/mobile/Documents/Set%281%29%20Mary.pdf now',
    ]) {
      const m = scrubMessage(raw);
      expect(m, raw).not.toMatch(/Private|Gig|Mary|Documents|pdf|%2|%20/);
      expect(m, raw).toBe('Error: cannot open <url> now');
    }
    // A stack frame's own closing bracket stays.
    expect(scrubStack('Error: x\n    at f (file:///android_asset/public/assets/index-B4xK9q1a.js:1:2)')).toContain(
      'at f (file://…/index-B4xK9q1a.js:1:2)',
    );
  });

  it('no NUL or control characters, and no marker can be forged', () => {
    const m = scrubMessage('Error: a\u0000b \u00010\u0001 c\u0007d');
    expect(m).not.toMatch(/[\u0000-\u0008]/);
    expect(m).not.toMatch(/undefined/);
    expect(scrubStack('Error: a\u0000b\n    at f (x.js:1:2)')).not.toMatch(/\u0000/);
  });

  it('opted out, then storage throws: still off (fails closed)', () => {
    setCrashReportsEnabled(false);
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked, key: blocked, length: 0 });
    expect(readCrashReportsEnabled()).toBe(false);
  });

  it('storage unreadable from the start: off (fails closed)', async () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked, key: blocked, length: 0 });
    expect(readCrashReportsEnabled()).toBe(false);
    await reportClientError('error', new Error('nope'));
    expect(h.rpc).toHaveLength(0);
  });

  it('turned on, then storage throws: the in-memory yes holds for this run', () => {
    setCrashReportsEnabled(true);
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked, key: blocked, length: 0 });
    expect(readCrashReportsEnabled()).toBe(true);
  });

  it('a report the server refuses for good (4xx) is dropped, the next ones still go', async () => {
    const stop = installCrashReports();
    h.rpcResult = { data: null, error: { message: 'bad request' }, status: 400 };
    await reportClientError('error', new Error('refused'));
    h.rpcResult = { data: true, error: null, status: 200 };
    h.wire = [];
    await reportClientError('error', new Error('after'));
    await flush();
    expect(h.wire.map((a) => a.p_message)).toEqual(['Error: after']);
    stop();
  });

  it('401, 403, 408 and 429 are kept for later (signed out, slow, busy)', async () => {
    for (const status of [401, 403, 408, 429]) {
      __resetCrashReportsForTest();
      const stop = installCrashReports();
      h.rpcResult = { data: null, error: { message: 'later' }, status };
      await reportClientError('error', new Error(`kept ${status}`));
      h.rpcResult = { data: true, error: null, status: 200 };
      h.wire = [];
      window.dispatchEvent(new Event('online'));
      await flush();
      await flush();
      expect(h.wire.map((a) => a.p_message), String(status)).toEqual([`Error: kept ${status}`]);
      stop();
    }
  });
});

describe('Postgres key details, any shape (review #277, Claude r4)', () => {
  it('expression keys, brackets in the value, every message kind, a message cut short', () => {
    expect(scrubMessage('duplicate key value violates unique constraint "x". Key (lower(name::text))=(mary smith) already exists.')).toBe(
      'duplicate key value violates unique constraint "…". Key (lower(name::text))=(…) already exists.',
    );
    expect(scrubMessage('Key (title)=(Yesterday (Live) Mary Smith) already exists.')).toBe('Key (title)=(…) already exists.');
    expect(scrubMessage('insert violates foreign key. Key (band_id)=(Mirage Music) is not present in table "bands".')).toBe(
      'insert violates foreign key. Key (band_id)=(…) is not present in table "…".',
    );
    expect(scrubMessage('Key (room)=(Mary) is still referenced from table "x".')).toBe('Key (room)=(…) is still referenced from table "…".');
    const ex = scrubMessage('Key (room, during)=(Studio B, [2026-11-23 10:00, Mary)) conflicts with existing key (room, during)=(Studio B, [Jo Lee)).');
    expect(ex).not.toMatch(/Studio|Mary|Jo|Lee/);
    expect(ex).toBe('Key (room, during)=(…) conflicts with existing key (room, during)=(…).');
    expect(scrubMessage('Key (email)=(mary smith')).toBe('Key (email)=(…)');
  });
});

describe('round 5 (review #277)', () => {
  it('a JSON parse error never keeps the input it quotes', () => {
    const cases: Array<[string, string]> = [
      ['SyntaxError: Unexpected token \'n\', "[ "Lola", no ]" is not valid JSON', 'SyntaxError: Unexpected token … is not valid JSON'],
      ['SyntaxError: Unexpected token \'L\', "Lola Smith" is not valid JSON', 'SyntaxError: Unexpected token … is not valid JSON'],
      ['SyntaxError: Expected \',\' or \']\' after array element in JSON at position 10 (line 1 column 11)', 'SyntaxError: Expected … in JSON at position 10 (line 1 column 11)'],
      ['SyntaxError: JSON Parse error: Unexpected identifier "Lola"', 'SyntaxError: JSON Parse error: Unexpected identifier …'],
      ['SyntaxError: Invalid regular expression: /Lola Smith(/: Unterminated group', 'SyntaxError: Invalid regular expression: …'],
    ];
    for (const [raw, want] of cases) {
      expect(scrubMessage(raw), raw).toBe(want);
      expect(scrubMessage(raw), raw).not.toMatch(/Lola|Smith/);
    }
    // The same in a stack's first line.
    expect(scrubStack('SyntaxError: Unexpected token \'n\', "[ "Lola", no ]" is not valid JSON\n    at JSON.parse (<anonymous>)')).not.toMatch(/Lola/);
  });

  it('http(s) links with brackets in the path or the query go whole', () => {
    expect(scrubMessage('Error: failed https://localhost/_capacitor_file_/Chart(Private%20Gig).pdf now')).toBe('Error: failed https://localhost/… now');
    const m = scrubMessage('Error: 403 https://xyz.supabase.co/storage/v1/object/sign/audio/Yesterday (Live) Mary.mp3 now');
    expect(m).not.toMatch(/Yesterday|Live|Mary|mp3/);
    expect(scrubMessage('Error: at /quote.html?t=ab(cd)ef now')).toBe('Error: at /quote.html now');
    // A frame's own closing bracket stays, and the app's own file keeps its name.
    expect(scrubStack('Error: x\n    at f (https://app.bandwith.fun/assets/index-B4xK9q1a.js:1:2)')).toContain(
      '(https://app.bandwith.fun/assets/index-B4xK9q1a.js:1:2)',
    );
  });

  it('the screen is the one in view when the error happened, not after the version lookup', async () => {
    h.version = async () => {
      h.screen = 'Home';
      return '1.0.14';
    };
    await reportClientError('error', new Error('on stage'));
    expect(h.rpc[0]?.args.p_route).toBe('Stage');
  });
});

describe('links with spaces inside brackets (review #277, Claude r5)', () => {
  it('a link whose brackets hold a space goes whole, up to the end of the line or a quote', () => {
    const cases = [
      'Failed to fetch https://x.supabase.co/storage/v1/object/sign/audio/[Mirage] Mary Smith/x.pdf',
      'Failed to fetch https://x.supabase.co/storage/v1/object/sign/audio/(Mirage) Mary Smith/Yesterday take 2/x.pdf',
      'Could not open file:///var/mobile/Documents/[Mirage] Mary Smith/x.pdf',
      'GET /storage/v1/object/sign/audio/[Mirage] Mary Smith/x.pdf 400',
      'Load failed for "https://x.supabase.co/storage/v1/object/sign/[Mirage] Mary Smith/x.pdf" now',
    ];
    for (const raw of cases) {
      const m = scrubMessage(raw);
      expect(m, raw).not.toMatch(/Mirage|Mary|Smith|Yesterday|x\.pdf/);
    }
    expect(scrubMessage(cases[0])).toBe('Failed to fetch <url>');
    expect(scrubMessage(cases[2])).toBe('Could not open <url>');
  });

  it('an encoded segment goes whole too', () => {
    const m = scrubMessage('Failed to fetch https://x.supabase.co/storage/v1/object/sign/audio/%5BMirage%5D%20Mary%20Smith/x.pdf');
    expect(m).toBe('Failed to fetch <url>');
  });

  it('links without spaces, and the app’s own frames, are as before', () => {
    expect(scrubMessage('at f (https://app.bandwith.fun/assets/index-B4xK9q1a.js:1:2)')).toBe(
      'at f (https://app.bandwith.fun/assets/index-B4xK9q1a.js:1:2)',
    );
    expect(scrubMessage('Failed to load /deputy.html and then a / b')).toBe('Failed to load /deputy.html and then a / b');
    expect(scrubMessage('at https://cdn.example.com/lib/x.js:1:2')).toBe('at <url>');
  });
});

// ── Codex round (review #277) ───────────────────────────────────────────────
describe('a path goes whole, apostrophes, brackets and spaces included (Codex B1)', () => {
  const NAME = /Guns|Roses|Charts|Mary|Smith|Live|Yesterday|Mirage/;
  it('an apostrophe in a file name does not end the path', () => {
    const cases = [
      "Error: can't open '/Charts/Guns N' Roses.pdf'",
      "Error: can't open /Charts/Guns N' Roses.pdf",
      'Load failed for "/Charts/Guns N\' Roses.pdf"',
      "Failed to fetch https://x.supabase.co/storage/v1/object/sign/charts/Guns N' Roses.pdf",
      "Could not open file:///var/mobile/Documents/Guns N' Roses.pdf",
    ];
    for (const raw of cases) expect(scrubMessage(raw), raw).not.toMatch(NAME);
    expect(scrubMessage(cases[3])).toBe('Failed to fetch <url>');
    expect(scrubMessage(cases[4])).toBe('Could not open <url>');
  });

  it('brackets and spaces in the name, and a name with no extension, go up to the end of the line', () => {
    const cases = [
      "GET /storage/v1/object/sign/audio/Guns N' Roses (Live) [2019]/Mary Smith - Yesterday.mp3 400",
      'Failed to fetch https://x.supabase.co/storage/v1/object/sign/audio/Mary Smith (Live).mp3',
      "Failed to load /Charts/Guns N' Roses",
      'Failed to load /Charts/[Mirage] Mary Smith',
    ];
    for (const raw of cases) expect(scrubMessage(raw), raw).not.toMatch(NAME);
    expect(scrubMessage(cases[2])).toBe('Failed to load /…');
  });

  it('the same in a stack, where the frame keeps its position', () => {
    const s = scrubStack("Error: x\n    at load (https://x.supabase.co/storage/v1/object/sign/Guns N' Roses.js:1:2)")!;
    expect(s).not.toMatch(NAME);
    expect(s).toMatch(/:1:2\)$/);
  });
});

describe('storage full: the opt-out fails closed (Codex B2)', () => {
  /** An in-memory IndexedDB stand-in; `broken` makes it throw. */
  const store = () => {
    const data = new Map<string, string>();
    const s = {
      broken: false,
      data,
      get: async (k: string) => {
        if (s.broken) throw new Error('IndexedDB unavailable');
        return data.get(k) ?? null;
      },
      set: async (k: string, v: string) => {
        if (s.broken) throw new Error('QuotaExceededError');
        data.set(k, v);
      },
    };
    return s;
  };
  /** localStorage that reads but can't take a new value (full). restore() puts the real one back. */
  const fullLocalStorage = () => {
    const real = localStorage;
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => real.getItem(k),
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: (k: string) => real.removeItem(k),
      clear: () => real.clear(),
      key: (i: number) => real.key(i),
      length: 0,
    });
    return { mockRestore: () => vi.stubGlobal('localStorage', real) };
  };

  it('localStorage full: the off goes to IndexedDB, and holds after a reload', async () => {
    const idb = store();
    __setChoiceStoreForTest(idb);
    const spy = fullLocalStorage();
    expect(await setCrashReportsEnabled(false)).toBe(true);
    expect(idb.data.get(CRASH_REPORTS_KEY)).toBe('off');
    expect(readCrashReportsSaveFailed()).toBe(false);
    spy.mockRestore();
    __resetCrashReportsForTest(); // a reload: memory gone, storage kept
    await reportClientError('error', new Error('after reload'));
    expect(h.rpc).toHaveLength(0);
    expect(readCrashReportsEnabled()).toBe(false);
  });

  it('nothing can be saved: "Couldn\'t save the choice", and off for the whole session', async () => {
    const idb = store();
    idb.broken = true;
    __setChoiceStoreForTest(idb);
    fullLocalStorage();
    expect(await setCrashReportsEnabled(false)).toBe(false);
    expect(readCrashReportsSaveFailed()).toBe(true);
    await reportClientError('error', new Error('still off'));
    expect(h.rpc).toHaveLength(0);
    expect(readCrashReportsEnabled()).toBe(false);
  });

  it('the other tabs hear the off at once (BroadcastChannel), even when no storage event fires', async () => {
    const channels: Array<{ name: string; onmessage: ((e: { data: unknown }) => void) | null; posted: unknown[] }> = [];
    class FakeChannel {
      name: string;
      onmessage: ((e: { data: unknown }) => void) | null = null;
      posted: unknown[] = [];
      constructor(name: string) {
        this.name = name;
        channels.push(this);
      }
      postMessage(d: unknown) {
        this.posted.push(d);
      }
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const stop = installCrashReports();
    const full = fullLocalStorage();
    await setCrashReportsEnabled(false);
    expect(channels.some((c) => c.posted.some((d) => (d as { on?: boolean }).on === false))).toBe(true);
    // This tab, told by another one: off at once.
    full.mockRestore();
    stop();
    __resetCrashReportsForTest();
    const stop2 = installCrashReports();
    const mine = channels[channels.length - 1];
    expect(readCrashReportsEnabled()).toBe(true);
    mine.onmessage?.({ data: { on: false } });
    expect(readCrashReportsEnabled()).toBe(false);
    await reportClientError('error', new Error('other tab said no'));
    expect(h.rpc).toHaveLength(0);
    stop2();
  });

  it('on reload, a choice that can\'t be read means no report until it can', async () => {
    const idb = store();
    idb.broken = true;
    __setChoiceStoreForTest(idb);
    await reportClientError('error', new Error('unreadable'));
    expect(h.rpc).toHaveLength(0);
    idb.broken = false;
    await reportClientError('error', new Error('readable now'));
    await flush();
    expect(h.rpc.map((c) => c.args.p_message)).toEqual(['Error: readable now']);
  });

  it('the Settings row shows the message', async () => {
    // (CrashReportsRow.test.tsx renders it; here: the flag clears after a save that works.)
    const idb = store();
    idb.broken = true;
    __setChoiceStoreForTest(idb);
    const spy = fullLocalStorage();
    await setCrashReportsEnabled(false);
    expect(readCrashReportsSaveFailed()).toBe(true);
    spy.mockRestore();
    idb.broken = false;
    expect(await setCrashReportsEnabled(false)).toBe(true);
    expect(readCrashReportsSaveFailed()).toBe(false);
  });
});

describe('never sent before sign-in (Codex minor)', () => {
  it('an error on the sign-in screen stays on the device, and goes once after sign-in', async () => {
    const stop = installCrashReports();
    h.session = null;
    await reportClientError('error', new Error('on the sign-in screen'));
    await flush();
    expect(h.rpc).toHaveLength(0);
    h.session = { access_token: 'x' };
    h.auth?.('SIGNED_IN');
    await flush();
    await flush();
    expect(h.rpc.map((c) => c.args.p_message)).toEqual(['Error: on the sign-in screen']);
    h.auth?.('TOKEN_REFRESHED');
    await flush();
    expect(h.rpc).toHaveLength(1);
    stop();
  });
});

describe('an error is "seen" only once it is queued (Codex minor)', () => {
  it('switched off while the version was read: the same error later is still reported', async () => {
    const g = gate();
    h.version = async () => {
      await g.p;
      return '1.0.14';
    };
    const first = reportClientError('error', new Error('twice'));
    await flush();
    await setCrashReportsEnabled(false);
    g.open();
    await first;
    expect(h.rpc).toHaveLength(0);
    h.version = async () => '1.0.14';
    await setCrashReportsEnabled(true);
    await reportClientError('error', new Error('twice'));
    await flush();
    expect(h.rpc.map((c) => c.args.p_message)).toEqual(['Error: twice']);
  });
});

// ── Review round 6 (Codex + Claude, review #277) ────────────────────────────
describe('URLs: only http(s) on our own domains keep anything (Codex B2)', () => {
  it('a URL of another scheme goes whole (irealb:// carries a whole song)', () => {
    expect(scrubMessage('Error: cannot import irealb://Knockin%20On%20Heavens%20Door%3DDylan%20Bob%3D%3DRock')).toBe('Error: cannot import <url>');
    // Spaces inside it too: the rest of the line goes.
    const m = scrubMessage("Error: cannot import irealb://Knockin' On Heaven's Door=Dylan Bob==Rock=n=T44 now");
    expect(m).not.toMatch(/Knockin|Heaven|Dylan|Bob|Rock/);
    expect(m).toContain('<url>');
    for (const raw of ['Error: open intent://scan/#Intent;scheme=zxing;end', 'Error: ws://xyz.supabase.co/realtime/v1 closed', 'Error: bad data:text/plain;base64,TWFyeSBTbWl0aA==']) {
      expect(scrubMessage(raw), raw).toMatch(/<url>/);
      expect(scrubMessage(raw), raw).not.toMatch(/scan|zxing|supabase|realtime|TWFy/);
    }
    // In a stack frame the position stays.
    expect(scrubStack('Error: x\n    at f (irealb://Mary Smith=Song:1:2)')).not.toMatch(/Mary|Smith|Song/);
  });

  it('http(s) on another domain goes whole; our own domains keep the origin and the app files', () => {
    expect(scrubMessage('Failed to fetch https://xyz.supabase.co/storage/v1/object/sign/audio/x.mp3')).toBe('Failed to fetch <url>');
    expect(scrubMessage('Failed to fetch https://xyz.supabase.co')).toBe('Failed to fetch <url>');
    expect(scrubMessage('Error: at https://app.bandwith.fun/assets/index-B4xK9q1a.js')).toBe('Error: at https://app.bandwith.fun/assets/index-B4xK9q1a.js');
    expect(scrubMessage('Error: at https://bandwith.fun/x/y')).toBe('Error: at https://bandwith.fun/…');
    expect(scrubStack('Error: x\n    at b (capacitor://localhost/assets/index-Q1w2e3r4.js:3:4)')).toContain('capacitor://localhost/assets/index-Q1w2e3r4.js:3:4');
  });

  it('userinfo (user:secret@) is always stripped, on our own domains too', () => {
    const own = scrubMessage('Error: at https://user:secret@app.bandwith.fun/assets/index-B4xK9q1a.js');
    expect(own).not.toMatch(/user|secret/);
    expect(own).toBe('Error: at https://app.bandwith.fun/assets/index-B4xK9q1a.js');
    const other = scrubMessage('Error: GET https://mary:hunter2@xyz.supabase.co/rest/v1/songs 401');
    expect(other).not.toMatch(/mary|hunter2|supabase/);
    expect(other).toContain('<url>');
  });
});

describe('quotes: to the last matching quote on the line (Codex B3)', () => {
  it("'Knockin' on Heaven's Door' leaves nothing of the title", () => {
    expect(scrubMessage("Error: no song 'Knockin' on Heaven's Door' in set")).toBe("Error: no song '…' in set");
    expect(scrubMessage('Error: no song "Knockin" on Heaven"s Door" in set')).toBe('Error: no song "…" in set');
    const s = scrubStack("Error: no song 'Knockin' on Heaven's Door'\n    at f (https://app.bandwith.fun/assets/a.js:1:2)")!;
    expect(s).not.toMatch(/Knockin|Heaven|Door/);
  });
});

describe('stack: only real frames are kept as frames (Codex B4)', () => {
  it('a lyric line starting "at last ..." is scrubbed like the message', () => {
    const s = scrubStack(
      [
        'Error: bad lyric "Hudson',
        'at last my love has come along',
        'my lonely days are over" here',
        '    at parse (https://app.bandwith.fun/assets/index-B4xK9q1a.js:1:2)',
        'at last the "Mary Smith',
        'song" ends',
      ].join('\n'),
    )!;
    expect(s).not.toMatch(/Hudson|last my love|lonely|Mary|Smith/);
    expect(s).toContain('    at parse (https://app.bandwith.fun/assets/index-B4xK9q1a.js:1:2)');
  });

  it('Chrome, Safari and Firefox frames still keep their position', () => {
    const s = scrubStack(
      [
        'TypeError: x',
        '    at Object.parse (https://app.bandwith.fun/assets/index-B4xK9q1a.js:1:2)',
        '    at https://app.bandwith.fun/assets/index-B4xK9q1a.js:3:4',
        'parse@capacitor://localhost/assets/index-Q1w2e3r4.js:5:6',
        'global code@capacitor://localhost/assets/index-Q1w2e3r4.js:7:8',
        'promiseReactionJob@[native code]',
      ].join('\n'),
    )!;
    expect(s.split('\n')).toEqual([
      'TypeError: x',
      '    at Object.parse (https://app.bandwith.fun/assets/index-B4xK9q1a.js:1:2)',
      '    at https://app.bandwith.fun/assets/index-B4xK9q1a.js:3:4',
      'parse@capacitor://localhost/assets/index-Q1w2e3r4.js:5:6',
      'global code@capacitor://localhost/assets/index-Q1w2e3r4.js:7:8',
      'promiseReactionJob@[native code]',
    ]);
  });
});

describe('relative paths without a leading slash (Claude 7)', () => {
  it('audio/Mirage/Mary Smith - Yesterday.mp3 goes whole', () => {
    for (const lead of [' ', ':', '=', '(']) {
      const m = scrubMessage(`Error: failed${lead}audio/Mirage/Mary Smith - Yesterday.mp3 now`);
      expect(m, lead).not.toMatch(/audio|Mirage|Mary|Smith|Yesterday|mp3/);
    }
    expect(scrubMessage('Error: failed audio/Mirage/Mary Smith - Yesterday.mp3 now')).toBe('Error: failed … now');
    expect(scrubMessage('Error: failed Mirage/Mary.pdf')).toBe('Error: failed …');
    // Not a path: a lone slash between words, our own link, a local dev server.
    expect(scrubMessage('Failed to load /deputy.html and then a / b')).toBe('Failed to load /deputy.html and then a / b');
    expect(scrubMessage('Error: at http://localhost:5173/assets/index-Q1w2e3r4.js')).toBe('Error: at http://localhost:5173/assets/index-Q1w2e3r4.js');
  });
});

describe('IndexedDB: saved only once the transaction completes (Codex B5)', () => {
  const fullLocalStorage = () => {
    const real = localStorage;
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => real.getItem(k),
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: (k: string) => real.removeItem(k),
      clear: () => real.clear(),
    });
  };

  it('the put succeeds but the transaction aborts: not saved, and Settings says so', async () => {
    const { fakeIndexedDB } = await import('@/test/fakeIndexedDB');
    const fake = fakeIndexedDB({ abortWrites: true });
    vi.stubGlobal('indexedDB', fake.indexedDB);
    fullLocalStorage();
    expect(await setCrashReportsEnabled(false)).toBe(false);
    expect(readCrashReportsSaveFailed()).toBe(true);
    expect(readCrashReportsEnabled()).toBe(false);
  });

  it('a transaction that completes is saved', async () => {
    const { fakeIndexedDB } = await import('@/test/fakeIndexedDB');
    const fake = fakeIndexedDB();
    vi.stubGlobal('indexedDB', fake.indexedDB);
    fullLocalStorage();
    expect(await setCrashReportsEnabled(false)).toBe(true);
    expect(fake.state.data.get(CRASH_REPORTS_KEY)).toBe('off');
    expect(readCrashReportsSaveFailed()).toBe(false);
  });
});

describe('Crashlytics follows the final state after every change (Codex minor 6)', () => {
  it('turned on while IndexedDB still said off: Crashlytics ends on', async () => {
    h.native = true;
    h.consent = 'granted';
    const g = gate();
    const data = new Map<string, string>([[CRASH_REPORTS_KEY, 'off']]);
    __setChoiceStoreForTest({
      get: async (k) => data.get(k) ?? null,
      set: async (k, v) => {
        await g.p;
        data.set(k, v);
      },
    });
    const stop = installCrashReports();
    for (let i = 0; i < 5; i++) await flush();
    expect(readCrashReportsEnabled()).toBe(false);
    expect(h.setEnabled[h.setEnabled.length - 1]).toBe(false);
    const saved = setCrashReportsEnabled(true);
    for (let i = 0; i < 5; i++) await flush();
    g.open();
    expect(await saved).toBe(true);
    for (let i = 0; i < 5; i++) await flush();
    expect(readCrashReportsEnabled()).toBe(true);
    expect(h.setEnabled[h.setEnabled.length - 1]).toBe(true);
    stop();
  });
});
