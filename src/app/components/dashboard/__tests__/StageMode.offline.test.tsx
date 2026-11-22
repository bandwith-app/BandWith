import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));

import { StageMode, type StageSong } from '../StageMode';
import { packSavedLabel } from '@/app/components/event/OfflineReadyRow';
import { t } from '@/lib/i18n';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(cleanup);

const songs: StageSong[] = [{ id: 'r1', songId: 's1', title: 'Paper Boats', lyrics: '[C]Paper boats on the [G]river' }];

/** Live mode with no signal (plan §3.4): the songs say where they come from. */
describe('Stage mode offline', () => {
  it('shows "Offline · content from …" when the songs come from the live pack', () => {
    const savedAt = new Date();
    savedAt.setHours(18, 2, 0, 0);
    render(
      <StageMode title="The Loft, Brooklyn" dateLabel="Sat 28 Nov" steps={[]} songs={songs} offlineFrom={savedAt.toISOString()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Offline · content from 18:02');
    expect(screen.getByText('Paper Boats')).toBeInTheDocument();
  });

  it('no tag with signal', () => {
    render(<StageMode title="The Loft, Brooklyn" dateLabel="Sat 28 Nov" steps={[]} songs={songs} onClose={vi.fn()} />);
    expect(screen.queryByText(/Offline · content from/)).toBeNull();
  });
});

describe('packSavedLabel', () => {
  const now = new Date(2026, 10, 21, 15, 0);
  it('today a time, yesterday a word, earlier a date (24 h)', () => {
    expect(packSavedLabel(new Date(2026, 10, 21, 14, 32).toISOString(), t, now)).toBe('14:32');
    expect(packSavedLabel(new Date(2026, 10, 20, 18, 2).toISOString(), t, now)).toBe('yesterday 18:02');
    expect(packSavedLabel(new Date(2026, 10, 18, 9, 5).toISOString(), t, now)).toMatch(/Nov.*09:05$/);
    expect(packSavedLabel('nope', t, now)).toBe('');
  });
});
