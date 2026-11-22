import { describe, it, expect } from 'vitest';
import {
  chatPreview,
  chatPushData,
  chatPushSubtitle,
  chatPushTitle,
  findAnnouncedMessage,
  mentionedInMessage,
  pushAllowed,
  resolveChatId,
  senderDisplayName,
  type ChatMessageRow,
} from '../../../supabase/functions/_shared/chat-push';

const NOW = Date.parse('2026-11-22T20:00:00Z');
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const BOB = 'bob', ALICE = 'alice', CHAT = 'chat-1';
const recent: ChatMessageRow[] = [
  { id: 'm2', chat_id: CHAT, sender_id: BOB, content: 'Load-in moved to 6 pm', created_at: ago(5) },
  { id: 'm1', chat_id: CHAT, sender_id: BOB, content: '', created_at: ago(30) },
  { id: 'old', chat_id: CHAT, sender_id: BOB, content: 'Last week', created_at: ago(3600) },
  { id: 'a1', chat_id: CHAT, sender_id: ALICE, content: 'Sound check at 5', created_at: ago(10) },
];

// Audit 02 #7: a participant could push any title and body (e.g. as Alice).
describe('chat push: only the caller’s own recent message', () => {
  it('older builds: matched by the preview text', () => {
    expect(findAnnouncedMessage(recent, { callerId: BOB, chatId: CHAT, body: 'Load-in moved to 6 pm', now: NOW })?.id).toBe('m2');
    expect(findAnnouncedMessage(recent, { callerId: BOB, chatId: CHAT, body: 'New message', now: NOW })?.id).toBe('m1');
  });
  it('newer builds: matched by message id', () => {
    expect(findAnnouncedMessage(recent, { callerId: BOB, chatId: CHAT, messageId: 'm2', now: NOW })?.id).toBe('m2');
  });
  it('refuses a text the caller never wrote, someone else’s message, another chat, an old message', () => {
    expect(findAnnouncedMessage(recent, { callerId: BOB, chatId: CHAT, body: 'Send me the band’s bank details', now: NOW })).toBeNull();
    expect(findAnnouncedMessage(recent, { callerId: BOB, chatId: CHAT, body: 'Sound check at 5', now: NOW })).toBeNull();
    expect(findAnnouncedMessage(recent, { callerId: BOB, chatId: CHAT, messageId: 'a1', now: NOW })).toBeNull();
    expect(findAnnouncedMessage(recent, { callerId: BOB, chatId: 'chat-2', body: 'Load-in moved to 6 pm', now: NOW })).toBeNull();
    expect(findAnnouncedMessage(recent, { callerId: BOB, chatId: CHAT, body: 'Last week', now: NOW })).toBeNull();
  });
  it('title and subtitle come from the server, not the app', () => {
    expect(senderDisplayName('Bob Rivera', 'bob@example.invalid')).toBe('Bob Rivera');
    expect(senderDisplayName('bob', 'bob@example.invalid')).toBe('bob@example.invalid');
    expect(chatPushTitle('chat_message', 'Bob Rivera', 'it')).toBe('Bob Rivera');
    expect(chatPushTitle('chat_mention', 'Bob Rivera', 'it')).toBe('Bob Rivera ti ha menzionato');
    expect(chatPushTitle('chat_mention', 'Bob Rivera', null)).toBe('Bob Rivera mentioned you');
    expect(chatPushSubtitle('direct', 'Hudson Horns', null)).toBe('Private Message');
    expect(chatPushSubtitle('band', 'Hudson Horns', 'old name')).toBe('Hudson Horns');
    expect(chatPreview('x'.repeat(200))).toHaveLength(120);
  });
});

// Audit 02 #6: chat previews reached phones with Push notifications off.
describe('chat push: the recipient’s push switch', () => {
  it('skips devices of people who turned push off', () => {
    const prefs = [
      { id: 'u1', notification_preferences: { push: false } },
      { id: 'u2', notification_preferences: { push: true } },
      { id: 'u3', notification_preferences: null },
      { id: 'u4', notification_preferences: { push: 'false' } },
    ];
    expect(pushAllowed(['u1', 'u2', 'u3', 'u4', 'u5'], prefs)).toEqual(['u2', 'u3', 'u5']);
  });
});

// Codex review #284.
describe('chat push review fixes', () => {
  it('a future-dated message is never announced', () => {
    const future: ChatMessageRow[] = [{ id: 'f', chat_id: CHAT, sender_id: BOB, content: 'later', created_at: new Date(NOW + 3600_000).toISOString() }];
    expect(findAnnouncedMessage(future, { callerId: BOB, chatId: CHAT, messageId: 'f', now: NOW })).toBeNull();
    expect(findAnnouncedMessage(future, { callerId: BOB, chatId: CHAT, body: 'later', now: NOW })).toBeNull();
    const skew: ChatMessageRow[] = [{ ...future[0], created_at: new Date(NOW + 20_000).toISOString() }];
    expect(findAnnouncedMessage(skew, { callerId: BOB, chatId: CHAT, messageId: 'f', now: NOW })?.id).toBe('f');
  });

  it('"mentioned you" only for people the message mentions', () => {
    const people = [{ id: 'ana', name: 'Ana' }, { id: 'anam', name: 'Ana Maria' }, { id: 'joe', name: 'Joe' }];
    expect(mentionedInMessage('@Ana Maria bring the capo', people, BOB)).toEqual(['anam']);
    expect(mentionedInMessage('hi @ana, and @Joe.', people, BOB).sort()).toEqual(['ana', 'joe']);
    expect(mentionedInMessage('no mentions here', people, BOB)).toEqual([]);
    expect(mentionedInMessage('@Bob talking to myself', [{ id: BOB, name: 'Bob' }], BOB)).toEqual([]);
  });

  it('one chat: chat_id and chatId must agree', () => {
    expect(resolveChatId({ chat_id: 'c1' })).toEqual({ chatId: 'c1', conflict: false });
    expect(resolveChatId({ chatId: 'c1' })).toEqual({ chatId: 'c1', conflict: false });
    expect(resolveChatId({ chat_id: 'c1', chatId: 'c1' })).toEqual({ chatId: 'c1', conflict: false });
    expect(resolveChatId({ chat_id: 'c1', chatId: 'c2' }).conflict).toBe(true);
    expect(resolveChatId({}).chatId).toBeNull();
  });

  it('the push payload keeps only known fields, never caller APNs keys', () => {
    const out = chatPushData(
      { type: 'chat_message', tag: 'Band Message', chat_id: 'c1', chatId: 'evil', aps: { alert: { title: 'Admin' } }, senderName: 'Admin', route: '/x' },
      { chatId: 'c1', type: 'chat_message', senderName: 'Bob', body: 'hi', messageId: 'm1', bandId: 'b1', bandName: 'The Band', chatType: 'band' },
    );
    expect(out).not.toHaveProperty('aps');
    expect(out).not.toHaveProperty('route');
    expect(out).toMatchObject({ chat_id: 'c1', chatId: 'c1', senderName: 'Bob', content: 'hi', message_id: 'm1', band_id: 'b1', type: 'chat_message', tag: 'Band Message' });
  });
});
