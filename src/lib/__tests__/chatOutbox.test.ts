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

import { CHAT_OUTBOX_PREFIX, chatOutboxKey, clearOfflineCache, syncCachedRoles } from '../offline/storage';
import { beginChatSend, dropRefusedOutsideChats, discardChatOutbox, holdUnsavedChatMessage, flushChatOutbox, putChatOutbox, listChatOutbox, dropChatOutbox, CHAT_OUTBOX_EVENT } from '../chatOutbox';
import settingsView from '@/app/views/SettingsView.tsx?raw';
import authenticatedApp from '@/app/AuthenticatedApp.tsx?raw';
import { APP_TOAST_EVENT, showAppToast } from '../appToast';
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
  // Pinned byte for byte: #292 (src/lib/offline/storage.ts, `CHAT_OUTBOX_PREFIX`
  // and `readChatOutboxCount(uid)`) reads this key, keeps it at sign-out,
  // erases it on account deletion and counts an array of
  // { chatId, clientId, body, createdAt } in its sign-out sheet. Change the key
  // or the shape only together with #292's helper.
  it('stores exactly { chatId, clientId, body, createdAt } under bw:chat_outbox:<uid>', async () => {
    await putChatOutbox('u-a', item(1));
    expect(CHAT_OUTBOX_PREFIX).toBe('bw:chat_outbox:');
    expect(chatOutboxKey('u-a')).toBe('bw:chat_outbox:u-a');
    expect(JSON.parse(localStorage.getItem('bw:chat_outbox:u-a')!)).toEqual([item(1)]);
    await dropChatOutbox('u-a', 'cid-1');
    expect(localStorage.getItem('bw:chat_outbox:u-a')).toBeNull();
  });

  it('back online with the chat closed: sent once, with its client id', async () => {
    await putChatOutbox('u-a', item(1));
    h.send.mockResolvedValue(saved(1));
    renderHook(() => useChatOutboxFlush('u-a'));
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await act(async () => {});
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith('c1', 'message 1', 'text', undefined, 'cid-1', 'u-a');
    expect(await listChatOutbox('u-a')).toEqual([]);
  });

  it('two flushes at once send it once', async () => {
    await putChatOutbox('u-a', item(1));
    h.send.mockResolvedValue(saved(1));
    await Promise.all([flushChatOutbox('u-a'), flushChatOutbox('u-a')]);
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('a refusal: kept as "Not sent" with the reason, never sent again by itself', async () => {
    await putChatOutbox('u-a', item(1));
    h.send.mockResolvedValue({ data: null, error: new h.Rule('You can only message in bands you are an active member of.') });
    const seen: unknown[] = [];
    window.addEventListener(CHAT_OUTBOX_EVENT, (e) => seen.push((e as CustomEvent).detail));
    const r = await flushChatOutbox('u-a');
    expect(r.refused).toEqual([{ chatId: 'c1', clientId: 'cid-1', reason: 'You can only message in bands you are an active member of.', denied: true }]);
    expect(await listChatOutbox('u-a')).toEqual([{ ...item(1), refused: 'You can only message in bands you are an active member of.' }]);
    expect(seen).toHaveLength(1);
    await flushChatOutbox('u-a');
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("after a refusal, A's outbox is not sent while B is signed in", async () => {
    await putChatOutbox('u-a', item(1));
    h.send.mockResolvedValueOnce({ data: null, error: new h.Rule('No.') });
    await flushChatOutbox('u-a');
    await putChatOutbox('u-a', item(2));
    h.uid = 'u-b';
    await flushChatOutbox('u-a');
    renderHook(() => useChatOutboxFlush('u-b'));
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect((await listChatOutbox('u-a')).map((x) => x.clientId)).toEqual(['cid-1', 'cid-2']);
    expect(await listChatOutbox('u-b')).toEqual([]);
  });

  it('a lost reply is retried with the same client id (the server keeps one copy)', async () => {
    await putChatOutbox('u-a', item(1));
    h.send.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    await flushChatOutbox('u-a');
    expect(await listChatOutbox('u-a')).toEqual([item(1)]);
    h.send.mockResolvedValueOnce(saved(1));
    await flushChatOutbox('u-a');
    expect(h.send.mock.calls.map((c) => c[4])).toEqual(['cid-1', 'cid-1']);
    expect(await listChatOutbox('u-a')).toEqual([]);
  });

  it('a hiccup (not a refusal) keeps it waiting, oldest first', async () => {
    await putChatOutbox('u-a', item(2));
    await putChatOutbox('u-a', item(1));
    h.send.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } });
    await flushChatOutbox('u-a', { backoffMs: [0, 0] });
    expect(h.send.mock.calls[0][4]).toBe('cid-1');
    expect(await listChatOutbox('u-a')).toHaveLength(2);
  });

  // Claude #291 CR6 M4: one message that keeps failing (not a refusal, not
  // the network) no longer holds every other chat back. It is tried 3 times
  // with a pause; then its chat waits (order in a chat holds) and the others go.
  it('a message that keeps failing: 3 tries, then the other chats still go', async () => {
    await putChatOutbox('u-a', item(1, 'stuck'));
    await putChatOutbox('u-a', item(2, 'stuck'));
    await putChatOutbox('u-a', item(3, 'c2'));
    h.send.mockImplementation(async (chatId: string) =>
      chatId === 'stuck' ? { data: null, error: { code: '57014', message: 'timeout' } } : saved(3));
    const r = await flushChatOutbox('u-a', { backoffMs: [0, 0] });
    expect(h.send.mock.calls.map((c) => c[4])).toEqual(['cid-1', 'cid-1', 'cid-1', 'cid-3']);
    expect(r.sent.map((x) => x.clientId)).toEqual(['cid-3']);
    expect((await listChatOutbox('u-a')).map((x) => x.clientId)).toEqual(['cid-1', 'cid-2']);
  });

  it('the network goes: the flush stops at once (no retries)', async () => {
    await putChatOutbox('u-a', item(1, 'c1'));
    await putChatOutbox('u-a', item(2, 'c2'));
    h.send.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });
    await flushChatOutbox('u-a', { backoffMs: [0, 0] });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  // Claude review #291 round 8, finding 2: a message that could not go on
  // the device is held in memory as "Not sent" for its chat.
  it('a message held in memory shows as "Not sent", is never sent by itself, and goes with Delete', async () => {
    holdUnsavedChatMessage('u-a', { ...item(7), refused: 'Couldn’t save this message offline: it hasn’t been sent.' });
    expect((await listChatOutbox('u-a')).map((x) => [x.clientId, x.refused])).toEqual([['cid-7', 'Couldn’t save this message offline: it hasn’t been sent.']]);
    expect(await listChatOutbox('u-b')).toEqual([]);
    await flushChatOutbox('u-a', { backoffMs: [0, 0] });
    expect(h.send).not.toHaveBeenCalled();
    await dropChatOutbox('u-a', 'cid-7');
    expect(await listChatOutbox('u-a')).toEqual([]);
  });

  it('held in memory, then kept on the device: listed once; a deleted account loses both', async () => {
    holdUnsavedChatMessage('u-a', { ...item(8), refused: '' });
    expect(await putChatOutbox('u-a', item(8))).toBe(true);
    expect((await listChatOutbox('u-a')).map((x) => x.clientId)).toEqual(['cid-8']);
    holdUnsavedChatMessage('u-a', { ...item(9), refused: '' });
    await discardChatOutbox('u-a');
    expect(await listChatOutbox('u-a')).toEqual([]);
  });

  it('a toast from anywhere reaches the app\'s toast', () => {
    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(APP_TOAST_EVENT, on);
    showAppToast('Message not saved on this phone: hi', 'error');
    window.removeEventListener(APP_TOAST_EVENT, on);
    expect(seen).toEqual([{ message: 'Message not saved on this phone: hi', type: 'error' }]);
    expect(authenticatedApp).toMatch(/window\.addEventListener\(APP_TOAST_EVENT, onToast\)/);
    expect(authenticatedApp).toMatch(/setSaveToast\(\{ message: d\.message, type: d\.type/);
  });

  // Codex #291 r7 B5: sign-out keeps the waiting chat outbox (per account,
  // as #292); a deleted account's goes.
  it('sign-out (the offline cache wipe) keeps every account\'s chat outbox; a role change too', async () => {
    await putChatOutbox('u-a', item(1));
    await putChatOutbox('u-b', item(2));
    localStorage.setItem('bw:u-a:global:chats_list', '[]');
    await clearOfflineCache();
    expect(localStorage.getItem('bw:u-a:global:chats_list')).toBeNull();
    expect((await listChatOutbox('u-a')).map((x) => x.clientId)).toEqual(['cid-1']);
    expect((await listChatOutbox('u-b')).map((x) => x.clientId)).toEqual(['cid-2']);
    await syncCachedRoles('u-a', { b1: 'member' });
    expect((await listChatOutbox('u-a')).map((x) => x.clientId)).toEqual(['cid-1']);
  });

  it('a deleted account: its chat outbox goes, nobody else\'s', async () => {
    await putChatOutbox('u-a', item(1));
    await putChatOutbox('u-b', item(2));
    await discardChatOutbox('u-a');
    expect(await listChatOutbox('u-a')).toEqual([]);
    expect((await listChatOutbox('u-b')).map((x) => x.clientId)).toEqual(['cid-2']);
    // Settings › Delete account runs it before signing out.
    const del = settingsView.slice(settingsView.indexOf('const handleDeleteAccount'));
    expect(del.indexOf('discardChatOutbox(user?.id)')).toBeGreaterThan(0);
    expect(del.indexOf('discardChatOutbox(user?.id)')).toBeLessThan(del.indexOf('await signOut('));
  });

  // Codex #291 r7 B6: storage full or blocked: the caller learns it.
  it('a write that storage refuses says so', async () => {
    const real = localStorage.setItem.bind(localStorage);
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
      if (k.startsWith('bw:chat_outbox:')) throw new DOMException('full', 'QuotaExceededError');
      return real(k, v);
    });
    try {
      expect(await putChatOutbox('u-a', item(1))).toBe(false);
    } finally {
      spy.mockRestore();
    }
    expect(await putChatOutbox('u-a', item(1))).toBe(true);
  });

  it('a Delete while its send is refused never brings it back', async () => {
    await putChatOutbox('u-a', item(1));
    h.send.mockImplementation(async () => {
      await dropChatOutbox('u-a', 'cid-1');
      return { data: null, error: new h.Rule('No.') };
    });
    await flushChatOutbox('u-a', { backoffMs: [0, 0] });
    expect(await listChatOutbox('u-a')).toEqual([]);
  });

  // Claude #291 CR6 M5: another tab's change is never written over: every
  // read-modify-write holds the Web Lock 'bw-chat-outbox' when there is one.
  it("every outbox change holds the 'bw-chat-outbox' Web Lock", async () => {
    const names: string[] = [];
    let held = 0;
    let overlap = false;
    const request = vi.fn(async (name: string, cb: () => Promise<unknown>) => {
      names.push(name);
      if (held) overlap = true;
      held += 1;
      try { return await cb(); } finally { held -= 1; }
    });
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
    try {
      await Promise.all([putChatOutbox('u-a', item(1)), putChatOutbox('u-a', item(2)), listChatOutbox('u-a')]);
      await dropChatOutbox('u-a', 'cid-1');
      await dropRefusedOutsideChats('u-a', ['c1']);
      expect(names.length).toBe(5);
      expect(new Set(names)).toEqual(new Set(['bw-chat-outbox']));
      expect(overlap).toBe(false);
      expect((await listChatOutbox('u-a')).map((x) => x.clientId)).toEqual(['cid-2']);
    } finally {
      delete (navigator as { locks?: unknown }).locks;
    }
  });

  it('without Web Locks the outbox works as before', async () => {
    expect((navigator as { locks?: unknown }).locks).toBeUndefined();
    await putChatOutbox('u-a', item(1));
    expect((await listChatOutbox('u-a')).map((x) => x.clientId)).toEqual(['cid-1']);
  });
  // Claude #291 r5: someone else signs in while A's outbox is going out.
  it("the account changes mid-flush: the rest of A's outbox stays, unsent", async () => {
    await putChatOutbox('u-a', item(1));
    await putChatOutbox('u-a', item(2));
    h.send.mockImplementationOnce(async () => { h.uid = 'u-b'; return saved(1); });
    await flushChatOutbox('u-a');
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(await listChatOutbox('u-a')).toEqual([item(2)]);
  });

  // Claude #291 r5 (5): a flush waits while the chat on screen is sending.
  it('a flush waits for a send from the chat on screen, then goes', async () => {
    await putChatOutbox('u-a', item(1));
    h.send.mockResolvedValue(saved(1));
    const release = beginChatSend();
    const done = flushChatOutbox('u-a');
    await new Promise((r) => setTimeout(r, 20));
    expect(h.send).not.toHaveBeenCalled();
    release();
    await done;
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  // Main (#292 Claude r5 M3): one key, one storage, owned by #292. The chat
  // never touches it directly: chatOutbox.ts goes through #292's helpers in
  // src/lib/offline/storage.ts (a byte-identical copy of #292's block).
  it("only #292's helpers touch the key", async () => {
    const NODE_FS = 'node:fs';
    const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync: (path: string, enc: 'utf8') => string };
    const { process } = globalThis as unknown as { process: { cwd(): string } };
    const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, 'utf8');
    for (const f of ['src/app/components/chat/ChatDetailModal.tsx', 'src/app/hooks/useChatOutbox.ts']) {
      expect(read(f)).not.toMatch(/localStorage|indexedDB|chat_outbox:|chatOutboxKey/);
    }
    const src = read('src/lib/chatOutbox.ts');
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/localStorage|indexedDB|chat_outbox:|chatOutboxKey|CHAT_OUTBOX_PREFIX/);
    expect(code).toMatch(/from '\.\/offline\/storage'/);
  });
  // Claude #291 r5 (5): the writer goes to sendMessage, which refuses to
  // send as anyone else.
  it('each send names its writer', async () => {
    await putChatOutbox('u-a', item(1));
    h.send.mockResolvedValue(saved(1));
    await flushChatOutbox('u-a');
    expect(h.send.mock.calls[0][5]).toBe('u-a');
  });

  // Claude #291 r5 (4): a "Not sent" message for a chat that is no longer
  // in the list goes; a waiting one stays, whatever its chat.
  it('the chat list without a chat: its refused messages go, waiting ones stay', async () => {
    await putChatOutbox('u-a', { ...item(1, 'gone'), refused: 'You no longer have access to this chat.' });
    await putChatOutbox('u-a', item(2, 'gone'));
    await putChatOutbox('u-a', { ...item(3, 'c1'), refused: '' });
    await dropRefusedOutsideChats('u-a', ['c1']);
    expect((await listChatOutbox('u-a')).map((x) => x.clientId)).toEqual(['cid-2', 'cid-3']);
  });
});
