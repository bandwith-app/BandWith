import { describe, it, expect, vi } from 'vitest';

// The live pack's silent refresh (170): never a banner, only a refresh of that event.
const h = vi.hoisted(() => ({ listeners: {} as Record<string, (n: unknown) => unknown>, scheduled: [] as unknown[] }));
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
vi.mock('../../supabase', () => ({ supabase: {} }));

import { setupNativePushListeners } from '../pushNotifications';
import { LIVE_PACK_REFRESH_EVENT } from '@/lib/livePack';

describe('silent live pack refresh push', () => {
  it('refreshes that event and shows nothing', async () => {
    const onNotification = vi.fn();
    setupNativePushListeners(onNotification, vi.fn());
    const seen: string[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail?.eventId);
    window.addEventListener(LIVE_PACK_REFRESH_EVENT, on);
    await h.listeners.pushNotificationReceived({ title: '', body: '', data: { type: 'live_pack_refresh', event_id: 'ev-1', silent: '1' } });
    window.removeEventListener(LIVE_PACK_REFRESH_EVENT, on);
    expect(seen).toEqual(['ev-1']);
    expect(h.scheduled).toHaveLength(0);
    expect(onNotification).not.toHaveBeenCalled();
  });
});
