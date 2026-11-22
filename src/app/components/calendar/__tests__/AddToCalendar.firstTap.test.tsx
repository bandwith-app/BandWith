// Claude review of #285, round 5: opening an event writes nothing. The
// one-event link is read when the event opens and made on the first tap.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
const h = vi.hoisted(() => ({
  native: false,
  openExternal: vi.fn(),
  make: vi.fn(),
  hook: vi.fn((..._a: unknown[]) => ({ token: null as string | null, loading: false })),
}));
vi.mock('@capacitor/core', async (orig) => ({
  ...(await orig<typeof import('@capacitor/core')>()),
  Capacitor: { isNativePlatform: () => h.native, getPlatform: () => (h.native ? 'ios' : 'web') },
}));
vi.mock('@/lib/nativeFiles', () => ({ openExternal: h.openExternal }));
vi.mock('@/lib/memberCalendar', async (orig) => ({
  ...(await orig<typeof import('@/lib/memberCalendar')>()),
  useEventCalendarToken: h.hook,
  myEventCalendarToken: h.make,
  useCalendarLinkReview: () => false,
}));

import { AddToCalendar } from '../AddToCalendar';

const EV = { eventId: '11111111-2222-4333-8444-555555555555', title: 'Rooftop Session', date: '2026-12-08', start: '21:00' };
const MADE = 'd'.repeat(64);

describe('Add to calendar: the link is made on the first tap', () => {
  beforeEach(() => {
    h.native = false;
    h.openExternal.mockReset();
    h.make.mockReset();
    h.hook.mockImplementation(() => ({ token: null, loading: false }));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('no link yet (web): the tap opens a window at once, makes the link, then shows the file', async () => {
    const win = { location: { href: '' }, close: vi.fn(), opener: {} as unknown };
    const open = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
    h.make.mockResolvedValue(MADE);
    render(<AddToCalendar event={EV} />);
    const button = screen.getByRole('button', { name: 'Add to calendar' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(open).toHaveBeenCalledTimes(1); // in the tap, before any await (no pop-up block)
    await waitFor(() => expect(win.location.href).toMatch(/member-calendar\?o=d{64}/));
    expect(h.make).toHaveBeenCalledWith(EV.eventId, EV.date, { create: true });
    expect(win.opener).toBeNull();
  });

  it('no link yet (app): the link is made, then opened by the system', async () => {
    h.native = true;
    const open = vi.spyOn(window, 'open');
    h.make.mockResolvedValue(MADE);
    render(<AddToCalendar event={EV} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    await waitFor(() => expect(h.openExternal).toHaveBeenCalledWith(expect.stringMatching(/member-calendar\?o=d{64}/)));
    expect(open).not.toHaveBeenCalled();
  });

  it('the link could not be made: the window closes and it says so', async () => {
    const win = { location: { href: '' }, close: vi.fn(), opener: {} as unknown };
    vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
    h.make.mockResolvedValue(null);
    render(<AddToCalendar event={EV} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(win.close).toHaveBeenCalled();
  });

  it('a link that exists opens straight away, nothing is made', () => {
    h.hook.mockImplementation(() => ({ token: MADE, loading: false }));
    render(<AddToCalendar event={EV} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    expect(h.openExternal).toHaveBeenCalledWith(expect.stringMatching(/member-calendar\?o=d{64}/));
    expect(h.make).not.toHaveBeenCalled();
  });
});
