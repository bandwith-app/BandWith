import { describe, expect, it, vi } from 'vitest';
import {
  androidInstallMessage,
  compareVersions,
  createAndroidUpdater,
  newestAndroidRelease,
  type AndroidInstallState,
  type ApkUpdatePlugin,
} from '../androidUpdate';

const rel = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets: [{ name: 'BandWith.apk', browser_download_url: `https://example.test/${tag}/BandWith.apk` }],
  ...extra,
});

describe('androidUpdate', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.1')).toBe(-1);
  });

  it('picks the newest published Android release with an APK', () => {
    const latest = newestAndroidRelease([
      rel('android-v1.0.2', { draft: true }),
      rel('android-v1.0.3', { prerelease: true }),
      rel('v2.0.0'),
      rel('android-v1.0.10'),
      rel('android-v1.0.9'),
      { tag_name: 'android-v1.0.11', draft: false, prerelease: false, assets: [] },
    ]);
    expect(latest).toEqual({ version: '1.0.10', url: 'https://example.test/android-v1.0.10/BandWith.apk' });
  });

  it('keeps the APK size from the release, for the download check', () => {
    const latest = newestAndroidRelease([
      rel('android-v1.0.3', { assets: [{ name: 'BandWith.apk', browser_download_url: 'https://example.test/a.apk', size: 19443314 }] }),
    ]);
    expect(latest).toEqual({ version: '1.0.3', url: 'https://example.test/a.apk', size: 19443314 });
  });

  it('copes with an empty or odd answer', () => {
    expect(newestAndroidRelease([])).toBeNull();
    expect(newestAndroidRelease({ message: 'rate limited' } as never)).toBeNull();
  });
});

const UPDATE = { version: '1.0.3', url: 'https://example.test/BandWith.apk', size: 1000 };
const rejectWith = (code: string) => Object.assign(new Error(code), { code });

function fakePlugin(over: Partial<ApkUpdatePlugin> = {}) {
  let progress: ((p: { version: string; percent: number; bytes: number; total: number }) => void) | null = null;
  const remove = vi.fn(async () => {});
  const plugin = {
    canInstall: vi.fn(async () => ({ allowed: true })),
    openInstallSettings: vi.fn(async () => {}),
    download: vi.fn(async () => {
      progress?.({ version: '1.0.3', percent: 42, bytes: 420, total: 1000 });
      return { versionCode: 30459389, versionName: '1.0.3', bytes: 1000 };
    }),
    install: vi.fn(async () => {}),
    addListener: vi.fn(async (_e: string, cb: typeof progress) => {
      progress = cb;
      return { remove };
    }),
    ...over,
  };
  return { plugin: plugin as unknown as ApkUpdatePlugin & typeof plugin, remove };
}

function setup(plugin: ApkUpdatePlugin | null) {
  const openBrowser = vi.fn(async () => {});
  const updater = createAndroidUpdater({ plugin: () => plugin, openBrowser });
  const states: AndroidInstallState[] = [];
  updater.subscribe(() => states.push(updater.getState()));
  return { updater, openBrowser, states };
}

