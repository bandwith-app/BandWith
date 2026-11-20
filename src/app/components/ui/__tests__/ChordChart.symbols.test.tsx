import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ChordChartView } from '../ChordChart';
import { SongBody } from '../SongViews';
import { SymbolLegend } from '../MusicSymbol';
import { parseMusic, type SongChart } from '@/lib/ireal';
import { LEGEND_SYMBOLS, MUSIC_SYMBOLS } from '@/lib/musicSymbols';
import { setLocalePref as setLocale } from '@/lib/i18n';

// Made-up chart (no real song) with every marker iReal Pro writes.
const MUSIC =
  '{*AT44C^7 p p p |D-7 G7 |N1E-7 A7 }|N2D-7 G7 |r|   |x Z' +
  '*B[T34fFh7 Bb7b9 |Ebo7 |S<D.C. al Coda>Ab-^7/G |Q n |<3x>C7 |<Fine>F6 |<Solo on AABA>G7 U]';

const chart = (): SongChart => ({ v: 1, source: 'ireal', title: 'Made Up', key: 'C', ...parseMusic(MUSIC) });

/** What the chart shows as text: no raw marker may be in it. */
const RAW = [/%/, /[{}<>]/, /\bN[0-9]\b/, /\*[A-Za-z]/, /\bT\d\d\b/, /\bSegno\b/, /\bCoda\b(?! )/, /(^|\s)[xnpfrUYSQ](\s|$)/];

describe('chord charts draw symbols, never raw markers', () => {
  afterEach(() => {
    cleanup();
    setLocale('en');
  });

  it('draws every marker of the chart as a named symbol', () => {
    const { container } = render(<ChordChartView chart={chart()} size={20} />);
    const grid = container.querySelector('[data-chart-grid]')!.parentElement!.parentElement!;
    const text = grid.textContent || '';
    for (const re of RAW) expect(text, String(re)).not.toMatch(re);
    const names = screen.getAllByRole('img').map((el) => el.getAttribute('aria-label'));
    expect(names).toEqual(
      expect.arrayContaining([
        'Repeat start',
        'Repeat end',
        'Ending 1',
        'Ending 2',
        'Repeat the previous bar',
        'Repeat the previous two bars',
        'Same chord, next beat',
        'Segno',
        'Coda',
        'Fermata: hold',
        'No chord',
        'Da capo al coda: back to the start, then jump to the coda',
        'Play 3 times',
        'Fine: the song ends here',
        'Final bar line',
        'Double bar line',
        'Time signature 3/4',
        'End',
      ]),
    );
    // A player's own words stay as written.
    expect(text).toContain('Solo on AABA');
  });

  it('keeps the two-bar repeat two bars wide', () => {
    const { container } = render(<ChordChartView chart={chart()} size={20} />);
    const cell = container.querySelector('[data-symbol="repeat-two-bars"]')!.closest('[data-bar]') as HTMLElement;
    expect(cell.style.gridColumn).toBe('span 2');
  });

  it('names the symbols in the reader’s language', () => {
    setLocale('it');
    render(<ChordChartView chart={chart()} size={20} />);
    expect(screen.getAllByRole('img', { name: 'Segno' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: /^Ripeti la battuta precedente$/ })).toBeTruthy();
  });

  it('draws inline chords from lyrics through the same symbols', () => {
    render(<SongBody song={{ lyrics: '# Verse\n[N.C.]Hello [Am]world', chart: undefined }} view="chords" size={18} />);
    expect(screen.getByRole('img', { name: 'No chord' })).toBeTruthy();
  });

  it('lists every legend symbol with its meaning', () => {
    render(<SymbolLegend />);
    for (const id of LEGEND_SYMBOLS) {
      expect(screen.getAllByText(MUSIC_SYMBOLS[id].name.replace('{n}', id === 'repeat-times' ? '3' : '1').replace('{name}', id === 'section' ? 'A' : '3/4')).length).toBeGreaterThan(0);
    }
  });
});
