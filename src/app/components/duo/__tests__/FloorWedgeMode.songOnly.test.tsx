import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, cleanup } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));

import { computePosture, updatePosture, LAPTOP_POSE_PREF, SETTLE_MS } from '@/lib/posture';
import { setStageSongOnly } from '@/lib/stageChrome';
import { FloorWedgeMode } from '../modes/FloorWedgeMode';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const tabletop = () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  act(() => {
    updatePosture(computePosture({ viewport: { w: 669, h: 900 }, division: { x: 0, y: 440, w: 669, h: 20 }, hinge: 'half-open' }));
  });
  act(() => {
    vi.advanceTimersByTime(SETTLE_MS);
  });
  vi.useRealTimers();
};

afterEach(() => {
  cleanup();
  act(() => setStageSongOnly(false));
  act(() => {
    updatePosture(computePosture({ viewport: { w: 393, h: 852 } }));
  });
  localStorage.removeItem(LAPTOP_POSE_PREF);
});

const songs = [
  { title: 'Paper Boats', key: 'C', lyrics: '[C]Paper boats on the [G]river' },
  { title: 'Harbor Lights', key: 'G', lyrics: '[G]Harbor lights are [D]calling' },
];

describe('Laptop pose, Song only (the floor wedge)', () => {
  it('names the song in one small line above it, as on every other device', () => {
    tabletop();
    act(() => setStageSongOnly(true));
    render(<FloorWedgeMode songs={songs} lyricsOn onClose={vi.fn()} />);
    const view = screen.getByLabelText('Song only: Paper Boats');
    expect(view).toHaveTextContent('Paper boats on the');
    expect(view).toHaveTextContent('01/02');
    expect(view).toHaveTextContent('Paper Boats');
  });
});
