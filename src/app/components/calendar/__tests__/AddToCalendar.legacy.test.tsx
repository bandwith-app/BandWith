// Claude review #285 r5 (M4) + Codex B2 (round 7): an app with 182's code
// on a database without 182 (the functions are not deployed yet: PGRST202).
// Add to calendar still works, as that event's .ics file made on the device:
// never a link, and never the account token (which opens the whole feed).
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
const h = vi.hoisted(() => ({ openExternal: vi.fn(), shareFile: vi.fn(), downloadBlobOnWeb: vi.fn(), rpc: vi.fn(), native: true }));
vi.mock('@capacitor/core', async (orig) => ({
  ...(await orig<typeof import('@capacitor/core')>()),
  Capacitor: { isNativePlatform: () => h.native, getPlatform: () => (h.native ? 'ios' : 'web') },
}));
vi.mock('@/lib/nativeFiles', () => ({ openExternal: h.openExternal, shareFile: h.shareFile, downloadBlobOnWeb: h.downloadBlobOnWeb }));
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
import { _resetCalendarTokenCache } from '@/lib/memberCalendar';

const EV = { eventId: '11111111-2222-4333-8444-555555555555', title: 'Rooftop Session', date: '2026-12-08', start: '21:00' };
const ACCOUNT = 'a'.repeat(64);
const missing = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };

beforeEach(() => {
  _resetCalendarTokenCache();
  h.openExternal.mockReset();
  h.shareFile.mockReset();
  h.shareFile.mockResolvedValue('shared');
  h.downloadBlobOnWeb.mockReset();
  h.native = true;
  h.rpc.mockReset();
});

describe('Add to calendar before 182 is on the database', () => {
  it('on PGRST202 hands over the .ics of this event, with no token in it', async () => {
    h.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'bw_my_event_calendar_link' || fn === 'bw_my_event_calendar_token') return missing;
      if (fn === 'bw_my_calendar_token') return { data: ACCOUNT, error: null };
      return { data: null, error: null };
    });
    render(<AddToCalendar event={EV} />);
    const button = await screen.findByRole('button', { name: 'Add to calendar' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(h.shareFile).toHaveBeenCalledTimes(1));
    const [blob, name] = h.shareFile.mock.calls[0] as [Blob, string];
    expect(name).toMatch(/\.ics$/);
    const ics = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(blob);
    });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Rooftop Session');
    expect(ics).toContain('DTSTART:20261208T210000');
    expect(ics).not.toContain('RRULE');
    // No link, so no token: neither the account's nor any other.
    expect(ics).not.toContain(ACCOUNT);
    expect(ics).not.toMatch(/[?&](t|o)=/);
    expect(h.openExternal).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalledWith('bw_my_calendar_token', expect.anything());
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
    expect(h.shareFile).not.toHaveBeenCalled();
  });
  // Claude r7 (2): on the web the missing functions are found only after the
  // tap's await, when the tap no longer counts as a user action (Web Share
  // would throw NotAllowedError): a plain download, and the tab opened for
  // the link is closed.
  it('web: the .ics downloads (no share sheet), and the tab opened in the tap closes', async () => {
    h.native = false;
    const tab = { close: vi.fn(), opener: null, location: { href: '' } };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    h.rpc.mockImplementation(async (fn: string) =>
      fn === 'bw_my_event_calendar_link' ? { data: null, error: null } : fn === 'bw_my_event_calendar_token' ? missing : { data: null, error: null },
    );
    render(<AddToCalendar event={EV} />);
    const button = await screen.findByRole('button', { name: 'Add to calendar' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(h.downloadBlobOnWeb).toHaveBeenCalledTimes(1));
    expect(h.downloadBlobOnWeb.mock.calls[0][1]).toMatch(/\.ics$/);
    expect(h.shareFile).not.toHaveBeenCalled();
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe('');
    open.mockRestore();
  });

  // Claude r7 (3): a file that can't be made says so, not "link".
  it('a file that cannot be made shows its own message', async () => {
    h.shareFile.mockRejectedValue(new Error('disk full'));
    h.rpc.mockImplementation(async (fn: string) =>
      fn === 'bw_my_event_calendar_link' || fn === 'bw_my_event_calendar_token' ? missing : { data: null, error: null },
    );
    render(<AddToCalendar event={EV} />);
    const button = await screen.findByRole('button', { name: 'Add to calendar' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't make the calendar file. Try again.");
  });
});
