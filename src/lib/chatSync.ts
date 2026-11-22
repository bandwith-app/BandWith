/**
 * Keeps an open chat in sync without downloading it on a timer.
 *
 * Realtime delivers new messages; the list is fetched again only:
 * - once each time the channel joins (first open, or back after a drop), to
 *   pick up anything sent in between;
 * - once when the app comes back to the front;
 * - every CHAT_FALLBACK_POLL_MS while the channel is not joined (offline,
 *   blocked socket, Realtime outage), so delivery never depends on it.
 *
 * It used to poll every 3 s even with Realtime working: about 1,200 requests
 * and 30–40 MB of Supabase egress per hour of open chat.
 */

export const CHAT_FALLBACK_POLL_MS = 10_000;

/** The chat list (several queries per fetch) polls more slowly while the socket is down. */
export const CHAT_LIST_FALLBACK_POLL_MS = 30_000;

/** Channel states reported by supabase-js `subscribe(cb)`. */
export type ChannelStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR' | (string & {});

export interface ChatSync {
  /** Pass every status the channel reports. */
  onStatus: (status: ChannelStatus) => void;
  /** Fetch once now (app back to the front). */
  catchUp: () => void;
  /** True while the slow fallback poll runs. */
  isPolling: () => boolean;
  stop: () => void;
}

export function createChatSync(fetchLatest: () => unknown, intervalMs: number = CHAT_FALLBACK_POLL_MS): ChatSync {
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const run = () => {
    if (!stopped) void fetchLatest();
  };
  const startPoll = () => {
    if (timer === null && !stopped) timer = setInterval(run, intervalMs);
  };
  const stopPoll = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  // Until the channel confirms it joined, behave as if it were down.
  startPoll();

  return {
    onStatus(status) {
      if (stopped) return;
      if (status === 'SUBSCRIBED') {
        stopPoll();
        run();
      } else {
        startPoll();
      }
    },
    catchUp: run,
    isPolling: () => timer !== null,
    stop() {
      stopped = true;
      stopPoll();
    },
  };
}
