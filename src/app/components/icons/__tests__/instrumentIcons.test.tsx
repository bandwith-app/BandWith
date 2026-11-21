import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { INSTRUMENT_KEYS } from '@/lib/instruments';
import { INSTRUMENTS } from '@/lib/OnboardingContext';
import { InstrumentIcon, instrumentIconKey, INSTRUMENT_ICONS } from '../brand-icons';

describe('instrument icons', () => {
  it('every canonical instrument has its own icon, not the fallback', () => {
    expect(INSTRUMENT_KEYS.length).toBeGreaterThanOrEqual(13);
    for (const key of INSTRUMENT_KEYS) {
      expect(instrumentIconKey(key), key).not.toBe('other');
    }
  });

  it('draws the three new icons: percussion, cello (and double bass), trombone as brass', () => {
    expect(instrumentIconKey('percussion')).toBe('percussion');
    expect(instrumentIconKey('cello')).toBe('cello');
    expect(instrumentIconKey('double-bass')).toBe('cello');
    expect(instrumentIconKey('trombone')).toBe('trumpet');
    expect(INSTRUMENT_ICONS.percussion.displayName).toBe('InstrumentPercussion');
    expect(INSTRUMENT_ICONS.cello.displayName).toBe('InstrumentCello');
  });

  it('reads the free text the app stores (ids, roles, other languages)', () => {
    expect(instrumentIconKey('saxophone')).toBe('sax');
    expect(instrumentIconKey('Bass · Band leader')).toBe('bass');
    expect(instrumentIconKey('Guitar / Backing vocals')).toBe('guitar');
    expect(instrumentIconKey('Contrabbasso')).toBe('cello');
    expect(instrumentIconKey('Pianoforte')).toBe('keys');
    expect(instrumentIconKey('Cajon')).toBe('percussion');
    expect(instrumentIconKey('Harp')).toBe('other');
    expect(instrumentIconKey('')).toBe('other');
    expect(instrumentIconKey(null)).toBe('other');
  });

  it('every onboarding instrument chip has its icon', () => {
    for (const { id } of INSTRUMENTS) {
      if (id !== 'other') expect(instrumentIconKey(id), id).not.toBe('other');
    }
  });

  it('renders a Dot Icon in the 24 grid tagged with the instrument', () => {
    for (const key of Object.keys(INSTRUMENT_ICONS)) {
      const { container, unmount } = render(<InstrumentIcon instrumentId={key} />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.getAttribute('data-instrument')).toBe(key);
      expect(svg.querySelectorAll('path, circle').length).toBeGreaterThan(0);
      unmount();
    }
  });
});
