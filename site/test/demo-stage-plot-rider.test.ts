import { describe, expect, it } from 'vitest';
import { addItem, gearItem, initialPlot, presetItem, removeItem, freeSpot, type Plot } from '../src/ui/demos/stage-plot-rider';

const list = (p: Plot) => p.inputs.map((c) => `${c.source}/${c.mic}`);

describe('stage plot demo follows the app (src/lib/stagePlot.ts)', () => {
  it('starts with the bass and the lead vocal, in desk order', () => {
    expect(list(initialPlot())).toEqual(['Bass/DI', 'Lead vox/Beta 58']);
  });

  it('puts the drummer’s four channels first', () => {
    const p = addItem(initialPlot(), presetItem('drums'));
    expect(list(p)).toEqual(['Kick/Beta 52', 'Snare/SM57', 'OH L/C414', 'OH R/C414', 'Bass/DI', 'Lead vox/Beta 58']);
  });

  it('keeps desk order: guitars, keys, others and DI boxes, lead vocal, other vocals', () => {
    let p = initialPlot();
    for (const k of ['vocals', 'sax', 'keys', 'guitar']) p = addItem(p, presetItem(k));
    p = addItem(p, gearItem('di'));
    expect(list(p)).toEqual(['Bass/DI', 'Guitar/SM57', 'Keys L/DI', 'Keys R/DI', 'Sax/SM57', 'DI box/DI', 'Lead vox/Beta 58', 'Vox/SM58']);
  });

  it('adds no channel for wedges, speakers or Other musician', () => {
    let p = initialPlot();
    for (const k of ['wedge', 'speaker', 'player'] as const) p = addItem(p, gearItem(k));
    expect(list(p)).toEqual(['Bass/DI', 'Lead vox/Beta 58']);
  });

  it('removes an item’s channels with it', () => {
    const drums = presetItem('drums');
    const p = removeItem(addItem(initialPlot(), drums), drums.id);
    expect(list(p)).toEqual(['Bass/DI', 'Lead vox/Beta 58']);
  });

  it('never drops a new circle on one already there', () => {
    const p = initialPlot();
    const spot = freeSpot(p.items, presetItem('vocals'));
    expect(spot).not.toEqual({ x: 0.5, y: 0.66 });
  });
});
