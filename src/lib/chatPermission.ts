/**
 * May this account write in this chat? The chat screen asks the server each
 * time it opens a chat; the last answer is kept per (account, chat) so that
 * offline the screen can still decide (main's decision, #291 r4).
 *
 * Offline it fails open: the last answer when there is one, otherwise the
 * composer shows and the message waits for the network. The server always
 * has the last word when it is sent (a refusal shows "Not sent" with its
 * reason, the text stays). Online, the server's answer replaces the cache.
 *
 * The key lives under `bw:<userId>:` (offline/storage.ts getCacheKey), so it
 * is per account and goes with the read caches at sign-out
 * (`clearOfflineCache`) and on a role change (`syncCachedRoles`).
 */
import { getCacheKey, getOfflineItem, setOfflineItem } from './offline/storage';

export interface ChatPermission {
  permitted: boolean;
  /** English i18n key of the reason (translated when shown), '' when permitted. */
  reason: string;
}

export const chatPermissionKey = (userId: string, chatId: string): string =>
  getCacheKey(userId, 'global', `chat_can_text:${chatId}`);

export const readChatPermission = async (
  userId: string | null | undefined,
  chatId: string,
): Promise<ChatPermission | null> => {
  if (!userId) return null;
  try {
    const v = await getOfflineItem<ChatPermission>(chatPermissionKey(userId, chatId));
    return v && typeof v.permitted === 'boolean' ? { permitted: v.permitted, reason: typeof v.reason === 'string' ? v.reason : '' } : null;
  } catch {
    return null;
  }
};

export const saveChatPermission = async (
  userId: string | null | undefined,
  chatId: string,
  p: ChatPermission,
): Promise<void> => {
  if (!userId) return;
  try {
    await setOfflineItem(chatPermissionKey(userId, chatId), p);
  } catch {
    // A device that can't store it asks the server again next time.
  }
};

/** No answer from the server: the cached one, or open (the server decides on send). */
export const offlinePermission = (cached: ChatPermission | null): ChatPermission =>
  cached ?? { permitted: true, reason: '' };
