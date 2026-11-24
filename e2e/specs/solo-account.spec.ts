import { test, expect, DB_KEY, DEMO_USER_ID, type App } from '../fixtures';
import { escapeRe } from '../support/flows';
import { hubRow, openHub } from '../support/hub';
import { pressItself } from '../support/tabs';

/**
 * A solo account: signed up on the "Solo schedule" path of "What brings you
 * here?" ("Manage personal gigs, sync private rehearsals and track your
 * earnings."). It has no band and no membership.
 *
 * It is never offered something that needs a band or other people (the band
 * chat, proposing a rehearsal, the members list, the band's repertoire, gear,
 * to-do lists, contracts, pricing, plan) unless the entry answers "Band
 * required" with "Create a band"; nothing opens a screen that loads forever
 * (owner's report, 11-24: Settings › Members opened a blank page with a
 * loader that never stopped); and what the solo path promises works.
 */

const SHOTS = process.env.SOLO_SHOTS;

/**
 * A new person on this device, as after "Create account": signed in, no band,
 * no deputy gigs, nothing left over from a band (the demo user is Leo M., who
 * the seed puts in Velvet Static). Then the onboarding's solo path, by hand.
 */
async function signUpSolo(app: App) {
  // Before the app starts (as on a new device): the offline cache of the
  // band session is deleted before the app opens it again, so nothing cached
  // from Velvet Static shows up for the new account.
  await app.page.addInitScript(
    ({ k, me }) => {
      if (sessionStorage.getItem('bw-e2e-solo')) return;
      sessionStorage.setItem('bw-e2e-solo', '1');
      const d = JSON.parse(localStorage.getItem(k) || '{}');
      d.band_members = (d.band_members || []).filter((m: { user_id: string }) => m.user_id !== me);
      d.demo_deputy_gigs = [];
      d.band_deputies = (d.band_deputies || []).filter((x: { user_id?: string }) => x.user_id !== me);
      d.notifications = (d.notifications || []).filter((n: { user_id?: string }) => n.user_id !== me);
      // A new account has no events yet. (And the demo backend has no
      // row-level security: another band's events and polls, which a new
      // account could never read, must not be there for it either.)
      d.events = [];
      d.event_members = [];
      d.rehearsal_polls = [];
      for (const p of d.profiles || []) {
        if (p.id === me) {
          p.role = 'member';
          p.user_mode = null;
        }
      }
      localStorage.setItem(k, JSON.stringify(d));
      for (const key of Object.keys(localStorage)) if (key.startsWith('bw:')) localStorage.removeItem(key);
      indexedDB.deleteDatabase('bandwith_offline_db');
    },
    { k: DB_KEY, me: DEMO_USER_ID },
  );
  await app.page.reload();

  // "What brings you here?" → Solo schedule → Tell us about you → Go to dashboard.
  const solo = app.page.getByRole('radio', { name: new RegExp(escapeRe(app.t('Solo schedule'))) });
  await expect(solo).toBeVisible({ timeout: 30_000 });
  await solo.click();
  await app.page.getByRole('button', { name: app.t('Continue'), exact: true }).click();
  await expect(app.page.getByRole('heading', { name: new RegExp(escapeRe(app.t('Tell us about you')), 'i') }).first()).toBeVisible();
  await app.page.getByRole('button', { name: app.t('Guitar'), exact: true }).click();
  await app.page.getByRole('button', { name: app.t('Continue'), exact: true }).click();
  await app.page.getByRole('button', { name: app.t('Go to dashboard'), exact: true }).click();
  await expect(app.page.getByRole('button', { name: app.t('Home'), exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await app.settle();
}

const anyButton = (app: App, source: string) =>
  app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t(source))}`, 'i') }).filter({ visible: true });

/** Nothing on screen is still loading. */
async function nothingLoads(app: App, where: string) {
  await app.settle();
  await expect(app.page.locator('.animate-spin').filter({ visible: true }), `no loader left spinning on ${where}`).toHaveCount(0);
}

async function look(app: App, where: string) {
  await nothingLoads(app, where);
  await app.check(where);
  if (SHOTS) await app.page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${where.replace(/\W+/g, '-')}.png` });
}

