/**
 * The trap's page-edge guards (focusable spans at the start and end of
 * <body>, so Tab past the page edge comes back into the layer) are hidden
 * from screen readers, and focus never stays on one: it goes straight back
 * into the layer, from either edge.
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

const Sheet: React.FC = () => (
  <BwSheet open onClose={() => {}} title="Create" footer={<button type="button">Create gig</button>}>
    <button type="button">New gig</button>
  </BwSheet>
);

describe('focus guards', () => {
  it('are aria-hidden', async () => {
    render(<Sheet />);
    const sheet = screen.getByRole('dialog', { name: 'Create' });
    await waitFor(() => expect(document.activeElement).toBe(sheet));
    const guards = Array.from(document.querySelectorAll<HTMLElement>('[data-bw-focus-guard]'));
    expect(guards).toHaveLength(2);
    for (const g of guards) expect(g.getAttribute('aria-hidden')).toBe('true');
  });

  it('send focus back into the layer: the end one to its first stop, the start one to its last', async () => {
    render(<Sheet />);
    const sheet = screen.getByRole('dialog', { name: 'Create' });
    await waitFor(() => expect(document.activeElement).toBe(sheet));
    const [start, end] = Array.from(document.querySelectorAll<HTMLElement>('[data-bw-focus-guard]'));
    const stops = Array.from(sheet.querySelectorAll<HTMLElement>('button:not([disabled])'));
    end.focus();
    expect(document.activeElement).toBe(stops[0]);
    start.focus();
    expect(document.activeElement).toBe(stops[stops.length - 1]);
  });
});
