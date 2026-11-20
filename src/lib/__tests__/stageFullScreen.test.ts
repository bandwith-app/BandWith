import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// Stage / Live mode full screen: the system bars (native), the browser's own
// full screen (web), and leaving it from outside (Escape, the browser's UI).

const bars = vi.hoisted(() => ({ native: false, hide: vi.fn(async () => {}), show: vi.fn(async () => {}) }));
vi.mock('@capacitor/core', async (orig) => {
  const real = await orig<typeof import('@capacitor/core')>();
  return {
    ...real,
    Capacitor: { ...real.Capacitor, isNativePlatform: () => bars.native, getPlatform: () => (bars.native ? 'ios' : 'web') },
    SystemBars: { ...real.SystemBars, hide: bars.hide, show: bars.show, setStyle: vi.fn(async () => {}) },
  };
});

import { STAGE_FULL_ATTR, exitBrowserFullScreen, requestBrowserFullScreen, useBrowserFullScreenExit, useStageFullScreen } from '../stageChrome';

const root = document.documentElement as unknown as { requestFullscreen?: unknown; webkitRequestFullscreen?: unknown; hasAttribute: (n: string) => boolean; removeAttribute: (n: string) => void };
const doc = document as unknown as { exitFullscreen?: unknown };

const setFullscreenElement = (el: Element | null) => Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => el });

describe('stage full screen', () => {
  beforeEach(() => {
    bars.native = false;
    bars.hide.mockClear();
    bars.show.mockClear();
    root.removeAttribute(STAGE_FULL_ATTR);
    delete root.requestFullscreen;
    delete root.webkitRequestFullscreen;
    delete doc.exitFullscreen;
    setFullscreenElement(null);
  });

  it('hides the status and navigation bars in the native apps while on', () => {
    bars.native = true;
    const { rerender, unmount } = renderHook(({ on }) => useStageFullScreen(on), { initialProps: { on: true } });
    expect(bars.hide).toHaveBeenCalledTimes(1);
    expect(root.hasAttribute(STAGE_FULL_ATTR)).toBe(true);
    rerender({ on: false });
    expect(bars.show).toHaveBeenCalledTimes(1);
    rerender({ on: true });
    unmount();
    expect(bars.show).toHaveBeenCalledTimes(2);
    expect(root.hasAttribute(STAGE_FULL_ATTR)).toBe(false);
  });

  it('leaves the system bars alone on the web', () => {
    renderHook(() => useStageFullScreen(true));
    expect(bars.hide).not.toHaveBeenCalled();
  });

  it('asks the browser for full screen, with the WebKit fallback', async () => {
    const std = vi.fn(async () => {});
    root.requestFullscreen = std;
    expect(await requestBrowserFullScreen()).toBe(true);
    expect(std).toHaveBeenCalled();

    delete root.requestFullscreen;
    const webkit = vi.fn();
    root.webkitRequestFullscreen = webkit;
    expect(await requestBrowserFullScreen()).toBe(true);
    expect(webkit).toHaveBeenCalled();

    delete root.webkitRequestFullscreen;
    expect(await requestBrowserFullScreen()).toBe(false);
  });

  it('does not ask the browser in the native apps (the bars are hidden there)', async () => {
    bars.native = true;
    const std = vi.fn(async () => {});
    root.requestFullscreen = std;
    expect(await requestBrowserFullScreen()).toBe(false);
    expect(std).not.toHaveBeenCalled();
  });

  it('leaves the browser’s full screen only when it is on', async () => {
    const exit = vi.fn(async () => {});
    doc.exitFullscreen = exit;
    await exitBrowserFullScreen();
    expect(exit).not.toHaveBeenCalled();
    setFullscreenElement(document.documentElement);
    await exitBrowserFullScreen();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('follows the person leaving the browser’s full screen from outside (Escape)', () => {
    const onExit = vi.fn();
    renderHook(() => useBrowserFullScreenExit(true, onExit));
    setFullscreenElement(document.documentElement);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(onExit).not.toHaveBeenCalled();
    setFullscreenElement(null);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
