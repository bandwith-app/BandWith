/**
 * The kit page: on one page (phone, Duo closed) it covers the gear hub and is
 * a modal dialog; on two pages it sits beside the kit list, so it is a
 * labelled region, not modal (the list stays usable). On one page it traps
 * focus like the other modal pages: focus moves in when it opens, Tab stays
 * in it, and focus goes back to the kit row that opened it when it closes.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

const layout = vi.hoisted(() => ({ twoPane: false }));
vi.mock('@/lib/deviceRegions', async (orig) => ({
  ...(await orig<typeof import('@/lib/deviceRegions')>()),
  useRailLayout: () => ({ rail: layout.twoPane, twoPane: layout.twoPane, wide: false, railEdge: 'right' }),
}));

import { KitDetail } from '../KitDetail';

afterEach(cleanup);

const kit = { id: 'k1', band_id: 'b1', name: 'Club kit', created_at: '2026-11-01T00:00:00Z' };
const summary = { items: [], total: 0, ready: 0, repair: 0, lost: 0, inUse: 0, cases: 0, nextGig: null };
const renderKit = () =>
  render(<KitDetail kit={kit} summary={summary} canEdit onBack={() => {}} onEdit={() => {}} onUseForGig={() => {}} />);

describe('kit page', () => {
  it('one page: a modal dialog named by the kit', () => {
    layout.twoPane = false;
    renderKit();
    const page = screen.getByRole('dialog', { name: 'Club kit' });
    expect(page.getAttribute('aria-modal')).toBe('true');
  });

  it('two pages: a region beside the list, not modal', () => {
    layout.twoPane = true;
    renderKit();
    expect(screen.queryByRole('dialog')).toBeNull();
    const page = screen.getByRole('region', { name: 'Club kit' });
    expect(page.hasAttribute('aria-modal')).toBe(false);
  });

  it('one page: focus moves in, Tab stays in it, and goes back to the kit row on close', async () => {
    layout.twoPane = false;
    const Hub: React.FC<{ open: boolean }> = ({ open }) => (
      <>
        <button type="button">Club kit row</button>
        {open && <KitDetail kit={kit} summary={summary} canEdit onBack={() => {}} onEdit={() => {}} onUseForGig={() => {}} />}
      </>
    );
    const { rerender } = render(<Hub open={false} />);
    const row = screen.getByRole('button', { name: 'Club kit row' });
    row.focus();
    rerender(<Hub open />);
    const page = screen.getByRole('dialog', { name: 'Club kit' });
    await waitFor(() => expect(page.contains(document.activeElement)).toBe(true));
    const stops = Array.from(page.querySelectorAll<HTMLElement>('button:not([disabled])'));
    stops[stops.length - 1].focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(stops[0]);
    rerender(<Hub open={false} />);
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it('two pages: no trap, focus stays in the kit list', async () => {
    layout.twoPane = true;
    const Hub: React.FC<{ open: boolean }> = ({ open }) => (
      <>
        <button type="button">Club kit row</button>
        {open && <KitDetail kit={kit} summary={summary} canEdit onBack={() => {}} onEdit={() => {}} onUseForGig={() => {}} />}
      </>
    );
    const { rerender } = render(<Hub open={false} />);
    const row = screen.getByRole('button', { name: 'Club kit row' });
    row.focus();
    rerender(<Hub open />);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.activeElement).toBe(row);
  });
});
