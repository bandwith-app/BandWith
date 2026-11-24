import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

// Laptop pose (the iPhone Duo folded like a laptop): the countdown must sit
// whole on the Display, with Stop on the Deck. The ring and the number were
// centred on the whole screen, across the fold (device pass 11-24: the number
// at y 250–600, the fold at 455–495). The countdown's own half is now a box
// (.bw-countin-pane) that stage.css sizes to the Display in that pose; in
// every other posture it is no box at all (display: contents).

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));
vi.mock('@/lib/services/countInStyle', () => ({
  getCountInStyle: vi.fn(async () => 'down'),
  setCountInStyle: vi.fn(async () => ({ error: null })),
}));

import { StageCountInOverlay } from '../StageCountIn';
import { COUNTIN_LEAD_MS, startCountIn } from '@/lib/countIn';
import { meterOf } from '@/lib/meter';

// The stylesheet as written (CSS imports are stubbed in the test runner).
const FS = 'node:fs';
const readStageCss = async (): Promise<string> => {
  const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync: (p: string, enc: 'utf8') => string };
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();
  return readFileSync(`${cwd}/src/styles/stage.css`, 'utf8');
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function countdown(canStop: boolean) {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] });
  const now = performance.timeOrigin + performance.now();
  const state = startCountIn({ from: 'leader', songId: 'r1', bpm: 120, meter: meterOf('4/4'), now });
  render(<StageCountInOverlay state={state} offset={0} title="Harbor Lights" accent="#d4ff3a" canStop={canStop} onStop={() => {}} big />);
  act(() => void vi.advanceTimersByTime(COUNTIN_LEAD_MS + 20));
  return screen.getByRole('dialog', { name: 'Count-in · Harbor Lights' });
}

describe('Count-in in Laptop pose: the countdown on the Display, Stop on the Deck', () => {
  it('the song, the ring, the number and its caption are one box; Stop is outside it', () => {
    const layer = countdown(true);
    const pane = layer.querySelector('.bw-countin-pane');
    expect(pane, 'the countdown has its own box').not.toBeNull();
    expect(pane!.parentElement).toBe(layer);
    expect(pane).toContainElement(screen.getByTestId('countin-number'));
    expect(pane).toContainElement(screen.getByText('Harbor Lights'));
    expect(pane!.querySelector('svg circle')).not.toBeNull();
    const stop = screen.getByRole('button', { name: 'Stop the count-in' });
    expect(pane).not.toContainElement(stop);
    expect(stop.parentElement).toBe(layer);
    // The flash covers both halves: it stays on the layer.
    expect(pane).not.toContainElement(screen.getByTestId('countin-flash'));
  });

  it('a member’s "Hide on this phone" is outside it too', () => {
    const layer = countdown(false);
    const hide = screen.getByRole('button', { name: 'Hide on this phone' });
    expect(layer.querySelector('.bw-countin-pane')).not.toContainElement(hide);
  });

  it('everywhere else the box is no box (display: contents), so phones, tablets and the other postures lay out as before', () => {
    const layer = countdown(true);
    expect(layer.querySelector('.bw-countin-pane')).toHaveClass('contents');
  });

  it('stage.css: in Laptop pose the box is the Display’s height and the size container, the fold band stays empty, Stop is centred on the Deck', async () => {
    const css = (await readStageCss()).replace(/\s+/g, ' ');
    const rule = (selector: string) => {
      const at = css.indexOf(`${selector} {`);
      expect(at, selector).toBeGreaterThan(-1);
      return css.slice(at, css.indexOf('}', at));
    };
    const pane = rule(':root[data-bw-posture="tabletop"] .bw-countin-pane');
    expect(pane).toContain('height: var(--bw-display-h)');
    expect(pane).toContain('container-type: size');
    expect(pane).toContain('margin-bottom: calc(var(--bw-deck-top) - var(--bw-display-h))');
    // Below the offline bar while it shows, as the wedge's Display.
    expect(pane).toContain('var(--bw-stage-display-top');
    // The wedge's Display: at the bar's real bottom (the inset the bar pads by + its strip), not a fixed number.
    expect(rule(':root[data-bw-status-block] .bw-fold-split--stage .bw-fold-display')).toContain('padding-top: var(--bw-stage-display-top)');
    const top = rule(':root[data-bw-status-block]');
    expect(top).toContain('--bw-bar-bottom: calc(var(--safe-top-inset, 0px) + var(--offline-h, 0px))');
    expect(top).toContain('--bw-stage-display-top:');
    expect(rule(':root[data-bw-posture="tabletop"] .bw-countin')).toContain('container-type: normal');
    expect(rule(':root[data-bw-posture="tabletop"] .bw-countin > button')).toContain('margin-block: auto');
  });
});
