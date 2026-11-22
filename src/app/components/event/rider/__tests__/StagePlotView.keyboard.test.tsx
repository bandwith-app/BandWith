import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));

import { StagePlotView } from '../StagePlotView';
import type { StagePlot } from '@/lib/stagePlot';

afterEach(() => cleanup());

/** The marks on the stage (the add chips below share some names). */
const stage = () => within(screen.getByRole('group', { name: /Stage plot/ }));

const start: StagePlot = {
  id: 'p1',
  name: 'Main',
  items: [
    { id: 'a', kind: 'player', code: 'LV', label: 'Lead vocals', x: 0.5, y: 0.5 },
    { id: 'b', kind: 'wedge', x: 0.3, y: 0.9 },
  ],
};

let latest: StagePlot = start;
const Harness: React.FC = () => {
  const [plot, setPlot] = useState(start);
  latest = plot;
  return <StagePlotView plot={plot} editable onChange={setPlot} />;
};

describe('Stage plot, keyboard only', () => {
  it('every item on the stage is a named control in the tab order', () => {
    render(<Harness />);
    const singer = stage().getByRole('button', { name: /Lead vocals/ });
    const wedge = stage().getByRole('button', { name: /Wedge/ });
    for (const el of [singer, wedge]) expect(el.tabIndex).toBe(0);
    singer.focus();
    expect(document.activeElement).toBe(singer);
  });

  it('Enter selects an item: rename it and remove it without a pointer', () => {
    render(<Harness />);
    const singer = stage().getByRole('button', { name: /Lead vocals/ });
    singer.focus();
    fireEvent.keyDown(singer, { key: 'Enter' });
    expect(singer.getAttribute('aria-pressed')).toBe('true');
    const caption = screen.getByRole('textbox', { name: 'Caption' }) as HTMLInputElement;
    fireEvent.change(caption, { target: { value: 'Singer' } });
    expect(latest.items.find((i) => i.id === 'a')?.label).toBe('Singer');
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
    expect(latest.items.map((i) => i.id)).toEqual(['b']);
  });

  it('Space selects too, and Escape lets it go', () => {
    render(<Harness />);
    const wedge = stage().getByRole('button', { name: /Wedge/ });
    fireEvent.keyDown(wedge, { key: ' ' });
    expect(wedge.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(wedge, { key: 'Escape' });
    expect(wedge.getAttribute('aria-pressed')).toBe('false');
  });

  it('arrow keys move the focused item (Shift for bigger steps), within the stage', () => {
    render(<Harness />);
    const singer = stage().getByRole('button', { name: /Lead vocals/ });
    fireEvent.keyDown(singer, { key: 'ArrowRight' });
    expect(latest.items[0].x).toBeCloseTo(0.52);
    fireEvent.keyDown(stage().getByRole('button', { name: /Lead vocals/ }), { key: 'ArrowUp', shiftKey: true });
    expect(latest.items[0].y).toBeCloseTo(0.4);
    for (let i = 0; i < 10; i++) fireEvent.keyDown(stage().getByRole('button', { name: /Lead vocals/ }), { key: 'ArrowLeft', shiftKey: true });
    expect(latest.items[0].x).toBe(0);
  });

  it('a read-only plot stays one picture (no controls inside)', () => {
    render(<StagePlotView plot={start} />);
    expect(screen.getByRole('img', { name: /Stage plot/ })).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
