/**
 * A deleted account (Settings › Delete account): everything it left on this
 * device goes before the session ends, and nothing is written back. Its
 * offline queue, its waiting Stage and rehearsal changes, its refused
 * changes (which plain sign-out keeps, KEEP_ON_SIGN_OUT_PREFIXES), its chat
 * outbox and its offline setlists, in both stores (localStorage and
 * IndexedDB). AuthContext runs it again once the sign-out is done, for a
 * send that was answered meanwhile.
 * Other accounts' changes on a shared device stay.
 */
import { listOfflineKeys, removeOfflineItem } from './offline/storage';

export async function discardAccountWrites(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  try {
    // Under the queue's lock: a write in flight can't put it back afterwards.
    const { clearOfflineQueue } = await import('./offline/syncQueue');
    await clearOfflineQueue(userId);
  } catch {
    /* nothing stored */
  }
  try {
    const mine = (await listOfflineKeys('bw:')).filter((k) => k.endsWith(`:${userId}`));
    await Promise.all(mine.map((k) => removeOfflineItem(k)));
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
