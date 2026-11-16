import { describe, expect, it } from 'vitest';
import { laptopRevealDelta } from '../keyboardInsets';

// iPhone Duo, Laptop pose, keyboard up (simulator): the web view ends at 601,
// the fold band stays at 453–497 (bands from posture.ts).
const bands = { displayH: 453, deckTop: 497 };
const viewH = 601;
const page = { top: 0, bottom: viewH };

describe('laptopRevealDelta (Laptop pose, keyboard up)', () => {
  it('moves a field left on the fold band down onto the Deck strip, just above the keys', () => {
    // Deputy gigs' message field, where iOS left it on the simulator.
    const d = laptopRevealDelta({ top: 418, bottom: 488 }, page, bands, viewH);
    expect(d).toBe(488 - (viewH - 8));
    const top = 418 - d!;
    expect(top).toBeGreaterThanOrEqual(bands.deckTop);
    expect(488 - d!).toBeLessThanOrEqual(viewH);
  });

  it('brings a field below the keyboard up onto the Deck strip', () => {
    expect(laptopRevealDelta({ top: 880, bottom: 950 }, page, bands, viewH)).toBe(950 - 593);
  });

  it('leaves a field that already rests on the Deck strip', () => {
    expect(laptopRevealDelta({ top: 520, bottom: 570 }, page, bands, viewH)).toBe(0);
  });

  it('puts a field taller than the strip on the Display, just above the fold', () => {
    const d = laptopRevealDelta({ top: 520, bottom: 660 }, page, bands, viewH);
    expect(660 - d!).toBe(bands.displayH - 8);
  });

  it('keeps clear of a pinned header: a scroller showing only below it uses the Deck', () => {
    // The in-app Deputy gigs hub: its sticky header covers the Display.
    const clip = { top: 497, bottom: viewH };
    const d = laptopRevealDelta({ top: 418, bottom: 488 }, clip, bands, viewH);
    expect(418 - d!).toBeGreaterThanOrEqual(clip.top);
  });

  it('a sheet raised onto the Display keeps its field there', () => {
    const clip = { top: 120, bottom: bands.displayH };
    expect(laptopRevealDelta({ top: 300, bottom: 348 }, clip, bands, viewH)).toBe(0);
    expect(laptopRevealDelta({ top: 500, bottom: 548 }, clip, bands, viewH)).toBe(548 - (bands.displayH - 8));
  });

  it('content already at its top cannot move down to the Deck: the field stays on the Display', () => {
    expect(laptopRevealDelta({ top: 289, bottom: 340 }, page, bands, viewH, 0)).toBe(0);
  });

  it('gives up when the field fits nowhere', () => {
    expect(laptopRevealDelta({ top: 0, bottom: 500 }, page, bands, viewH)).toBeNull();
  });
});
