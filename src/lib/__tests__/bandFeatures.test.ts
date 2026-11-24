import { describe, it, expect } from 'vitest';
import { canUseBandFeatures, isRealBand } from '../bandFeatures';

/**
 * Owner's report, 11-24: a new account on the "Solo schedule" path was offered
 * a chat, a rehearsal proposal and a Members page that loaded forever. What
 * needs a band is decided by one rule, "is this account in a real band".
 */
const band = { id: 'band-1', name: 'Velvet Static' };
const known = { bandsLoading: false, bandsError: null };

describe('canUseBandFeatures', () => {
  it('the solo path with no band: no', () => {
    expect(canUseBandFeatures({ userMode: 'solo', bands: [], ...known })).toBe(false);
  });

  it('a band list known to be empty: no, whatever the profile says (left its last band, mode never written)', () => {
    expect(canUseBandFeatures({ userMode: null, bands: [], ...known })).toBe(false);
    expect(canUseBandFeatures({ userMode: 'band_admin', bands: [], ...known })).toBe(false);
    expect(canUseBandFeatures({ userMode: 'member', bands: [null, undefined], ...known })).toBe(false);
  });

  it('a real band always wins, even while the profile still says solo (just joined or created one)', () => {
    expect(canUseBandFeatures({ userMode: 'solo', bands: [band], ...known })).toBe(true);
    expect(canUseBandFeatures({ userMode: 'member', bands: [band, { id: 'band-2' }], ...known })).toBe(true);
    // The selected band stands in for a list that is a moment behind.
    expect(canUseBandFeatures({ userMode: 'member', bands: [null, band], ...known })).toBe(true);
  });

  it('"not loaded yet" is never taken for "no band"', () => {
    expect(canUseBandFeatures({ userMode: 'band_admin', bands: [], bandsLoading: true })).toBe(true);
    expect(canUseBandFeatures({ userMode: null, bands: [], bandsLoading: true })).toBe(true);
    // The solo path is known from the profile at once: no band to wait for.
    expect(canUseBandFeatures({ userMode: 'solo', bands: [], bandsLoading: true })).toBe(false);
  });

  it('a band list that failed to load is not "no band"', () => {
    expect(canUseBandFeatures({ userMode: 'member', bands: [], bandsLoading: false, bandsError: new Error('offline') })).toBe(true);
    expect(canUseBandFeatures({ userMode: 'solo', bands: [], bandsLoading: false, bandsError: new Error('offline') })).toBe(false);
  });

  it('a personal band (the planned hidden band of one) is not a real band: still no', () => {
    const personal = { id: 'band-p', name: 'Leo M.', is_personal: true };
    expect(isRealBand(personal)).toBe(false);
    expect(isRealBand(band)).toBe(true);
    expect(isRealBand({ ...band, is_personal: false })).toBe(true);
    expect(isRealBand(null)).toBe(false);
    expect(canUseBandFeatures({ userMode: 'solo', bands: [personal], ...known })).toBe(false);
    expect(canUseBandFeatures({ userMode: 'member', bands: [personal], ...known })).toBe(false);
    // With a real band beside it, band features are on.
    expect(canUseBandFeatures({ userMode: 'member', bands: [personal, band], ...known })).toBe(true);
  });
});
