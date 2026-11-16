import { expect } from '../fixtures';
import type { App } from '../fixtures';
import { escapeRe, eventDetail, openEvent, SEED } from '../support/flows';
import { openHub } from '../support/hub';
import { deputy } from './deputy.model.ts';
import { ME } from './poll.steps.ts';
import { stepsFor } from './steps.ts';

const LENA = '10000004-0000-4000-8000-000000000004';
const LUCA = '100007d0-0000-4000-8000-000000002000'; // band_deputies id(2000)
const BAND = 'The Late Shift';
const BRUNCH = 'Jazz Brunch';
const SUMMER = 'Summer Wedding';
const STREET = 'Via XX Settembre 48';

const roster = (app: App) => app.page.getByRole('list', { name: app.t('Deputies') }).filter({ visible: true }).first();
const rosterRow = (app: App, name: string) => roster(app).getByRole('listitem').filter({ hasText: name });
/** The deputy edit sheet (its title changes with the question it asks). */
const editSheet = (app: App) => app.page.getByRole('dialog').filter({ hasText: 'Luca T.' }).last();
const onBandWith = (app: App) => app.t('On BandWith');
const askRow = (app: App, name: string) =>
  app.page.getByRole('dialog').filter({ hasText: app.t('Find a deputy') }).last().getByRole('listitem').filter({ hasText: name });
const gig = (app: App, title: string) => app.page.getByRole('article', { name: `${title} · ${BAND}` });
const answer = (app: App, title: string, name: string) => gig(app, title).getByRole('button', { name: app.t(name), exact: true });

async function dbDeputyGig(app: App, title: string) {
  const db = await app.readDb();
  return db.demo_deputy_gigs.find((g) => g.event_title === title);
}
async function dbLuca(app: App) {
  const db = await app.readDb();
  return db.band_deputies.find((d) => d.id === LUCA);
}

/** Lena P. declines the Wedding; the app opens again on Home. */
async function lenaDeclines(app: App) {
  await app.editDb((db) => {
    const ev = db.events.find((e) => e.title === SEED.wedding)!;
    for (const m of db.event_members) if (m.event_id === ev.id && m.user_id === LENA) m.status = 'declined';
  });
  await app.open();
}

async function openLineup(app: App) {
  await openEvent(app, SEED.wedding);
  await eventDetail(app).getByRole('button', { name: app.t('Open lineup details') }).click();
  await app.settle();
}

const findDeputyBtn = (app: App) =>
  app.page.getByRole('button', { name: app.t('Find a deputy', { context: 'button' }), exact: true }).filter({ visible: true });

async function answered(app: App, label: string, status: string, street: boolean) {
  const card = gig(app, BRUNCH);
  await expect(card.getByRole('status').first()).toHaveText(app.t(label));
  await expect(card.getByText(STREET)).toHaveCount(street ? 1 : 0);
  await expect(card.getByRole('button', { name: app.t('Change your answer') })).toBeVisible();
  await expect(answer(app, BRUNCH, 'Yes')).toHaveCount(0);
  await expect.poll(async () => (await dbDeputyGig(app, BRUNCH))?.status).toBe(status);
}

