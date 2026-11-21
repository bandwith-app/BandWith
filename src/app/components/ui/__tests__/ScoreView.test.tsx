import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import HARBOR from '@/lib/demo/scores/harbor-lights.musicxml?raw';

const loadScore = vi.hoisted(() => vi.fn());
vi.mock('@/lib/scoreCache', () => ({ loadScore }));

// OSMD draws with real layout (the e2e suite renders it for real): here a stand-in records what the view asks of it.
const osmd = vi.hoisted(() => ({ instances: [] as any[] }));
vi.mock('opensheetmusicdisplay', () => {
  class OpenSheetMusicDisplay {
    options: Record<string, unknown>;
    container: HTMLElement;
    Zoom = 1;
    Sheet = { Transpose: 0 };
    TransposeCalculator: unknown = null;
    labels = new Map<number, string>();
    EngravingRules = {
      ChordSymbolLabelTexts: { setValue: (k: number, v: string) => this.labels.set(k, v) },
      ChordAccidentalTexts: {},
      resetChordAccidentalTexts: vi.fn(),
    };
    loaded = '';
    renders: { transpose: number; zoom: number }[] = [];
    constructor(container: HTMLElement, options: Record<string, unknown>) {
      this.container = container;
      this.options = { ...options };
      osmd.instances.push(this);
    }
    setOptions(o: Record<string, unknown>) {
      Object.assign(this.options, o);
    }
    async load(xml: string) {
      this.loaded = xml;
    }
    render() {
      this.renders.push({ transpose: this.Sheet.Transpose, zoom: this.Zoom });
      this.container.innerHTML = '<svg data-osmd></svg>';
    }
    clear() {}
  }
  class TransposeCalculator {}
  const ChordSymbolEnum = { major: 0, minor: 1, dominant: 4, majorseventh: 5, minorseventh: 6, majorsixth: 11 };
  return { OpenSheetMusicDisplay, TransposeCalculator, ChordSymbolEnum };
});

import { ScoreView } from '../ScoreView';
import { TransposeProvider } from '../Transpose';

const view = (semitones = 0, size = 24) => (
  <TransposeProvider semitones={semitones} songKey="G">
    <ScoreView scoreRef="demo://scores/harbor-lights.musicxml" title="Harbor Lights" size={size} />
  </TransposeProvider>
);

beforeEach(() => {
  osmd.instances.length = 0;
  loadScore.mockReset();
  loadScore.mockResolvedValue(HARBOR);
});

describe('ScoreView', () => {
  it('draws the score once, as one picture with a text alternative', async () => {
    render(view());
    const img = await screen.findByRole('img', { name: 'Score: Harbor Lights' });
    await waitFor(() => expect(img.closest('[data-score-state]')).toHaveAttribute('data-score-state', 'ready'));
    expect(img).toHaveAccessibleDescription(/8 bars, key of G\. Chords: Gmaj7, Em7/);
    expect(img.closest('[data-score-state]')).toHaveAttribute('data-score-bars', '8');
    expect(osmd.instances).toHaveLength(1);
    const o = osmd.instances[0];
    expect(o.loaded).toContain('Harbor Lights');
    expect(o.options).toMatchObject({ backend: 'svg', drawTitle: false, drawPartNames: false });
    expect(typeof o.options.defaultColorMusic).toBe('string');
    // OSMD's own SVG is not a second picture for screen readers.
    expect(o.container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it("spells chords the chart's way (G6, not OSMD's Gmaj6)", async () => {
    render(view());
    await waitFor(() => expect(osmd.instances[0]?.renders.length).toBeGreaterThan(0));
    expect(osmd.instances[0].labels.get(11)).toBe('6');
    expect(osmd.instances[0].labels.get(5)).toBe('maj7');
    expect(osmd.instances[0].labels.get(6)).toBe('m7');
  });

  it('transposes with the chords control: key, picture and text move together', async () => {
    const { rerender } = render(view(0));
    await waitFor(() => expect(osmd.instances[0]?.renders.length).toBe(1));
    rerender(view(2));
    await waitFor(() => expect(osmd.instances[0].renders.at(-1)).toMatchObject({ transpose: 2 }));
    expect(osmd.instances).toHaveLength(1);
    const root = document.querySelector('[data-score-state]')!;
    expect(root).toHaveAttribute('data-score-key', 'A');
    expect(screen.getByRole('img')).toHaveAccessibleDescription(/key of A\. Chords: Amaj7, F♯m7/);
  });

  it('zooms with the reader text size', async () => {
    const { rerender } = render(view(0, 24));
    await waitFor(() => expect(osmd.instances[0]?.renders.length).toBe(1));
    rerender(view(0, 36));
    await waitFor(() => expect(osmd.instances[0].renders.at(-1)?.zoom).toBeCloseTo(1.5));
  });

  it('says so when the score is not on the device and there is no network', async () => {
    loadScore.mockRejectedValue(new Error('offline'));
    render(view());
    expect(await screen.findByText(/no internet/i)).toBeInTheDocument();
    expect(document.querySelector('[data-score-state]')).toHaveAttribute('data-score-state', 'error');
    expect(osmd.instances).toHaveLength(0);
  });
});
