/**
 * A deleted account (Settings › Delete account): everything it left on this
 * device goes before the session ends, and nothing is written back. Its
 * offline queue, its waiting Stage and rehearsal changes, its refused
 * changes (which plain sign-out keeps, KEEP_ON_SIGN_OUT_PREFIXES) and its
 * offline setlists.
 * Other accounts' changes on a shared device stay.
 */
import { removeOfflineItem } from './offline/storage';

export async function discardAccountWrites(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  try {
    const { getOfflineQueueKey } = await import('./offline/syncQueue');
    await removeOfflineItem(getOfflineQueueKey(userId));
  } catch {
    /* nothing stored */
  }
  try {
    const mine: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('bw:') && k.endsWith(`:${userId}`)) mine.push(k);
    }
    mine.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage blocked */
  }
  try {
    const { deleteAllPacks } = await import('./livePackStore');
    await deleteAllPacks(userId);
  } catch {
    /* no packs */
  }
}
