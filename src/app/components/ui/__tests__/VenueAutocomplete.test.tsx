import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  searchVenues: vi.fn(),
}));
vi.mock('@/lib/services/location', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/location')>()),
  searchVenues: mocks.searchVenues,
  getGooglePlaceDetails: vi.fn(),
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
