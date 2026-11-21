import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { set, env } = vi.hoisted(() => ({ set: vi.fn((_o: { color: string }) => Promise.resolve()), env: { platform: 'android' } }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => env.platform !== 'web', getPlatform: () => env.platform },
  registerPlugin: () => ({ set }),
}));

import { syncAndroidBackdrop, topSurfaceColor, resetAndroidBackdropForTests } from '../androidBackdrop';

const flushFrames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));

/**
 * The strip above the web view (Android, System WebView older than 140): it
 * takes the colour at the top of the page, so Stage mode's black (and its full
 * screen) no longer has a white band over it.
 */
describe('androidBackdrop', () => {
  beforeEach(() => {
    env.platform = 'android';
    set.mockClear();
    resetAndroidBackdropForTests();
    document.body.innerHTML = '';
    document.body.style.backgroundColor = 'rgb(229, 227, 224)';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reads the first solid surface under the top of the page, looking through see-through layers', () => {
    const stage = document.createElement('div');
    stage.style.backgroundColor = 'rgb(0, 0, 0)';
    const line = document.createElement('span');
    stage.appendChild(line);
    // A sheet's scrim over Stage mode: see-through, so the black under it counts.
    const scrim = document.createElement('div');
    scrim.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
    document.body.append(stage, scrim);
    expect(topSurfaceColor(() => [scrim, line, stage, document.body])).toBe('#000000');
    // Nothing there: the page's own background.
    expect(topSurfaceColor(() => [])).toBe('#e5e3e0');
  });

  it('gives the native backdrop the colour at the top, once per change', async () => {
    const stage = document.createElement('div');
    stage.style.backgroundColor = 'rgb(0, 0, 0)';
    document.body.appendChild(stage);
    syncAndroidBackdrop(() => [stage]);
    await flushFrames();
    expect(set).toHaveBeenCalledWith({ color: '#000000' });
    syncAndroidBackdrop(() => [stage]);
    await flushFrames();
    expect(set).toHaveBeenCalledTimes(1);
    stage.remove();
    syncAndroidBackdrop(() => []);
    await flushFrames();
    expect(set).toHaveBeenLastCalledWith({ color: '#e5e3e0' });
  });

  it('does nothing on iOS or the web (they draw under the bars)', async () => {
    for (const p of ['ios', 'web']) {
      env.platform = p;
      syncAndroidBackdrop(() => []);
      await flushFrames();
    }
    expect(set).not.toHaveBeenCalled();
  });
});
