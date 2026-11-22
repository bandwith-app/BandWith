import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react';

// Audit 09 #10: the review screen fetched the newest 200 suggestions of every
// status and filtered them on the phone. A correction left pending behind 200
// newer reviewed ones never showed in Waiting, and its notification could not
// open it. Now each tab asks the server for its own status, a page at a time,
// and a notification's suggestion is fetched by id.
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ rows: [] as Row[], holdKeyset: null as Promise<void> | null, band: 'band-1' }));

vi.mock('@/lib/supabase', () => {
  const query = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const orders: Array<{ col: string; asc: boolean }> = [];
    let limit = Infinity;
    let head = false;
    let one = false;
    let keyset = false;
    const run = () => {
      let rows = table === 'song_suggestions' ? db.rows.filter((r) => filters.every((f) => f(r))) : [];
      rows = [...rows].sort((a, b) => {
        for (const { col, asc } of orders) {
          if (a[col] === b[col]) continue;
          return (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1);
        }
        return 0;
      });
      const count = rows.length;
      // Like PostgREST's max-rows: never more than 1,000 per request.
      rows = rows.slice(0, Math.min(limit, 1000));
      if (head) return { data: null, count, error: null };
      if (one) return { data: rows[0] ?? null, error: null };
      return { data: rows, count, error: null };
    };
    const b: Record<string, unknown> = {
      select: (_c?: string, o?: { head?: boolean }) => ((head = !!o?.head), b),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), b),
      order: (col: string, o?: { ascending?: boolean }) => (orders.push({ col, asc: o?.ascending !== false }), b),
      // Keyset cursor: created_at.lt."T",and(created_at.eq."T",id.lt."I")
      or: (expr: string) => {
        const m = expr.match(/^created_at\.lt\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.lt\."([^"]+)"\)$/);
        if (!m) throw new Error(`unexpected or(): ${expr}`);
        filters.push((r) => String(r.created_at) < m[1] || (r.created_at === m[2] && String(r.id) < m[3]));
        keyset = true;
        return b;
      },
      limit: (n: number) => ((limit = n), b),
      maybeSingle: () => ((one = true), b),
      single: () => ((one = true), b),
      // A slow "Load older" page: the next keyset request waits for the test.
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        const hold = keyset ? db.holdKeyset : null;
        if (hold) db.holdKeyset = null;
        return (hold ?? Promise.resolve()).then(run).then(res, rej);
      },
    };
    return b;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { from: query, channel: () => channel, removeChannel: vi.fn() } };
});
vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ selectedBand: { id: db.band, name: db.band === 'band-1' ? 'Velvet Static' : 'Hudson Line' }, isAdmin: true }),
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin-1' } }) }));

import { SongSuggestionsView } from '../SongSuggestionsView';
import { closeSongSuggestions, openSongSuggestions, SUGGESTIONS_CHANGED } from '@/lib/services/songSuggestions';

const at = (i: number) => new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString();
const row = (i: number, status: string, title: string, band = 'band-1'): Row => ({
  id: `sg-${band === 'band-1' ? '' : `${band}-`}${i}`, band_id: band, song_id: null, song_title: title, kind: 'note', proposed: { note: 'Count in 4' },
  original: {}, message: null, status, reason: null, applied: null, created_by: 'member-1', created_at: at(i),
  reviewed_by: null, reviewed_at: null, author: { id: 'member-1', full_name: 'Jordan Lee' }, reviewer: null,
});
const seed = () => {
  db.rows = [row(0, 'pending', 'Old correction · Harlem Nocturne')];
  for (let i = 1; i <= 230; i++) db.rows.push(row(i, 'accepted', `Reviewed ${i}`));
};

afterEach(() => {
  act(() => closeSongSuggestions());
  cleanup();
  db.band = 'band-1';
  db.holdKeyset = null;
});

