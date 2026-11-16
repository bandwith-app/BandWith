import { test, expect, DB_KEY, DEMO_USER_ID, type App } from '../fixtures';
import { isWide, openCreate, openEvent, SEED } from '../support/flows';

/**
 * Layers that must work on special layouts.
 *
 * - @laptop (Duo in Laptop pose only): the Create layers keep every control
 *   off the fold band (app.check measures it). Known open bug on main:
 *   member "Log personal gig" (its venue search) and the rehearsal wizard
 *   put controls on it.
 * - iPad composers: the location field suggests venues while typing
 *   (reported on device; passes here with the stubbed place search).
 */

const venueSuggestion = (app: App, q: string) => app.page.getByRole('option', { name: new RegExp(`${q} Studios`) });

test.describe('Duo Laptop pose: nothing on the fold', () => {
  test.describe('member', () => {
    test.use({ role: 'member' });

    test('@laptop Log personal gig and its venue search stay off the fold', async ({ app }) => {
      await openCreate(app, 'Add personal gig');
      await app.check('Log personal gig');
      // The field's placeholder changed in #180 ("Search venue…").
      const venue = app.page
        .getByPlaceholder(app.t('Search venue…'))
        .or(app.page.getByPlaceholder(app.t('Search venue or location...')))
        .filter({ visible: true })
        .first();
      await venue.click();
      await venue.fill('Blackbox');
      await expect(venueSuggestion(app, 'Blackbox').first()).toBeVisible();
      await app.check('Log personal gig: venue search');
    });

    test('@laptop Propose rehearsal stays off the fold', async ({ app }) => {
      await openCreate(app, 'Propose rehearsal');
      await expect(app.page.getByPlaceholder(app.t('e.g. Practice new setlist transitions'))).toBeVisible();
      await app.check('Propose rehearsal');
    });
  });

  test('@laptop the rehearsal wizard stays off the fold', async ({ app }) => {
    await openCreate(app, 'New rehearsal');
    await app.check('rehearsal wizard');
  });

  test('@laptop the poll builder stays off the fold', async ({ app }) => {
    await openCreate(app, 'New rehearsal');
    await app.page.getByRole('radio', { name: app.t('Poll availability') }).click();
    await expect(app.page.getByPlaceholder(app.t('e.g. Extra rehearsal before the wedding'))).toBeVisible();
    await app.check('poll builder');
  });

  test('@laptop the Create menu and the gig wizard stay off the fold', async ({ app }) => {
    await app.tab('Create');
    await app.check('Create menu');
    await app.page.getByRole('dialog').last().getByRole('button', { name: new RegExp(`^${app.t('New gig')}`, 'i') }).first().click();
    await app.check('gig wizard');
  });
});

/**
 * The account leaves its band (the demo user stays signed in): with deputy
 * gigs it lands on "Deputy gigs", without them on onboarding. Like a fresh
 * install, the offline cache of the band session is cleared.
 */
async function leaveBand(app: App, keepDeputyGigs: boolean) {
  await app.page.evaluate(
    ({ k, me, keep }) => {
      const d = JSON.parse(localStorage.getItem(k) || '{}');
      d.band_members = (d.band_members || []).filter((m: { user_id: string }) => m.user_id !== me);
      if (!keep) {
        d.demo_deputy_gigs = [];
        d.band_deputies = (d.band_deputies || []).filter((x: { user_id?: string }) => x.user_id !== me);
      }
      localStorage.setItem(k, JSON.stringify(d));
      for (const key of Object.keys(localStorage)) if (key.startsWith('bw:')) localStorage.removeItem(key);
      indexedDB.deleteDatabase('bandwith_offline_db');
    },
    { k: DB_KEY, me: DEMO_USER_ID, keep: keepDeputyGigs },
  );
  await app.page.reload();
}

test.describe('Duo Laptop pose: screens off the fold', () => {
  test('@laptop Stage mode: no setlist row rests on the fold', async ({ app }) => {
    await openEvent(app, SEED.gigToday);
    await app.page.getByRole('button', { name: app.t('Open stage mode'), exact: true }).filter({ visible: true }).first().click();
    await expect(app.page.getByRole('button', { name: new RegExp(`^${app.t('Go to')} `) }).first()).toBeVisible();
    // Laptop pose: the floor wedge covers Stage mode, also when the gig was
    // opened over a hub (search, Calendar).
    await expect(app.page.getByRole('region', { name: app.t('Song controls') })).toBeVisible();
    await app.check('Stage mode');
  });

  test('@laptop Deputy gigs: the reply field is off the fold', async ({ app }) => {
    await leaveBand(app, true);
    await expect(app.page.getByRole('textbox').filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await app.check('Deputy gigs');
  });

  test('@laptop onboarding: "What brings you here?" keeps its path cards off the fold', async ({ app }) => {
    await leaveBand(app, false);
    await expect(app.page.getByRole('radio', { name: new RegExp(app.t('Manage my band')) })).toBeVisible({ timeout: 30_000 });
    await app.check('What brings you here?');
  });

  test.describe('signed out', () => {
    test.use({ autoOpen: false });

    test('@laptop Create account: no field or Show password on the fold', async ({ app }) => {
      await app.page.addInitScript(() => localStorage.removeItem('bw-demo-session'));
      await app.page.goto('/');
      await app.page.getByRole('button', { name: app.t('Get started'), exact: true }).click();
      await expect(app.page.getByRole('heading', { name: new RegExp(app.t('Create account'), 'i') }).first()).toBeVisible();
      await app.check('Create account');
    });
  });
});

test.describe('iPad composers', () => {
  test.beforeEach(async ({ app }) => {
    test.skip(!(await isWide(app)), 'one-screen composers are a tablet layout');
  });

  test('gig composer: the venue field suggests venues while typing', async ({ app }) => {
    await openCreate(app, 'New gig');
    const venue = app.page.getByPlaceholder(app.t('Search venue or location...')).filter({ visible: true }).first();
    await venue.fill('Blackbox');
    await expect(venueSuggestion(app, 'Blackbox').first()).toBeVisible();
    await venueSuggestion(app, 'Blackbox').first().click();
    await expect(venue).toHaveValue(/Blackbox Studios/);
    await app.check('gig composer venue');
  });

  test('rehearsal composer: the venue field suggests venues while typing', async ({ app }) => {
    await openCreate(app, 'New rehearsal');
    const venue = app.page.getByPlaceholder(app.t('Search venue or studio…')).filter({ visible: true }).first();
    await venue.fill('Blackbox');
    await expect(venueSuggestion(app, 'Blackbox').first()).toBeVisible();
    await app.check('rehearsal composer venue');
  });
});
