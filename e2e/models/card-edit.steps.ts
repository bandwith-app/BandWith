import type { Locator } from '@playwright/test';
import { expect } from '../fixtures';
import type { App } from '../fixtures';
import { eventDetail, openEvent, SEED, systemBack } from '../support/flows';
import { editSheet, EVENT_IDS, lineupList, sectionEdit, showGigSetlist } from '../support/event';
import { cardEdit, setlistDraft, type Card } from './card-edit.model.ts';
import { stepsFor, type Ctx } from './steps.ts';

/**
 * One overview card: how to open its editor, make a change, and tell the
 * saved value from the old one on the overview.
 */
interface CardDef {
  event: string;
  open: (app: App) => Locator;
  title: string;
  change: (app: App, sheet: Locator) => Promise<void>;
  /** The change is still in the editor. */
  changed: (app: App, sheet: Locator) => Promise<void>;
  /** The overview shows the new value. */
  saved: (app: App) => Promise<void>;
  /** The overview still shows the old value. */
  unchanged: (app: App) => Promise<void>;
  /** Another card of the same event (Duo book: switch while dirty). */
  other: { open: (app: App) => Locator; title: string };
}

const detail = eventDetail;
// The Duo's rail carries the hero pencil outside the detail pane.
const heroBtn = (app: App) =>
  app.page.getByRole('button', { name: app.t('Edit title, date & times'), exact: true }).filter({ visible: true }).first();
const venueBtn = (app: App) => detail(app).getByRole('button', { name: app.t('Edit venue') });
const feeBtn = (app: App) => detail(app).getByRole('button', { name: app.t('Edit fee') });
const NOTE = 'Lift to the roof is behind the bar.';

