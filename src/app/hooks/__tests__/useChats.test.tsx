import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const getChats = vi.fn();
const store = new Map<string, unknown>();
const rt = vi.hoisted(() => ({ onStatus: null as null | ((s: string) => void) }));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 'me' } }) }));
vi.mock('@/lib/services/chats', () => ({
  getChats: (...a: unknown[]) => getChats(...a),
  subscribeToNewMessages: (_cb: unknown, opts?: { onStatus?: (s: string) => void }) => {
    rt.onStatus = opts?.onStatus ?? null;
    return () => {};
  },
  subscribeToReceipts: () => () => {},
}));
vi.mock('@/lib/offline/storage', () => ({
  getCacheKey: (u: string, b: string | undefined, k: string) => `bw:${u}:${b || 'global'}:${k}`,
  getOfflineItem: async (k: string) => store.get(k) ?? null,
  setOfflineItem: async (k: string, v: unknown) => { store.set(k, v); },
  onCachedRolesChanged: () => () => {},
}));

import { useChats } from '../useData';
import { CHAT_LIST_FALLBACK_POLL_MS } from '@/lib/chatSync';

const chat = (id: string) => ({ id, type: 'direct', participants: [] }) as any;

beforeEach(() => {
  store.clear();
  try { localStorage.clear(); } catch { /* none */ }
  getChats.mockReset();
  rt.onStatus = null;
});

describe('useChats', () => {
  it('keeps the list when a refetch fails (offline, network blip)', async () => {
    getChats.mockResolvedValueOnce({ data: [chat('c1')], error: null });
    const { result } = renderHook(() => useChats());
    await waitFor(() => expect(result.current.chats).toHaveLength(1));
    getChats.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    await act(async () => { await result.current.refetch(); });
    expect(result.current.chats.map((c) => c.id)).toEqual(['c1']);
    expect(result.current.error).toBeTruthy();
  });

  it('shows the last list from this device while offline', async () => {
    store.set('bw:me:global:chats_list', [chat('c9')]);
    getChats.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });
    const { result } = renderHook(() => useChats());
    await waitFor(() => expect(result.current.chats.map((c) => c.id)).toEqual(['c9']));
  });

  // Claude #291 r5 (4): a "Not sent" chat message for a chat that is no
  // longer in the list can't be tried again: it goes; a waiting one stays.
  it('the list loaded without a chat: its refused messages leave the outbox', async () => {
    const { putChatOutbox, listChatOutbox } = await import('@/lib/chatOutbox');
    await putChatOutbox('me', { chatId: 'gone', clientId: 'r1', body: 'Not sent one', createdAt: '2026-11-22T10:00:00.000Z', refused: '' });
    await putChatOutbox('me', { chatId: 'gone', clientId: 'w1', body: 'Waiting one', createdAt: '2026-11-22T10:01:00.000Z' });
    getChats.mockResolvedValue({ data: [chat('c1')], error: null });
    const { result } = renderHook(() => useChats());
    await waitFor(() => expect(result.current.chats).toHaveLength(1));
    await waitFor(async () => expect((await listChatOutbox('me')).map((x) => x.clientId)).toEqual(['w1']));
  });

  it('a band-filtered list never drops anything', async () => {
    const { putChatOutbox, listChatOutbox } = await import('@/lib/chatOutbox');
    await putChatOutbox('me', { chatId: 'other-band-chat', clientId: 'r2', body: 'Not sent', createdAt: '2026-11-22T10:00:00.000Z', refused: '' });
    getChats.mockResolvedValue({ data: [chat('c1')], error: null });
    const { result } = renderHook(() => useChats('band-1'));
    await waitFor(() => expect(result.current.chats).toHaveLength(1));
    await act(async () => {});
    expect((await listChatOutbox('me')).map((x) => x.clientId)).toEqual(['r2']);
  });

  // Audit 07 #8: Realtime down while HTTP works, a DM arrives. The list and
  // the unread badge used to stay stale until something else refetched.
  describe('socket outage', () => {
    const flush = async (ms = 0) => {
      await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    };
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('polls slowly while the channel is down and picks up the missed message', async () => {
      getChats.mockResolvedValue({ data: [chat('c1')], error: null });
      const { result } = renderHook(() => useChats());
      await flush();
      await act(async () => { rt.onStatus?.('SUBSCRIBED'); });
      await act(async () => { rt.onStatus?.('CHANNEL_ERROR'); });
      await flush();
      getChats.mockResolvedValue({ data: [chat('dm-new'), chat('c1')], error: null });
      await flush(CHAT_LIST_FALLBACK_POLL_MS + 100);
      expect(result.current.chats.map((c) => c.id)).toEqual(['dm-new', 'c1']);
    });

    it('refetches once when the channel joins again, then stops polling', async () => {
      getChats.mockResolvedValue({ data: [chat('c1')], error: null });
      const { result } = renderHook(() => useChats());
      await flush();
      await act(async () => { rt.onStatus?.('SUBSCRIBED'); });
      await act(async () => { rt.onStatus?.('CLOSED'); });
      getChats.mockResolvedValue({ data: [chat('dm-new'), chat('c1')], error: null });
      await act(async () => { rt.onStatus?.('SUBSCRIBED'); });
      await flush();
      expect(result.current.chats.map((c) => c.id)).toEqual(['dm-new', 'c1']);
      const calls = getChats.mock.calls.length;
      await flush(CHAT_LIST_FALLBACK_POLL_MS * 4);
      expect(getChats.mock.calls.length).toBe(calls);
    });
  });
});
