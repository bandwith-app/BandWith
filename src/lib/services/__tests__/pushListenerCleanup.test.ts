import { describe, it, expect, vi } from 'vitest';

// Audit 07 #12: the native bridge hands listener handles back late. Cleanup
// that ran first left them all active, and the next sign-in added a second
// set (one push, two banners).
const h = vi.hoisted(() => ({
  pending: [] as Array<() => void>,
  active: new Set<string>(),
  n: 0,
}));
const delayedAdd = (name: string) => () =>
  new Promise<{ remove: () => Promise<void> }>((resolve) => {
    const key = `${name}#${++h.n}`;
    h.active.add(key);
    h.pending.push(() => resolve({ remove: async () => void h.active.delete(key) }));
  });

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
  registerPlugin: () => ({}),
}));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: { addListener: (name: string) => delayedAdd(name)() },
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    requestPermissions: async () => ({}),
    schedule: async () => undefined,
    addListener: (name: string) => delayedAdd(name)(),
  },
}));
vi.mock('../../supabase', () => ({ supabase: {} }));

import { setupNativePushListeners } from '../pushNotifications';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('native push listeners', () => {
  it('a handle that arrives after cleanup is removed at once', async () => {
    const cleanup = setupNativePushListeners(vi.fn(), vi.fn());
    expect(h.active.size).toBe(3);
    cleanup(); // left the screen while the bridge was still registering
    h.pending.splice(0).forEach((r) => r());
    await flush();
    await flush();
    expect(h.active.size).toBe(0);

    // Signing in again: exactly one set.
    const again = setupNativePushListeners(vi.fn(), vi.fn());
    h.pending.splice(0).forEach((r) => r());
    await flush();
    expect(h.active.size).toBe(3);
    again();
    await flush();
    expect(h.active.size).toBe(0);
  });
});
