import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react';

// Audit 09 #10: the review screen fetched the newest 200 suggestions of every
// status and filtered them on the phone. A correction left pending behind 200
// newer reviewed ones never showed in Waiting, and its notification could not
// open it. Now each tab asks the server for its own status, a page at a time,
// and a notification's suggestion is fetched by id.
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ rows: [] as Row[] }));

vi.mock('@/lib/supabase', () => {
  const query = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let order: { col: string; asc: boolean } | null = null;
    let limit = Infinity;
    let head = false;
    let one = false;
    const run = () => {
      let rows = table === 'song_suggestions' ? db.rows.filter((r) => filters.every((f) => f(r))) : [];
      if (order) {
        const { col, asc } = order;
        rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
      }
      const count = rows.length;
      rows = rows.slice(0, limit);
      if (head) return { data: null, count, error: null };
      if (one) return { data: rows[0] ?? null, error: null };
      return { data: rows, count, error: null };
    };
    const b: Record<string, unknown> = {
      select: (_c?: string, o?: { head?: boolean }) => ((head = !!o?.head), b),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), b),
      order: (col: string, o?: { ascending?: boolean }) => ((order = { col, asc: o?.ascending !== false }), b),
      limit: (n: number) => ((limit = n), b),
      maybeSingle: () => ((one = true), b),
      single: () => ((one = true), b),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { from: query, channel: () => channel, removeChannel: vi.fn() } };
});
vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ selectedBand: { id: 'band-1', name: 'Velvet Static' }, isAdmin: true }),
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin-1' } }) }));

import { SongSuggestionsView } from '../SongSuggestionsView';
import { closeSongSuggestions, openSongSuggestions } from '@/lib/services/songSuggestions';

const at = (i: number) => new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString();
const row = (i: number, status: string, title: string): Row => ({
  id: `sg-${i}`, band_id: 'band-1', song_id: null, song_title: title, kind: 'note', proposed: { note: 'Count in 4' },
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
  });
});
