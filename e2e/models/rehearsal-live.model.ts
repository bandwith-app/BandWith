import { defineLifecycle } from './lifecycle.ts';

/**
 * Rehearsal session in Live mode (plan A1b): the band admin runs it.
 *
 * From the code:
 * - Live mode on an upcoming band rehearsal (src/lib/liveMode.ts) shows the
 *   session bar (StageMode.tsx → RehearsalSession.tsx RehearsalSessionBar)
 *   when the `rehearsal_sessions` flag is on (src/lib/flags.ts, default on).
 * - Not started: the admin sees "Start rehearsal"; members see nothing.
 * - Running: the clock (pauses left out, src/lib/rehearsalSession.ts
 *   elapsedSeconds), "Rehearsing", Pause and End. End asks first
 *   ("End rehearsal?" Keep going / End now).
 * - Paused: the clock stands, "Paused", Resume.
 * - Ended: the summary (RehearsalSummaryDialog): time rehearsed, "N of M
 *   songs played" and the list; Resume rehearsal (admin) or Done. Then the
 *   bar says "Ended" with Summary.
 * - Every change is saved in rehearsal_sessions (migration 131), one row per
 *   occurrence, so the session survives a restart and the rehearsal's page
 *   shows it (REHEARSAL SESSION card).
 */
export const rehearsalLive = defineLifecycle({
  id: 'rehearsal-live',
  title: 'Rehearsal session (Live mode)',
  summary: 'The admin starts, pauses, resumes and ends a rehearsal in Live mode; the summary is saved and shown on the rehearsal page.',
  role: 'admin',
  initial: 'start',
  states: {
    start: {
      see: 'Nothing open yet: the first event seeds "Weekly rehearsal" with three focus songs and opens it.',
      on: { OPEN_LIVE: 'idle' },
    },
    idle: {
      see: 'Live mode on "Weekly rehearsal" with "Start rehearsal" and no clock; nothing saved yet.',
      source: 'RehearsalSession.tsx RehearsalSessionBar (status idle, admin)',
      on: { START: 'live' },
    },
    live: {
      see: 'The clock runs, "Rehearsing", Pause and End; the session is saved with no end.',
      source: 'RehearsalSessionBar (live); useRehearsalSession commit → saveRehearsalSession',
      on: { PAUSE: 'paused', END: 'confirming', RELOAD: 'live' },
    },
    paused: {
      see: '"Paused", the clock stands still, Resume; the saved session has a pause start.',
      source: 'rehearsalSession.ts pauseSession / elapsedSeconds',
      on: { RESUME: 'live' },
    },
    confirming: {
      see: '"End rehearsal?" with Keep going and End now; nothing ended yet.',
      source: 'RehearsalSessionBar confirmEnd',
      on: { KEEP_GOING: 'live', END_NOW: 'summary' },
    },
    summary: {
      see: 'The rehearsal summary: "N of 3 songs played" with the songs played, Resume rehearsal and Done; the saved session has an end and its songs.',
      source: 'RehearsalSummaryDialog; rehearsalSession.ts buildSummary',
      on: { DONE: 'ended', RESUME_REHEARSAL: 'live' },
    },
    ended: {
      see: 'The bar says "Ended" with Summary; no Pause or End.',
      source: 'RehearsalSessionBar (ended)',
      on: { SHOW_SUMMARY: 'summary', EXIT: 'page' },
    },
    page: {
      see: 'Back on the rehearsal: the REHEARSAL SESSION card says "Ended" and how many songs were played.',
      source: 'EventDetail.tsx REHEARSAL SESSION; RehearsalSessionCard',
    },
  },
  events: {
    OPEN_LIVE: { do: 'Open "Weekly rehearsal" and tap Open live mode.' },
    START: { do: 'Tap Start rehearsal.' },
    PAUSE: { do: 'Tap Pause.' },
    RESUME: { do: 'Tap Resume.' },
    END: { do: 'Tap End.' },
    KEEP_GOING: { do: 'Tap Keep going.' },
    END_NOW: { do: 'Tap End now (after moving on to the second song).' },
    DONE: { do: 'Tap Done in the summary.' },
    RESUME_REHEARSAL: { do: 'Tap Resume rehearsal in the summary.' },
    SHOW_SUMMARY: { do: 'Tap Summary.' },
    EXIT: { do: 'Tap Exit live mode.' },
    RELOAD: { do: 'Restart the app, open the rehearsal and Live mode again.' },
  },
  wide: [],
  knownBugs: [],
  manual: [
    "The member's side (the same clock, no controls, the summary at the end) runs in e2e/specs/rehearsal-session.spec.ts with two devices in one browser.",
    'Offline in the rehearsal room: the admin\'s changes are kept on the device and saved when back online (vitest useRehearsalSession); Bluetooth carries song changes but not the session.',
    'Duo Laptop: the floor wedge shows the session clock and Pause / Resume (rehearsal-session.spec @smoke); starting and ending are done unfolded.',
  ],
});
