import { describe, it, expect } from 'vitest';
import { lineupPresetMembers, selectedLineupPreset } from '../lineupPresets';

const presets = [
  { count: 1, type: 'solo' },
  { count: 2, type: 'duo' },
  { count: 3, type: 'trio' },
  { count: 3, type: 'full_band' }, // a 3-person band
];
const band = ['me', 'b', 'c'];

describe('lineup presets', () => {
  it('picks the first members, the user always in', () => {
    expect(lineupPresetMembers(2, band, 'me')).toEqual(['me', 'b']);
    expect(lineupPresetMembers(2, band, 'c')).toEqual(['c', 'b']);
    expect(lineupPresetMembers(3, [], 'me')).toEqual(['me']);
  });

  it('is selected only on an exact lineup match, not a count', () => {
    expect(selectedLineupPreset(presets, ['me', 'c'], band, 'me', 'duo')).toBeNull();
    expect(selectedLineupPreset(presets, ['b', 'me'], band, 'me', 'duo')).toBe('duo');
  });

  it('marks one preset when two pick the same people: the last chosen, else the first', () => {
    expect(selectedLineupPreset(presets, ['me', 'b', 'c'], band, 'me', 'full_band')).toBe('full_band');
    expect(selectedLineupPreset(presets, ['me', 'b', 'c'], band, 'me', 'trio')).toBe('trio');
    expect(selectedLineupPreset(presets, ['me', 'b', 'c'], band, 'me', 'solo')).toBe('trio');
  });
});
