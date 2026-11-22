import { supabase } from '../supabase';
import { t } from '@/lib/i18n';
import { holdDeletionSignOut } from '@/lib/deletionSignOut';

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; reason: 'admin_of_bands'; bands: string[] }
  | { ok: false; reason: 'error'; message: string }
  // Committed (180): the server finishes it within minutes; the app signs out.
  | { ok: false; reason: 'committed'; message: string };

/**
 * Permanently deletes the signed-in user's account (edge function
 * `delete-account`). The caller is resolved from the session server-side.
 */
// Round 9 (Claude): while this device deletes the account, its own
// background writes refused by 180 sign nothing out mid-request; when the
// deletion went through (or is committed), the hold stays a minute, while
// the settings screen signs out itself.
export async function deleteMyAccount(): Promise<DeleteAccountResult> {
  const release = holdDeletionSignOut();
  let result: DeleteAccountResult | null = null;
  try {
    result = await deleteMyAccountNow();
    return result;
  } finally {
    if (result && (result.ok || result.reason === 'committed')) setTimeout(release, 60_000);
    else release();
  }
}

async function deleteMyAccountNow(): Promise<DeleteAccountResult> {
  const { data, error } = await supabase.functions.invoke('delete-account', {
    body: { confirm: 'DELETE' },
  });

  if (!error && data?.success) return { ok: true };

  // Non-2xx responses: the body is on error.context (a Response).
  let body: any = data;
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    body = await context.json().catch(() => null);
  }

  if (body?.code === 'account_has_bands') {
    return { ok: false, reason: 'admin_of_bands', bands: Array.isArray(body.bands) ? body.bands : [] };
  }
  // A co-admin (or everyone else in a band) is deleting their account too.
  if (body?.code === 'account_deletion_in_progress') {
    return { ok: false, reason: 'error', message: t('A bandmate is deleting their account. Try again in a few minutes.') };
  }
  // Committed (180, round 5): the server finishes it on its own within a
  // few minutes, even if nobody tries again.
  if (body?.code === 'storage_not_ready' && body?.committed === true) {
    return { ok: false, reason: 'committed', message: t('Your account is being deleted. It will be gone within a few minutes.') };
  }
  // A step could not finish yet (files still there): nothing more is gone,
  // and trying again finishes it.
  if (body?.code === 'storage_not_ready') {
    return { ok: false, reason: 'error', message: t('We couldn’t finish deleting your account. Try again shortly.') };
  }
  return {
    ok: false,
    reason: 'error',
    message: t('We couldn’t delete your account. Check your connection and try again. If it keeps failing, see Help & support in Settings.'),
  };
}
