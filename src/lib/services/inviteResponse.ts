import { supabase } from '@/lib/supabase';
import { t } from '@/lib/i18n';
import { respondToEventInvite } from './events';

/** The answer was not saved; the message is translated and safe to show. */
export class InviteResponseError extends Error {}

/**
 * Records the signed-in user's own answer to an event invite (notification
 * RSVP sheet, inbox Going / Can't make it). Throws InviteResponseError when
 * nothing was saved (offline, removed from the event, event deleted), so the
 * caller neither tells the admins nor shows the answer as sent.
 * `changed` is false when that was already the answer: nothing is written and
 * the caller tells no one again (no second "is going" / "dropped out").
 */
export const respondToOwnInvite = async (
  eventId: string,
  userId: string,
  status: 'confirmed' | 'declined'
): Promise<{ changed: boolean }> => {
  const { data: membership, error } = await supabase
    .from('event_members')
    .select('id, status')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new InviteResponseError(t('Could not send your RSVP. Please try again.'));
  if (!membership) throw new InviteResponseError(t('You are no longer on this event, so there is nothing to answer.'));
  if (membership.status === status) return { changed: false };
  const { data, error: saveError } = await respondToEventInvite(membership.id, status);
  if (saveError || !data) throw new InviteResponseError(t('Could not send your RSVP. Please try again.'));
  return { changed: true };
};

/** The user's answer on an event: 'confirmed', 'declined', … ; null when not on it, undefined when unknown (offline). */
export const getOwnInviteStatus = async (eventId: string, userId: string): Promise<string | null | undefined> => {
  const { data, error } = await supabase
    .from('event_members')
    .select('status')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return undefined;
  return data ? (data.status as string) : null;
};

/** An invite that needs no answer any more: already answered, or no longer on the event. */
export const inviteSettled = (status: string | null | undefined): boolean =>
  status === null || status === 'confirmed' || status === 'declined';
