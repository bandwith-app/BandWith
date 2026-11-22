import { describe, it, expect, vi, beforeEach } from 'vitest';

// Remote kill switches (173, docs/flags.md): fail open, cached offline.
const h = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as unknown },
  throws: false,
  calls: 0,
  platform: 'android' as 'ios' | 'android' | 'web',
  version: '1.0.13' as string | null,
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: async (cols: string) => {
        h.calls++;
        expect(table).toBe('app_flags');
        expect(cols).toBe('key, enabled, min_app_version');
        if (h.throws) throw new TypeError('Failed to fetch');
        return h.result;
      },
    }),
  },
}));
vi.mock('@/lib/minVersion', () => ({
  currentPlatform: () => h.platform,
  installedVersion: async () => h.version,
}));
vi.mock('@/lib/appResume', () => ({ onAppResume: () => () => undefined }));

import {
  APP_FLAGS_STORAGE_KEY,
  APP_FLAG_DEFAULTS,
  __resetAppFlagsForTest,
  appFlagValue,
  isFlagOn,
  minVersionFor,
  parseAppFlagRows,
  refreshAppFlags,
} from '../appFlags';

beforeEach(() => {
  localStorage.clear();
  __resetAppFlagsForTest(null);
  h.result = { data: [], error: null };
  h.throws = false;
  h.calls = 0;
  h.platform = 'android';
  h.version = '1.0.13';
});

describe('app flags', () => {
  it('every feature of the release is on by default', () => {
    for (const k of Object.keys(APP_FLAG_DEFAULTS) as (keyof typeof APP_FLAG_DEFAULTS)[]) expect(isFlagOn(k)).toBe(true);
    expect(Object.keys(APP_FLAG_DEFAULTS).sort()).toEqual(['ble_live', 'count_in', 'follow_tempo', 'live_pack', 'voice_parts']);
  });

  it('a row turned off hides the feature after the next read', async () => {
    h.result = { data: [{ key: 'voice_parts', enabled: false, min_app_version: null }], error: null };
    await refreshAppFlags();
    expect(isFlagOn('voice_parts')).toBe(false);
    expect(isFlagOn('live_pack')).toBe(true);
  });

  it('the table missing (migration not applied), nothing cached → the built-in default', async () => {
    h.result = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.app_flags' in the schema cache" } };
    await refreshAppFlags();
    expect(isFlagOn('live_pack')).toBe(true);
  });

  // Review #273 round 8: PGRST205 can be a schema cache not reloaded yet. Only a
  // definite answer with no row for the key clears a cached "off".
  it('the table "not found" (PGRST205, 42P01) keeps a cached "off"; an answer without the row clears it', async () => {
    __resetAppFlagsForTest({ flags: { live_pack: { enabled: false, minAppVersion: null } }, version: null });
    h.result = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.app_flags' in the schema cache" } };
    await refreshAppFlags();
    expect(isFlagOn('live_pack')).toBe(false);
    h.result = { data: null, error: { code: '42P01', message: 'relation "public.app_flags" does not exist' } };
    await refreshAppFlags();
    expect(isFlagOn('live_pack')).toBe(false);
    h.result = { data: [], error: null };
    await refreshAppFlags();
    expect(isFlagOn('live_pack')).toBe(true);
  });

  it('a missing row → the built-in default', async () => {
    h.result = { data: [{ key: 'count_in', enabled: false, min_app_version: null }], error: null };
    await refreshAppFlags();
    expect(isFlagOn('ble_live')).toBe(true);
  });

  it('offline: the value cached on the device holds, also after a restart', async () => {
    h.result = { data: [{ key: 'ble_live', enabled: false, min_app_version: null }], error: null };
    await refreshAppFlags();
    expect(localStorage.getItem(APP_FLAGS_STORAGE_KEY)).toContain('ble_live');
    // The app restarts with no signal.
    __resetAppFlagsForTest();
    h.throws = true;
    await refreshAppFlags();
    expect(isFlagOn('ble_live')).toBe(false);
    // A server error (not "no table") keeps it too.
    h.throws = false;
    h.result = { data: null, error: { code: '503', message: 'Service Unavailable' } };
    await refreshAppFlags();
    expect(isFlagOn('ble_live')).toBe(false);
  });

  it('nothing cached and no signal → the built-in default', async () => {
    h.throws = true;
    await refreshAppFlags();
    expect(isFlagOn('ble_live')).toBe(true);
  });

  it('a broken cache on the device → the built-in default', () => {
    localStorage.setItem(APP_FLAGS_STORAGE_KEY, '{not json');
    __resetAppFlagsForTest();
    expect(isFlagOn('voice_parts')).toBe(true);
  });

  it('min_app_version holds older installs back, per platform', async () => {
    h.result = { data: [{ key: 'live_pack', enabled: true, min_app_version: 'ios=202611230000;android=1.0.14' }], error: null };
    await refreshAppFlags();
    expect(isFlagOn('live_pack')).toBe(false);
    h.version = '1.0.14';
    await refreshAppFlags();
    expect(isFlagOn('live_pack')).toBe(true);
    // The web isn't listed: no minimum there.
    expect(appFlagValue('live_pack', { live_pack: { enabled: true, minAppVersion: 'android=1.0.14' } }, 'web', '202611210000')).toBe(true);
    // An install whose version can't be read is not held back.
    expect(appFlagValue('live_pack', { live_pack: { enabled: true, minAppVersion: '1.0.14' } }, 'android', null)).toBe(true);
  });

  it('reads the per-platform minimum, ignores junk', () => {
    expect(minVersionFor('1.0.14', 'android')).toBe('1.0.14');
    expect(minVersionFor('ios=202611230000; android=1.0.14', 'ios')).toBe('202611230000');
    expect(minVersionFor('ios=202611230000', 'android')).toBeNull();
    expect(minVersionFor('soon', 'ios')).toBeNull();
    expect(parseAppFlagRows([{ key: 'x', enabled: 'no' }, null, { key: 'y', enabled: false }])).toEqual({ y: { enabled: false, minAppVersion: null } });
    expect(parseAppFlagRows('nope')).toEqual({});
  });
});
