import { describe, expect, it } from 'vitest';
import { addItem, gearItem, initialPlot, presetItem, removeItem, freeSpot, dragLabel, itemNames, markHtml, type Plot } from '../src/ui/demos/stage-plot-rider';
import { makeTranslator } from '../src/i18n/translate';
import { SAME } from '../src/i18n/same';
import { it as IT } from '../src/i18n/dict/it';
import { es as ES } from '../src/i18n/dict/es';

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

  // Every mark says its name and how to move it. Whatever is added to the plot, in any order,
  // the sentence exists in Italian and Spanish (it used to for five of the thirteen names).
  it('names every mark the plot can hold', () => {
    expect(itemNames()).toEqual(['Lead vox', 'Vocals', 'Guitar amp', 'Bass amp', 'Keys', 'Drums · riser', 'Percussion', 'Sax', 'Trumpet', 'Other musician', 'Wedge', 'Speaker', 'DI box']);
    expect(markHtml(presetItem('keys'), true)).toContain('aria-label="Keys. Drag, or use the arrow keys, to move it."');
  });
  for (const [lang, dict] of [['it', IT], ['es', ES]] as const) {
    it(`${lang}: the drag label of every mark is translated`, () => {
      const t = makeTranslator(lang, dict, SAME);
      expect(itemNames().map(dragLabel).filter((l) => t.text(l) == null)).toEqual([]);
    });
  }
});
