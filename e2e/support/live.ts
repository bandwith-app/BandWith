import { expect, test, type Locator } from '@playwright/test';
import type { App } from '../fixtures';
import { openWith } from './rehearsal';

/**
 * Rehearsal Live mode helpers (stage-live, rehearsal-session and the
 * rehearsal-live model): focus songs on "Weekly rehearsal" and a saved
 * session (migration 131) seeded before the app opens.
 */

export const WEEKLY = 'Weekly rehearsal';
export const FOCUS = ['Paper Boats', 'Harbor Lights', 'Superstition'] as const;

export interface SeedSession {
  /** Minutes rehearsed so far (the session started this long ago, no pauses). */
  minutesAgo: number;
  /** Ended this many minutes ago (default: still running). */
  endedMinutesAgo?: number;
  /** Songs played (focus song titles). */
  played?: string[];
}

/** A rehearsal note (migration 132) seeded on the occurrence. */
export interface SeedNote {
  id: string;
  /** Focus song title; null = a general note. */
  song: string | null;
  preset?: string | null;
  body?: string | null;
  status?: 'marked' | 'open' | 'ok';
  /** For me (scope members, I'm the assignee); otherwise for the band. */
  forMe?: boolean;
  /** Practised by me already. */
  practised?: boolean;
  /** Written by another band member (not me). */
  byOther?: boolean;
  markedAtS?: number | null;
}

/**
 * Opens the app with "Weekly rehearsal" (tomorrow) given three focus songs
 * and, optionally, a saved session and notes for that occurrence.
 */
export async function openWithFocusSongs(app: App, session?: SeedSession, notes: SeedNote[] = []) {
  const seed = JSON.stringify(session ?? null);
  const seedNotes = JSON.stringify(notes);
  const body = `(db, ids) => {
    const reh = ids.byTitle('Weekly rehearsal');
    const song = (title) => db.songs.find((s) => s.title === title);
    const list = '20000000-0000-4000-8000-000000000990';
    db.setlists.push({
      id: list, band_id: reh.band_id, name: 'Weekly focus', description: null,
      is_template: false, song_count: 3, total_duration_seconds: 660, created_by: ids.me,
      created_at: reh.created_at, updated_at: reh.created_at,
    });
    ['Paper Boats', 'Harbor Lights', 'Superstition'].forEach((title, i) =>
      db.setlist_songs.push({
        id: '20000000-0000-4000-8000-00000000099' + (i + 1), setlist_id: list,
        song_id: song(title).id, position: i + 1, set_number: 1, notes: null, created_at: reh.created_at,
      }),
    );
    reh.setlist_id = list;
    const s = ${seed};
    if (s) {
      const now = Date.now();
      const iso = (min) => new Date(now - min * 60000).toISOString();
      const played = (s.played || []).map((title) => ({ id: song(title).id, title }));
      db.rehearsal_sessions = [{
        id: '20000000-0000-4000-8000-000000000980', band_id: reh.band_id, event_id: reh.id,
        occurrence_date: String(reh.event_date).slice(0, 10), started_at: iso(s.minutesAgo), paused_ms: 0,
        paused_at: null, ended_at: s.endedMinutesAgo == null ? null : iso(s.endedMinutesAgo), started_by: ids.me,
        summary: { v: 1, durationS: (s.minutesAgo - (s.endedMinutesAgo || 0)) * 60, played, total: 3 },
        created_at: iso(s.minutesAgo), updated_at: iso(0),
      }];
    }
    const other = db.band_members.find((m) => m.band_id === reh.band_id && m.user_id !== ids.me).user_id;
    const at = new Date(Date.now() - 3600000).toISOString();
    db.rehearsal_notes = [];
    db.rehearsal_note_assignees = [];
    ${seedNotes}.forEach((n, i) => {
      db.rehearsal_notes.push({
        id: n.id, band_id: reh.band_id, event_id: reh.id, occurrence_date: String(reh.event_date).slice(0, 10),
        session_id: null, song_id: n.song ? song(n.song).id : null, song_title: n.song, preset: n.preset ?? null,
        section: null, body: n.body ?? null, scope: n.forMe ? 'members' : 'band', status: n.status ?? 'open',
        marked_at_s: n.markedAtS ?? null, created_by: n.byOther ? other : ids.me, ok_by: null, ok_at: null,
        created_at: new Date(Date.parse(at) + i * 1000).toISOString(), updated_at: at,
      });
      if (n.forMe) db.rehearsal_note_assignees.push({ note_id: n.id, user_id: ids.me, practised_at: n.practised ? at : null, created_at: at });
    });
  }`;
  // eslint-disable-next-line no-new-func
  await openWith(app, new Function(`return ${body}`)() as never);
}

/** Duo Laptop pose: the floor wedge (FloorWedgeMode) covers the live screen. */
export const isLaptop = () => test.info().project.name === 'duo-laptop';

export const liveDialog = (app: App, title = WEEKLY): Locator =>
  app.page.getByRole('dialog', { name: app.t('Live mode: {title}', { title }) });

export async function openLive(app: App, title = WEEKLY) {
  await app.button('Open live mode', { exact: true }).first().click();
  await expect(liveDialog(app, title)).toBeAttached();
  await app.settle();
}

/** The session timer in Live mode. */
export const timerBar = (app: App, title = WEEKLY) => liveDialog(app, title).getByRole('region', { name: app.t('Rehearsal timer') });
export const timer = (app: App, title = WEEKLY) => timerBar(app, title).getByRole('timer');

/** The saved session row of "Weekly rehearsal" in the demo database. */
export async function savedSession(app: App) {
  const db = await app.readDb();
  const reh = db.events.find((e) => e.title === WEEKLY)!;
  return (db.rehearsal_sessions ?? []).find((r) => r.event_id === reh.id) as Record<string, any> | undefined;
}

/** The notes bar in Live mode (Mark, the notes). */
export const notesBar = (app: App, title = WEEKLY) => liveDialog(app, title).getByRole('region', { name: app.t('Rehearsal notes') });

/** A sheet by its title (BwSheet's dialog is named by its heading). */
export const sheet = (app: App, title: string | RegExp) =>
  app.page.getByRole('dialog').filter({ has: app.page.getByRole('heading', { name: title }) });

/** The saved notes of "Weekly rehearsal" in the demo database. */
export async function savedNotes(app: App) {
  const db = await app.readDb();
  const reh = db.events.find((e) => e.title === WEEKLY)!;
  return ((db.rehearsal_notes ?? []) as Record<string, any>[]).filter((r) => r.event_id === reh.id);
}
