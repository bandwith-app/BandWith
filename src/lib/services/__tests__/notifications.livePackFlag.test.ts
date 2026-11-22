/**
 * Kill switch live_pack off (docs/flags.md): the "Download for offline"
 * prompts (live_pack_ready) are not shown: not in the inbox, not in the
 * unread count, not as a banner while the app is open.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as Array<[string, ...unknown[]]>,
  listeners: {} as Record<string, (n: unknown) => unknown>,
  scheduled: [] as unknown[],
}));

vi.mock('@/lib/supabase', () => {
  const chain: any = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === 'then') {
          const p = Promise.resolve({ data: [], error: null, count: 0 });
          return p.then.bind(p);
        }
        return (...args: unknown[]) => {
          h.calls.push([prop, ...args]);
          return chain;
        };
      },
    },
  );
  return {
    supabase: { from: (table: string) => { h.calls.push(['from', table]); return chain; } },
    getSafeUser: async () => ({ data: { user: { id: 'u1' } } }),
  };
});
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
  registerPlugin: () => ({}),
}));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: (name: string, fn: (n: unknown) => unknown) => {
      h.listeners[name] = fn;
      return Promise.resolve({ remove: async () => undefined });
    },
  },
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    requestPermissions: async () => ({}),
    schedule: async (o: unknown) => void h.scheduled.push(o),
    addListener: () => Promise.resolve({ remove: async () => undefined }),
  },
}));

import { getNotifications, getUnreadCount } from '../notifications';
import { setupNativePushListeners } from '../pushNotifications';
import { __resetAppFlagsForTest, __setAppFlagsForTest } from '@/lib/appFlags';

const hides = () => h.calls.filter(([m, col, v]) => m === 'neq' && col === 'type' && v === 'live_pack_ready');

beforeEach(() => {
  h.calls.length = 0;
  h.scheduled.length = 0;
  __resetAppFlagsForTest(null);
});

describe('live_pack off: no download prompts', () => {
  it('inbox and unread count leave live_pack_ready out', async () => {
    __setAppFlagsForTest({ live_pack: false });
    await getNotifications({ limit: 20, excludeChat: true });
    await getUnreadCount();
    expect(hides()).toHaveLength(2);
  });

  it('on (the default): the prompts stay', async () => {
    await getNotifications({ limit: 20, excludeChat: true });
    await getUnreadCount();
    expect(hides()).toHaveLength(0);
  });

  it('no banner while the app is open', async () => {
    __setAppFlagsForTest({ live_pack: false });
    const onNotification = vi.fn();
    setupNativePushListeners(onNotification, vi.fn());
    await h.listeners.pushNotificationReceived({ title: 'Saturday: keep the setlist offline', body: '', data: { type: 'live_pack_ready', event_id: 'ev-1' } });
    expect(h.scheduled).toHaveLength(0);
    expect(onNotification).not.toHaveBeenCalled();
    __setAppFlagsForTest({ live_pack: true });
    await h.listeners.pushNotificationReceived({ title: 'Saturday: keep the setlist offline', body: '', data: { type: 'live_pack_ready', event_id: 'ev-1' } });
    expect(h.scheduled).toHaveLength(1);
  });
});
