/**
 * The trap's page-edge guards (focusable spans at the start and end of
 * <body>, so Tab past the page edge comes back into the layer). Focus never
 * stays on one:
 * - from outside the page (the browser's toolbar), Tab enters at the
 *   layer's first stop and Shift+Tab at its last;
 * - from inside (Safari's Tab skipping buttons), past the end goes to the
 *   first stop and before the start to the last;
 * - on the Duo, past the layer's own stops Tab goes on to the rail's Close
 *   and Back before it wraps, and back the other way.
 * Not aria-hidden (like Radix's guards): a focusable element must not be
 * hidden from screen readers.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { BwSheet } from '../Screen';

afterEach(cleanup);

const Sheet: React.FC<{ rail?: boolean }> = ({ rail }) => (
  <>
    {rail && (
      <div role="toolbar" data-bw-trap-include="">
        <button type="button">Rail back</button>
        <button type="button">Rail close</button>
      </div>
    )}
    <BwSheet open onClose={() => {}} title="Create" footer={<button type="button">Create gig</button>}>
      <button type="button">New gig</button>
    </BwSheet>
  </>
);

const setup = async (rail = false) => {
  render(<Sheet rail={rail} />);
  const sheet = screen.getByRole('dialog', { name: 'Create' });
  await waitFor(() => expect(document.activeElement).toBe(sheet));
  const [start, end] = Array.from(document.querySelectorAll<HTMLElement>('[data-bw-focus-guard]'));
  const stops = Array.from(sheet.querySelectorAll<HTMLElement>('button:not([disabled])'));
  return { sheet, start, end, stops };
};

describe('focus guards', () => {
  it('are not aria-hidden (focusable)', async () => {
    const { start, end } = await setup();
    for (const g of [start, end]) {
      expect(g.hasAttribute('aria-hidden')).toBe(false);
      expect(g.tabIndex).toBe(0);
    }
  });

  it('from outside the page: the start one enters at the first stop, the end one at the last', async () => {
    const { start, end, stops } = await setup();
    (document.activeElement as HTMLElement).blur();
    start.focus();
    expect(document.activeElement).toBe(stops[0]);
    (document.activeElement as HTMLElement).blur();
    end.focus();
    expect(document.activeElement).toBe(stops[stops.length - 1]);
  });

  it('from inside: past the end to the first stop, before the start to the last', async () => {
    const { start, end, stops } = await setup();
    stops[stops.length - 1].focus();
    end.focus();
    expect(document.activeElement).toBe(stops[0]);
    stops[0].focus();
    start.focus();
    expect(document.activeElement).toBe(stops[stops.length - 1]);
  });

  it("on the Duo: past the layer's last stop to the rail's Close and Back, then back", async () => {
    const { start, end, stops } = await setup(true);
    stops[stops.length - 1].focus();
    end.focus();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Rail back' }));
    start.focus();
    expect(document.activeElement).toBe(stops[stops.length - 1]);
  });
});
