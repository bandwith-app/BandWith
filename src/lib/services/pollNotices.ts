/**
 * Notices about rehearsal proposals that the database doesn't write.
 * Written in the recipient's language (recipientLocale.ts). A declined
 * proposal is also pushed: the server pushes `system` rows of kind
 * 'proposal_declined' (migration 123; inbox only before it).
 */
import { createNotification } from './notifications';
import { recipientLocales } from '@/lib/recipientLocale';
import { translate } from '@/lib/i18n';

/** An admin declined a member's proposal: tell the member who proposed it. */
export async function notifyProposalDeclined(
  poll: { id: string; band_id: string; title?: string | null; created_by?: string | null },
  actorId: string | null | undefined,
  reason?: string | null,
): Promise<void> {
  const to = poll.created_by;
  if (!to || to === actorId) return;
  try {
    const lang = (await recipientLocales([to])).get(to) ?? 'en';
    const title = (poll.title || '').trim();
    const why = (reason || '').trim().slice(0, 200);
    const body = title
      ? translate(lang, 'An admin declined your rehearsal proposal "{title}".', { title })
      : translate(lang, 'An admin declined your rehearsal proposal.');
    await createNotification(to, {
      type: 'system',
      title: translate(lang, 'Rehearsal proposal declined'),
      body: why ? `${body} ${translate(lang, 'Reason: {reason}', { reason: why })}` : body,
      band_id: poll.band_id,
      data: { kind: 'proposal_declined', poll_id: poll.id, band_id: poll.band_id, ...(why ? { reason: why } : {}) },
    });
  } catch (err) {
    // The decline itself is done; the notice is best effort.
    console.warn('[notifyProposalDeclined]', err);
  }
}
