/**
 * The kit page: on one page (phone, Duo closed) it covers the gear hub and is
 * a modal dialog; on two pages it sits beside the kit list, so it is a
 * labelled region, not modal (the list stays usable).
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

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
});
