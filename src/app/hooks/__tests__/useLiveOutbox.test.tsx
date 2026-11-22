import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({ sent: [] as string[], offline: false }));
vi.mock('@/lib/services/liveOutboxApi', () => {
  const ok = (tag: string) => async (op: { id?: string }) => {
    if (m.offline) return { error: { message: 'Failed to fetch' } };
    m.sent.push(`${tag}:${op.id ?? ''}`);
    return { error: null };
  };
  return { liveOutboxApi: { note: ok('note'), noteDelete: ok('noteDelete'), suggestion: ok('suggestion'), order: ok('order') } };
});
vi.mock('@/lib/services/rehearsalNotes', () => {
  const ok = async () => ({ error: null });
  return { saveNote: ok, deleteNote: async (id: string) => (m.sent.push(`rehearsal:${id}`), { error: null }), setPractised: ok, setNoteOk: ok };
});
vi.mock('@/lib/sessionUser', () => ({ sessionUserId: async () => 'u-1' }));

import { useLiveOutboxFlush, useWaitingChanges } from '../useLiveOutbox';
import { queueLiveOp } from '@/lib/liveOutbox';
import { queueNoteOp } from '@/lib/rehearsalNotesOutbox';

const note = (id: string) => ({ kind: 'note' as const, id, songId: 's1', anchor: { type: 'song' as const }, body: 'capo 2', isNew: true });

beforeEach(() => {
  localStorage.clear();
  m.sent = [];
  m.offline = false;
});

describe('waiting changes', () => {
  it('counts what waits on the phone and follows every change', async () => {
    const { result } = renderHook(() => useWaitingChanges('u-1'));
    expect(result.current).toBe(0);
    act(() => queueLiveOp('u-1', note('n1')));
    expect(result.current).toBe(1);
    act(() => queueNoteOp('u-1', { kind: 'delete', id: 'r1' }));
    expect(result.current).toBe(2);
  });

  it('finds the signed-in person by itself (Stage has no user prop)', async () => {
    queueLiveOp('u-1', note('n1'));
    const { result } = renderHook(() => useWaitingChanges());
    await waitFor(() => expect(result.current).toBe(1));
  });
});

describe('sending when back online', () => {
  it('sends both outboxes on start and again when the signal comes back', async () => {
    m.offline = true;
    queueLiveOp('u-1', note('n1'));
    queueNoteOp('u-1', { kind: 'delete', id: 'r1' });
    renderHook(() => useLiveOutboxFlush('u-1'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(m.sent).toEqual(['rehearsal:r1']);
    m.offline = false;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(m.sent).toEqual(['rehearsal:r1', 'note:n1']);
  });
});
