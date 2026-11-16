import { test, expect } from '../fixtures';
import { chip, openHubPage } from '../support/hub';

/**
 * Gear & inventory (#173): add-item sheet, Speakers category, custom
 * categories (≤ 40 characters), and the member's read-only rows.
 */

test.describe('gear as admin', () => {
  test('the add-item sheet shows the example placeholder and the Speakers category', async ({ app }) => {
    await openHubPage(app, 'Gear & inventory');
    await expect(chip(app, app.t('Speakers')).first()).toBeVisible();
    await app.check('Gear & inventory');

    await app.page.getByRole('button', { name: app.t('Add equipment'), exact: true }).first().click();
    const sheet = app.page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByPlaceholder(app.t('e.g. Vocal mic, drum kit, DI box'))).toBeVisible();
    await expect(sheet.getByRole('button', { name: app.t('Speakers'), exact: true })).toBeVisible();
    await app.check('Add equipment sheet');
  });

  test('a custom category is capped at 40 characters and becomes a filter and a sheet chip', async ({ app }) => {
    await openHubPage(app, 'Gear & inventory');
    await app.page.getByRole('button', { name: app.t('Add equipment'), exact: true }).first().click();
    const sheet = app.page.getByRole('dialog');
    await sheet.getByPlaceholder(app.t('e.g. Vocal mic, drum kit, DI box')).fill('Spare IEM pack');
    await sheet.getByRole('button', { name: new RegExp(`^${app.t('Custom', { context: 'category' })}$`, 'i') }).click();

    const name = sheet.getByPlaceholder(app.t('e.g. Keys, In-ear monitors'));
    await expect(name).toBeVisible();
    // Typed like a user (42 characters): the field keeps the first 40.
    await name.pressSequentially('In-ear monitors and wireless packs, spares');
    await expect(name).toHaveValue('In-ear monitors and wireless packs, spar');
    await name.fill('In-ear monitors');

    await sheet.getByRole('button', { name: app.t('Save item'), exact: true }).click();
    await expect(sheet).toBeHidden();

    // The new category is a filter chip with the item in it.
    const filter = chip(app, 'In-ear monitors').first();
    await expect(filter).toBeVisible();
    await filter.click();
    await expect(app.page.getByText('Spare IEM pack').first()).toBeVisible();
    await expect(app.page.getByText('Acoustic guitar', { exact: true })).toHaveCount(0);
    await app.check('Gear filtered by a custom category');

    // …and a chip in the add-item sheet.
    await app.page.getByRole('button', { name: app.t('Add equipment'), exact: true }).first().click();
    await expect(app.page.getByRole('dialog').getByRole('button', { name: /^In-ear monitors$/i })).toBeVisible();
  });
});

test.describe('gear as member', () => {
  test.use({ role: 'member' });

  test('@smoke band gear and other members’ gear are locked, with a note and no edit or delete', async ({ app }) => {
    await openHubPage(app, 'Gear & inventory');
    const page = app.page;
    // Band gear (no owner) and Lena's keyboard: a lock, not a bin.
    await expect(page.getByRole('img', { name: app.t('Band gear: only the admins can change it.') }).first()).toBeVisible();
    await expect(
      page.getByRole('img', { name: app.t('Only {name} and the admins can change this item.', { name: 'Lena' }) }).first(),
    ).toBeAttached();
    await expect(
      page.getByText(app.t('Items with a lock belong to the band or to another member: only the admins or their owner can change them.')),
    ).toBeAttached();
    for (const item of ['Shure SM58', 'Nord Stage 4', 'Acoustic guitar']) {
      await expect(page.getByRole('button', { name: app.t('Edit {name}', { name: item }) })).toHaveCount(0);
      await expect(page.getByRole('button', { name: app.t('Delete {name}', { name: item }) })).toHaveCount(0);
    }
    await app.check('Gear (member)');
  });
});
