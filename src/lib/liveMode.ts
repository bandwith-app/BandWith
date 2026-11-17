/**
 * Live mode (Stage mode, src/app/components/dashboard/StageMode.tsx): which
 * events offer it and how it is called.
 *
 * - Upcoming band gigs: "Stage mode", with the evening's run of show.
 * - Upcoming band rehearsals (since 11-17): "Live mode", the same live
 *   screen (setlist = focus songs, lyrics / chords, click, the leader's song
 *   changes over the internet and Bluetooth) without the gig's phases and
 *   times and without striking songs off for tonight.
 * - Never for quotes, past events or personal gigs (no band to follow).
 *
 * Everyone on the band can open it; the band admin leads (useStageLive).
 */

export type LiveKind = 'gig' | 'rehearsal';

export interface LiveEvent {
  /** getEventType(): 'gig' | 'rehearsal' | 'quote' | … */
  eventType: string;
  isPast: boolean;
  /** No band (a personal gig): nobody to lead or follow. */
  isPersonalGig: boolean;
}

/** The kind of live mode an event offers, or null when it has none. */
export function liveKind({ eventType, isPast, isPersonalGig }: LiveEvent): LiveKind | null {
  if (isPast || isPersonalGig) return null;
  if (eventType === 'gig') return 'gig';
  if (eventType === 'rehearsal') return 'rehearsal';
  return null;
}

/** The event offers live mode (the play button, the Duo rail action, "Go live"). */
export const canGoLive = (event: LiveEvent): boolean => liveKind(event) !== null;
