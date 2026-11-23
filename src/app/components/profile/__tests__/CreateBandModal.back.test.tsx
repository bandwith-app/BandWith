import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

// Audit 10 #4: "Add personal gig" → "Create a free band" opens the band form
// on top. Android Back must close the band form (the top layer), not the
// personal gig underneath with its typed title and notes.

vi.mock('@/lib/BandContext', () => ({ useBand: () => ({ refreshBands: vi.fn() }) }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ refreshProfile: vi.fn() }) }));
vi.mock('@/lib/services/bands', () => ({ createBand: vi.fn() }));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { CreateBandModal } from '../CreateBandModal';
import { handleBackFromStack } from '@/lib/backStack';

afterEach(cleanup);

describe('Create a band: Android Back', () => {
  it('closes the band form first, so the screen under it keeps its draft', () => {
    const onClose = vi.fn();
    render(<CreateBandModal isOpen onClose={onClose} />);
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Hudson Line' } });
    expect(handleBackFromStack()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a closed band form leaves Back to the screens under it', () => {
    render(<CreateBandModal isOpen={false} onClose={vi.fn()} />);
    expect(handleBackFromStack()).toBe(false);
  });
});
