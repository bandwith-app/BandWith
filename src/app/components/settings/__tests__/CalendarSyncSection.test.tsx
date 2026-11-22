import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
const rpc = vi.hoisted(() => vi.fn());
const openExternal = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc,
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }) },
  },
}));
vi.mock('@/lib/nativeFiles', () => ({ openExternal }));

import { CalendarSyncSection } from '../CalendarSyncSection';
import { _resetCalendarTokenCache, myCalendarToken } from '@/lib/memberCalendar';
import { act } from '@testing-library/react';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('Settings → Calendar sync', () => {
  beforeEach(() => {
    rpc.mockReset();
    openExternal.mockReset();
    _resetCalendarTokenCache();
  });

  it('subscribes in Apple Calendar (webcal) and Google Calendar with the private link', async () => {
    rpc.mockResolvedValue({ data: A, error: null });
    render(<CalendarSyncSection />);
    const apple = await screen.findByRole('button', { name: /Apple Calendar/ });
    await waitFor(() => expect(apple).not.toBeDisabled());
    fireEvent.click(apple);
    expect(openExternal).toHaveBeenLastCalledWith(expect.stringMatching(new RegExp(`^webcal://.*member-calendar\\?t=${A}`)));
    fireEvent.click(screen.getByRole('button', { name: /Google Calendar/ }));
    expect(openExternal).toHaveBeenLastCalledWith(expect.stringMatching(/^https:\/\/calendar\.google\.com\/calendar\/render\?cid=webcal/));
  });

  it('makes a new link only after confirming', async () => {
    // By function: the section also asks whether to check an old link (182).
    rpc.mockImplementation(async (fn: string, args?: { p_rotate?: boolean }) =>
      fn === 'bw_my_calendar_token' ? { data: args?.p_rotate ? B : A, error: null } : { data: false, error: null });
    render(<CalendarSyncSection />);
    const make = await screen.findByRole('button', { name: /Make a new link/ });
    await waitFor(() => expect(make).not.toBeDisabled());
    fireEvent.click(make);
    expect(rpc.mock.calls.filter(([fn]) => fn === 'bw_my_calendar_token')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Make a new link' }));
    await screen.findByText('New link ready');
    expect(rpc).toHaveBeenLastCalledWith('bw_my_calendar_token', { p_rotate: true });
    fireEvent.click(screen.getByRole('button', { name: /Apple Calendar/ }));
    expect(openExternal).toHaveBeenLastCalledWith(expect.stringContaining(`t=${B}`));
  });

  // Codex review #285 round 2: an account asked to check its old link.
  it('a new link made here answers the old-link question, and the buttons follow every new link', async () => {
    const C = 'c'.repeat(64);
    let current = A;
    rpc.mockImplementation(async (fn: string, args?: { p_rotate?: boolean }) => {
      if (fn === 'bw_my_calendar_link_review') return { data: true, error: null };
      if (fn === 'bw_my_calendar_token') {
        if (args?.p_rotate) current = current === A ? B : C;
        return { data: current, error: null };
      }
      return { data: null, error: null };
    });
    render(<CalendarSyncSection />);
    await screen.findByTestId('calendar-link-review');
    const makes = screen.getAllByRole('button', { name: /Make a new link/ });
    const make = makes[makes.length - 1];
    await waitFor(() => expect(make).not.toBeDisabled());
    fireEvent.click(make);
    const group = await screen.findByRole('group', { name: 'Make a new link' });
    fireEvent.click(within(group).getByRole('button', { name: 'Make a new link' }));
    await screen.findByText('New link ready');
    // The new link starts unmarked: the question is gone.
    await waitFor(() => expect(screen.queryByTestId('calendar-link-review')).toBeNull());
    // Another new link (from an event's notice, say): Copy and Subscribe use it.
    await act(async () => {
      await myCalendarToken(true);
    });
    fireEvent.click(screen.getByRole('button', { name: /Apple Calendar/ }));
    expect(openExternal).toHaveBeenLastCalledWith(expect.stringContaining(`t=${C}`));
  });

  it('says so when the link is not available', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    render(<CalendarSyncSection />);
    expect(await screen.findByRole('alert')).toHaveTextContent('isn’t available');
    expect(screen.getByRole('button', { name: /Apple Calendar/ })).toBeDisabled();
  });
});
