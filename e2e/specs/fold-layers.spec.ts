import { test, expect, type App } from '../fixtures';
import { isWide, openCreate } from '../support/flows';

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
