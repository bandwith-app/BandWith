import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({ haptic: { tap: vi.fn(), confirm: vi.fn() } }));

import { RiderStageScreen } from '../RiderStage';
import type { EventStageState } from '../useEventStage';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const state = {
  stage: null,
  rider: null,
  isSuggestion: false,
  lineup: [],
  loading: false,
  error: null,
  save: vi.fn(),
  createRider: vi.fn(),
  shareRiderPdf: vi.fn(),
  shareRiderLink: vi.fn(),
} as unknown as EventStageState;

describe('Rider & stage page', () => {
  it('Back and Share stay at the top while the page scrolls, clear of the status bar', () => {
    render(
      <RiderStageScreen state={state} isAdmin={false} eventTitle="Jazz Club Night" people={[]} canEditPlot={false} onClose={vi.fn()} />,
    );
    const share = screen.getByRole('button', { name: 'Share rider PDF' });
    const top = share.closest('.sticky');
    expect(top).not.toBeNull();
    expect(top?.className).toContain('top-0');
    expect(top?.className).toContain('bg-background');
    expect((top as HTMLElement).style.paddingTop).toContain('--safe-top');
  });
});