const CARD: Record<Card, CardDef> = {
  hero: {
    event: SEED.gigToday,
    open: heroBtn,
    title: 'Title, date & times',
    change: (app, s) => s.getByLabel(app.t('Event title')).fill('Rooftop Session XL'),
    changed: (app, s) => expect(s.getByLabel(app.t('Event title'))).toHaveValue('Rooftop Session XL'),
    saved: (app) => expect(detail(app).getByRole('heading', { name: /Rooftop Session XL/i }).first()).toBeVisible(),
    unchanged: async (app) => {
      await expect(detail(app).getByRole('heading', { name: /Rooftop Session/i }).first()).toBeVisible();
      await expect(detail(app).getByRole('heading', { name: /Rooftop Session XL/i })).toHaveCount(0);
    },
    other: { open: venueBtn, title: 'Venue & location' },
  },
  venue: {
    event: SEED.gigToday,
    open: venueBtn,
    title: 'Venue & location',
    change: (app, s) => s.getByLabel(app.t('Address')).fill('Via Roma 1'),
    changed: (app, s) => expect(s.getByLabel(app.t('Address'))).toHaveValue('Via Roma 1'),
    saved: (app) => expect(detail(app).getByText(/Via Roma 1/i).first()).toBeVisible(),
    unchanged: async (app) => {
      await expect(detail(app).getByText(/Via Mazzini 12/i).first()).toBeVisible();
      await expect(detail(app).getByText(/Via Roma 1/i)).toHaveCount(0);
    },
    other: { open: feeBtn, title: 'Edit fee' },
  },
  lineup: {
    event: SEED.gigToday,
    open: (app) => sectionEdit(app, 'LINEUP'),
    title: 'Lineup',
    change: (_app, s) => s.getByRole('checkbox', { name: SEED.members[0], exact: true }).click(),
    changed: (_app, s) => expect(s.getByRole('checkbox', { name: SEED.members[0], exact: true })).toHaveAttribute('aria-checked', 'false'),
    saved: (app) => expect(lineupList(app)).not.toContainText(SEED.members[0], { ignoreCase: true }),
    unchanged: (app) => expect(lineupList(app)).toContainText(SEED.members[0], { ignoreCase: true }),
    other: { open: feeBtn, title: 'Edit fee' },
  },
  fee: {
    event: SEED.gigToday,
    open: feeBtn,
    title: 'Edit fee',
    change: (app, s) => s.getByLabel(app.t('Extra band fee / services')).fill('700'),
    changed: (app, s) => expect(s.getByLabel(app.t('Extra band fee / services'))).toHaveValue('700'),
    saved: (app) => expect(detail(app).getByText('€700').first()).toBeVisible(),
    unchanged: async (app) => {
      await expect(detail(app).getByText('€500').first()).toBeVisible();
      await expect(detail(app).getByText('€700')).toHaveCount(0);
    },
    other: { open: venueBtn, title: 'Venue & location' },
  },
  'to-dos': {
    event: SEED.gigToday,
    open: (app) => sectionEdit(app, 'TASKS'),
    title: 'Tasks',
    change: async (app, s) => {
      await s.getByPlaceholder(app.t('Add a preparation task...')).fill('Print the setlist');
      await s.getByRole('button', { name: app.t('Add'), exact: true }).click();
    },
    changed: (_app, s) =>
      expect.poll(() => s.locator('input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toContain('Print the setlist'),
    saved: (app) => expect(detail(app).getByText('Print the setlist')).toBeVisible(),
    unchanged: (app) => expect(detail(app).getByText('Print the setlist')).toHaveCount(0),
    other: { open: venueBtn, title: 'Venue & location' },
  },
  'client & notes': {
    event: SEED.gigToday,
    open: (app) => sectionEdit(app, 'CLIENT & NOTES'),
    title: 'Client & notes',
    change: (app, s) => s.getByLabel(app.t('Notes for the band')).fill(NOTE),
    changed: (app, s) => expect(s.getByLabel(app.t('Notes for the band'))).toHaveValue(NOTE),
    saved: (app) => expect(detail(app).getByText(NOTE)).toBeVisible(),
    unchanged: async (app) => {
      await expect(detail(app).getByText(/Parking in the back courtyard/).first()).toBeVisible();
      await expect(detail(app).getByText(NOTE)).toHaveCount(0);
    },
    other: { open: venueBtn, title: 'Venue & location' },
  },
  'studio cost': {
    event: SEED.rehearsalTomorrow,
    open: (app) => sectionEdit(app, 'STUDIO COST'),
    title: 'Studio cost',
    change: async (app, s) => {
      await s.getByRole('radio', { name: app.t('Paid') }).or(s.getByRole('button', { name: app.t('Paid'), exact: true })).first().click();
      await s.getByRole('spinbutton').fill('120');
    },
    changed: (_app, s) => expect(s.getByRole('spinbutton')).toHaveValue('120'),
    saved: (app) => expect(detail(app).getByText('€120').first()).toBeVisible(),
    unchanged: (app) => expect(detail(app).getByText('€120')).toHaveCount(0),
    other: { open: (app) => sectionEdit(app, 'TASKS'), title: 'Tasks' },
  },
};

const card = (c: Ctx) => CARD[c.variant as Card];
const sheet = (c: Ctx) => editSheet(c.app, card(c).title);
const question = (app: App) =>
  app.page.getByRole('dialog').filter({ hasText: app.t('Save your changes?') }).last();
const questionBtn = (app: App, name: string) => question(app).getByRole('button', { name: app.t(name), exact: true });

async function noQuestion(app: App) {
  await expect(app.page.getByRole('dialog').filter({ hasText: app.t('Save your changes?') })).toHaveCount(0);
}

export const cardEditSteps = stepsFor(cardEdit, {
  states: {
    start: async () => {},
    overview: async (c) => {
      await expect(card(c).open(c.app)).toBeVisible();
      await c.app.check(`overview (${c.variant})`);
    },
    clean: async (c) => {
      await expect(sheet(c)).toBeVisible();
      await expect(sheet(c).getByRole('button', { name: c.app.t('Save'), exact: true })).toBeDisabled();
      await c.app.check(`${c.variant} editor`);
    },
    closedUnchanged: async (c) => {
      await expect(sheet(c)).toBeHidden();
      await noQuestion(c.app);
      await card(c).unchanged(c.app);
    },
    dirty: async (c) => {
      await expect(sheet(c)).toBeVisible();
      await noQuestion(c.app);
      await card(c).changed(c.app, sheet(c));
      await expect(sheet(c).getByRole('button', { name: c.app.t('Save'), exact: true })).toBeEnabled();
    },
    leavePrompt: async (c) => {
      await expect(question(c.app)).toBeVisible();
      for (const b of ['Save changes', 'Discard', 'Keep editing']) await expect(questionBtn(c.app, b).first()).toBeVisible();
      await c.app.check(`${c.variant}: save your changes?`);
    },
    switchPrompt: async (c) => {
      await expect(question(c.app)).toBeVisible();
      await expect(editSheet(c.app, card(c).other.title)).toHaveCount(0);
      await c.app.check(`${c.variant}: switch, save your changes?`);
    },
    otherCard: async (c) => {
      await expect(editSheet(c.app, card(c).other.title)).toBeVisible();
      await noQuestion(c.app);
      await card(c).unchanged(c.app);
    },
    saved: async (c) => {
      await expect(sheet(c)).toBeHidden();
      await noQuestion(c.app);
      await card(c).saved(c.app);
      await c.app.check(`${c.variant} saved`);
    },
    memberView: async ({ app }) => {
      for (const title of [SEED.gigToday, SEED.rehearsalTomorrow]) {
        await openEvent(app, title);
        for (const name of ['Edit title, date & times', 'Edit venue', 'Edit fee']) {
          await expect(detail(app).getByRole('button', { name: app.t(name) })).toHaveCount(0);
        }
        await expect(detail(app).getByRole('button', { name: new RegExp(`^${app.t('EDIT')}:`) })).toHaveCount(0);
        await app.check(`member: ${title}`);
        await systemBack(app);
        await expect(detail(app)).toBeHidden();
        // Opened from Search (card not reachable, e.g. Duo Laptop's Planner
        // or a slow agenda): Back lands on the results; leave them too.
        const results = app.page.getByRole('dialog', { name: app.t('Search events') });
        if (await results.isVisible()) {
          await systemBack(app);
          await expect(results).toBeHidden();
        }
      }
    },
  },
  events: {
    OPEN_EVENT: (c) => openEvent(c.app, card(c).event),
    AS_MEMBER: (c) => c.app.setRole('member'),
    OPEN: async (c) => {
      await card(c).open(c.app).click();
      await c.app.settle();
    },
    CHANGE: (c) => card(c).change(c.app, sheet(c)),
    ESCAPE: (c) => systemBack(c.app),
    BROWSER_BACK: async (c) => {
      await c.app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
      await c.app.page.evaluate(() => history.back());
      await c.app.settle();
    },
    CANCEL: (c) => sheet(c).getByRole('button', { name: c.app.t('Cancel'), exact: true }).click(),
    CLOSE_X: (c) => sheet(c).getByRole('button', { name: c.app.t('Close'), exact: true }).first().click(),
    SAVE: async (c) => {
      await sheet(c).getByRole('button', { name: c.app.t('Save'), exact: true }).click();
      await c.app.settle();
    },
    SWITCH_CARD: (c) => card(c).other.open(c.app).click(),
    KEEP_EDITING: async (c) => {
      await questionBtn(c.app, 'Keep editing').first().click();
      await expect(question(c.app)).toBeHidden();
    },
    DISCARD: async (c) => {
      await questionBtn(c.app, 'Discard').click();
      await c.app.settle();
    },
    SAVE_CHANGES: async (c) => {
      await questionBtn(c.app, 'Save changes').click();
      await c.app.settle();
    },
  },
});

/* ─────────── Setlist / focus songs draft ─────────── */

interface SongsDef {
  event: string;
  id: string;
  open: (app: App) => Promise<void>;
  /** Template to load, and a song only it has. */
  template: RegExp;
  newSong: string;
  /** Songs saved before the change. */
  savedCount: number;
  newCount: number;
}

const SONGS: Record<string, SongsDef> = {
  'gig setlist': {
    event: SEED.gigToday,
    id: EVENT_IDS.rooftop,
    open: (app) => showGigSetlist(app),
    template: /Wedding — dinner \+ party/i,
    newSong: 'I Wish',
    savedCount: 10,
    newCount: 8,
  },
  'focus songs': {
    event: SEED.rehearsalTomorrow,
    id: EVENT_IDS.weeklyRehearsal,
    open: async (app) => {
      await sectionEdit(app, 'FOCUS SONGS').click();
      await expect(songsSheet(app)).toBeVisible();
      await app.settle();
    },
    template: /Rooftop set/i,
    newSong: 'Superstition',
    savedCount: 0,
    newCount: 10,
  },
};
const songs = (c: Ctx) => SONGS[c.variant];
const songsSheet = (app: App) => app.page.getByRole('dialog').filter({ hasText: new RegExp(app.t('Focus songs'), 'i') }).last();
/** Where the songs are edited: the sheet (rehearsal) or the overview (gig). */
const songsHost = (c: Ctx) => (c.variant === 'focus songs' ? songsSheet(c.app) : eventDetail(c.app));
const bar = (app: App) => app.page.getByRole('region', { name: app.t('Unsaved changes') }).filter({ visible: true });
const barBtn = (app: App, name: string) => bar(app).getByRole('button', { name: app.t(name), exact: true });
const setlistQuestion = (app: App) => app.page.getByRole('dialog').filter({ hasText: app.t('Save the setlist changes?') }).last();

/** Songs the database holds for the event. */
async function dbSongs(c: Ctx): Promise<number> {
  const db = await c.app.readDb();
  const setlistId = db.events.find((e) => e.id === songs(c).id)?.setlist_id;
  return setlistId ? db.setlist_songs.filter((s) => s.setlist_id === setlistId).length : 0;
}

export const setlistDraftSteps = stepsFor(setlistDraft, {
  states: {
    start: async () => {},
    overview: async (c) => {
      await expect(eventDetail(c.app)).toBeVisible();
    },
    clean: async (c) => {
      await expect(songsHost(c).getByRole('button', { name: c.app.t('Templates'), exact: true }).or(songsHost(c).getByRole('button', { name: songs(c).template }).first()).first()).toBeVisible();
      await expect(bar(c.app)).toHaveCount(0);
      await expect.poll(() => dbSongs(c)).toBe(songs(c).savedCount);
      await c.app.check(`${c.variant} editor`);
    },
    dirty: async (c) => {
      await expect(bar(c.app)).toBeVisible();
      await expect(barBtn(c.app, 'Cancel')).toBeVisible();
      await expect(barBtn(c.app, 'Save')).toBeVisible();
      await expect(songsHost(c).getByRole('button', { name: `Reorder ${songs(c).newSong}` })).toBeVisible();
      await c.app.check(`${c.variant} draft`);
    },
    draftKept: async (c) => {
      await expect(songsSheet(c.app)).toHaveCount(0);
      await expect(bar(c.app)).toBeVisible();
      await expect(setlistQuestion(c.app)).toHaveCount(0);
      await expect.poll(() => dbSongs(c)).toBe(songs(c).savedCount);
    },
    leavePrompt: async (c) => {
      await expect(setlistQuestion(c.app)).toBeVisible();
      for (const b of ['Save changes', 'Discard']) await expect(setlistQuestion(c.app).getByRole('button', { name: c.app.t(b), exact: true })).toBeVisible();
      await c.app.check(`${c.variant}: save the setlist changes?`);
    },
    saved: async (c) => {
      await expect(bar(c.app)).toHaveCount(0);
      await expect.poll(() => dbSongs(c)).toBe(songs(c).newCount);
    },
    leftUnchanged: async (c) => {
      await expect(eventDetail(c.app)).toBeHidden();
      await expect.poll(() => dbSongs(c)).toBe(songs(c).savedCount);
    },
    leftSaved: async (c) => {
      await expect(eventDetail(c.app)).toBeHidden();
      await expect.poll(() => dbSongs(c)).toBe(songs(c).newCount);
    },
  },
  events: {
    OPEN_EVENT: (c) => openEvent(c.app, songs(c).event),
    OPEN_SONGS: (c) => songs(c).open(c.app),
    CHANGE: async (c) => {
      const host = songsHost(c);
      const templates = host.getByRole('button', { name: c.app.t('Templates'), exact: true });
      if (await templates.count()) await templates.click();
      await host.getByRole('button', { name: songs(c).template }).first().click();
      await c.app.settle();
    },
    CANCEL_DRAFT: (c) => barBtn(c.app, 'Cancel').click(),
    SAVE_DRAFT: async (c) => {
      await barBtn(c.app, 'Save').click();
      await c.app.settle();
    },
    CLOSE_SONGS: async (c) => {
      if (c.variant !== 'focus songs') return;
      await songsSheet(c.app).getByRole('button', { name: c.app.t('Close sheet'), exact: true }).click();
      await c.app.settle();
    },
    LEAVE_EVENT: async (c) => {
      await eventDetail(c.app).getByRole('button', { name: c.app.t('Back'), exact: true }).first().click();
      await c.app.settle();
    },
    KEEP_EDITING: async (c) => {
      await setlistQuestion(c.app).getByRole('button', { name: c.app.t('Keep editing'), exact: true }).first().click();
      await expect(setlistQuestion(c.app)).toBeHidden();
    },
    DISCARD: (c) => setlistQuestion(c.app).getByRole('button', { name: c.app.t('Discard'), exact: true }).click(),
    SAVE_CHANGES: (c) => setlistQuestion(c.app).getByRole('button', { name: c.app.t('Save changes'), exact: true }).click(),
  },
});
