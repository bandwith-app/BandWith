import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, cleanup, screen, fireEvent } from '@testing-library/react';

const rt = vi.hoisted(() => ({
  onMessage: null as null | ((m: any) => void),
  opts: null as null | { onStatus?: (s: string) => void },
}));
// What every direct supabase query in the modal resolves to (band checks).
const sb = vi.hoisted(() => ({ result: { data: null, error: null } as { data: unknown; error: unknown } }));
const rule = vi.hoisted(() => ({ Err: class ChatRuleError extends Error {}, Sender: class ChatSenderChangedError extends Error {} }));
// Who the session says is signed in (getSafeUser).
const who = vi.hoisted(() => ({ id: 'me' as string | null }));
const svc = vi.hoisted(() => ({
  getMessages: vi.fn(),
  getChat: vi.fn(),
  getChatParticipants: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('@/lib/services/chats', () => ({
  getMessages: svc.getMessages,
  getChat: svc.getChat,
  getChatParticipants: svc.getChatParticipants,
  sendMessage: svc.sendMessage,
  markChatAsRead: vi.fn(async () => ({})),
  subscribeToChat: (_id: string, onMessage: (m: any) => void, opts?: any) => {
    rt.onMessage = onMessage;
    rt.opts = opts ?? null;
    return () => {};
  },
  subscribeToReceipts: () => () => {},
  deleteChat: vi.fn(async () => ({ error: null })),
  receiptFor: () => 'sent',
  chatErrorMessage: (e: unknown, fallback: string) => (e instanceof rule.Err ? e.message : fallback),
  isOffTheGig: (s: string | null | undefined) => ['declined', 'dropped_out', 'removed'].includes((s ?? '').trim().toLowerCase()),
  ACTIVE_MEMBER: 'is_active.is.null,is_active.eq.true',
  ChatSenderChangedError: rule.Sender,
}));
vi.mock('@/lib/supabase', () => {
  const b: any = new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === 'then') {
        const p = Promise.resolve(sb.result);
        return p.then.bind(p);
      }
      return b;
    },
    apply: () => b,
  });
  return { supabase: new Proxy({}, { get: () => () => b }), getSafeUser: async () => ({ data: { user: who.id ? { id: who.id } : null } }) };
});
vi.mock('@/lib/services/notifications', () => ({ markChatNotificationsAsRead: vi.fn() }));
vi.mock('@/lib/services/activeChatTracker', () => ({ setActiveChat: vi.fn() }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('@/lib/services/presence', () => ({ useOnlinePresence: () => new Set<string>() }));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { ChatDetailModal } from '../ChatDetailModal';
import { CHAT_FALLBACK_POLL_MS } from '@/lib/chatSync';
import type { Message } from '@/lib/services/chats';

const msg = (i: number, sender = 'u1'): Message => ({
  id: `m${i}`,
  chat_id: 'c1',
  sender_id: sender,
  content: `message ${i}`,
  message_type: 'text',
  edited: false,
  deleted: false,
  created_at: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(),
  sender: { id: sender, full_name: 'Leo M.' },
});
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, k) => msg(a + k));

let latest: Message[];
let older: Message[];
const scrollSpy = vi.fn();

const directProp = { id: 'c1', type: 'direct' as const, name: 'Chat', initials: 'CH', unread: 0 };
const participant = (id: string, name: string) => ({ user_id: id, profile: { full_name: name } });

