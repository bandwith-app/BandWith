import { describe, expect, it } from 'vitest';
import { fit, parseRegion } from '../src/ui/crop';

const AR = 1688 / 780;

describe('screen crop geometry', () => {
  it('parses "y0 y1 [x0 x1]"', () => {
    expect(parseRegion('0.1 0.4')).toEqual({ y0: 0.1, y1: 0.4, x0: undefined, x1: undefined });
    expect(parseRegion(' 0 1  0.2 0.8 ')).toEqual({ y0: 0, y1: 1, x0: 0.2, x1: 0.8 });
    expect(parseRegion(undefined)).toEqual({ y0: 0, y1: 1, x0: undefined, x1: undefined });
  });

  it('never leaves a gap: the capture always covers the box', () => {
    for (const [w, h] of [[400, 500], [343, 214], [260, 195], [1000, 300]])
      for (const r of [{ y0: 0, y1: 0.31 }, { y0: 0.47, y1: 0.96 }, { y0: 0.76, y1: 1 }, { y0: 0.1, y1: 0.2, x0: 0.3, x1: 0.7 }]) {
        const { z, tx, ty } = fit(w, h, AR, r);
        const iw = w * z;
        const ih = iw * AR;
        expect(z).toBeGreaterThanOrEqual(1);
        expect(tx).toBeLessThanOrEqual(0);
        expect(tx + iw).toBeGreaterThanOrEqual(w - 0.01);
        expect(ty).toBeLessThanOrEqual(0.01);
        expect(ty + ih).toBeGreaterThanOrEqual(h - 0.01);
      }
  });

  it('shows the whole region when it fits, centred (away from the capture edges)', () => {
    const r = { y0: 0.4, y1: 0.62 };
    const { z, ty } = fit(400, 500, AR, r);
    const ih = 400 * z * AR;
    const top = ty + r.y0 * ih;
    const bottom = ty + r.y1 * ih;
    expect(top).toBeGreaterThanOrEqual(-0.01);
    expect(bottom).toBeLessThanOrEqual(500.01);
    expect(Math.abs(top - (500 - bottom))).toBeLessThan(1);
    // Near the top edge it stays whole but can't centre without a gap.
    const t = fit(400, 500, AR, { y0: 0.13, y1: 0.44 });
    expect(t.ty).toBe(0);
  });

  it('zooms in on a narrow region', () => {
    const { z, tx } = fit(400, 500, AR, { y0: 0.1, y1: 0.2, x0: 0.5, x1: 1 });
    expect(z).toBeCloseTo(2, 5);
    expect(tx).toBeCloseTo(-400, 5);
  });

  it('reads a region taller than a wide box from its top', () => {
    const r = { y0: 0, y1: 0.4 };
    const { ty } = fit(343, 214, AR, r);
    expect(ty).toBeCloseTo(0, 5);
    const r2 = { y0: 0.33, y1: 0.66 };
    const f2 = fit(343, 214, AR, r2);
    expect(f2.ty).toBeCloseTo(-0.33 * 343 * AR, 3);
  });
});