describe('in-app Android install', () => {
  it('downloads with progress, then opens the installer', async () => {
    const { plugin, remove } = fakePlugin();
    const { updater, openBrowser, states } = setup(plugin);
    await updater.start(UPDATE, 'toast');
    expect(plugin.download).toHaveBeenCalledWith({ url: UPDATE.url, version: '1.0.3', size: 1000 });
    expect(plugin.install).toHaveBeenCalledWith({ version: '1.0.3' });
    expect(states.map((s) => (s.phase === 'downloading' ? `downloading ${s.percent}` : s.phase))).toEqual([
      'downloading null',
      'downloading 42',
      'installing',
    ]);
    expect(updater.getSource()).toBe('toast');
    expect(remove).toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
    // Back from the installer (cancelled or done): the button is back.
    await updater.resumed();
    expect(updater.getState()).toEqual({ phase: 'idle' });
  });

  it('asks for Android’s permission first and continues when the user comes back', async () => {
    let allowed = false;
    const { plugin } = fakePlugin({ canInstall: vi.fn(async () => ({ allowed })) });
    const { updater } = setup(plugin);
    await updater.start(UPDATE, 'settings');
    expect(updater.getState()).toEqual({ phase: 'permission', version: '1.0.3' });
    expect(plugin.install).not.toHaveBeenCalled();

    await updater.allow();
    expect(plugin.openInstallSettings).toHaveBeenCalled();

    // Came back without turning it on: still waiting.
    await updater.resumed();
    expect(updater.getState().phase).toBe('permission');

    allowed = true;
    await updater.resumed();
    expect(plugin.install).toHaveBeenCalledWith({ version: '1.0.3' });
    expect(updater.getState().phase).toBe('installing');
  });

  it('treats NOT_ALLOWED from install as the permission step', async () => {
    const { plugin } = fakePlugin({ install: vi.fn(async () => Promise.reject(rejectWith('NOT_ALLOWED'))) });
    const { updater } = setup(plugin);
    await updater.start(UPDATE, 'settings');
    expect(updater.getState().phase).toBe('permission');
  });

  it('falls back to the browser when the download fails', async () => {
    const { plugin } = fakePlugin({ download: vi.fn(async () => Promise.reject(rejectWith('SIZE_MISMATCH'))) });
    const { updater, openBrowser } = setup(plugin);
    await updater.start(UPDATE, 'toast');
    expect(updater.getState()).toEqual({ phase: 'error', version: '1.0.3', code: 'SIZE_MISMATCH', browser: true });
    expect(openBrowser).toHaveBeenCalledWith(UPDATE.url);
    expect(plugin.install).not.toHaveBeenCalled();
  });

  it('falls back to the browser for unknown errors and without the plugin', async () => {
    const { plugin } = fakePlugin({ download: vi.fn(async () => Promise.reject(new Error('not implemented'))) });
    const a = setup(plugin);
    await a.updater.start(UPDATE, 'toast');
    expect(a.updater.getState()).toMatchObject({ phase: 'error', code: 'UNAVAILABLE', browser: true });
    expect(a.openBrowser).toHaveBeenCalledWith(UPDATE.url);

    const b = setup(null);
    await b.updater.start(UPDATE, 'toast');
    expect(b.openBrowser).toHaveBeenCalledWith(UPDATE.url);
    expect(b.updater.getState()).toEqual({ phase: 'idle' });
  });

  it('does not send a file the browser would fail on too', async () => {
    for (const code of ['NOT_NEWER', 'SIGNATURE_MISMATCH', 'WRONG_PACKAGE']) {
      const { plugin } = fakePlugin({ download: vi.fn(async () => Promise.reject(rejectWith(code))) });
      const { updater, openBrowser } = setup(plugin);
      await updater.start(UPDATE, 'settings');
      expect(updater.getState()).toMatchObject({ phase: 'error', code, browser: false });
      expect(openBrowser).not.toHaveBeenCalled();
    }
  });

  it('ignores a second tap while downloading', async () => {
    let finish: () => void = () => {};
    const { plugin } = fakePlugin({
      download: vi.fn(() => new Promise<{ versionCode: number; versionName: string; bytes: number }>((r) => {
        finish = () => r({ versionCode: 2, versionName: '1.0.3', bytes: 1000 });
      })),
    });
    const { updater } = setup(plugin);
    const first = updater.start(UPDATE, 'toast');
    await vi.waitFor(() => expect(plugin.download).toHaveBeenCalledTimes(1));
    await updater.start(UPDATE, 'settings');
    expect(plugin.download).toHaveBeenCalledTimes(1);
    expect(updater.getSource()).toBe('toast');
    finish();
    await first;
    expect(updater.getState().phase).toBe('installing');
  });

  it('says what is happening', () => {
    expect(androidInstallMessage({ phase: 'idle' })).toBeNull();
    expect(androidInstallMessage({ phase: 'downloading', version: '1.0.3', percent: 42 })).toBe('Downloading 42%');
    expect(androidInstallMessage({ phase: 'downloading', version: '1.0.3', percent: null })).toBe('Downloading the update…');
    expect(androidInstallMessage({ phase: 'permission', version: '1.0.3' })).toMatch(/Allow from this source/);
    expect(androidInstallMessage({ phase: 'error', version: '1.0.3', code: 'DOWNLOAD_FAILED', browser: true })).toMatch(/browser/);
    expect(androidInstallMessage({ phase: 'error', version: '1.0.3', code: 'SIGNATURE_MISMATCH', browser: false })).toMatch(/Uninstall/);
  });
});
