import { describe, it, expect, vi, beforeEach } from 'vitest';

// Crash reports (174): JS errors → bw_report_client_error, scrubbed, rate-limited,
// off with the Settings switch. Native crashes → Crashlytics, same switch.
const h = vi.hoisted(() => ({
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: true as unknown, error: null as unknown },
  native: false,
  setEnabled: [] as boolean[],
  deleted: 0,
  /** The next rpc calls wait for this (a request in flight). */
  rpcGate: null as Promise<void> | null,
  version: async () => '1.0.14' as string | null,
  auth: null as ((event: string) => void) | null,
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.rpc.push({ fn, args });
      const result = h.rpcResult;
      if (h.rpcGate) await h.rpcGate;
      return result;
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
vi.mock('@/lib/appAnalytics', () => ({ currentScreenName: () => 'Stage' }));

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
  h.rpcResult = { data: true, error: null };
  h.native = false;
  h.setEnabled = [];
  h.deleted = 0;
  h.rpcGate = null;
  h.version = async () => '1.0.14';
  h.auth = null;
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
    expect(m).toContain('https://app.bandwith.fun/x');
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

describe('native: Crashlytics follows the switch', () => {
  it('off deletes the crash reports not sent yet', async () => {
    h.native = true;
    setCrashReportsEnabled(false);
    await flush();
    await flush();
    expect(h.deleted).toBe(1);
  });

  it('on at start, off when the switch goes off', async () => {
    h.native = true;
    const stop = installCrashReports();
    await flush();
    await flush();
    expect(h.setEnabled).toEqual([true]);
    setCrashReportsEnabled(false);
    await flush();
    await flush();
    expect(h.setEnabled).toEqual([true, false]);
    stop();
  });
});