const bandRequired = (app: App) => app.page.getByRole('dialog', { name: app.t('Band required'), exact: true });
const chatTab = (app: App) => app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Chat'))}(,|$)`) }).first();

test.describe('solo account: nothing band-only is offered', () => {
  test('@smoke the solo path makes a solo account: no band, no membership', async ({ app }) => {
    await signUpSolo(app);
    const db = await app.readDb();
    const me = (db.profiles || []).find((p) => p.id === DEMO_USER_ID);
    expect(me?.user_mode, 'profiles.user_mode').toBe('solo');
    expect((db.band_members || []).filter((m) => m.user_id === DEMO_USER_ID), 'band memberships').toEqual([]);
    expect((db.bands || []).filter((b) => b.created_by === DEMO_USER_ID && String(b.created_at) > '2026-11-16'), 'bands made by signing up').toEqual([]);

    // Home is the personal calendar: no band role above it, no band to switch to.
    await expect(app.page.getByRole('heading', { level: 1, name: app.t('My calendar') }).first()).toBeVisible();
    await expect(app.page.getByText(app.t('Solo schedule'), { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect(anyButton(app, 'Switch band')).toHaveCount(0);
    await look(app, 'solo Home');

    // The empty calendar proposes nothing to a band that is not there
    // ("Propose a rehearsal to the band." was its empty state).
    await app.tab('Calendar');
    await expect(app.page.getByRole('heading', { name: app.t('Nothing scheduled'), exact: true })).toBeVisible();
    await expect(app.page.getByText(app.t('Propose a rehearsal to the band.'), { exact: true })).toHaveCount(0);
    for (const bandOnly of ['Propose rehearsal', 'New rehearsal', 'New gig', 'New quote', 'Rehearsal', 'Quote']) {
      await expect(app.page.getByRole('button', { name: app.t(bandOnly), exact: true }).filter({ visible: true }), bandOnly).toHaveCount(0);
    }
    await look(app, 'solo Calendar, empty');
    await app.tab('Home');

    // Still solo after closing and opening the app (not sent back to the onboarding).
    await app.page.reload();
    await expect(app.page.getByRole('heading', { level: 1, name: app.t('My calendar') }).first()).toBeVisible({ timeout: 30_000 });
  });

  test('@smoke Create offers the personal gig only, and it lands on the calendar with its fee', async ({ app }) => {
    await signUpSolo(app);
    await app.tab('Create');
    const menu = app.page.getByRole('dialog').last();
    await expect(menu.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Add personal gig'))}`, 'i') })).toBeVisible();
    for (const bandOnly of ['Propose rehearsal', 'New rehearsal', 'New gig', 'New quote']) {
      await expect(menu.getByRole('button', { name: new RegExp(`^${escapeRe(app.t(bandOnly))}`, 'i') }), bandOnly).toHaveCount(0);
    }
    await look(app, 'solo Create menu');

    await menu.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Add personal gig'))}`, 'i') }).click();
    await app.page.getByPlaceholder(app.t('e.g. Solo acoustic set @ The Blue Room'), { exact: true }).fill('Riverside solo set');
    await app.page.getByPlaceholder('0.00', { exact: true }).fill('150');
    await look(app, 'solo personal gig form');
    await app.page.getByRole('button', { name: app.t('Create personal gig'), exact: true }).click();
    await expect(app.page.getByRole('button', { name: app.t('Create personal gig'), exact: true })).toHaveCount(0);

    // Saved as the account's own gig, with its fee (the earnings tracker's row).
    await expect
      .poll(async () => {
        const db = await app.readDb();
        const gig = (db.events || []).find((e) => e.title === 'Riverside solo set');
        if (!gig) return null;
        const mine = (db.event_members || []).find((m) => m.event_id === gig.id && m.user_id === DEMO_USER_ID);
        return { band: gig.band_id ?? null, fee: Number(mine?.fee ?? NaN) };
      })
      .toEqual({ band: null, fee: 150 });

    await app.tab('Calendar');
    await expect(app.page.getByText('Riverside solo set').filter({ visible: true }).first()).toBeVisible();
    // The calendar offers no band event either.
    for (const bandOnly of ['Propose rehearsal', 'New rehearsal', 'New gig', 'New quote']) {
      await expect(anyButton(app, bandOnly), bandOnly).toHaveCount(0);
    }
    await look(app, 'solo Calendar');

    // Earnings: the fee counts as upcoming pay on Home, next to the gig.
    await app.tab('Home');
    await expect(app.page.getByLabel(new RegExp(`^${escapeRe(app.t('UPCOMING PAY'))}: \\D*150$`)).first()).toBeVisible();
    await expect(app.page.getByText('Riverside solo set').filter({ visible: true }).first()).toBeVisible();
    await look(app, 'solo Home with a gig');
  });

  test('@smoke Chat answers "Band required" with Create a band, and never opens a chat', async ({ app }) => {
    await signUpSolo(app);
    await pressItself(chatTab(app));
    await expect(bandRequired(app)).toBeVisible();
    await expect(
      bandRequired(app).getByText(app.t('Chat is only available when you’re in a band. Create one or ask an admin for an invite.')),
    ).toBeVisible();
    // No chat list and no way to start one behind it.
    await expect(app.page.getByRole('tablist', { name: app.t('Chat filters'), exact: true })).toHaveCount(0);
    await look(app, 'solo Chat, Band required');

    // "Maybe later" leaves it at that: still on Home.
    await bandRequired(app).getByRole('button', { name: app.t('Maybe later'), exact: true }).click();
    await expect(bandRequired(app)).toHaveCount(0);
    await expect(app.page.getByRole('heading', { level: 1, name: app.t('My calendar') }).first()).toBeVisible();

    // "Create a band" is the one way on: the band form.
    await pressItself(chatTab(app));
    await bandRequired(app).getByRole('button', { name: app.t('Create a band'), exact: true }).click();
    await expect(bandRequired(app)).toHaveCount(0);
    await expect(app.page.getByPlaceholder(app.t('e.g. The Jazz Collective'), { exact: true })).toBeVisible();
    await look(app, 'solo Create a band');
  });

  test('@smoke Settings shows no members, band assets, band settings or plan, only the way to a band', async ({ app }) => {
    await signUpSolo(app);
    await openHub(app);
    await expect(app.page.getByText(app.t('Solo schedule'), { exact: true }).filter({ visible: true }).first()).toBeVisible();
    // The row the owner tapped: it opened a page that loaded forever.
    await expect(anyButton(app, 'Members')).toHaveCount(0);
    for (const row of ['Repertoire', 'Gear & inventory', 'Contracts & docs', 'To-do lists', 'Pricing, fees & services', 'Band settings', 'New band']) {
      await expect(hubRow(app, row), row).toBeHidden();
    }
    await expect(app.page.getByRole('heading', { name: app.t('Band assets & workflows'), exact: true })).toHaveCount(0);
    await expect(app.page.getByRole('button', { name: app.t('Create a band'), exact: true }).filter({ visible: true })).toHaveCount(1);
    await look(app, 'solo Settings');

    // Settings & account: no plan (a plan is a band's).
    await hubRow(app, 'Settings & account').click();
    await expect(anyButton(app, 'Privacy & account').first()).toBeVisible();
    await expect(anyButton(app, 'Plan')).toHaveCount(0);
    await look(app, 'solo Settings & account');
  });
});
