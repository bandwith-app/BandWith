import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const shouldAsk = vi.fn(() => true);
const setConsent = vi.fn(async (_consent: string) => true);
vi.mock('@/lib/appAnalytics', () => ({
  shouldAskAnalyticsConsent: () => shouldAsk(),
  setAnalyticsConsent: (c: string) => setConsent(c),
  useAnalyticsConsent: () => 'granted',
}));

import { useAnalyticsAsk, useAnalyticsAskOpen } from '../useAnalyticsAsk';

/** As AuthenticatedApp uses the two: the state first (it decides what is watched), then the sheet with what blocks it. */
const useAsk = (blocked: boolean) => {
  const ask = useAnalyticsAsk();
  const open = useAnalyticsAskOpen(ask, blocked);
  return { ask, open };
};

beforeEach(() => {
  vi.useFakeTimers();
  shouldAsk.mockReturnValue(true);
  setConsent.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('the usage-statistics question', () => {
  it('comes 1.5 s after nothing blocks it, and hides while something does', () => {
    const { result, rerender } = renderHook(({ blocked }) => useAsk(blocked), { initialProps: { blocked: true } });
    act(() => void vi.advanceTimersByTime(5000));
    expect(result.current.open).toBe(false);
    expect(result.current.ask.due).toBe(true);
    rerender({ blocked: false });
    act(() => void vi.advanceTimersByTime(1499));
    expect(result.current.open).toBe(false);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.open).toBe(true);
    // Stage mode or a sheet opens over it: it steps aside, and is back when that closes.
    rerender({ blocked: true });
    expect(result.current.open).toBe(false);
    rerender({ blocked: false });
    expect(result.current.open).toBe(true);
  });

  it('closed without an answer: not asked again in this run, whatever opens and closes after (asked on the next launch)', () => {
    const { result, rerender } = renderHook(({ blocked }) => useAsk(blocked), { initialProps: { blocked: false } });
    act(() => void vi.advanceTimersByTime(1500));
    expect(result.current.open).toBe(true);
    act(() => result.current.ask.dismiss());
    expect(result.current.open).toBe(false);
    // Nothing left to watch the page for.
    expect(result.current.ask.due).toBe(false);
    rerender({ blocked: true });
    rerender({ blocked: false });
    act(() => void vi.advanceTimersByTime(10_000));
    expect(result.current.open).toBe(false);
    expect(setConsent).not.toHaveBeenCalled();
  });

  it('answered: saved once and over, also when an older yes is given again (the stored answer does not change)', () => {
    const { result, rerender } = renderHook(({ blocked }) => useAsk(blocked), { initialProps: { blocked: false } });
    act(() => void vi.advanceTimersByTime(1500));
    act(() => result.current.ask.answer(true));
    expect(setConsent).toHaveBeenCalledWith('granted');
    expect(result.current.open).toBe(false);
    expect(result.current.ask.due).toBe(false);
    rerender({ blocked: true });
    rerender({ blocked: false });
    act(() => void vi.advanceTimersByTime(10_000));
    expect(result.current.open).toBe(false);
  });
});
