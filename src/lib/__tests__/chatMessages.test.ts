import { describe, it, expect } from 'vitest';
import { mergeLatestPage, prependOlder, normalizeChatType, appendIncoming, isReplySwipe, SWIPE_REPLY_PX, catchUpPage, markSendFailed, attachReplies, replyTargetIds } from '../chatMessages';
import type { Message } from '@/lib/services/chats';

const msg = (i: number, over: Partial<Message> = {}): Message => ({
  id: `m${i}`,
  chat_id: 'c1',
  sender_id: 'u1',
  content: `text ${i}`,
  message_type: 'text',
  edited: false,
  deleted: false,
  created_at: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(),
  ...over,
});
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, k) => msg(a + k));
const ids = (list: Message[]) => list.map((m) => m.id);

describe('mergeLatestPage (3 s poll)', () => {
  it('returns the same array when nothing changed, so the list does not re-render or scroll', () => {
    const prev = range(0, 50);
    expect(mergeLatestPage(prev, range(0, 50))).toBe(prev);
  });

  it('appends new messages', () => {
    const next = mergeLatestPage(range(0, 50), range(1, 51));
    expect(ids(next)).toEqual(ids(range(0, 51)));
  });

  it('keeps older messages loaded with "Load earlier messages"', () => {
    const prev = range(0, 100);
    const next = mergeLatestPage(prev, range(51, 101));
    expect(ids(next)).toEqual(ids(range(0, 101)));
  });

  it('takes edits from the server', () => {
    const next = mergeLatestPage(range(0, 3), [msg(0), msg(1, { content: 'fixed', edited: true }), msg(2)]);
    expect(next[1].content).toBe('fixed');
  });

  it('keeps optimistic messages at the end until the server has them', () => {
    const temp = msg(99, { id: 'temp-1', content: 'sending…' });
    const next = mergeLatestPage([...range(0, 2), temp], range(0, 2));
    expect(ids(next)).toEqual(['m0', 'm1', 'temp-1']);
  });

  it('an empty page (chat cleared) empties the list as before', () => {
    expect(mergeLatestPage(range(0, 3), [])).toEqual([]);
  });

  it('hides only the server copy of a pending message, not older messages with the same text', () => {
    const old = msg(0, { content: 'ok', sender_id: 'me' });
    const temp = msg(99, { id: 'temp-1', content: 'ok', sender_id: 'me' });
    const copy = msg(2, { content: 'ok', sender_id: 'me' });
    const next = mergeLatestPage([old, msg(1), temp], [old, msg(1), copy]);
    expect(ids(next)).toEqual(['m0', 'm1', 'temp-1']);
  });

  it("does not hide someone else's message with the same text", () => {
    const temp = msg(99, { id: 'temp-1', content: 'ok', sender_id: 'me' });
    const theirs = msg(2, { content: 'ok', sender_id: 'u1' });
    const next = mergeLatestPage([msg(1), temp], [msg(1), theirs]);
    expect(ids(next)).toEqual(['m1', 'm2', 'temp-1']);
  });
});

describe('appendIncoming (realtime)', () => {
  it("keeps my pending bubble when someone else's message arrives", () => {
    const temp = msg(99, { id: 'temp-1', content: 'hi', sender_id: 'me' });
    const next = appendIncoming([msg(0), temp], msg(1, { content: 'hey', sender_id: 'u1' }));
    expect(ids(next)).toEqual(['m0', 'm1', 'temp-1']);
  });

  it('replaces the pending bubble with its server copy', () => {
    const temp = msg(99, { id: 'temp-1', content: 'hi', sender_id: 'me' });
    const next = appendIncoming([msg(0), temp], msg(1, { content: 'hi', sender_id: 'me' }));
    expect(ids(next)).toEqual(['m0', 'm1']);
  });

  it('ignores a message already in the list', () => {
    const prev = range(0, 3);
    expect(appendIncoming(prev, msg(1))).toBe(prev);
  });
});

describe('prependOlder', () => {
  it('puts the older page first and skips duplicates', () => {
    const next = prependOlder(range(50, 100), range(10, 51));
    expect(ids(next)).toEqual(ids(range(10, 100)));
  });
});

