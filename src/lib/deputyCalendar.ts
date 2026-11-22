// Shared with the deputy-calendar edge function (Deno).
export * from '../../supabase/functions/_shared/deputy-calendar';

/**
 * The deputy's calendar file (one) or subscription: by the request's
 * read-only calendar token (182), never its reply token. Null without one
 * (a server before 182).
 */
export function deputyCalendarUrl(base: string | undefined, calendarToken: string | null | undefined, lang: string, one: boolean): string | null {
  if (!base || !calendarToken || !/^[0-9a-f]{64}$/.test(calendarToken)) return null;
  return `${base}/functions/v1/deputy-calendar?t=${calendarToken}&l=${lang}${one ? '&one=1' : ''}`;
}
