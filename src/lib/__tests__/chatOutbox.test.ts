import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

// Main (#291 r4): a chat message written offline is kept on the device
// (`bw:chat_outbox:<uid>`, format agreed with #292) and sent once, with the
// chat closed too, only by the account that wrote it.
const h = vi.hoisted(() => ({
  send: vi.fn(),
  uid: 'u-a' as string | null,
  Rule: class ChatRuleError extends Error {},
}));
vi.mock('@/lib/services/chats', () => ({
  sendMessage: h.send,
  chatErrorMessage: (e: unknown, fallback: string) => (e instanceof h.Rule ? e.message : fallback),
}));
vi.mock('@/lib/supabase', () => ({ getSafeUser: async () => ({ data: { user: h.uid ? { id: h.uid } : null } }) }));

import { chatOutboxKey, flushChatOutbox, putChatOutbox, readChatOutbox, dropChatOutbox, CHAT_OUTBOX_EVENT } from '../chatOutbox';
import { useChatOutboxFlush } from '@/app/hooks/useChatOutbox';

const item = (n: number, chatId = 'c1') => ({ chatId, clientId: `cid-${n}`, body: `message ${n}`, createdAt: `2026-11-22T10:0${n}:00.000Z` });
const saved = (n: number) => ({ data: { id: `m${n}`, chat_id: 'c1', sender_id: 'u-a', content: `message ${n}`, created_at: 'x' }, error: null });

beforeEach(() => {
  cleanup();
  localStorage.clear();
  h.send.mockReset();
  h.uid = 'u-a';
});

describe('chat outbox', () => {
  it('stores exactly { chatId, clientId, body, createdAt } under bw:chat_outbox:<uid>', () => {
    putChatOutbox('u-a', item(1));
    expect(chatOutboxKey('u-a')).toBe('bw:chat_outbox:u-a');
    expect(JSON.parse(localStorage.getItem('bw:chat_outbox:u-a')!)).toEqual([item(1)]);
    dropChatOutbox('u-a', 'cid-1');
    expect(localStorage.getItem('bw:chat_outbox:u-a')).toBeNull();
  });

  it('back online with the chat closed: sent once, with its client id', async () => {
    putChatOutbox('u-a', item(1));
    h.send.mockResolvedValue(saved(1));
    renderHook(() => useChatOutboxFlush('u-a'));
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await act(async () => {});
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith('c1', 'message 1', 'text', undefined, 'cid-1');
    expect(readChatOutbox('u-a')).toEqual([]);
  });

  it('two flushes at once send it once', async () => {
    putChatOutbox('u-a', item(1));
    h.send.mockResolvedValue(saved(1));
    await Promise.all([flushChatOutbox('u-a'), flushChatOutbox('u-a')]);
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('a refusal: kept as "Not sent" with the reason, never sent again by itself', async () => {
    putChatOutbox('u-a', item(1));
    h.send.mockResolvedValue({ data: null, error: new h.Rule('You can only message in bands you are an active member of.') });
    const seen: unknown[] = [];
    window.addEventListener(CHAT_OUTBOX_EVENT, (e) => seen.push((e as CustomEvent).detail));
    const r = await flushChatOutbox('u-a');
    expect(r.refused).toEqual([{ chatId: 'c1', clientId: 'cid-1', reason: 'You can only message in bands you are an active member of.' }]);
    expect(readChatOutbox('u-a')).toEqual([{ ...item(1), refused: 'You can only message in bands you are an active member of.' }]);
    expect(seen).toHaveLength(1);
    await flushChatOutbox('u-a');
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("after a refusal, A's outbox is not sent while B is signed in", async () => {
    putChatOutbox('u-a', item(1));
    h.send.mockResolvedValueOnce({ data: null, error: new h.Rule('No.') });
    await flushChatOutbox('u-a');
    putChatOutbox('u-a', item(2));
    h.uid = 'u-b';
    await flushChatOutbox('u-a');
    renderHook(() => useChatOutboxFlush('u-b'));
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(readChatOutbox('u-a').map((x) => x.clientId)).toEqual(['cid-1', 'cid-2']);
    expect(readChatOutbox('u-b')).toEqual([]);
  });

  it('a lost reply is retried with the same client id (the server keeps one copy)', async () => {
    putChatOutbox('u-a', item(1));
    h.send.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    await flushChatOutbox('u-a');
    expect(readChatOutbox('u-a')).toEqual([item(1)]);
    h.send.mockResolvedValueOnce(saved(1));
    await flushChatOutbox('u-a');
    expect(h.send.mock.calls.map((c) => c[4])).toEqual(['cid-1', 'cid-1']);
    expect(readChatOutbox('u-a')).toEqual([]);
  });

  it('a hiccup (not a refusal) keeps it waiting, oldest first', async () => {
    putChatOutbox('u-a', item(2));
    putChatOutbox('u-a', item(1));
    h.send.mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'timeout' } });
    await flushChatOutbox('u-a');
    expect(h.send.mock.calls[0][4]).toBe('cid-1');
    expect(readChatOutbox('u-a')).toHaveLength(2);
  });
});
