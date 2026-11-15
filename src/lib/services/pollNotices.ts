/**
 * Notices about rehearsal proposals that the database doesn't write.
 * Written in the recipient's language (recipientLocale.ts); inbox only, no
 * push (068: push is for what needs you to act).
 */
import { createNotification } from './notifications';
import { recipientLocales } from '@/lib/recipientLocale';
import { translate } from '@/lib/i18n';

/** An admin dismissed a member's proposal: tell the member who proposed it. */
export async function notifyProposalDismissed(
  poll: { id: string; band_id: string; title?: string | null; created_by?: string | null },
  actorId: string | null | undefined,
): Promise<void> {
  const to = poll.created_by;
  if (!to || to === actorId) return;
  try {
    const lang = (await recipientLocales([to])).get(to) ?? 'en';
    const title = (poll.title || '').trim();
    await createNotification(
      to,
      {
        type: 'system',
        title: translate(lang, 'Rehearsal proposal dismissed'),
        body: title
          ? translate(lang, 'An admin dismissed your rehearsal proposal "{title}".', { title })
          : translate(lang, 'An admin dismissed your rehearsal proposal.'),
        band_id: poll.band_id,
        data: { kind: 'proposal_dismissed', poll_id: poll.id, band_id: poll.band_id },
      },
      { sendPush: false },
    );
  } catch (err) {
    // The dismissal itself is done; the notice is best effort.
    console.warn('[notifyProposalDismissed]', err);
  }
}
