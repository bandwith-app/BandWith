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
  currentScreenName: () => 'Stage',
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
  vi.unstubAllGlobals();
  __resetCrashReportsForTest();
});

const gate = () => {
  let open = () => {};
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
};

describe('scrubbing: no personal data, no user content', () => {
  it('removes emails, ids, numbers, tokens, quoted text and URL queries', () => {
    const m = scrubMessage(
      'Failed for leo@brooklynband.com on 3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f: "Hudson Line lyrics…" is not valid JSON, call +1 718 555 0199 at https://app.bandwith.fun/x?token=abc#frag eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl',
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
    expect(scrubMessage('SyntaxError: Unexpected token \'Y\', "Yesterday" is not valid JSON')).toBe(
      'SyntaxError: Unexpected token \'…\', "…" is not valid JSON',
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
      `SyntaxError: Unexpected token '…', "…" is not valid JSON`,
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
    expect(m).toContain('https://xyz.supabase.co/…');
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
    expect(h.setEnabled).toEqual([true, false]);
    expect(h.deleted).toBe(1);
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
    expect(m).toContain('https://files.test/…');
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
    expect(m).toContain('file://…');
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
      expect(m, raw).toBe('Error: cannot open file://… now');
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
