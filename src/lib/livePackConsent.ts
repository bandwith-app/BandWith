/**
 * May the live packs come down by themselves on this device (plan §3.2–3.3)?
 * Only after the person said yes: "Download and keep it automatic" (every
 * setlist of the next 7 days, silently) or "Only this gig". Kept per user
 * on the device; the server copy (profiles.live_pack_auto, A2) tells the
 * daily job not to ask again.
 *
 * Opening an event while online still keeps its songs on the device (what
 * Stage mode did since PR #93, for Bluetooth on stage): that's the person
 * using the setlist, not a download ahead.
 */

export interface LivePackChoice {
  /** "Download and keep it automatic". */
  auto: boolean;
  /** "Only this gig": these events. */
  events: string[];
  /** Download only on Wi-Fi. */
  wifiOnly: boolean;
  /** Last time the sheet was answered "Not now" (ISO). */
  notNowAt?: string;
}

const EMPTY: LivePackChoice = { auto: false, events: [], wifiOnly: false };
const keyOf = (userId: string) => `bw-live-pack:${userId}`;
export const LIVE_PACK_CHOICE_EVENT = 'bw:live-pack-choice';

export function readChoice(userId: string | null | undefined): LivePackChoice {
  if (!userId) return EMPTY;
  try {
    const v = JSON.parse(localStorage.getItem(keyOf(userId)) || 'null');
    if (!v || typeof v !== 'object') return EMPTY;
    return {
      auto: v.auto === true,
      events: Array.isArray(v.events) ? v.events.filter((e: unknown): e is string => typeof e === 'string') : [],
      wifiOnly: v.wifiOnly === true,
      notNowAt: typeof v.notNowAt === 'string' ? v.notNowAt : undefined,
    };
  } catch {
    return EMPTY;
  }
}

export function writeChoice(userId: string, choice: LivePackChoice) {
  try {
    localStorage.setItem(keyOf(userId), JSON.stringify(choice));
  } catch {
    /* per-device preference */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LIVE_PACK_CHOICE_EVENT, { detail: { userId } }));
}

/** The person said yes for this event (or for all of them). */
export const packAllowed = (choice: LivePackChoice, eventId: string): boolean => choice.auto || choice.events.includes(eventId);

/** Anything may come down ahead at all. */
export const anyPackAllowed = (choice: LivePackChoice): boolean => choice.auto || choice.events.length > 0;
