// The band home base (Pricing): a venue pick can land late, once Google's
// place details load, after other settings changed meanwhile (the free local
// radius, a toggle). It applies to the latest settings, never to the ones
// from when the pick started (Claude delta review of #298 cfe13af8).
import { describe, it, expect } from 'vitest';
import src from '../BandPricingModal.tsx?raw';

describe('Pricing: the home-base venue pick', () => {
  it('updates the latest settings (a functional update), not a stale copy', () => {
    const pick = src.slice(src.indexOf('onSelect={(place) => {'), src.indexOf('placeholder={t(\'City or rehearsal studio\')}'));
    expect(pick).toContain('band_origin_address: formatted');
    expect(pick).toMatch(/setSettings\(\(s\) => \(\{\s*\.\.\.s,/);
    expect(pick).not.toMatch(/\.\.\.settings\b/);
  });
});
