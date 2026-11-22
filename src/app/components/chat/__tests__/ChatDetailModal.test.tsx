import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, cleanup, screen, fireEvent } from '@testing-library/react';

const rt = vi.hoisted(() => ({
  onMessage: null as null | ((m: any) => void),
  opts: null as null | { onStatus?: (s: string) => void },
}));
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
  chatErrorMessage: (_e: unknown, fallback: string) => fallback,
}));
vi.mock('@/lib/supabase', () => {
  const b: any = new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === 'then') {
        const p = Promise.resolve({ data: null, error: null });
        return p.then.bind(p);
      }
      return b;
    },
    apply: () => b,
  });
  return { supabase: new Proxy({}, { get: () => () => b }) };
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
      await act(async () => { first.resolve({ data: null, error: new Error('Failed to fetch') }); });
      await settle();
      expect(input().value).toBe('message B, half typed');
      expect(screen.getByText('message A')).toBeTruthy();
      expect(screen.getByText('Not sent')).toBeTruthy();

      const saved = { ...msg(200, 'me'), content: 'message A' };
      svc.sendMessage.mockResolvedValueOnce({ data: saved, error: null });
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await settle();
      expect(svc.sendMessage).toHaveBeenLastCalledWith('c1', 'message A', 'text', undefined);
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
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
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
