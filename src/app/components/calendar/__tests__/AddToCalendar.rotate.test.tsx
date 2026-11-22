// Codex review #285 round 5 (AddToCalendar:45): after "Make a new link" the
// one-event link made earlier is gone; Add to calendar must open the new one,
// never the URL it made before.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
const h = vi.hoisted(() => ({ openExternal: vi.fn(), rpc: vi.fn() }));
vi.mock('@capacitor/core', async (orig) => ({
  ...(await orig<typeof import('@capacitor/core')>()),
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
}));
vi.mock('@/lib/nativeFiles', () => ({ openExternal: h.openExternal }));
vi.mock('@/lib/supabase', () => ({
  isDemoMode: false,
  supabase: {
    rpc: h.rpc,
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
  },
}));

import { AddToCalendar } from '../AddToCalendar';
import { myCalendarToken } from '@/lib/memberCalendar';

const EV = { eventId: '11111111-2222-4333-8444-555555555555', title: 'Rooftop Session', date: '2026-12-08', start: '21:00' };
const OLD = 'd'.repeat(64);
const NEW = 'f'.repeat(64);

describe('Add to calendar after "Make a new link"', () => {
  it('opens the new link, not the one it made before', async () => {
    let link: string | null = null; // what the server has for this event
    let next = OLD;
    h.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'bw_my_event_calendar_link') return { data: link, error: null };
      if (fn === 'bw_my_event_calendar_token') {
        link = link ?? next;
        return { data: link, error: null };
      }
      if (fn === 'bw_my_calendar_token') return { data: 'a'.repeat(64), error: null };
      return { data: null, error: null };
    });
    render(<AddToCalendar event={EV} />);
    const button = await screen.findByRole('button', { name: 'Add to calendar' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(h.openExternal).toHaveBeenLastCalledWith(expect.stringContaining(`o=${OLD}`)));
    // "Make a new link": the server ends every one-event link.
    link = null;
    next = NEW;
    await act(async () => {
      await myCalendarToken(true);
    });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Add to calendar' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    await waitFor(() => expect(h.openExternal).toHaveBeenLastCalledWith(expect.stringContaining(`o=${NEW}`)));
    expect(h.openExternal).not.toHaveBeenLastCalledWith(expect.stringContaining(`o=${OLD}`));
  });
});
