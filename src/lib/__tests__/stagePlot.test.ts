import { describe, expect, it } from 'vitest';
import { asStageData, freeSpot, channelLabel, isStageEmpty, moveInput, moveItem, presetItem, stageSize, starterStage, syncInputs, toStageRow, LIMITS } from '../stagePlot';

describe('stagePlot', () => {
  it('sanitises bad rows instead of failing', () => {
    expect(asStageData(null)).toEqual(asStageData(undefined));
    const d = asStageData({
      plots: [{ id: 'p', name: 'Full band', items: [{ id: 'a', kind: 'player', code: 'DR', x: 5, y: -1 }, { kind: 'nope' }] }, 'junk'],
      inputs: [{ source: 'Kick', mic: 'Beta 52' }, { source: 'Bass', mic: 'DI' }, 42],
      band_brings: ['PA', '', 3],
      venue_provides: 'power',
      venue_agreed: true,
    } as any);
    expect(d.plots).toHaveLength(1);
    const item = d.plots[0].items[0];
    expect(item.x).toBeLessThanOrEqual(1);
    expect(item.y).toBeGreaterThanOrEqual(0);
    expect(d.inputs.map((c) => c.kind)).toEqual(['mic', 'di']);
    expect(d.inputs.every((c) => !!c.id)).toBe(true);
    expect(d.bandBrings).toEqual(['PA']);
    expect(d.venueProvides).toEqual([]);
    expect(d.venueAgreed).toBe(true);
  });

  it('caps the lists', () => {
    const inputs = Array.from({ length: LIMITS.inputs + 10 }, (_, i) => ({ source: `In ${i}`, mic: 'SM58' }));
    expect(asStageData({ plots: [], inputs, band_brings: [], venue_provides: [] }).inputs).toHaveLength(LIMITS.inputs);
  });

  it('round-trips through the database row', () => {
    const d = starterStage([{ name: 'Marta Conti', instrument: 'Drums' }, { name: 'Leo M.', instrument: 'Vocals' }]);
    expect(asStageData(toStageRow(d) as any)).toEqual(d);
  });

  it('builds a starter plot and inputs from the lineup', () => {
    const d = starterStage([
      { name: 'Marta Conti', instrument: 'Drums' },
      { name: 'Jonah Reyes', instrument: 'Bass' },
      { name: 'Leo M.', instrument: 'Vocals · Band leader' },
    ]);
    expect(d.plots).toHaveLength(1);
    const codes = d.plots[0].items.filter((i) => i.kind === 'player').map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['DR', 'BS', 'VX']));
    expect(d.plots[0].items.find((i) => i.code === 'VX')?.lead).toBe(true);
    expect(d.inputs[0]).toMatchObject({ source: 'Kick', who: 'Marta' });
    expect(d.inputs.some((c) => c.source === 'Bass' && c.kind === 'di' && c.who === 'Jonah')).toBe(true);
    expect(isStageEmpty(d)).toBe(false);
    expect(isStageEmpty(asStageData(null))).toBe(true);
  });

  it('moves channels and items', () => {
    const d = asStageData({ plots: [], inputs: [{ source: 'A', mic: 'x' }, { source: 'B', mic: 'x' }, { source: 'C', mic: 'x' }], band_brings: [], venue_provides: [] });
    expect(moveInput(d.inputs, 0, 2).map((c) => c.source)).toEqual(['B', 'C', 'A']);
    expect(moveInput(d.inputs, 0, 9)).toBe(d.inputs);
    const plot = { id: 'p', name: 'x', items: [{ id: 'i', kind: 'wedge' as const, x: 0.5, y: 0.5 }] };
    const moved = moveItem(plot, 'i', 2, -3).items[0];
    expect(moved.x).toBeLessThanOrEqual(1);
    expect(moved.y).toBeGreaterThanOrEqual(0);
  });

  it('formats labels', () => {
    expect(channelLabel(0)).toBe('01');
    expect(channelLabel(12)).toBe('13');
    expect(stageSize({ id: 'p', name: 'x', widthM: 6, depthM: 4.5, items: [] })).toBe('6 × 4.5 m');
    expect(stageSize({ id: 'p', name: 'x', items: [] })).toBe('');
  });
});

