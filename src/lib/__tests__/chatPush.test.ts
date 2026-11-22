import { describe, it, expect } from 'vitest';
import {
  CHAT_PUSH_CHANNEL,
  pendingAnnouncements,
  pushSettledUsers,
  LEGACY_CANDIDATES,
  noticeSettled,
  chatPreview,
  chooseUnannounced,
  findAnnouncedCandidates,
  isUuid,
  legacyContentFilter,
  mentionsAmong,
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

// Codex + Claude review #284, round 2.
describe('chat push review fixes, round 2', () => {
  const ANA = 'ana', ANAM = 'anam';
  const roster = [{ id: ANA, name: 'Ana' }, { id: ANAM, name: 'Ana Maria' }, { id: BOB, name: 'Bob' }];

  it('mentions are read against the whole chat, not only the requested recipients', () => {
    // Only Ana is asked for, but the message mentions Ana Maria.
    expect(mentionsAmong('@Ana Maria bring the capo', roster, [ANA], BOB)).toEqual([]);
    expect(mentionsAmong('@Ana Maria and @Ana', roster, [ANA], BOB)).toEqual([ANA]);
    expect(mentionsAmong('@Ana Maria', roster, [ANA, ANAM], BOB)).toEqual([ANAM]);
  });

  it('a verified chat push always rings on the Messages channel', () => {
    const out = chatPushData(
      { channel_id: 'bandwith_events', tag: 'Band Message' },
      { chatId: 'c1', type: 'chat_message', senderName: 'Bob', body: 'hi', messageId: 'm1', bandId: null, bandName: null, chatType: 'direct', subtitle: 'Private Message' },
    );
    expect(out.channel_id).toBe(CHAT_PUSH_CHANNEL);
    expect(CHAT_PUSH_CHANNEL).toBe('bandwith_messages');
  });

  it('the push payload carries the subtitle (foreground iOS banner reads data.subtitle)', () => {
    const out = chatPushData({}, { chatId: 'c1', type: 'chat_message', senderName: 'Bob', body: 'hi', messageId: 'm1', bandId: 'b1', bandName: 'Hudson Horns', chatType: 'band', subtitle: 'Hudson Horns' });
    expect(out.subtitle).toBe('Hudson Horns');
  });

  it('a name with $ stays literal in "mentioned you"', () => {
    expect(chatPushTitle('chat_mention', 'Ke$$', 'en')).toBe('Ke$$ mentioned you');
    expect(chatPushTitle('chat_mention', "$& $' $`", 'it')).toBe("$& $' $` ti ha menzionato");
  });

  it('a message id must be a UUID (anything else is refused, not a 500)', () => {
    expect(isUuid('8b0c6f4e-2a1d-4c3b-9e8f-0a1b2c3d4e5f')).toBe(true);
    expect(isUuid('8B0C6F4E-2A1D-4C3B-9E8F-0A1B2C3D4E5F')).toBe(true);
    expect(isUuid('temp-123')).toBe(false);
    expect(isUuid("' or 1=1 --")).toBe(false);
    expect(isUuid(42)).toBe(false);
  });

  it('older builds: the preview is looked up by content, so 20 newer messages can’t hide it', () => {
    expect(legacyContentFilter('Load-in moved to 6 pm')).toEqual({ eq: 'Load-in moved to 6 pm' });
    expect(legacyContentFilter('New message')).toEqual({ in: ['', 'New message'] });
    const long = 'a'.repeat(114) + '50%_\\x';
    expect(long).toHaveLength(120);
    expect(legacyContentFilter(long)).toEqual({ like: 'a'.repeat(114) + '50\\%\\_\\\\x%' });
    // Cut in the middle of an emoji: the lone half isn't part of the pattern.
    const cut = ('x'.repeat(119) + '🎸🎸').substring(0, 120);
    expect(legacyContentFilter(cut)).toEqual({ like: 'x'.repeat(119) + '%' });
  });

  it('one message rings each recipient once', () => {
    const m = (id: string): ChatMessageRow => ({ id, chat_id: CHAT, sender_id: BOB, content: 'OK', created_at: ago(5) });
    // Re-calling with the same message: only those not told yet.
    expect(chooseUnannounced([m('m9')], ['u1', 'u2'], [{ user_id: 'u1', message_id: 'm9' }])).toEqual({ message: m('m9'), recipients: ['u2'] });
    expect(chooseUnannounced([m('m9')], ['u1'], [{ user_id: 'u1', message_id: 'm9' }])).toBeNull();
    // Older builds, "OK" twice: the second push announces the other "OK".
    expect(chooseUnannounced([m('m2'), m('m1')], ['u1'], [{ user_id: 'u1', message_id: 'm2' }])?.message.id).toBe('m1');
    expect(chooseUnannounced([], ['u1'], [])).toBeNull();
  });

  it('older builds: every recent message with that preview is a candidate, newest first', () => {
    const twice: ChatMessageRow[] = [
      { id: 'n2', chat_id: CHAT, sender_id: BOB, content: 'OK', created_at: ago(5) },
      { id: 'n1', chat_id: CHAT, sender_id: BOB, content: 'OK', created_at: ago(50) },
    ];
    expect(findAnnouncedCandidates(twice, { callerId: BOB, chatId: CHAT, body: 'OK', now: NOW }).map((r) => r.id)).toEqual(['n2', 'n1']);
    expect(findAnnouncedCandidates(twice, { callerId: BOB, chatId: CHAT, messageId: 'n1', now: NOW }).map((r) => r.id)).toEqual(['n1']);
  });
});

// Codex review #284, round 3.
describe('chat push review fixes, round 3', () => {
  it('the preview never ends in half an emoji (Postgres rejects it in JSON)', () => {
    const cut = 'a'.repeat(119) + '🎸';
    expect(chatPreview(cut)).toBe('a'.repeat(119));
    expect(/[\uD800-\uDBFF]$/.test(chatPreview(cut + ' rest'))).toBe(false);
    expect(chatPreview('a'.repeat(118) + '🎸x')).toBe('a'.repeat(118) + '🎸');
    expect(chatPreview('🎸'.repeat(70))).toBe('🎸'.repeat(60));
  });

  it('an older build’s preview cut through an emoji still matches its message', () => {
    const content = 'a'.repeat(119) + '🎸 and more';
    const oldBody = content.substring(0, 120); // what an older build sends
    const rows: ChatMessageRow[] = [{ id: 'e1', chat_id: CHAT, sender_id: BOB, content, created_at: ago(5) }];
    expect(findAnnouncedCandidates(rows, { callerId: BOB, chatId: CHAT, body: oldBody, now: NOW }).map((r) => r.id)).toEqual(['e1']);
  });

  it('a notice counts as announced only once it was pushed, or while someone is pushing it', () => {
    const t = Date.parse('2026-11-22T20:00:00Z');
    expect(noticeSettled({ pushed_at: '2026-11-22T19:00:00Z' }, t)).toBe(true);
    expect(noticeSettled({ push_claimed_at: '2026-11-22T19:59:30Z' }, t)).toBe(true);
    expect(noticeSettled({ push_claimed_at: '2026-11-22T19:55:00Z' }, t)).toBe(false);
    expect(noticeSettled({}, t)).toBe(false);
  });

  it('older builds: far more than 20 identical previews are candidates', () => {
    expect(LEGACY_CANDIDATES).toBeGreaterThanOrEqual(500);
    const many: ChatMessageRow[] = Array.from({ length: 25 }, (_, i) => ({ id: `ok${i}`, chat_id: CHAT, sender_id: BOB, content: 'OK', created_at: ago(5 + i) }));
    const told = many.slice(0, 24).map((m) => ({ user_id: 'u1', message_id: m.id }));
    expect(chooseUnannounced(many, ['u1'], told)?.message.id).toBe('ok24');
  });
});

// Codex review #284, round 3 (second pass).
describe('chat push review fixes, round 3b', () => {
  it('a message marked deleted is never announced', () => {
    const rows: ChatMessageRow[] = [
      { id: 'd1', chat_id: CHAT, sender_id: BOB, content: 'oops', created_at: ago(5), deleted: true },
      { id: 'd0', chat_id: CHAT, sender_id: BOB, content: 'oops', created_at: ago(9) },
    ];
    expect(findAnnouncedCandidates(rows, { callerId: BOB, chatId: CHAT, messageId: 'd1', now: NOW })).toEqual([]);
    expect(findAnnouncedCandidates(rows, { callerId: BOB, chatId: CHAT, body: 'oops', now: NOW }).map((r) => r.id)).toEqual(['d0']);
  });

  it('marked pushed only when a device took it, or there was nothing to deliver to', () => {
    const out = pushSettledUsers(['ok', 'down', 'none', 'dead', 'mixed'], [
      { userId: 'ok', success: true },
      { userId: 'down', success: false, error: 'FCM error: 503' },
      { userId: 'down', success: false, error: 'timeout' },
      { userId: 'dead', success: false, error: 'invalid_token' },
      { userId: 'mixed', success: false, error: 'FCM error: 503' },
      { userId: 'mixed', success: true },
    ]);
    expect(out.sort()).toEqual(['dead', 'mixed', 'none', 'ok']);
  });

  it('every candidate with someone left to tell, in order (a lost claim moves on)', () => {
    const m = (id: string): ChatMessageRow => ({ id, chat_id: CHAT, sender_id: BOB, content: 'OK', created_at: ago(5) });
    const got = pendingAnnouncements([m('m2'), m('m1'), m('m0')], ['u1'], [{ user_id: 'u1', message_id: 'm1' }]);
    expect(got.map((p) => p.message.id)).toEqual(['m2', 'm0']);
  });
});