export const deputySteps = stepsFor(deputy, {
  states: {
    home: async ({ app }) => {
      await expect(app.page.getByRole('button', { name: app.t('Home'), exact: true }).first()).toBeVisible();
    },
    roster: async ({ app }) => {
      await expect(roster(app)).toBeVisible();
      await expect(app.page.getByText(app.t("Session players you call when a member can't make a gig. Only admins see this list."))).toBeVisible();
      await expect(rosterRow(app, 'Luca T.')).toContainText(onBandWith(app));
      for (const n of ['Noa B.', 'Ivo M.']) {
        await expect(rosterRow(app, n)).toBeVisible();
        await expect(rosterRow(app, n)).not.toContainText(onBandWith(app));
      }
      await app.check('deputies');
    },
    lucaSheet: async ({ app }) => {
      await expect(editSheet(app)).toContainText(app.t('{name} answers in the app: requests and changes reach them as notifications.', { name: 'Luca T.' }));
      await expect(editSheet(app).getByRole('button', { name: app.t('Unlink account') })).toBeVisible();
      await app.check('edit a linked deputy');
    },
    unlinkPrompt: async ({ app }) => {
      await expect(editSheet(app)).toContainText(app.t('Unlink BandWith account?'));
      await expect(editSheet(app)).toContainText(app.t('Links already sent stop working. Send the next request by message: opening its new link from the app links the right account.'));
      await expect(editSheet(app).getByRole('button', { name: app.t('Cancel'), exact: true })).toBeVisible();
      await expect(editSheet(app).getByRole('button', { name: app.t('Unlink'), exact: true })).toBeVisible();
      await app.check('unlink BandWith account?');
    },
    unlinked: async ({ app }) => {
      await expect(app.page.getByText(app.t('Unlinked. Send the next request by message: its new link lets them join again from the app.'))).toBeVisible();
      await expect(editSheet(app).getByRole('button', { name: app.t('Unlink account') })).toHaveCount(0);
      await expect(editSheet(app).getByText(onBandWith(app), { exact: true })).toHaveCount(0);
      expect((await dbLuca(app))?.user_id ?? null).toBeNull();
    },
    askByMessageOnly: async ({ app }) => {
      const luca = askRow(app, 'Luca T.');
      await expect(luca).toBeVisible();
      await expect(luca.getByText(onBandWith(app), { exact: true })).toHaveCount(0);
      await expect(luca.getByRole('button', { name: app.t('Ask in the app') })).toHaveCount(0);
      await expect(luca.getByRole('button', { name: /WhatsApp|Email/i }).first()).toBeVisible();
      await app.check('find a deputy after the unlink');
    },
    lineupDeclined: async ({ app }) => {
      await expect(findDeputyBtn(app)).toHaveCount(1);
      await app.check('lineup with a declined member');
    },
    askSheet: async ({ app }) => {
      await expect(app.page.getByText(app.t('Replacing {name}', { name: 'Lena P.' }), { exact: false }).first()).toBeVisible();
      const luca = askRow(app, 'Luca T.');
      await expect(luca.getByText(onBandWith(app), { exact: true })).toBeVisible();
      await expect(luca.getByRole('button', { name: app.t('Ask in the app') })).toBeVisible();
      for (const n of ['Noa B.', 'Ivo M.']) {
        await expect(askRow(app, n).getByRole('button', { name: app.t('Ask in the app') })).toHaveCount(0);
      }
      await app.check('find a deputy');
    },
    askedInApp: async ({ app }) => {
      const luca = askRow(app, 'Luca T.');
      await expect(luca.getByText(app.t('Sent in the app: they get a notification.'))).toBeVisible();
      await expect(luca.getByText(app.t('Asked · no answer yet'))).toBeVisible();
      const db = await app.readDb();
      const ev = db.events.find((e) => e.title === SEED.wedding)!;
      const req = db.deputy_requests.find((r) => r.event_id === ev.id && r.deputy_id === LUCA);
      expect(req?.status).toBe('pending');
      expect(req?.replaces_user_id).toBe(LENA);
    },
    welcome: async ({ app }) => {
      const screen = app.page.getByRole('dialog', { name: app.t('Deputy gigs') });
      await expect(screen).toBeVisible();
      await expect(screen.getByText(app.t("You're on {band}'s deputy list", { band: BAND }))).toBeVisible();
      await expect(screen.getByText(app.t('Your gigs with {band} are below.', { band: BAND }))).toBeVisible();
      await app.check('deputy link welcome');
    },
    deputyGigs: async ({ app }) => {
      await expect(app.page.getByText(app.t("You're on {band}'s deputy list", { band: BAND }))).toHaveCount(0);
      const card = gig(app, BRUNCH);
      await expect(card.getByRole('status').first()).toHaveText(app.t('Waiting for your answer'));
      for (const n of ['Yes', 'Not sure yet', "No, I can't"]) await expect(answer(app, BRUNCH, n)).toBeVisible();
      await expect(card.getByText(STREET)).toHaveCount(0);
      await expect(gig(app, SUMMER).getByRole('region', { name: app.t('Something changed') })).toBeVisible();
      await app.check('deputy gigs');
    },
    saidYes: async ({ app }) => {
      await answered(app, 'You said yes', 'available', true);
      await app.check('deputy said yes');
    },
    changing: async ({ app }) => {
      for (const n of ['Yes', 'Not sure yet', "No, I can't", 'Cancel']) await expect(answer(app, BRUNCH, n)).toBeVisible();
    },
    saidMaybe: async ({ app }) => {
      await answered(app, "You'll confirm later", 'maybe', false);
    },
    saidNo: async ({ app }) => {
      await answered(app, "You said you can't", 'unavailable', false);
    },
    stillOk: async ({ app }) => {
      const card = gig(app, SUMMER);
      await expect(card.getByRole('region', { name: app.t('Something changed') })).toHaveCount(0);
      await expect(card.getByRole('status').first()).toHaveText(app.t('You said yes'));
      await expect.poll(async () => (await dbDeputyGig(app, SUMMER))?.changes).toEqual([]);
    },
    deputyHome: async ({ app }) => {
      await expect(app.page.getByRole('heading', { level: 1, name: app.t('Deputy gigs') })).toBeVisible();
      await expect(app.page.getByText(app.t('Playing in a band too?'))).toBeVisible();
      await expect(app.page.getByRole('button', { name: app.t('Set up your band') })).toBeVisible();
      await expect(answer(app, BRUNCH, 'Yes')).toBeVisible();
      await app.check('deputy home (no band)');
    },
  },
  events: {
    OPEN_ROSTER: async ({ app }) => {
      await openHub(app);
      await app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Members'))} \\(\\d+\\)`) }).first().click();
      await app.settle();
      await roster(app).scrollIntoViewIfNeeded();
    },
    EDIT_LUCA: async ({ app }) => {
      await rosterRow(app, 'Luca T.').getByRole('button').click();
      await app.settle();
    },
    UNLINK: ({ app }) => editSheet(app).getByRole('button', { name: app.t('Unlink account') }).click(),
    CANCEL: ({ app }) => editSheet(app).getByRole('button', { name: app.t('Cancel'), exact: true }).click(),
    CONFIRM_UNLINK: async ({ app }) => {
      await editSheet(app).getByRole('button', { name: app.t('Unlink'), exact: true }).click();
      await app.settle();
    },
    ASK_AFTER_UNLINK: async ({ app }) => {
      await lenaDeclines(app);
      await openLineup(app);
      await findDeputyBtn(app).click();
      await app.settle();
    },
    MEMBER_DECLINED: async ({ app }) => {
      await lenaDeclines(app);
      await openLineup(app);
    },
    FIND_DEPUTY: async ({ app }) => {
      await findDeputyBtn(app).click();
      await app.settle();
    },
    ASK_IN_APP: async ({ app }) => {
      await askRow(app, 'Luca T.').getByRole('button', { name: app.t('Ask in the app') }).click();
      await app.settle();
    },
    OPEN_CLAIM_LINK: ({ app }) => app.open(`/?deputy=${'d'.repeat(64)}`),
    OK: async ({ app }) => {
      await app.page.getByRole('dialog', { name: app.t('Deputy gigs') }).getByRole('button', { name: app.t('OK'), exact: true }).click();
    },
    YES: ({ app }) => answer(app, BRUNCH, 'Yes').click(),
    NOT_SURE: ({ app }) => answer(app, BRUNCH, 'Not sure yet').click(),
    NO: ({ app }) => answer(app, BRUNCH, "No, I can't").click(),
    CHANGE_ANSWER: ({ app }) => gig(app, BRUNCH).getByRole('button', { name: app.t('Change your answer') }).click(),
    CANCEL_CHANGE: ({ app }) => answer(app, BRUNCH, 'Cancel').click(),
    STILL_OK: ({ app }) => gig(app, SUMMER).getByRole('button', { name: app.t('Still OK'), exact: true }).click(),
    NO_BAND: async ({ app }) => {
      // Leaves the band and drops the cached band list before the app starts
      // (as a new device would): the IndexedDB cache is deleted before the
      // app opens it again.
      await app.page.addInitScript((me) => {
        if (sessionStorage.getItem('bw-e2e-no-band')) return;
        sessionStorage.setItem('bw-e2e-no-band', '1');
        const k = 'bw-demo-db-v6';
        const d = JSON.parse(localStorage.getItem(k) || '{}');
        d.band_members = (d.band_members || []).filter((m: { user_id: string }) => m.user_id !== me);
        localStorage.setItem(k, JSON.stringify(d));
        for (const key of Object.keys(localStorage)) if (key.startsWith('bw:')) localStorage.removeItem(key);
        localStorage.setItem('bw-role-tour-seen:deputy', '1');
        indexedDB.deleteDatabase('bandwith_offline_db');
      }, ME);
      await app.page.reload();
      await expect(app.page.getByRole('heading', { level: 1, name: app.t('Deputy gigs') })).toBeVisible({ timeout: 30_000 });
      await app.settle();
    },
  },
});
