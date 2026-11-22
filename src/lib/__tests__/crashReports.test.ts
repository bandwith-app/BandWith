import { describe, it, expect, vi, beforeEach } from 'vitest';

// Crash reports (174): JS errors → bw_report_client_error, scrubbed, rate-limited,
// off with the Settings switch. Native crashes → Crashlytics, same switch.
const h = vi.hoisted(() => ({
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: true as unknown, error: null as unknown },
  native: false,
  setEnabled: [] as boolean[],
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.rpc.push({ fn, args });
      return h.rpcResult;
    },
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
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
  },
}));
vi.mock('@/lib/minVersion', () => ({ currentPlatform: () => (h.native ? 'android' : 'web'), installedVersion: async () => '1.0.14' }));
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
  localStorage.clear();
  h.rpc = [];
  h.rpcResult = { data: true, error: null };
  h.native = false;
  h.setEnabled = [];
  __resetCrashReportsForTest();
});

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

  it('keeps what helps: error names and property names', () => {
    expect(scrubMessage("TypeError: Cannot read properties of undefined (reading 'map')")).toBe(
      "TypeError: Cannot read properties of undefined (reading 'map')",
    );
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

describe('native: Crashlytics follows the switch', () => {
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
