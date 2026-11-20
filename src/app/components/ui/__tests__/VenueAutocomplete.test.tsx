import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  searchVenues: vi.fn(),
  getGooglePlaceDetails: vi.fn(),
  rememberPickedPlace: vi.fn(),
}));
vi.mock('@/lib/services/location', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/location')>()),
  searchVenues: mocks.searchVenues,
  getGooglePlaceDetails: mocks.getGooglePlaceDetails,
  rememberPickedPlace: mocks.rememberPickedPlace,
}));

import { VenueAutocomplete } from '../VenueAutocomplete';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const place = { name: 'Blue Note Jazz Club', address: 'Via Borsieri 37', city: 'Milano', provider: 'osm' };

const Harness: React.FC<{ onSelect: (p: unknown) => void }> = ({ onSelect }) => {
  const [value, setValue] = useState('');
  return <VenueAutocomplete value={value} onChange={setValue} onSelect={onSelect} inputId="venue" />;
};

const openSuggestions = async () => {
  mocks.searchVenues.mockResolvedValue([place]);
  const input = screen.getByRole('combobox');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'Blue Note' } });
  return screen.findByRole('option');
};

const touch = (el: Element, type: 'touchStart' | 'touchEnd', x: number, y: number) =>
  fireEvent[type](el, type === 'touchStart' ? { touches: [{ clientX: x, clientY: y }] } : { changedTouches: [{ clientX: x, clientY: y }] });

describe('Venue suggestions on a touch screen', () => {
  it('one tap on a suggestion picks it while the keyboard is up (no click follows on iOS)', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const option = await openSuggestions();
    touch(option, 'touchStart', 40, 40);
    touch(option, 'touchEnd', 42, 41);
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect.mock.calls[0][0]).toMatchObject({ name: 'Blue Note Jazz Club' });
  });

  it('scrolling the suggestion list does not pick a venue', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const option = await openSuggestions();
    touch(option, 'touchStart', 40, 40);
    touch(option, 'touchEnd', 40, 120);
    await new Promise((r) => setTimeout(r, 20));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a mouse click still picks a suggestion', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const option = await openSuggestions();
    fireEvent.click(option);
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
  });

  it('the venue field does not autocorrect names', () => {
    render(<Harness onSelect={vi.fn()} />);
    expect(screen.getByRole('combobox').getAttribute('autocorrect')).toBe('off');
  });
});

const lastSearch = () => mocks.searchVenues.mock.calls[mocks.searchVenues.mock.calls.length - 1];

describe('Google sessions', () => {
  it('keeps one session token from typing to the pick, then starts a new one', async () => {
    const onSelect = vi.fn();
    const google = { name: 'Blue Note', fullAddress: 'Blue Note, Via Borsieri 37, Milano', placeId: 'ChIJ1', provider: 'google' };
    mocks.searchVenues.mockResolvedValue([google]);
    mocks.getGooglePlaceDetails.mockResolvedValue({ city: 'Milano', address: 'Via Borsieri 37', latitude: 45.48, longitude: 9.18 });
    render(<Harness onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Blue' } });
    fireEvent.change(input, { target: { value: 'Blue Note' } });
    const option = await screen.findByRole('option');
    expect(screen.getByText('Google Maps')).toBeTruthy();
    fireEvent.click(option);
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));

    const token = lastSearch()?.[2]?.sessionToken;
    expect(typeof token === 'string' && token.length > 0).toBe(true);
    expect(mocks.getGooglePlaceDetails).toHaveBeenCalledWith('ChIJ1', undefined, token);
    expect(mocks.rememberPickedPlace).toHaveBeenCalledWith(expect.objectContaining({ latitude: 45.48 }));

    fireEvent.change(input, { target: { value: 'Alcatraz' } });
    await waitFor(() => expect(lastSearch()?.[0]).toBe('Alcatraz'));
    expect(lastSearch()?.[2]?.sessionToken).not.toBe(token);
  });
});