describe('normalizeChatType', () => {
  it('maps the stored chat type to the three the UI knows', () => {
    expect(normalizeChatType('direct')).toBe('direct');
    expect(normalizeChatType('band')).toBe('band');
    expect(normalizeChatType('group')).toBe('band');
    expect(normalizeChatType('event')).toBe('event');
    expect(normalizeChatType(undefined)).toBeNull();
  });
});

describe('isReplySwipe', () => {
  it('answers a message dragged far enough to the right', () => {
    expect(isReplySwipe(SWIPE_REPLY_PX, 4)).toBe(true);
    expect(isReplySwipe(SWIPE_REPLY_PX - 1, 0)).toBe(false);
  });
  it('ignores leftward and mostly vertical drags (scrolling)', () => {
    expect(isReplySwipe(-80, 0)).toBe(false);
    expect(isReplySwipe(60, 90)).toBe(false);
  });
});

// Audit 07 #7: 10 on screen, 60 more arrive while away; the latest page is 20–69.
describe('catchUpPage', () => {
  const history = range(0, 70);
  const after = async (t: string) => history.filter((m) => m.created_at >= t).slice(0, 50);

  it('fetches forward from the newest message on screen until it meets the latest page', async () => {
    const { page, complete } = await catchUpPage(range(0, 10), range(20, 70), after);
    expect(complete).toBe(true);
    expect(ids(mergeLatestPage(range(0, 10), page))).toEqual(ids(history));
  });

  it('nothing to do when the latest page overlaps what is on screen', async () => {
    let calls = 0;
    const page = range(10, 60);
    const res = await catchUpPage(range(0, 30), page, async () => { calls++; return []; });
    expect(res).toEqual({ page, complete: true });
    expect(calls).toBe(0);
  });

  it('too far behind: says so (the chat then shows the latest page only)', async () => {
    const res = await catchUpPage(range(0, 10), range(20, 70), after, 0);
    expect(res.complete).toBe(false);
  });

  // Codex review #291: one Realtime arrival (69) before the refresh made the
  // latest page look connected, and 10–19 never came.
  it('a message that arrived by Realtime does not hide the gap', async () => {
    const prev = [...range(0, 10), msg(69)];
    const { page, complete } = await catchUpPage(prev, range(20, 70), after);
    expect(complete).toBe(true);
    expect(ids(mergeLatestPage(prev, page))).toEqual(ids(history));
  });
});

// Audit 07 #5
describe('failed sends', () => {
  const temp = (over: Partial<Message> = {}) => msg(99, { id: 'temp-1', content: 'message A', ...over });

  it('a failed bubble stays through the poll', () => {
    const prev = markSendFailed([...range(0, 3), temp()], 'temp-1');
    const next = mergeLatestPage(prev, range(0, 3));
    expect(next.find((m) => m.id === 'temp-1')?.failed).toBe(true);
  });

  it('it gives way to its server copy if the message got through after all', () => {
    const prev = markSendFailed([...range(0, 3), temp()], 'temp-1');
    const server = msg(4, { content: 'message A' });
    expect(ids(mergeLatestPage(prev, [...range(0, 3), server]))).toEqual(['m0', 'm1', 'm2', 'm4']);
  });
});

// Audit 07 #11
describe('reply quotes', () => {
  const reply = msg(5, { reply_to_id: 'm1' });
  const target = { id: 'm1', content: 'text 1', sender_id: 'u2', created_at: msg(1).created_at };

  it('asks only for quotes not loaded yet', () => {
    expect(replyTargetIds([reply, msg(6), msg(7, { reply_to_id: 'm1' })])).toEqual(['m1']);
    expect(replyTargetIds([{ ...reply, reply_to: msg(1) }])).toEqual([]);
  });

  it('attaches the quote, but not one from before the reader cleared the chat', () => {
    expect(attachReplies([reply], [target], null)[0].reply_to?.content).toBe('text 1');
    expect(attachReplies([reply], [target], msg(3).created_at)[0].reply_to).toBeUndefined();
  });
});

