import { describe, expect, it } from 'vitest';
import { tally, OTHERS, BAND, SLOTS } from '../src/ui/demos/rehearsals-polls';
import { markup } from '../src/content/demos/rehearsals-polls';

const all = OTHERS.filter((v) => v.at).map((v) => v.id);

describe('rehearsal poll demo', () => {
  it('is a band of five: Sara and the canonical cast', () => {
    expect(OTHERS.map((v) => v.name)).toEqual(['Leo M.', 'Nico', 'Tom', 'Lena P.']);
    expect(BAND).toBe(OTHERS.length + 1);
    expect(SLOTS.every((s) => s.n >= 16 && s.n <= 20)).toBe(true); // the week before Sat 21 Nov
  });

  it('starts with Leo and Nico voted, Tuesday on top', () => {
    const t = tally([], false, []);
    expect(t.voted).toBe(2);
    expect(t.top).toEqual([0]);
  });

  it('leaves Tuesday and Thursday tied until Sara votes, then her vote decides', () => {
    expect(tally([], false, all).top).toEqual([0, 2]);
    expect(tally([2], false, all).top).toEqual([2]);
    expect(tally([0], false, all).top).toEqual([0]);
    expect(tally([2], false, all).rows[2].map((v) => v.name)).toContain('Sara');
  });

  it('counts None work as answered but not voted', () => {
    const t = tally([], true, all);
    expect(t.voted).toBe(4);
    expect(t.answered).toBe(5);
  });

  it('never tells the band by push when a date is locked in', () => {
    expect(markup()).not.toMatch(/everyone got the push/i);
    expect(markup()).not.toMatch(/Marta|Omar|Jacopo|Bloom/);
  });
});
