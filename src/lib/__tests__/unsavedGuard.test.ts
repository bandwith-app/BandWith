import { describe, expect, it, vi } from 'vitest';
import { registerUnsavedGuard, runGuarded } from '@/lib/unsavedGuard';

describe('runGuarded', () => {
  it('runs the action at once when no screen has unsaved changes', () => {
    const action = vi.fn();
    runGuarded(action);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('hands the action to the screen with changes, which runs it after asking', () => {
    let pending: (() => void) | null = null;
    const remove = registerUnsavedGuard((proceed) => {
      pending = proceed;
      return true;
    });
    const action = vi.fn();
    runGuarded(action);
    expect(action).not.toHaveBeenCalled();
    pending!();
    expect(action).toHaveBeenCalledTimes(1);
    remove();
    runGuarded(action);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('asks only the most recent guard', () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const r1 = registerUnsavedGuard(first);
    const r2 = registerUnsavedGuard(second);
    runGuarded(() => {});
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    r1();
    r2();
  });
});
