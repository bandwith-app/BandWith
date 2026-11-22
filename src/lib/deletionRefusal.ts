/**
 * The server refusing something because an account is being deleted (180):
 *   * someone in the band is deleting their account and the change would
 *     stop that deletion (the guard on band members: hint
 *     account_deletion_in_progress, who is deleting in the detail);
 *   * your own account is being deleted, on another device (hint
 *     account_being_deleted: no new messages).
 * The server's message is plain English for older builds; this gives the
 * app's own, translated text for every path (Claude review #282, round 5).
 */
import { t } from './i18n';

export type DeletionRefusal = 'own' | 'admin' | 'member';

export function deletionRefusal(error: unknown): DeletionRefusal | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as { message?: unknown; hint?: unknown; details?: unknown; detail?: unknown };
  const msg = typeof e.message === 'string' ? e.message : '';
  const hint = typeof e.hint === 'string' ? e.hint : '';
  const detail = typeof e.details === 'string' ? e.details : typeof e.detail === 'string' ? e.detail : '';
  if (hint === 'account_being_deleted' || msg === 'Your account is being deleted.') return 'own';
  if (hint !== 'account_deletion_in_progress' && !/account_deletion_in_progress|is deleting their account\. Try again in a few minutes\./.test(msg)) {
    return null;
  }
  let by: unknown = null;
  try {
    by = detail ? (JSON.parse(detail) as { by?: unknown })?.by : null;
  } catch {
    by = null;
  }
  return by === 'admin' || /^An admin of this band /.test(msg) ? 'admin' : 'member';
}

/** The app's text for it, or null when the error is something else. */
export function deletionRefusalMessage(error: unknown): string | null {
  switch (deletionRefusal(error)) {
    case 'own':
      return t('Your account is being deleted.');
    case 'admin':
      return t('An admin of this band is deleting their account. Try again in a few minutes.');
    case 'member':
      return t('A member of this band is deleting their account. Try again in a few minutes.');
    default:
      return null;
  }
}
