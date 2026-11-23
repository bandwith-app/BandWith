// The band home base (Pricing): the venue field hands back its text late too.
// VenueAutocomplete calls `onChange` and then `onSelect` after Google's place
// details load, with the callbacks from the render in which the pick started.
// A setting changed in between (the free local radius) must survive both:
// `onChange` used to write a copy of the settings from before that change,
// and so undid it, even though `onSelect` was already a functional update
// (Codex round 11-22, #298).
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';

type VenueProps = {
  value?: string;
  onChange: (val: string) => void;
  onSelect: (place: Record<string, unknown>) => void;
};
const venue = vi.hoisted(() => ({ props: [] as unknown[] }));

vi.mock('@/app/components/ui/VenueAutocomplete', () => ({
  VenueAutocomplete: (props: VenueProps) => {
    venue.props.push(props);
    return <input aria-label="Band home base" readOnly value={props.value || ''} />;
  },
}));
vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ isAdmin: true, selectedBand: { id: 'band-1', name: 'The Hudson Line' }, refreshBands: vi.fn() }),
}));
vi.mock('@/lib/services/bands', () => ({ updateBand: vi.fn(async () => ({})) }));
vi.mock('@/lib/services/pricing', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/services/pricing')>();
  return {
    ...real,
    getBandPricing: vi.fn(async () => ({
      ...real.DEFAULT_BAND_PRICING,
      band_id: 'band-1',
      band_origin_address: 'Brooklyn, NY',
      free_travel_radius_km: 30,
    })),
  };
});

import { BandPricingModal } from '../BandPricingModal';

// jsdom has no Element.scrollTo (the section strip keeps its tab in view).
beforeAll(() => {
  Element.prototype.scrollTo = vi.fn() as unknown as Element['scrollTo'];
});

afterEach(() => {
  cleanup();
  venue.props.length = 0;
});

const latest = () => venue.props[venue.props.length - 1] as VenueProps;
const homeBase = () => screen.getByLabelText('Band home base') as HTMLInputElement;
const radius = () => screen.getByLabelText(/^Free local radius in/) as HTMLInputElement;

/** Opens Pricing on the travel section and returns the venue field's callbacks as they were before the radius changed. */
async function openThenChangeRadius() {
  render(<BandPricingModal isOpen onClose={() => {}} bandId="band-1" initialTab="production" />);
  await waitFor(() => expect(homeBase().value).toBe('Brooklyn, NY'));
  const before = radius().value;
  const started = latest();
  fireEvent.change(radius(), { target: { value: String(Number(before) + 7) } });
  const changed = radius().value;
  expect(changed).not.toBe(before);
  return { started, changed };
}

describe('Pricing: the home-base text that lands late', () => {
  it('keeps a setting changed while the place details were loading', async () => {
    const { started, changed } = await openThenChangeRadius();
    act(() => started.onChange('Asbury Park, NJ'));
    expect(homeBase().value).toBe('Asbury Park, NJ');
    expect(radius().value).toBe(changed);
  });

  it('keeps it through the full late pick (the text, then the place)', async () => {
    const { started, changed } = await openThenChangeRadius();
    act(() => {
      started.onChange('The Stone Pony');
      started.onSelect({ name: 'The Stone Pony', fullAddress: '913 Ocean Ave, Asbury Park, NJ', latitude: 40.22, longitude: -74.0 });
    });
    expect(homeBase().value).toBe('913 Ocean Ave, Asbury Park, NJ');
    expect(radius().value).toBe(changed);
  });
});
