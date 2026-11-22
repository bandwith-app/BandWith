import { t } from '@/lib/i18n';
/**
 * Where a notification leads. Shared by push taps and the in-app inbox so both
 * open the same screen. The result is the `detail` of the `push-navigate`
 * window event handled in AuthenticatedApp.
 */
export type NotificationTarget =
  | { screen: 'chat'; chatId: string }
  // livePack: open its "setlist without signal" consent sheet (170).
  // date: the date of a repeating rehearsal it is about (a session summary, 133).
  | { screen: 'event'; eventId?: string; livePack?: true; date?: string }
  // A rehearsal poll to vote on (its sheet, like the inbox).
  | { screen: 'poll'; pollId: string }
  // quoteId: the quote a client answered on its page (migration 099).
  | { screen: 'quotes'; quoteId?: string }
  | { screen: 'finance' }
  | { screen: 'invites' }
  | { screen: 'bandMembers' }
  | { screen: 'repertoire' }
  // A member's suggestion for a song (admins review it; the author sees the outcome, 108).
  | { screen: 'songSuggestions'; suggestionId?: string }
  // The account's requests as a deputy for other bands (migration 086).
  | { screen: 'deputyGigs'; requestId?: string }
  // A date on hold (178): its card on Home, where the member answers.
  | { screen: 'home'; holdEventId?: string };

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : undefined;

/** The screen a notification opens, or null when it has no screen of its own. */
export function notificationTarget(
  type: string | undefined | null,
  data?: Record<string, unknown> | null
): NotificationTarget | null {
  const kind = String(type || data?.type || '');
  const d = data || {};
  // A hold's push (178) travels as event_date_hold so old builds just open
  // the calendar; the real notice type and the event come along separately.
  if (kind === 'event_date_hold') {
    const holdType = str(d.hold_type) || 'date_hold';
    if (holdType === 'date_hold_released') return null;
    const holdEventId = str(d.hold_event_id);
    return holdEventId ? { screen: 'home', holdEventId } : { screen: 'home' };
  }
  const chatId = str(d.chatId) || str(d.chat_id);
  const eventId = str(d.eventId) || str(d.event_id);

  // A possible gig to keep free (178): the hold card on Home. Once the date
  // is free again there's nothing to open.
  if (kind === 'date_hold' || kind === 'date_hold_changed') {
    return eventId ? { screen: 'home', holdEventId: eventId } : { screen: 'home' };
  }
  if (kind === 'date_hold_released') return null;
  // Pushes to a deputy: not their band, so they open their deputy gigs.
  if (kind === 'deputy_request' || kind === 'deputy_gig_changed') {
    const requestId = str(d.deputy_request_id) || str(d.deputyRequestId);
    return requestId ? { screen: 'deputyGigs', requestId } : { screen: 'deputyGigs' };
  }
  // The setlist ready for offline (170): the event, with the consent sheet.
  if (kind === 'live_pack_ready') return eventId ? { screen: 'event', eventId, livePack: true } : { screen: 'event' };
  // Taken off a gig's lineup: it's no longer theirs to open.
  if (kind === 'event_update' && d.kind === 'lineup_removed') return null;
  if (kind === 'chat_message' || kind === 'chat_mention') {
    return chatId ? { screen: 'chat', chatId } : null;
  }
  if (
    kind.startsWith('event_') ||
    kind.startsWith('gig_') ||
    kind === 'member_dropped_out' ||
    kind === 'deputy_reply' ||
    kind === 'deputy_joined' ||
    (kind === 'setlist_updated' && !!eventId) ||
    kind === 'rehearsal_reminder' ||
    // The summary when a rehearsal session ends: the rehearsal and its notes (133).
    kind === 'rehearsal_notes_added' ||
    kind === 'rehearsal_poll_finalized'
  ) {
    // One date of a repeating rehearsal opens on that date (Codex #297 B1).
    const date = str(d.occurrence_date) || str(d.occurrenceDate);
    return date && eventId ? { screen: 'event', eventId, date } : { screen: 'event', eventId };
  }
  if (kind === 'rehearsal_poll' || kind === 'rehearsal_proposal') {
    const pollId = str(d.poll_id) || str(d.pollId);
    return pollId ? { screen: 'poll', pollId } : { screen: 'event' };
  }
  if (kind.startsWith('quote_')) {
    const quoteId = str(d.quote_id) || str(d.quoteId);
    return quoteId ? { screen: 'quotes', quoteId } : { screen: 'quotes' };
  }
  if (kind.startsWith('payment_')) return { screen: 'finance' };
  if (kind === 'invite_received' || kind === 'band_invite') return { screen: 'invites' };
  if (kind === 'song_suggestion' || kind === 'song_suggestion_reviewed') {
    const suggestionId = str(d.suggestion_id) || str(d.suggestionId);
    return suggestionId ? { screen: 'songSuggestions', suggestionId } : { screen: 'songSuggestions' };
  }
  // A song, or a setlist edited in the band's library (no gig): the repertoire.
  if (kind === 'song_added' || kind === 'song_updated' || kind === 'setlist_updated') return { screen: 'repertoire' };
  if (kind === 'member_joined' || kind === 'member_left') {
    // Someone removed from a band can no longer open its member list.
    return d.removed ? null : { screen: 'bandMembers' };
  }
  return null;
}

/** Button label for the detail page's "open" action. */
export function notificationTargetLabel(target: NotificationTarget): string {
  switch (target.screen) {
    case 'chat':
      return t('Open chat');
    case 'event':
      return target.eventId ? t('Open event') : t('Open calendar');
    case 'poll':
      return t('Vote now');
    case 'quotes':
      return t('Open quotes');
    case 'finance':
      return t('Open finance');
    case 'invites':
      return t('View invite');
    case 'bandMembers':
      return t('Open members');
    case 'repertoire':
      return t('Open repertoire');
    case 'songSuggestions':
      return t('Open suggestion');
    case 'deputyGigs':
      return t('Open deputy gigs');
    case 'home':
      return t('Answer on Home');
  }
}

/** The band a notification belongs to (column or payload), if any. */
export function notificationBandId(n: { band_id?: string | null; data?: Record<string, unknown> | null }): string | undefined {
  return (n.band_id || str(n.data?.band_id) || str(n.data?.bandId)) ?? undefined;
}

/**
 * Opens the target. `bandId` is the band the notification belongs to: when it
 * isn't the active band, the app asks whether to switch first.
 * `notificationId`: an inbox row that goes away once its screen is open
 * (kept when the user cancels the band switch).
 */
export function navigateToNotificationTarget(target: NotificationTarget | null, bandId?: string, notificationId?: string): void {
  const detail = {
    ...(target ?? { screen: 'home' }),
    ...(target && bandId ? { bandId } : {}),
    ...(notificationId ? { notificationId } : {}),
  };
  window.dispatchEvent(new CustomEvent('push-navigate', { detail }));
}
