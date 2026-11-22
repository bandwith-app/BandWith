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

describe('Venue suggestions with a keyboard and a screen reader (ARIA 1.2 combobox)', () => {
  const second = { name: 'Bowery Ballroom', address: '6 Delancey St', city: 'New York', provider: 'osm' };
  const open = async () => {
    mocks.searchVenues.mockResolvedValue([place, second]);
    const input = screen.getByRole('combobox');
    input.focus();
    fireEvent.change(input, { target: { value: 'Blue' } });
    await screen.findAllByRole('option');
    return input;
  };

  it('the field points at the highlighted option (aria-activedescendant); options stay out of the Tab order', async () => {
    render(<Harness onSelect={() => {}} />);
    const input = await open();
    const options = screen.getAllByRole('option');
    for (const o of options) expect(o.tabIndex).toBe(-1);
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1].id);
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent).toContain('Bowery Ballroom');
  });

  it('Tab picks the highlighted venue, says so, and lets focus move on', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const input = await open();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const ev = fireEvent.keyDown(input, { key: 'Tab' });
    expect(ev).toBe(true); // not prevented
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect.mock.calls[0][0]).toMatchObject({ name: 'Blue Note Jazz Club' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByRole('status').textContent).toContain('Blue Note Jazz Club');
  });

  it('Tab with nothing highlighted just closes the list', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const input = await open();
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(onSelect).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('the highlighted suggestion stays in view', () => {
  const second = { name: 'Bowery Ballroom', address: '6 Delancey St', city: 'New York', provider: 'osm' };
  const open = async () => {
    mocks.searchVenues.mockResolvedValue([place, second]);
    const input = screen.getByRole('combobox');
    input.focus();
    fireEvent.change(input, { target: { value: 'Blue' } });
    await screen.findAllByRole('option');
    return input;
  };

  it('moving the highlight scrolls the option into view (nearest), keeping aria-activedescendant', async () => {
    const spy = vi.fn();
    const was = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      render(<Harness onSelect={() => {}} />);
      const input = await open();
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      const active = document.getElementById(input.getAttribute('aria-activedescendant')!)!;
      await waitFor(() => expect(spy.mock.contexts).toContain(active));
      expect(spy).toHaveBeenLastCalledWith({ block: 'nearest' });
      expect(active.textContent).toContain('Bowery Ballroom');
    } finally {
      Element.prototype.scrollIntoView = was;
    }
  });

  it('Tab commits only an option that is in view; else it just closes the list', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const input = await open();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const listbox = screen.getByRole('listbox');
    const option = document.getElementById(input.getAttribute('aria-activedescendant')!)!;
    // The list shows y 100–300; the option sits below it (scrolled away).
    listbox.getBoundingClientRect = () => new DOMRect(0, 100, 300, 200);
    option.getBoundingClientRect = () => new DOMRect(0, 400, 300, 48);
    fireEvent.keyDown(input, { key: 'Tab' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(onSelect).not.toHaveBeenCalled();
  });
});
