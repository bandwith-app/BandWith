/**
 * CI 11-23 (event-edit e2e, duo-closed and duo-book): with the Create contract
 * form open over Contracts & docs, the Duo rail showed the page's Go back,
 * Create and Search instead of the form's Back.
 *
 * The rail's action toolbar sat inside the tabs' AnimatePresence, which draws
 * its children from its own state. When the tabs finished leaving, it asked
 * (at normal priority) to draw "the children as last committed"; a rail change
 * that came right after (at once: the rail is an external store) was drawn
 * first, and the earlier request then put the older toolbar back, for good.
 * Seen when the phone is slow enough for the two to queue up.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, afterAll, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import { flushSync } from 'react-dom';

// Before the imports: the animation library takes requestAnimationFrame when
// it loads, and the test decides when the tabs' exit animation ends.
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] });
});

vi.mock('@/lib/haptics', () => ({ haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() } }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ profile: { full_name: 'Leo M.', email: 'demo@example.com' } }) }));

import { DuoRail, type RailTab } from '../DuoRail';
import { useRailBack } from '@/lib/railActions';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const Icon = () => <svg />;
const tabs: RailTab[] = ['Home', 'Calendar', 'Chat'].map((key) => ({ key, label: key, icon: Icon as RailTab['icon'], onClick: () => {}, isActive: key === 'Home' }));

/** A full-screen layer: its Back goes to the rail. */
const Layer: React.FC<{ label: string }> = ({ label }) => {
  useRailBack(() => {}, label);
  return null;
};

let open: (label: string) => void = () => {};
const App: React.FC = () => {
  const [layers, setLayers] = useState<string[]>([]);
  open = (label) => setLayers((l) => [...l, label]);
  return (
    <>
      <DuoRail tabs={tabs} isPlusMenuOpen={false} onPlus={() => {}} isProfileOpen={false} onProfile={() => {}} showTabs />
      {layers.map((l) => (
        <Layer key={l} label={l} />
      ))}
    </>
  );
};

const toolbar = () => screen.getByRole('toolbar', { name: 'Screen actions, search and profile' });
const railButtons = () => within(toolbar()).getAllByRole('button').map((b) => b.getAttribute('aria-label'));

beforeEach(() => {
  // The Duo's system column: the rail owns Back.
  document.documentElement.setAttribute('data-bw-rail', '');
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-bw-rail');
});
afterAll(() => void vi.useRealTimers());

describe('Duo rail: the toolbar is always the newest layer’s', () => {
  it('a layer opened just as the tabs finish leaving gets its Back in the rail, and keeps it', async () => {
    render(<App />);
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();

    // A page opens (Contracts & docs): its Back is in the rail, the tabs start leaving.
    act(() => open('Go back'));
    expect(railButtons()[0]).toBe('Go back');

    await act(async () => {
      // The tabs finish leaving (the request to redraw is now waiting)…
      await vi.advanceTimersByTimeAsync(600);
      for (let i = 0; i < 20; i++) await Promise.resolve();
      // …and right then a form opens on top (Create contract), drawn at once.
      flushSync(() => open('Back'));
    });
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(railButtons()[0]).toBe('Back');
    // Still so a moment later.
    act(() => void vi.advanceTimersByTime(1000));
    expect(railButtons()[0]).toBe('Back');
  });
});
