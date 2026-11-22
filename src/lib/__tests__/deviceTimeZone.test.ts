/**
 * Codex #297 r8: every profile held 004's default zone (Europe/Rome) because
 * the app never wrote it, so the server's "today" was Rome's for everyone.
 * The device's zone goes with each date action (p_tz) and is written to the
 * profile on sign-in, like preferred_language.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const update = vi.fn();
const eq = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      update: (v: unknown) => {
        update(table, v);
        return { eq: (...a: unknown[]) => eq(...a) };
      },
    }),
  },
}));

import { deviceTimeZone, useServerTimezoneSync } from '../deviceTimeZone';

const zoneIs = (tz: string | undefined | Error) =>
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation((() => {
    if (tz instanceof Error) throw tz;
    return { resolvedOptions: () => ({ timeZone: tz }) };
  }) as unknown as typeof Intl.DateTimeFormat);

describe("the device's time zone", () => {
  afterEach(() => vi.restoreAllMocks());

  it('is the zone Intl reports', () => {
    zoneIs('America/New_York');
    expect(deviceTimeZone()).toBe('America/New_York');
  });

  it('is null when Intl has none, throws or reports something too long for the column', () => {
    zoneIs(undefined);
    expect(deviceTimeZone()).toBeNull();
    vi.restoreAllMocks();
    zoneIs(new Error('no Intl'));
    expect(deviceTimeZone()).toBeNull();
    vi.restoreAllMocks();
    zoneIs('X'.repeat(51));
    expect(deviceTimeZone()).toBeNull();
  });
});

describe('the profile zone written on sign-in', () => {
  beforeEach(() => {
    update.mockReset();
    eq.mockReset().mockResolvedValue({ error: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("writes the device's zone over 004's default, once", () => {
    zoneIs('America/New_York');
    const { rerender } = renderHook(({ tz }) => useServerTimezoneSync('u1', tz), { initialProps: { tz: 'Europe/Rome' as string | null } });
    expect(update).toHaveBeenCalledWith('profiles', { timezone: 'America/New_York' });
    expect(eq).toHaveBeenCalledWith('id', 'u1');
    // The profile in memory still says Rome (not read again): nothing more.
    rerender({ tz: 'Europe/Rome' });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('writes again when the device moves to another zone', () => {
    zoneIs('America/New_York');
    const { rerender } = renderHook(({ tz }) => useServerTimezoneSync('u1', tz), { initialProps: { tz: 'Europe/Rome' as string | null } });
    vi.restoreAllMocks();
    zoneIs('America/Los_Angeles');
    rerender({ tz: 'Europe/Rome' });
    expect(update).toHaveBeenLastCalledWith('profiles', { timezone: 'America/Los_Angeles' });
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('tries again on the next render when the write failed', async () => {
    zoneIs('America/New_York');
    eq.mockResolvedValueOnce({ error: { message: 'offline' } });
    const { rerender } = renderHook(({ tz }) => useServerTimezoneSync('u1', tz), { initialProps: { tz: 'Europe/Rome' as string | null } });
    await Promise.resolve();
    await Promise.resolve();
    rerender({ tz: null });
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('does nothing signed out, when it already matches, or when the device has no zone', () => {
    zoneIs('America/New_York');
    renderHook(() => useServerTimezoneSync(null, 'Europe/Rome'));
    renderHook(() => useServerTimezoneSync('u1', 'America/New_York'));
    vi.restoreAllMocks();
    zoneIs(undefined);
    renderHook(() => useServerTimezoneSync('u2', 'Europe/Rome'));
    expect(update).not.toHaveBeenCalled();
  });
});

describe('wired at sign-in', () => {
  it('App syncs the zone where it syncs the language', async () => {
    const app = (await import('@/app/App.tsx?raw')).default as string;
    expect(app).toMatch(/useServerTimezoneSync\(isAuthenticated && !isPasswordRecovery \? user\?\.id : null, profile\?\.timezone\)/);
  });
});