describe('Suggestions: an older pending one stays reachable', () => {
  it('shows it in Waiting behind 200+ newer reviewed suggestions', async () => {
    seed();
    render(<SongSuggestionsView />);
    act(() => openSongSuggestions());
    expect(await screen.findByText('Old correction · Harlem Nocturne')).toBeTruthy();
  });

  it('opens it from its notification', async () => {
    seed();
    db.rows.push(row(-5, 'accepted', 'Very old reviewed · Brooklyn Bridge'));
    render(<SongSuggestionsView />);
    act(() => openSongSuggestions({ suggestionId: 'sg--5' }));
    // The detail page of that suggestion, not the list.
    expect(await screen.findByRole('heading', { name: 'Very old reviewed · Brooklyn Bridge' })).toBeTruthy();
  });

  it('pages through older reviewed suggestions', { timeout: 30_000 }, async () => {
    seed();
    render(<SongSuggestionsView />);
    act(() => openSongSuggestions());
    await screen.findByText('Old correction · Harlem Nocturne');
    fireEvent.click(screen.getByRole('button', { name: /^Reviewed/ }));
    expect(await screen.findByText('Reviewed 230')).toBeTruthy();
    expect(screen.queryByText('Reviewed 1')).toBeNull();
    let more = screen.getByRole('button', { name: 'Load older suggestions' });
    await act(async () => fireEvent.click(more));
    more = await screen.findByRole('button', { name: 'Load older suggestions' });
    await act(async () => fireEvent.click(more));
    expect(await screen.findByText('Reviewed 1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load older suggestions' })).toBeNull();
    expect(within(screen.getByRole('dialog')).queryByText('Old correction · Harlem Nocturne')).toBeNull();
    // A refresh (another admin reviewed one) keeps the older pages shown.
    db.rows.push(row(500, 'rejected', 'Just reviewed'));
    await act(async () => window.dispatchEvent(new CustomEvent(SUGGESTIONS_CHANGED)));
    expect(await screen.findByText('Just reviewed')).toBeTruthy();
    expect(screen.getByText('Reviewed 1')).toBeTruthy();
  });

  it('opened again from a notification while already loaded: waits for that suggestion', async () => {
    seed();
    db.rows.push(row(-5, 'accepted', 'Very old reviewed · Brooklyn Bridge'));
    render(<SongSuggestionsView />);
    act(() => openSongSuggestions());
    await screen.findByText('Old correction · Harlem Nocturne');
    act(() => openSongSuggestions({ suggestionId: 'sg--5' }));
    expect(await screen.findByRole('heading', { name: 'Very old reviewed · Brooklyn Bridge' })).toBeTruthy();
  });

  it('reaches the oldest of 1,001 reviewed suggestions past the 1,000-row cap', { timeout: 120_000 }, async () => {
    db.rows = [];
    for (let i = 1; i <= 1001; i++) db.rows.push(row(i, 'accepted', `Reviewed ${i}`));
    render(<SongSuggestionsView />);
    act(() => openSongSuggestions());
    fireEvent.click(await screen.findByRole('button', { name: /^Reviewed/ }));
    await screen.findByText('Reviewed 1001');
    for (let n = 0; n < 12 && screen.queryByRole('button', { name: 'Load older suggestions' }); n++) {
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Load older suggestions' })));
    }
    expect(await screen.findByText('Reviewed 1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load older suggestions' })).toBeNull();
  });

  it('a slow "Load older" from one band never lands in another band’s list (Codex review of #295)', { timeout: 30_000 }, async () => {
    seed();
    for (let i = 1; i <= 3; i++) db.rows.push(row(i, 'accepted', `Hudson reviewed ${i}`, 'band-2'));
    const view = render(<SongSuggestionsView />);
    act(() => openSongSuggestions());
    fireEvent.click(await screen.findByRole('button', { name: /^Reviewed/ }));
    await screen.findByText('Reviewed 230');
    let release!: () => void;
    db.holdKeyset = new Promise<void>((r) => (release = r));
    fireEvent.click(screen.getByRole('button', { name: 'Load older suggestions' }));
    // Meanwhile the user switches band.
    db.band = 'band-2';
    view.rerender(<SongSuggestionsView />);
    expect(await screen.findByText('Hudson reviewed 3')).toBeTruthy();
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 20));
    });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Hudson reviewed 1')).toBeTruthy();
    expect(within(dialog).queryByText(/^Reviewed \d+$/)).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Load older suggestions' })).toBeNull();
  });

  it('tab badges show the server totals, not the rows loaded so far (Codex review of #295)', { timeout: 30_000 }, async () => {
    seed();
    render(<SongSuggestionsView />);
    act(() => openSongSuggestions());
    await screen.findByText('Old correction · Harlem Nocturne');
    const tabs = () => within(screen.getByRole('group', { name: 'Suggestions' }));
    expect(tabs().getByRole('button', { name: /^Reviewed/ }).textContent).toBe('Reviewed230');
    fireEvent.click(tabs().getByRole('button', { name: /^Reviewed/ }));
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Load older suggestions' })));
    await screen.findByText('Reviewed 130');
    expect(tabs().getByRole('button', { name: /^Reviewed/ }).textContent).toBe('Reviewed230');
    expect(tabs().getByRole('button', { name: /^Waiting/ }).textContent).toBe('Waiting1');
  });
});