describe('instrument presets and the input list', () => {
  const plot = (items: import('../stagePlot').PlotItem[]): import('../stagePlot').StagePlot => ({ id: 'p', name: 'Full band', items });

  it('a preset musician has its code, caption and instrument, all editable', () => {
    const it = presetItem('drums');
    expect(it).toMatchObject({ kind: 'player', code: 'DR', label: 'Drums · riser', instrument: 'drums' });
    expect(asStageData(toStageRow({ ...asStageData(null), plots: [plot([it])] })).plots[0].items[0].instrument).toBe('drums');
  });

  it('adds the channels of new instruments in desk order and keeps hand edits', () => {
    const vox = { ...presetItem('vocals'), lead: true };
    const first = syncInputs(undefined, plot([vox]), []);
    expect(first.map((c) => c.source)).toEqual(['Lead vox']);
    const edited = [{ ...first[0], mic: 'KMS 105', who: 'Leo' }];
    const drums = presetItem('drums');
    const bass = presetItem('bass');
    const next = syncInputs(plot([vox]), plot([vox, drums, bass]), edited);
    expect(next.map((c) => c.source)).toEqual(['Kick', 'Snare', 'OH L', 'OH R', 'Bass', 'Lead vox']);
    expect(next[5]).toMatchObject({ mic: 'KMS 105', who: 'Leo' });
    expect(next.find((c) => c.source === 'Bass')?.kind).toBe('di');
  });

  it('removes the channels of a deleted item and keeps channels added by hand', () => {
    const gtr = presetItem('guitar');
    const keys = presetItem('keys');
    const manual = { id: 'm1', source: 'Talkback', mic: 'SM58', kind: 'mic' as const, who: '' };
    const list = [...syncInputs(undefined, plot([gtr, keys]), []), manual];
    const next = syncInputs(plot([gtr, keys]), plot([gtr]), list);
    expect(next.map((c) => c.source)).toEqual(['Guitar', 'Talkback']);
  });

  it('a generic musician, a wedge or a speaker adds no channel; a DI box adds one', () => {
    const items = [
      { id: 'a', kind: 'player' as const, code: '??', x: 0.5, y: 0.5 },
      { id: 'b', kind: 'wedge' as const, x: 0.5, y: 0.9 },
      { id: 'c', kind: 'di' as const, x: 0.4, y: 0.5 },
    ];
    expect(syncInputs(undefined, plot(items), []).map((c) => [c.source, c.kind])).toEqual([['DI box', 'di']]);
  });

  it('starter channels are linked to their player', () => {
    const d = starterStage([{ name: 'Marta Conti', instrument: 'Bass' }]);
    const player = d.plots[0].items.find((i) => i.kind === 'player')!;
    expect(d.inputs[0].itemId).toBe(player.id);
    expect(syncInputs(d.plots[0], plot(d.plots[0].items.filter((i) => i.id !== player.id)), d.inputs)).toEqual([]);
  });
});

describe('freeSpot', () => {
  it('keeps the wanted spot when it is clear', () => {
    expect(freeSpot([{ x: 0.2, y: 0.2 }], { x: 0.6, y: 0.6 })).toEqual({ x: 0.6, y: 0.6 });
  });
  it('moves off a circle already there, staying on the stage', () => {
    const items = [{ x: 0.5, y: 0.5 }];
    const s = freeSpot(items, { x: 0.5, y: 0.5 });
    expect(Math.hypot(s.x - 0.5, s.y - 0.5)).toBeGreaterThanOrEqual(0.12);
    expect(s.x).toBeGreaterThanOrEqual(0.06);
    expect(s.x).toBeLessThanOrEqual(0.94);
    expect(s.y).toBeGreaterThanOrEqual(0.06);
    expect(s.y).toBeLessThanOrEqual(0.94);
  });
  it('clears every item, not just the first', () => {
    const items = [{ x: 0.5, y: 0.5 }, { x: 0.62, y: 0.5 }, { x: 0.38, y: 0.5 }];
    const s = freeSpot(items, { x: 0.5, y: 0.5 });
    for (const i of items) expect(Math.hypot(s.x - i.x, s.y - i.y)).toBeGreaterThanOrEqual(0.12);
  });
  it('keeps circles apart on a wide stage, in drawn distance', () => {
    // Duo: 600 px wide, ratio 1.6 (375 px deep); a circle is 44 px.
    const width = 600;
    const stage = { ratio: 1.6, gap: 52 / width };
    const px = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot((a.x - b.x) * width, ((a.y - b.y) * width) / stage.ratio);
    const items: { x: number; y: number }[] = [{ x: 0.5, y: 0.5 }];
    for (let n = 0; n < 6; n++) items.push(freeSpot(items, { x: 0.5, y: 0.5 }, stage));
    for (let a = 0; a < items.length; a++)
      for (let b = a + 1; b < items.length; b++) expect(px(items[a], items[b])).toBeGreaterThanOrEqual(51.9);
  });
});
