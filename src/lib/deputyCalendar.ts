// Shared with the deputy-calendar edge function (Deno).
export * from '../../supabase/functions/_shared/deputy-calendar';

/**
 * The deputy's calendar links (182), never with the reply token:
 *   'gig'  the file of one gig, by its gig_calendar_token (?g=): a forwarded
 *          file link shows that gig only;
 *   'feed' the subscription, by calendar_token (?t=).
 * Null without the key (a server before 182).
 */
export function deputyCalendarUrl(base: string | undefined, key: string | null | undefined, lang: string, kind: 'gig' | 'feed'): string | null {
  if (!base || !key || !/^[0-9a-f]{64}$/.test(key)) return null;
  return `${base}/functions/v1/deputy-calendar?${kind === 'gig' ? 'g' : 't'}=${key}&l=${lang}`;
}
