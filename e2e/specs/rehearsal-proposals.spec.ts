import { test, expect } from '../fixtures';
import { openCreate } from '../support/flows';

/**
 * Rehearsal proposals (#174): a member proposes, the admin sees how long the
 * proposal stays open and can decline it with a reason.
 */
test.describe('rehearsal proposals', () => {
  test.use({ role: 'member' });

  test('a member proposes a rehearsal; the admin sees "Open until" and declines it with a reason', async ({ app }) => {
    const { page, t } = app;
    await openCreate(app, 'Propose rehearsal');
    const topic = page.getByPlaceholder(t('e.g. Practice new setlist transitions'));
    await expect(topic).toBeVisible();
    // The notes placeholder is an example, not an instruction.
    await expect(page.getByPlaceholder(t('e.g. The two new songs and the set endings'))).toBeVisible();
    await app.check('Propose rehearsal');

    await topic.fill('Tighten the horn section');
    await page.getByRole('button', { name: t('Thu'), exact: true }).first().click();
    await page.getByRole('button', { name: t('Submit to admin') }).click();
    await expect(page.getByText(t('Proposal sent to band admin.'))).toBeVisible();
    await expect(topic).toBeHidden();

    // Same band, now as its admin.
    await app.editDb((db, { me }) => {
      for (const m of db.band_members) if (m.user_id === me) m.role = 'admin';
    });
    const card = page.getByText('Tighten the horn section').first();
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await expect(page.getByText(new RegExp(t('Open until {date}', { date: '.+' }))).first()).toBeVisible();
    await app.check('Home with a proposal');

    await page.getByRole('button', { name: t('Decline'), exact: true }).first().click();
    await expect(page.getByText(t('Decline this proposal?'))).toBeVisible();
    await page.getByPlaceholder(t('e.g. The room is booked that week')).fill('Room booked all week');
    await page.getByRole('button', { name: t('Decline'), exact: true }).last().click();
    await expect(page.getByText('Tighten the horn section')).toHaveCount(0);

    const db = await app.readDb();
    const poll = db.rehearsal_polls.find((p) => String(p.title ?? p.notes ?? '').includes('Tighten the horn section'));
    expect(poll?.status).not.toBe('proposal');
  });
});
