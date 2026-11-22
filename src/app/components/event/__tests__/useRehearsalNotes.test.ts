import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import type { RehearsalNote } from '@/lib/rehearsalNotes';

const changeHandlers: (() => void)[] = [];
vi.mock('@/lib/supabase', () => {
  const channel = {
    on: vi.fn((_type: string, _filter: unknown, cb: () => void) => {
      changeHandlers.push(cb);
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };
  return { supabase: { channel: vi.fn(() => channel), removeChannel: vi.fn() } };
});

let server: RehearsalNote[] = [];
let offline = false;
let answer: { error: unknown; status?: number } | null = null;
const saveNote = vi.fn(async (n: RehearsalNote, _before: string[]) => {
  if (offline) return { error: { message: 'Failed to fetch' } };
  if (answer) return answer;
  server = [...server.filter((x) => x.id !== n.id), n];
  return { error: null };
});
vi.mock('@/lib/services/rehearsalNotes', () => ({
  fetchOccurrenceNotes: vi.fn(async () => (offline ? null : server)),
  saveNote: (n: RehearsalNote, before: string[]) => saveNote(n, before),
  deleteNote: vi.fn(async () => ({ error: null })),
  setPractised: vi.fn(async () => ({ error: null })),
  setNoteOk: vi.fn(async () => ({ error: null })),
}));

import { useRehearsalNotes } from '../useRehearsalNotes';
import { clearNoteBackoff, readOutbox } from '@/lib/rehearsalNotesOutbox';

const opts = { enabled: true, bandId: 'b', eventId: 'e', date: '2026-11-19', userId: 'u1', isAdmin: true };

beforeEach(() => {
  localStorage.clear();
  server = [];
  offline = false;
  answer = null;
  saveNote.mockClear();
  changeHandlers.length = 0;
});
afterEach(cleanup);

describe('useRehearsalNotes (A2)', () => {
  it('a mark is saved with the song and the minute', async () => {
    const { result } = renderHook(() => useRehearsalNotes(opts));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => {
      result.current.mark({ songId: 's1', songTitle: 'Paper Boats', markedAtS: 754 });
    });
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0]).toMatchObject({ status: 'marked', songId: 's1', markedAtS: 754, scope: 'band' });
    await waitFor(() => expect(saveNote).toHaveBeenCalledOnce());
    await waitFor(() => expect(readOutbox('u1')).toEqual([]));
  });

  it('no signal: the note shows at once, waits on the device and goes when back online', async () => {
    offline = true;
    const { result } = renderHook(() => useRehearsalNotes(opts));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => {
      result.current.mark({ songId: null, songTitle: null, markedAtS: 30 });
    });
    await waitFor(() => expect(saveNote).toHaveBeenCalled());
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.waiting).toBe(1);
    offline = false;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(result.current.waiting).toBe(0));
    expect(server).toHaveLength(1);
    expect(result.current.notes).toHaveLength(1);
  });

  it('audit 06 #5: a 503 keeps the note waiting; a refusal says so and keeps its words', async () => {
    answer = { error: { message: 'Service Unavailable' }, status: 503 };
    const { result } = renderHook(() => useRehearsalNotes(opts));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => {
      result.current.save({ ...result.current.draft({ preset: 'tempo', body: 'Bridge rushes' })! });
    });
    await waitFor(() => expect(saveNote).toHaveBeenCalled());
    expect(result.current.waiting).toBe(1);
    expect(result.current.notes.map((n) => n.body)).toEqual(['Bridge rushes']);
    expect(result.current.rejected).toEqual([]);
    // Now the server refuses it for good: not waiting any more, but its text is still here.
    answer = { error: { code: '42501', message: 'denied' }, status: 403 };
    clearNoteBackoff(); // its wait after the 503 is over
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(result.current.waiting).toBe(0));
    expect(result.current.rejected?.map((n) => n.body)).toEqual(['Bridge rushes']);
    act(() => result.current.dismissRejected?.(result.current.rejected![0].id));
    expect(result.current.rejected).toEqual([]);
  });

  it('writing a mark makes it a note', async () => {
    const { result } = renderHook(() => useRehearsalNotes(opts));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    let id = '';
    act(() => {
      id = result.current.mark({ songId: 's1', songTitle: 'Paper Boats', markedAtS: 10 })!.id;
    });
    const marked = result.current.notes.find((n) => n.id === id)!;
    act(() => result.current.save({ ...marked, preset: 'tempo' }));
    expect(result.current.notes.find((n) => n.id === id)).toMatchObject({ status: 'open', preset: 'tempo' });
  });

  it("another member's note arrives live", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { result } = renderHook(() => useRehearsalNotes(opts));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      server = [
        {
          id: 'other',
          bandId: 'b',
          eventId: 'e',
          date: '2026-11-19',
          sessionId: null,
          songId: 's2',
          songTitle: 'Superstition',
          preset: 'ending',
          section: null,
          body: null,
          scope: 'band',
          status: 'open',
          markedAtS: null,
          createdBy: 'u2',
          okBy: null,
          okAt: null,
          createdAt: '2026-11-19T20:00:00.000Z',
          assignees: [],
        },
      ];
      act(() => changeHandlers[0]());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      await waitFor(() => expect(result.current.notes.map((n) => n.id)).toEqual(['other']));
    } finally {
      vi.useRealTimers();
    }
  });

  it('off (flag, personal gig, no date): nothing', () => {
    const { result } = renderHook(() => useRehearsalNotes({ ...opts, date: null }));
    expect(result.current.enabled).toBe(false);
    expect(result.current.mark({ songId: null, songTitle: null, markedAtS: null })).toBeNull();
  });
});