beforeEach(() => {
  vi.useFakeTimers();
  latest = range(50, 100);
  older = range(0, 50);
  svc.getMessages.mockReset().mockImplementation(async (_id: string, opts?: { before?: string }) => ({
    data: opts?.before ? older.filter((m) => m.created_at < opts.before!) : latest,
    error: null,
  }));
  svc.getChat.mockReset().mockResolvedValue({
    data: { id: 'c1', type: 'direct', participants: [participant('me', 'Me'), participant('u1', 'Leo M.')] },
    error: null,
  });
  svc.getChatParticipants.mockReset().mockResolvedValue({ data: [participant('me', 'Me'), participant('u1', 'Leo M.')] });
  svc.sendMessage.mockReset().mockResolvedValue({ data: null, error: null });
  scrollSpy.mockReset();
  sb.result = { data: null, error: null };
  who.id = 'me';
  try { localStorage.clear(); } catch { /* none */ }
  rt.onMessage = null;
  rt.opts = null;
  Element.prototype.scrollIntoView = scrollSpy;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const settle = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('ChatDetailModal', () => {
  it('does not jump to the bottom on a poll that brings nothing new', async () => {
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    const afterLoad = scrollSpy.mock.calls.length;
    expect(afterLoad).toBeGreaterThan(0);
    await settle(CHAT_FALLBACK_POLL_MS + 100);
    await settle(CHAT_FALLBACK_POLL_MS + 100);
    expect(scrollSpy.mock.calls.length).toBe(afterLoad);
  });

  it('follows a new message when the reader is at the bottom', async () => {
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    const afterLoad = scrollSpy.mock.calls.length;
    latest = range(51, 101);
    await settle(CHAT_FALLBACK_POLL_MS + 100);
    expect(screen.getByText('message 100')).toBeTruthy();
    expect(scrollSpy.mock.calls.length).toBeGreaterThan(afterLoad);
  });

  it('loads messages older than the last 50 and keeps them through the poll', async () => {
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    expect(screen.queryByText('message 10')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /load earlier messages/i }));
    await settle();
    expect(svc.getMessages).toHaveBeenLastCalledWith('c1', { limit: 50, before: msg(50).created_at });
    expect(screen.getByText('message 10')).toBeTruthy();

    await settle(CHAT_FALLBACK_POLL_MS + 100);
    expect(screen.getByText('message 10')).toBeTruthy();
    expect(screen.getByText('message 99')).toBeTruthy();
  });

  it('hides "Load earlier messages" when the whole history fits', async () => {
    latest = range(0, 12);
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    expect(screen.queryByRole('button', { name: /load earlier messages/i })).toBeNull();
  });

  it('a band chat opened as "direct" (push, inbox) shows as a band chat', async () => {
    svc.getChat.mockResolvedValue({
      data: { id: 'c1', type: 'band', band_id: 'b1', participants: [participant('me', 'Me'), participant('u1', 'Leo M.')] },
      error: null,
    });
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    await settle(CHAT_FALLBACK_POLL_MS + 100);
    expect(screen.getByText(/BAND ·/)).toBeTruthy();
    expect(screen.queryByText(/DM ·/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Leo M.' })).toBeNull();
  });

  // No band check to pass in these: the composer stays open.
  const openComposer = () =>
    svc.getChat.mockResolvedValue({ data: { id: 'c1', type: 'direct', participants: [participant('me', 'Me')] }, error: null });

  it('another chat in the same screen starts with an empty composer', async () => {
    openComposer();
    const { rerender } = render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    const input = screen.getByRole('textbox', { name: 'Message' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'draft for Leo' } });
    expect(input.value).toBe('draft for Leo');
    rerender(<ChatDetailModal chat={{ ...directProp, id: 'c2' }} onClose={() => {}} />);
    await settle();
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLInputElement).value).toBe('');
  });

  it('says the messages could not be loaded instead of "No messages yet"', async () => {
    svc.getMessages.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    expect(screen.getByText('Could not load the messages')).toBeTruthy();
    expect(screen.queryByText('No messages yet')).toBeNull();
  });

  it('a chat the user can no longer open locks the composer', async () => {
    svc.getChat.mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    expect(screen.getByText('You no longer have access to this chat.')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
  });

  it('a message that was not sent says so and keeps the text', async () => {
    openComposer();
    svc.sendMessage.mockResolvedValue({ data: null, error: new Error('permission denied for table messages') });
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    const input = screen.getByRole('textbox', { name: 'Message' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('Message not sent. Try again.');
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLInputElement).value).toBe('hello');
    expect(screen.queryByText(/permission denied/)).toBeNull();
  });

  // Claude review #291 r4: the text went back into the composer after a
  // timeout; sending it again must not make a second copy.
  it('resending the same text from the composer reuses its client id', async () => {
    openComposer();
    svc.sendMessage.mockResolvedValueOnce({ data: null, error: new Error('upstream request timeout') });
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    const input = () => screen.getByRole('textbox', { name: 'Message' }) as HTMLInputElement;
    fireEvent.change(input(), { target: { value: 'see you at 8' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await settle();
    expect(input().value).toBe('see you at 8');
    svc.sendMessage.mockResolvedValueOnce({ data: { ...msg(201, 'me'), content: 'see you at 8' }, error: null });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await settle();
    const calls = svc.sendMessage.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][4]).toBe(calls[0][4]);
    // A different message gets a new one.
    svc.sendMessage.mockResolvedValueOnce({ data: { ...msg(202, 'me'), content: 'and bring the cables' }, error: null });
    fireEvent.change(input(), { target: { value: 'and bring the cables' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await settle();
    expect(svc.sendMessage.mock.calls[2][4]).not.toBe(calls[0][4]);
  });

  // Claude #291 CR6 M4: the text is on the device before the first try,
  // so a send that hangs and an app that is closed lose nothing; once saved
  // it leaves.
  it('a send that hangs: the message is already kept on the device', async () => {
    openComposer();
    let answer: (v: unknown) => void = () => {};
    svc.sendMessage.mockImplementation(() => new Promise((r) => { answer = r; }));
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    const input = screen.getByRole('textbox', { name: 'Message' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'gate code 4417' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await settle();
    expect(svc.sendMessage).toHaveBeenCalledTimes(1);
    const kept = JSON.parse(localStorage.getItem('bw:chat_outbox:me') ?? '[]');
    expect(kept).toEqual([expect.objectContaining({ chatId: 'c1', body: 'gate code 4417', clientId: svc.sendMessage.mock.calls[0][4] })]);
    expect(kept[0].refused).toBeUndefined();
    // It answers at last: saved, gone from the device (and no send stays open).
    await act(async () => { answer({ data: { ...msg(204, 'me'), content: 'gate code 4417', client_id: kept[0].clientId }, error: null }); });
    await settle();
    expect(localStorage.getItem('bw:chat_outbox:me')).toBeNull();
  });

  it('saved: it leaves the device', async () => {
    openComposer();
    svc.sendMessage.mockResolvedValue({ data: { ...msg(205, 'me'), content: 'on my way' }, error: null });
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    const input = screen.getByRole('textbox', { name: 'Message' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'on my way' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await settle();
    expect(localStorage.getItem('bw:chat_outbox:me')).toBeNull();
  });

  // Codex review #291: a bubble not saved yet (sending, or "Not sent") had
  // Reply, and replying sent its temp id as reply_to_id (not a UUID).
  it('a message that is not saved cannot be replied to', async () => {
    openComposer();
    let fail: (v: unknown) => void = () => {};
    svc.sendMessage.mockImplementation(() => new Promise((res) => { fail = res; }));
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    const replies = () => screen.queryAllByRole('button', { name: 'Reply to message' }).length;
    const saved = replies();
    const input = screen.getByRole('textbox', { name: 'Message' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await settle();
    expect(screen.getByText('hello')).toBeTruthy();
    expect(replies()).toBe(saved);
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'new draft' } });
    await act(async () => { fail({ data: null, error: new Error('upstream request timeout') }); });
    await settle();
    expect(screen.getByText('Not sent')).toBeTruthy();
    expect(replies()).toBe(saved);
  });

  // Claude review #291 (a11y): "Not sent" is announced, and its buttons say
  // which message they act on.
  it('a message that was not sent is announced, and its buttons name it', async () => {
    openComposer();
    let fail: (v: unknown) => void = () => {};
    svc.sendMessage.mockImplementation(() => new Promise((res) => { fail = res; }));
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    const input = screen.getByRole('textbox', { name: 'Message' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Load-in moved to 5:30 at the side door, bring the long cables' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await settle();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'new draft' } });
    await act(async () => { fail({ data: null, error: new Error('upstream request timeout') }); });
    await settle();
    const status = screen.getAllByRole('status').find((el) => el.textContent?.includes('Not sent'));
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('button', { name: 'Try again: Load-in moved to 5:30 at the side door…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete unsent message: Load-in moved to 5:30 at the side door…' })).toBeTruthy();
  });

  // Egress: with Realtime connected the open chat must not re-download the
  // last 50 messages on a timer (it did every 3 s: ~1,200 requests an hour).
  describe('Realtime first, slow poll only when the channel is down', () => {
    const connect = async () => {
      await act(async () => { rt.opts?.onStatus?.('SUBSCRIBED'); });
      await settle();
    };

    it('makes no message requests for a minute while Realtime is connected', async () => {
      render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
      await settle();
      await connect();
      const afterJoin = svc.getMessages.mock.calls.length;
      await settle(60_000);
      expect(svc.getMessages.mock.calls.length).toBe(afterJoin);
    });

    it('catches up once when the channel joins, so nothing sent meanwhile is lost', async () => {
      render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
      await settle();
      const beforeJoin = svc.getMessages.mock.calls.length;
      latest = range(51, 101);
      await connect();
      expect(svc.getMessages.mock.calls.length).toBe(beforeJoin + 1);
      expect(screen.getByText('message 100')).toBeTruthy();
    });

    it('polls slowly while the channel is down and stops when it is back', async () => {
      render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
      await settle();
      await connect();
      await act(async () => { rt.opts?.onStatus?.('CHANNEL_ERROR'); });
      const atDrop = svc.getMessages.mock.calls.length;
      await settle(CHAT_FALLBACK_POLL_MS * 3 + 100);
      expect(svc.getMessages.mock.calls.length).toBe(atDrop + 3);
      latest = range(52, 102);
      await connect();
      expect(screen.getByText('message 101')).toBeTruthy();
      const back = svc.getMessages.mock.calls.length;
      await settle(60_000);
      expect(svc.getMessages.mock.calls.length).toBe(back);
    });

    it('shows a new message from Realtime right away', async () => {
      render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
      await settle();
      await connect();
      await act(async () => { rt.onMessage?.(msg(100)); });
      expect(screen.getByText('message 100')).toBeTruthy();
    });

    it('catches up when the app comes back to the front', async () => {
      render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
      await settle();
      await connect();
      const before = svc.getMessages.mock.calls.length;
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
      await settle();
      expect(svc.getMessages.mock.calls.length).toBe(before + 1);
    });
  });

  // Audit 07 #5: message A fails while message B is being typed.
  describe('a failed send never eats the next draft', () => {
    const deferred = () => {
      let resolve!: (v: unknown) => void;
      const promise = new Promise((r) => { resolve = r; });
      return { promise, resolve };
    };

    it('keeps B in the composer and A as a "Not sent" bubble with Try again', async () => {
      openComposer();
      const first = deferred();
      svc.sendMessage.mockReturnValueOnce(first.promise);
      render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
      await settle();
      const input = () => screen.getByRole('textbox', { name: 'Message' }) as HTMLInputElement;
      fireEvent.change(input(), { target: { value: 'message A' } });
      fireEvent.keyDown(input(), { key: 'Enter' });
      await settle();
      fireEvent.change(input(), { target: { value: 'message B, half typed' } });
      await act(async () => { first.resolve({ data: null, error: new Error('upstream request timeout') }); });
      await settle();
      expect(input().value).toBe('message B, half typed');
      expect(screen.getByText('message A')).toBeTruthy();
      expect(screen.getByText('Not sent')).toBeTruthy();

      const saved = { ...msg(200, 'me'), content: 'message A' };
      svc.sendMessage.mockResolvedValueOnce({ data: saved, error: null });
      fireEvent.click(screen.getByRole('button', { name: /^Try again: / }));
      await settle();
      expect(svc.sendMessage).toHaveBeenLastCalledWith('c1', 'message A', 'text', undefined, expect.any(String), 'me');
      // Claude review #291 r4: the insert may have landed before the timeout;
      // Try again sends the same client id, so the server keeps one copy.
      const calls = svc.sendMessage.mock.calls;
      expect(calls[calls.length - 1][4]).toBe(calls[0][4]);
      expect(calls[0][4]).toMatch(/^[0-9a-f-]{36}$/);
      expect(screen.queryByText('Not sent')).toBeNull();
      expect(screen.getByText('message A')).toBeTruthy();
      expect(input().value).toBe('message B, half typed');
    });

    it('Delete removes the failed bubble', async () => {
      openComposer();
      const first = deferred();
      svc.sendMessage.mockReturnValueOnce(first.promise);
      render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
      await settle();
      const input = () => screen.getByRole('textbox', { name: 'Message' }) as HTMLInputElement;
      fireEvent.change(input(), { target: { value: 'message A' } });
      fireEvent.keyDown(input(), { key: 'Enter' });
      fireEvent.change(input(), { target: { value: 'B' } });
      await act(async () => { first.resolve({ data: null, error: new Error('permission denied') }); });
      await settle();
      fireEvent.click(screen.getByRole('button', { name: /^Delete unsent message: / }));
      expect(screen.queryByText('message A')).toBeNull();
      expect(input().value).toBe('B');
    });
  });

  // Audit 07 #7: 1–10 on screen, 60 more arrive while the app sleeps.
  it('catching up after a long gap leaves no hole in the history', async () => {
    const history = range(0, 70);
    latest = range(0, 10);
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    expect(screen.getByText('message 9')).toBeTruthy();
    svc.getMessages.mockImplementation(async (_id: string, opts?: { before?: string; after?: string; limit?: number }) => {
      if (opts?.after) return { data: history.filter((m) => m.created_at >= opts.after!).slice(0, opts.limit ?? 50), error: null };
      if (opts?.before) return { data: history.filter((m) => m.created_at < opts.before!).slice(-50), error: null };
      return { data: history.slice(-50), error: null };
    });
    // The channel joins again (reconnect): one catch-up.
    await act(async () => { rt.opts?.onStatus?.('SUBSCRIBED'); });
    await settle();
    for (const i of [9, 10, 15, 19, 20, 69]) expect(screen.getByText(`message ${i}`)).toBeTruthy();
  });

  // Audit 07 #11: the sender keeps the quote once the message is saved.
  it('a sent reply keeps its quote after saving', async () => {
    openComposer();
    latest = range(0, 3);
    svc.sendMessage.mockImplementation(async (_c: string, content: string, _t: string, replyTo?: string) => ({
      data: { ...msg(300, 'me'), content, reply_to_id: replyTo },
      error: null,
    }));
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    fireEvent.click(screen.getAllByRole('button', { name: 'Reply to message' })[0]);
    const input = screen.getByRole('textbox', { name: 'Message' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'yes, two of them' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await settle();
    expect(screen.getByText('yes, two of them')).toBeTruthy();
    // The quote box (black) inside the saved bubble.
    const quotes = [...document.querySelectorAll('.bg-black')].map((el) => el.textContent);
    expect(quotes.some((q) => q?.includes('message 0'))).toBe(true);
  });
});

// Main's decision (#291 r4): offline the chat fails open. The last answer
// kept for this chat and account decides; with none the composer shows and
// the message waits; the server has the last word when it goes out.
describe('ChatDetailModal offline: who may write', () => {
  const bandProp = { id: 'c1', type: 'band' as const, name: 'Velvet Static', initials: 'VS', unread: 0 };
  const bandChat = () =>
    svc.getChat.mockResolvedValue({
      data: { id: 'c1', type: 'band', band_id: 'b1', name: 'Velvet Static', participants: [participant('me', 'Me')] },
      error: null,
    });
  const offline = () => { sb.result = { data: null, error: new Error('Failed to fetch') }; };
  const composer = () => screen.queryByRole('textbox', { name: 'Message' }) as HTMLInputElement | null;
  const bandRule = 'You can only message in bands you are an active member of.';

  it('offline with a kept "yes": the composer shows', async () => {
    const { saveChatPermission } = await import('@/lib/chatPermission');
    await saveChatPermission('me', 'c1', { permitted: true, reason: '' });
    bandChat();
    offline();
    render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    expect(composer()).toBeTruthy();
    expect(screen.queryByText(bandRule)).toBeNull();
  });

  it('offline with a kept "no": the composer stays locked with its reason', async () => {
    const { saveChatPermission } = await import('@/lib/chatPermission');
    await saveChatPermission('me', 'c1', { permitted: false, reason: bandRule });
    bandChat();
    offline();
    render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    expect(composer()).toBeNull();
    expect(screen.getByText(bandRule)).toBeTruthy();
  });

  it('offline with nothing kept: the composer shows, the message waits, the server says no later', async () => {
    bandChat();
    offline();
    svc.sendMessage.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    const input = composer();
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: 'Soundcheck at 6' } });
    fireEvent.keyDown(input!, { key: 'Enter' });
    await settle();
    // Queued: a bubble that waits, never back in the composer.
    expect(screen.getByText('Soundcheck at 6')).toBeTruthy();
    expect(screen.getByText('Waiting for connection')).toBeTruthy();
    expect(composer()!.value).toBe('');

    // Back online: it goes out by itself, same client id; the server refuses.
    svc.sendMessage.mockResolvedValueOnce({ data: null, error: new rule.Err(bandRule) });
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await settle();
    const calls = svc.sendMessage.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][4]).toBe(calls[0][4]);
    expect(screen.getByText('Not sent')).toBeTruthy();
    expect(screen.getAllByText(bandRule).length).toBeGreaterThan(0);
    expect(screen.getByText('Soundcheck at 6')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Try again: Soundcheck at 6/ })).toBeTruthy();
  });

  it('a waiting message that the server takes is sent once', async () => {
    bandChat();
    offline();
    svc.sendMessage.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    fireEvent.change(composer()!, { target: { value: 'On my way' } });
    fireEvent.keyDown(composer()!, { key: 'Enter' });
    await settle();
    svc.sendMessage.mockResolvedValueOnce({ data: { ...msg(300, 'me'), content: 'On my way' }, error: null });
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await settle();
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await settle();
    expect(svc.sendMessage).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Waiting for connection')).toBeNull();
    expect(screen.getAllByText('On my way')).toHaveLength(1);
  });

  it('online, the server\'s "no" replaces a kept "yes"', async () => {
    const { saveChatPermission, readChatPermission } = await import('@/lib/chatPermission');
    await saveChatPermission('me', 'c1', { permitted: true, reason: '' });
    bandChat();
    sb.result = { data: null, error: null };
    render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    expect(composer()).toBeNull();
    expect(screen.getByText(bandRule)).toBeTruthy();
    expect(await readChatPermission('me', 'c1')).toEqual({ permitted: false, reason: bandRule });
  });

  it('online, the server\'s "yes" is kept for next time', async () => {
    const { readChatPermission } = await import('@/lib/chatPermission');
    bandChat();
    sb.result = { data: [{ id: 'bm1', user_id: 'me' }], error: null };
    render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    expect(composer()).toBeTruthy();
    expect(await readChatPermission('me', 'c1')).toEqual({ permitted: true, reason: '' });
  });

  // Main (#291 r4): the text is kept on the device, so closing the chat
  // offline loses nothing; reopened online, it is sent once.
  it('closed offline, reopened online: the waiting message is sent once', async () => {
    bandChat();
    offline();
    svc.sendMessage.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    const first = render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    fireEvent.change(composer()!, { target: { value: 'Running 10 min late' } });
    fireEvent.keyDown(composer()!, { key: 'Enter' });
    await settle();
    expect(screen.getByText('Waiting for connection')).toBeTruthy();
    first.unmount();

    sb.result = { data: [{ id: 'bm1', user_id: 'me' }], error: null };
    svc.sendMessage.mockResolvedValueOnce({ data: { ...msg(400, 'me'), content: 'Running 10 min late' }, error: null });
    render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    await settle();
    const calls = svc.sendMessage.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][4]).toBe(calls[0][4]);
    expect(screen.queryByText('Waiting for connection')).toBeNull();
    expect(screen.getAllByText('Running 10 min late')).toHaveLength(1);
  });

  it('closed offline, reopened while still offline: the message is still there, waiting', async () => {
    bandChat();
    offline();
    svc.sendMessage.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });
    svc.getMessages.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });
    const first = render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    fireEvent.change(composer()!, { target: { value: 'Bring the long cables' } });
    fireEvent.keyDown(composer()!, { key: 'Enter' });
    await settle();
    first.unmount();
    render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    expect(screen.getByText('Bring the long cables')).toBeTruthy();
    expect(screen.getByText('Waiting for connection')).toBeTruthy();
  });

  it('a refused message stays "Not sent" with its reason after the chat is reopened', async () => {
    bandChat();
    offline();
    svc.sendMessage.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    const first = render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    fireEvent.change(composer()!, { target: { value: 'Soundcheck at 6' } });
    fireEvent.keyDown(composer()!, { key: 'Enter' });
    await settle();
    svc.sendMessage.mockResolvedValueOnce({ data: null, error: new rule.Err(bandRule) });
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await settle();
    first.unmount();
    render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    expect(screen.getByText('Soundcheck at 6')).toBeTruthy();
    expect(screen.getByText('Not sent')).toBeTruthy();
    expect(screen.getAllByText(bandRule).length).toBeGreaterThan(0);
    // Not sent again by itself.
    expect(svc.sendMessage).toHaveBeenCalledTimes(2);
  });

  // Codex #291 (B3, ChatDetailModal:700): the loop sent from a snapshot, so a
  // message deleted while the first one was sending still went out.
  it('two waiting messages: the one deleted while the first is sending never goes out', async () => {
    bandChat();
    offline();
    svc.sendMessage.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    svc.sendMessage.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    for (const text of ['First: load-in at 5', 'Second: never mind']) {
      fireEvent.change(composer()!, { target: { value: text } });
      fireEvent.keyDown(composer()!, { key: 'Enter' });
      await settle();
    }
    expect(screen.getAllByText('Waiting for connection')).toHaveLength(2);
    const secondId = svc.sendMessage.mock.calls[1][4];

    let land: (v: unknown) => void = () => {};
    svc.sendMessage.mockImplementationOnce(() => new Promise((res) => { land = res; }));
    svc.sendMessage.mockResolvedValue({ data: { ...msg(501, 'me'), content: 'Second: never mind' }, error: null });
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await settle();
    expect(svc.sendMessage).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: /^Delete unsent message: Second/ }));
    const first = { ...msg(500, 'me'), content: 'First: load-in at 5' };
    latest = [...latest, first]; // the server's page has it from now on
    await act(async () => { land({ data: first, error: null }); });
    await settle();
    await settle();
    const flushed = svc.sendMessage.mock.calls.slice(2).map((c) => c[4]);
    expect(flushed).not.toContain(secondId);
    expect(screen.queryByText('Second: never mind')).toBeNull();
    expect(screen.getAllByText('First: load-in at 5')).toHaveLength(1);
  });

  // Codex #291 r4 (B4): with delivery confirmed by client id only, a row
  // from Realtime without one (database before 192) must not show twice.
  it('a saved message that Realtime brought first shows once', async () => {
    svc.getChat.mockResolvedValue({ data: { id: 'c1', type: 'direct', participants: [participant('me', 'Me')] }, error: null });
    let land: (v: unknown) => void = () => {};
    svc.sendMessage.mockImplementationOnce(() => new Promise((res) => { land = res; }));
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    fireEvent.change(composer()!, { target: { value: 'See you at 8' } });
    fireEvent.keyDown(composer()!, { key: 'Enter' });
    await settle();
    const saved = { ...msg(600, 'me'), content: 'See you at 8' };
    await act(async () => { rt.onMessage?.(saved); });
    await act(async () => { land({ data: saved, error: null }); });
    await settle();
    expect(screen.getAllByText('See you at 8')).toHaveLength(1);
  });
  // Claude #291 r5 (2): never sent as someone else.
  it('another account signed in meanwhile: nothing is sent, the message waits for its writer', async () => {
    svc.getChat.mockResolvedValue({ data: { id: 'c1', type: 'direct', participants: [participant('me', 'Me')] }, error: null });
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    who.id = 'someone-else';
    fireEvent.change(composer()!, { target: { value: 'Set list is final' } });
    fireEvent.keyDown(composer()!, { key: 'Enter' });
    await settle();
    expect(svc.sendMessage).not.toHaveBeenCalled();
    expect(screen.getByText('Waiting for connection')).toBeTruthy();
    const { listChatOutbox } = await import('@/lib/chatOutbox');
    expect((await listChatOutbox('me')).map((x) => x.body)).toEqual(['Set list is final']);
    expect(await listChatOutbox('someone-else')).toEqual([]);
  });

  // Claude #291 r5 (4): the server's no at send time locks the chat.
  it('a send the rule refuses locks the composer and keeps the no', async () => {
    const { readChatPermission } = await import('@/lib/chatPermission');
    bandChat();
    sb.result = { data: [{ id: 'bm1', user_id: 'me' }], error: null };
    svc.sendMessage.mockResolvedValueOnce({ data: null, error: new rule.Err(bandRule) });
    render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    fireEvent.change(composer()!, { target: { value: 'Can I still post?' } });
    fireEvent.keyDown(composer()!, { key: 'Enter' });
    await settle();
    expect(composer()).toBeNull();
    expect(screen.getAllByText(bandRule).length).toBeGreaterThan(0);
    expect(await readChatPermission('me', 'c1')).toEqual({ permitted: false, reason: bandRule });
  });

  // Codex #291 r7 B7: the refusal locks the composer; the text must not go
  // into that hidden composer (and its copy deleted): it stays "Not sent".
  it('a refused send stays in the "Not sent" list, never in the hidden composer', async () => {
    bandChat();
    sb.result = { data: [{ id: 'bm1', user_id: 'me' }], error: null };
    svc.sendMessage.mockResolvedValueOnce({ data: null, error: new rule.Err(bandRule) });
    render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    fireEvent.change(composer()!, { target: { value: 'Setlist for Friday' } });
    fireEvent.keyDown(composer()!, { key: 'Enter' });
    await settle();
    expect(composer()).toBeNull();
    expect(screen.getByText('Setlist for Friday')).toBeTruthy();
    expect(screen.getByText('Not sent')).toBeTruthy();
    const kept = JSON.parse(localStorage.getItem('bw:chat_outbox:me') ?? '[]');
    expect(kept).toEqual([expect.objectContaining({ body: 'Setlist for Friday', refused: bandRule })]);
  });

  // Codex #291 r7 B6: storage full or blocked: nothing waits on the device,
  // so no "Waiting for connection"; the text stays in the composer.
  it('offline with storage full: the text stays in the composer, with a clear message', async () => {
    bandChat();
    offline();
    svc.sendMessage.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    const real = localStorage.setItem.bind(localStorage);
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
      if (k.startsWith('bw:chat_outbox:')) throw new DOMException('full', 'QuotaExceededError');
      return real(k, v);
    });
    try {
      fireEvent.change(composer()!, { target: { value: 'Doors at 7' } });
      fireEvent.keyDown(composer()!, { key: 'Enter' });
      await settle();
      expect(screen.queryByText('Waiting for connection')).toBeNull();
      expect(composer()!.value).toBe('Doors at 7');
      expect(screen.getByText('Couldn’t save this message offline: it hasn’t been sent.')).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it('a send refused by the database (42501) locks the composer too', async () => {
    const { readChatPermission } = await import('@/lib/chatPermission');
    bandChat();
    sb.result = { data: [{ id: 'bm1', user_id: 'me' }], error: null };
    svc.sendMessage.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } });
    render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    fireEvent.change(composer()!, { target: { value: 'Hello?' } });
    fireEvent.keyDown(composer()!, { key: 'Enter' });
    await settle();
    expect(composer()).toBeNull();
    expect(screen.getByText('You no longer have access to this chat.')).toBeTruthy();
    expect(await readChatPermission('me', 'c1')).toEqual({ permitted: false, reason: 'You no longer have access to this chat.' });
  });

  it('a waiting message refused when the network is back locks the chat', async () => {
    bandChat();
    offline();
    svc.sendMessage.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    fireEvent.change(composer()!, { target: { value: 'Soundcheck at 6' } });
    fireEvent.keyDown(composer()!, { key: 'Enter' });
    await settle();
    svc.sendMessage.mockResolvedValueOnce({ data: null, error: new rule.Err(bandRule) });
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await settle();
    expect(composer()).toBeNull();
    expect(screen.getByText('Not sent')).toBeTruthy();
  });

  it('the channel joins again: permission is asked again and a new no locks the chat', async () => {
    bandChat();
    sb.result = { data: [{ id: 'bm1', user_id: 'me' }], error: null };
    render(<ChatDetailModal chat={bandProp} onClose={() => {}} />);
    await settle();
    await act(async () => { rt.opts?.onStatus?.('SUBSCRIBED'); });
    await settle();
    expect(composer()).toBeTruthy();
    // Dropped from the band while the connection was down.
    sb.result = { data: null, error: null };
    await act(async () => { rt.opts?.onStatus?.('CHANNEL_ERROR'); });
    await act(async () => { rt.opts?.onStatus?.('SUBSCRIBED'); });
    await settle();
    expect(composer()).toBeNull();
    expect(screen.getByText(bandRule)).toBeTruthy();
  });
  // Claude #291 r5 (1): the client's off-the-gig set is the server's
  // (trimmed, any case): 'Dropped_Out' never gets a composer the server
  // then refuses (no flip-flop).
  it("'Dropped_Out' on the lineup: the composer stays locked", async () => {
    const evProp = { id: 'c1', type: 'event' as const, name: 'Rooftop Session', initials: 'RS', unread: 0 };
    svc.getChat.mockResolvedValue({
      data: { id: 'c1', type: 'event', band_id: 'b1', event_id: 'g1', name: 'Rooftop Session', participants: [participant('me', 'Me')] },
      error: null,
    });
    // One answer for every lookup: a list (admins) that is also the member's row.
    sb.result = { data: Object.assign([{ user_id: 'u9' }], { role: 'member', status: 'Dropped_Out' }), error: null };
    render(<ChatDetailModal chat={evProp} onClose={() => {}} />);
    await settle();
    expect(composer()).toBeNull();
    expect(screen.getByText('You can only message in events you are participating in.')).toBeTruthy();
    await act(async () => { rt.opts?.onStatus?.('SUBSCRIBED'); });
    await act(async () => { rt.opts?.onStatus?.('SUBSCRIBED'); });
    await settle();
    expect(composer()).toBeNull();
  });

  // Claude #291 r5 (5): the writer goes to sendMessage; if it says someone
  // else is signed in, the message waits for its writer.
  it('the send names its writer; signed in as someone else, it waits', async () => {
    svc.getChat.mockResolvedValue({ data: { id: 'c1', type: 'direct', participants: [participant('me', 'Me')] }, error: null });
    svc.sendMessage.mockResolvedValueOnce({ data: null, error: new rule.Sender('Signed in as someone else') });
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    fireEvent.change(composer()!, { target: { value: 'Parking is on 5th' } });
    fireEvent.keyDown(composer()!, { key: 'Enter' });
    await settle();
    expect(svc.sendMessage.mock.calls[0][5]).toBe('me');
    expect(screen.getByText('Waiting for connection')).toBeTruthy();
    const { listChatOutbox } = await import('@/lib/chatOutbox');
    expect((await listChatOutbox('me')).map((x) => x.body)).toEqual(['Parking is on 5th']);
  });

  // Claude #291 r5 (7): the channel joining is a sign the network is back.
  it('Realtime joins: what waits in the outbox goes, without an online event', async () => {
    const { putChatOutbox } = await import('@/lib/chatOutbox');
    await putChatOutbox('me', { chatId: 'c1', clientId: 'cid-w', body: 'Doors at 7', createdAt: '2026-11-22T10:00:00.000Z' });
    svc.getChat.mockResolvedValue({ data: { id: 'c1', type: 'direct', participants: [participant('me', 'Me')] }, error: null });
    svc.getMessages.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });
    svc.sendMessage.mockResolvedValue({ data: { ...msg(700, 'me'), content: 'Doors at 7', client_id: 'cid-w' }, error: null });
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    expect(svc.sendMessage).not.toHaveBeenCalled();
    await act(async () => { rt.opts?.onStatus?.('SUBSCRIBED'); });
    await settle();
    expect(svc.sendMessage).toHaveBeenCalledTimes(1);
    expect(svc.sendMessage.mock.calls[0][4]).toBe('cid-w');
  });
  // Claude #291 r5 (6): another account's row with the same client id is
  // not this account's message: the waiting one stays.
  it("someone else's saved row with my client id: my waiting message stays", async () => {
    const { putChatOutbox, listChatOutbox } = await import('@/lib/chatOutbox');
    await putChatOutbox('me', { chatId: 'c1', clientId: 'cid-x', body: 'Bring the capo', createdAt: '2026-11-22T10:00:00.000Z' });
    latest = [...range(0, 3), { ...msg(800, 'u1'), content: 'Bring the capo', client_id: 'cid-x' }];
    svc.getChat.mockResolvedValue({ data: { id: 'c1', type: 'direct', participants: [participant('me', 'Me')] }, error: null });
    render(<ChatDetailModal chat={directProp} onClose={() => {}} />);
    await settle();
    expect(screen.getByText('Waiting for connection')).toBeTruthy();
    expect((await listChatOutbox('me')).map((x) => x.clientId)).toEqual(['cid-x']);
  });
});
