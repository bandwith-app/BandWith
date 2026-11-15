import { describe, expect, it } from 'vitest';
import { notificationBandId, notificationTarget, notificationTargetLabel } from './notificationRouting';

describe('notificationTarget', () => {
  it('opens the event of a confirmed rehearsal', () => {
    const t = notificationTarget('rehearsal_poll_finalized', { event_id: 'ev-1', poll_id: 'p' });
    expect(t).toEqual({ screen: 'event', eventId: 'ev-1' });
    expect(notificationTargetLabel(t!)).toBe('Open event');
  });

  it('opens the vote sheet of a rehearsal poll', () => {
    const t = notificationTarget('rehearsal_poll', { poll_id: 'p-1' });
    expect(t).toEqual({ screen: 'poll', pollId: 'p-1' });
    expect(notificationTargetLabel(t!)).toBe('Vote now');
    expect(notificationTarget('rehearsal_proposal', {})).toEqual({ screen: 'event' });
  });

  it('opens chats only when the chat id is known', () => {
    expect(notificationTarget('chat_message', { chat_id: 'c-1' })).toEqual({ screen: 'chat', chatId: 'c-1' });
    expect(notificationTarget('chat_message', {})).toBeNull();
  });

  it('routes quotes, payments, invites and members', () => {
    expect(notificationTarget('quote_accepted', {})).toEqual({ screen: 'quotes' });
    expect(notificationTarget('quote_message', { quote_id: 'q-1' })).toEqual({ screen: 'quotes', quoteId: 'q-1' });
    expect(notificationTarget('payment_received', {})).toEqual({ screen: 'finance' });
    expect(notificationTarget('invite_received', {})).toEqual({ screen: 'invites' });
    expect(notificationTarget('member_joined', {})).toEqual({ screen: 'bandMembers' });
    expect(notificationTarget('song_added', {})).toEqual({ screen: 'repertoire' });
  });

  it('routes setlist and song summaries (107)', () => {
    // A gig's setlist: that gig. A setlist from the band's library, or a song: the repertoire.
    expect(notificationTarget('setlist_updated', { event_id: 'e-1', kind: 'summary' })).toEqual({ screen: 'event', eventId: 'e-1' });
    expect(notificationTarget('setlist_updated', { setlist_id: 's-1' })).toEqual({ screen: 'repertoire' });
    expect(notificationTarget('song_updated', { song_id: 'x' })).toEqual({ screen: 'repertoire' });
  });

  it('opens song suggestions for admins and for the member who suggested (108)', () => {
    expect(notificationTarget('song_suggestion', { suggestion_id: 'g-1' })).toEqual({ screen: 'songSuggestions', suggestionId: 'g-1' });
    expect(notificationTarget('song_suggestion_reviewed', { suggestion_id: 'g-1', status: 'rejected' })).toEqual({ screen: 'songSuggestions', suggestionId: 'g-1' });
    expect(notificationTarget('song_suggestion', {})).toEqual({ screen: 'songSuggestions' });
  });

  it('has no screen for someone removed from a band or unknown types', () => {
    expect(notificationTarget('member_left', { removed: true })).toBeNull();
    // Taken off a gig's lineup: nothing to open.
    expect(notificationTarget('event_update', { kind: 'lineup_removed', event_id: 'e' })).toBeNull();
    expect(notificationTarget('event_update', { event_id: 'e' })).toEqual({ screen: 'event', eventId: 'e' });
    expect(notificationTarget('something_else', {})).toBeNull();
  });

  it('falls back to the type inside the push payload', () => {
    expect(notificationTarget('', { type: 'event_confirmed', eventId: 'e' })).toEqual({ screen: 'event', eventId: 'e' });
  });
});

describe('notificationBandId', () => {
  it('reads the band from the column, then the payload', () => {
    expect(notificationBandId({ band_id: 'b-1', data: { band_id: 'b-2' } })).toBe('b-1');
    expect(notificationBandId({ data: { bandId: 'b-3' } })).toBe('b-3');
    expect(notificationBandId({ data: {} })).toBeUndefined();
  });
});
