/**
 * Chat pushes sent from the app (send-push, user callers): the server decides
 * who wrote what (audit 02 #6, #7, release 383f15b).
 *
 * The app used to choose the title (sender name), subtitle and body freely,
 * so a participant could make a lock-screen alert and an inbox entry look
 * like someone else's message. Now the text must be the caller's own recent
 * message in that chat (by id from newer builds, by its first 120 characters
 * from older ones), and title, subtitle and body are rebuilt from the stored
 * message and the caller's profile. Pushes also respect the recipient's
 * "Push notifications" switch (notification_preferences.push).
 *
 * Plain TypeScript with no imports: Deno and vitest share this file.
 */

export interface ChatMessageRow {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string | null;
  created_at: string;
}

/** What the app put in the body for a message (src/lib/services/notifications.ts). */
export const chatPreview = (content: string | null | undefined): string =>
  (content ?? '').substring(0, 120) || 'New message';

/** A message older than this can't be announced any more. */
export const CHAT_PUSH_WINDOW_MS = 10 * 60 * 1000;
/** Device clocks drift: a message this far "ahead" still counts as new. */
export const CHAT_PUSH_FUTURE_SKEW_MS = 60 * 1000;

/**
 * The caller's message this push announces, or null. `recent` are the
 * caller's latest messages in the chat (newest first).
 */
export function findAnnouncedMessage(
  recent: ChatMessageRow[],
  opts: { callerId: string; chatId: string; messageId?: unknown; body?: unknown; now?: number },
): ChatMessageRow | null {
  const now = opts.now ?? Date.now();
  const mine = recent.filter(
    (m) =>
      m.sender_id === opts.callerId &&
      m.chat_id === opts.chatId &&
      now - Date.parse(m.created_at) <= CHAT_PUSH_WINDOW_MS &&
      // Inserts may carry their own created_at: a future one isn't new forever.
      Date.parse(m.created_at) - now <= CHAT_PUSH_FUTURE_SKEW_MS,
  );
  if (typeof opts.messageId === 'string' && opts.messageId) {
    return mine.find((m) => m.id === opts.messageId) ?? null;
  }
  const body = typeof opts.body === 'string' ? opts.body : '';
  return mine.find((m) => chatPreview(m.content) === body) ?? null;
}

/** Name, else email address, else fallback (same rule as src/lib/personName.ts). */
export function senderDisplayName(fullName: string | null | undefined, email: string | null | undefined, fallback = 'Someone'): string {
  const n = (fullName ?? '').trim();
  const address = (email ?? '').trim();
  const lower = n.toLowerCase();
  const isReal = !!n && !(address && (lower === address.toLowerCase() || lower === address.toLowerCase().split('@')[0]));
  return (isReal ? n : '') || address || fallback;
}

const MENTIONED: Record<string, string> = {
  en: '{name} mentioned you',
  it: '{name} ti ha menzionato',
  es: '{name} te ha mencionado',
  fr: "{name} t'a mentionné",
  de: '{name} hat dich erwähnt',
  pt: '{name} mencionou você',
};

/** The push title: the sender's name, or "{name} mentioned you" in the reader's language. */
export function chatPushTitle(type: 'chat_message' | 'chat_mention', senderName: string, lang: string | null | undefined): string {
  if (type === 'chat_message') return senderName;
  const l = String(lang || 'en').slice(0, 2).toLowerCase();
  return (MENTIONED[l] ?? MENTIONED.en).replace('{name}', senderName);
}

/** The push subtitle: "Private Message" for a direct chat, else the band (or chat) name. */
export function chatPushSubtitle(chatType: string | null | undefined, bandName: string | null | undefined, chatName: string | null | undefined): string {
  if (chatType === 'direct') return 'Private Message';
  return (bandName || chatName || '').trim() || 'Band Chat';
}

/** Recipients whose device may ring: not those who turned push off. */
export function pushAllowed(userIds: string[], prefs: { id: string; notification_preferences: unknown }[]): string[] {
  const off = new Set(
    prefs
      .filter((p) => {
        const v = (p.notification_preferences as Record<string, unknown> | null)?.push;
        return v === false || v === 'false';
      })
      .map((p) => p.id),
  );
  return userIds.filter((id) => !off.has(id));
}

/**
 * The chat a request is about. Older builds send both keys with the same
 * value; when they differ, verification and tap routing could disagree, so
 * the request is refused (Codex review #284).
 */
export function resolveChatId(data: Record<string, unknown> | null | undefined): { chatId: string | null; conflict: boolean } {
  const a = typeof data?.chat_id === 'string' && data.chat_id ? data.chat_id : null;
  const b = typeof data?.chatId === 'string' && data.chatId ? data.chatId : null;
  if (a && b && a !== b) return { chatId: null, conflict: true };
  return { chatId: a ?? b, conflict: false };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * People the message mentions ("@Name", same rule as src/lib/chatMentions.ts):
 * only they get "{name} mentioned you", whatever type the caller asked for.
 */
export function mentionedInMessage(content: string | null | undefined, people: { id: string; name: string }[], excludeId?: string | null): string[] {
  if (!content || !content.includes('@')) return [];
  let rest = content;
  const found: string[] = [];
  const byLength = people
    .filter((p) => p.id && p.id !== excludeId && p.name.trim())
    .sort((a, b) => b.name.trim().length - a.name.trim().length);
  for (const p of byLength) {
    const re = new RegExp(`@${escapeRe(p.name.trim())}(?=$|[\\s.,;:!?)\\]}'"’])`, 'giu');
    if (re.test(rest)) {
      if (!found.includes(p.id)) found.push(p.id);
      rest = rest.replace(re, ' ');
    }
  }
  return found;
}

export interface VerifiedChatFields {
  chatId: string;
  type: 'chat_message' | 'chat_mention';
  senderName: string;
  body: string;
  messageId: string;
  bandId: string | null;
  bandName: string | null;
  chatType: string | null;
}

/**
 * What a chat push carries to the device: the verified fields, plus the
 * caller's harmless labels. Nothing else from the request goes through (an
 * `aps` key used to replace the iOS alert, a stray id could route the tap).
 */
export function chatPushData(data: Record<string, unknown> | null | undefined, v: VerifiedChatFields): Record<string, unknown> {
  const label = (k: string) => (typeof data?.[k] === 'string' ? String(data[k]).slice(0, 64) : undefined);
  const out: Record<string, unknown> = {
    type: v.type,
    chat_id: v.chatId,
    chatId: v.chatId,
    senderName: v.senderName,
    content: v.body,
    message_id: v.messageId,
    band_id: v.bandId,
    bandName: v.bandName ?? undefined,
    chatType: v.chatType ?? undefined,
    tag: label('tag'),
    channel_id: label('channel_id'),
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}
