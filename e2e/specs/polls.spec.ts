import { test, expect, type App } from '../fixtures';
import { SEED, systemBack, isWide, openCreate } from '../support/flows';

/**
 * Rehearsal polls (#175): the poll builder's Back paths and discard sheet,
 * the venue autocomplete on its location, and fast voting on Home.
 */

const POLL_ID = '100005dc-0000-4000-8000-000000001500';

/** Create → New rehearsal → Poll availability. */
async function openPollBuilder(app: App) {
  await openCreate(app, 'New rehearsal');
  await pollMode(app).click();
  await expect(builderTitle(app)).toBeVisible();
  await app.settle();
}
const pollMode = (app: App) => app.page.getByRole('radio', { name: app.t('Poll availability') });
const builderTitle = (app: App) => app.page.getByPlaceholder(app.t('e.g. Extra rehearsal before the wedding'));
/** The rehearsal wizard's first step (session & roster). */
const wizardStep1 = (app: App) => app.page.getByPlaceholder(app.t('e.g. New setlist run-through'));
const discardSheet = (app: App) => app.page.getByRole('dialog').filter({ hasText: app.t('Discard this poll?') });

test.describe('poll builder', () => {
  // Phones and the Duo: the builder is its own screen after the wizard.
  // Tablets build the poll in the one-screen composer (no step back).
  test.beforeEach(async ({ app }) => {
    test.skip(await isWide(app), 'tablets use the one-screen composer');
  });
  const backs: { name: string; go: (app: App) => Promise<void> }[] = [
    { name: 'header Back', go: (app) => app.page.getByRole('button', { name: app.t('Back'), exact: true }).filter({ visible: true }).first().click() },
    { name: 'CTA bar BACK', go: (app) => app.page.getByRole('button', { name: new RegExp(`^${app.t('BACK')}$`, 'i') }).filter({ visible: true }).last().click() },
    { name: 'Escape (system Back)', go: (app) => systemBack(app) },
  ];

  for (const b of backs) {
    test(`${b.name}: with a title typed it asks first (Keep editing / Discard), then returns to the rehearsal wizard`, async ({ app }) => {
      await openPollBuilder(app);
      await app.check('poll builder');
      await builderTitle(app).fill('Horn section run-through');
      await b.go(app);
      await expect(discardSheet(app)).toBeVisible();
      await app.check('discard this poll?');
      await discardSheet(app).getByRole('button', { name: app.t('Keep editing'), exact: true }).last().click();
      await expect(discardSheet(app)).toBeHidden();
      await expect(builderTitle(app)).toHaveValue('Horn section run-through');

      await b.go(app);
      await discardSheet(app).getByRole('button', { name: app.t('Discard'), exact: true }).click();
      await expect(wizardStep1(app)).toBeVisible();
      await expect(builderTitle(app)).toBeHidden();
    });
  }

  test('with nothing typed, Back returns to the rehearsal wizard without asking', async ({ app }) => {
    await openPollBuilder(app);
    await backs[0].go(app);
    await expect(wizardStep1(app)).toBeVisible();
    await expect(discardSheet(app)).toHaveCount(0);
  });

});

test.describe('poll location', () => {
  test('the location field suggests venues while typing', async ({ app }) => {
    await openPollBuilder(app);
    const where = app.page.getByPlaceholder(app.t('e.g. Blackbox Studios · room 2'));
    await where.fill('Blackbox');
    const option = app.page.getByRole('option', { name: /Blackbox Studios/ });
    await expect(option).toBeVisible();
    await app.check('poll location suggestions');
    await option.click();
    await expect(where).toHaveValue(/Blackbox Studios/);
  });
});

test.describe('poll on Home', () => {
  const pad = (app: App, day: RegExp) =>
    app.page.locator('[aria-pressed]').filter({ hasText: day }).first();

  const myVotes = async (app: App) => {
    const db = await app.readDb();
    return db.rehearsal_poll_votes
      .filter((v) => v.poll_id === POLL_ID && v.user_id === '10000001-0000-4000-8000-000000000001')
      .map((v) => String(v.option_id));
  };

  test('fast taps: the pads follow at once and the last tap wins', async ({ app }) => {
    await expect(app.page.getByText(SEED.poll, { exact: false }).first()).toBeVisible();
    const wed = pad(app, /25/);
    const thu = pad(app, /26/);
    // Wed: on, off, on → on. Thu: on, off → off.
    await wed.click();
    await thu.click();
    await wed.click();
    await thu.click();
    await wed.click();
    await expect(wed).toHaveAttribute('aria-pressed', 'true');
    await expect(thu).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => myVotes(app), { timeout: 15_000 }).toEqual(['100005e6-0000-4000-8000-000000001510']);
    await app.check('poll after fast votes');
  });

  test('the admin locks in a date: the rehearsal is on the calendar', async ({ app }) => {
    await app.button('Details · Lock in').first().click();
    await app.page.getByRole('button', { name: new RegExp(`^${app.t('Lock in')}$`, 'i') }).first().click();
    // Lock-in may ask for the room first; confirm whatever it needs.
    const confirm = app.page.getByRole('button', { name: new RegExp(`^(${app.t('Lock in')}|${app.t('Confirm')}|${app.t('Lock in this date')})`, 'i') });
    await expect
      .poll(async () => {
        const db = await app.readDb();
        const poll = db.rehearsal_polls.find((p) => p.id === POLL_ID);
        if (poll?.confirmed_event_id) return 'locked';
        if (await confirm.last().isVisible().catch(() => false)) await confirm.last().click().catch(() => {});
        return poll?.status;
      }, { timeout: 20_000 })
      .toBe('locked');
    await app.tab('Calendar');
    await expect(app.page.getByRole('button', { name: new RegExp(SEED.poll, 'i') }).first()).toBeVisible();
  });
});
