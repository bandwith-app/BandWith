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
      now - Date.parse(m.created_at) <= CHAT_PUSH_WINDOW_MS,
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
