// Claude review #285 r5 (M4): an app with 182's code on a database without
// 182 (the functions are not deployed yet: PGRST202). Add to calendar still
// works, with the one-event link of builds before 182 (account token + e=).
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
import { _resetCalendarTokenCache, memberCalendarUrl } from '@/lib/memberCalendar';

const EV = { eventId: '11111111-2222-4333-8444-555555555555', title: 'Rooftop Session', date: '2026-12-08', start: '21:00' };
const ACCOUNT = 'a'.repeat(64);
const missing = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };

beforeEach(() => {
  _resetCalendarTokenCache();
  h.openExternal.mockReset();
  h.rpc.mockReset();
});

describe('Add to calendar before 182 is on the database', () => {
  it('falls back to memberCalendarUrl(account token, { eventId }) on PGRST202', async () => {
    h.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'bw_my_event_calendar_link' || fn === 'bw_my_event_calendar_token') return missing;
      if (fn === 'bw_my_calendar_token') return { data: ACCOUNT, error: null };
      return { data: null, error: null };
    });
    render(<AddToCalendar event={EV} />);
    const button = await screen.findByRole('button', { name: 'Add to calendar' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    const want = memberCalendarUrl(ACCOUNT, { eventId: EV.eventId });
    await waitFor(() => expect(h.openExternal).toHaveBeenLastCalledWith(want));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('any other error is no fallback: no account link, the error shows', async () => {
    h.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'bw_my_event_calendar_link') return { data: null, error: null };
      if (fn === 'bw_my_event_calendar_token') return { data: null, error: { code: '42501', message: 'Not allowed' } };
      if (fn === 'bw_my_calendar_token') return { data: ACCOUNT, error: null };
      return { data: null, error: null };
    });
    render(<AddToCalendar event={EV} />);
    const button = await screen.findByRole('button', { name: 'Add to calendar' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await screen.findByRole('alert');
    expect(h.openExternal).not.toHaveBeenCalled();
  });
});
