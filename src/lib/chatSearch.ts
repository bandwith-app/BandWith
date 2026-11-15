/**
 * Chat search helpers: a message matches only after the time the viewer
 * deleted that chat (chat_participants.cleared_at), as in the chat itself.
 */

/** Whether a message sent at `createdAt` is still visible after the chat was cleared at `clearedAt`. */
export function visibleAfterClear(createdAt: string, clearedAt: string | null | undefined): boolean {
  if (!clearedAt) return true;
  const sent = new Date(createdAt).getTime();
  const cleared = new Date(clearedAt).getTime();
  if (!Number.isFinite(cleared)) return true;
  return Number.isFinite(sent) && sent > cleared;
}

/** The viewer's cleared_at per chat, from the chats' participant rows. */
export function clearedAtByChat(
  chats: { id: string; participants?: { user_id: string; cleared_at?: string | null }[] }[],
  userId: string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of chats) {
    const mine = (c.participants || []).find((p) => p.user_id === userId);
    if (mine?.cleared_at) map.set(c.id, mine.cleared_at);
  }
  return map;
}
