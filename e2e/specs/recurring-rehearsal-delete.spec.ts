import { test, expect } from '../fixtures';
import { openEvent, eventDetail, SEED } from '../support/flows';

/**
 * Audit 05 #4: deleting one date of a weekly rehearsal takes only that date
 * out of the series; the series (its sessions and notes) stays. Deleting the
 * whole series is still there as its own choice.
 */
test.describe('a repeating rehearsal: delete one date @smoke', () => {
  test.beforeEach(async ({ app }) => {
    await app.editDb((db) => {
      const ev = (db.events as Record<string, unknown>[]).find((e) => e.title === SEED.rehearsalTomorrow);
      if (ev) {
        ev.is_recurring = true;
        ev.recurrence_rule = { frequency: 'weekly', interval: 1 };
      }
    });
    await openEvent(app, SEED.rehearsalTomorrow);
  });

  test('this date only, the series stays', async ({ app }) => {
    const detail = eventDetail(app);
    await detail.getByRole('button', { name: app.t('DELETE THIS REHEARSAL') }).filter({ visible: true }).first().click();
    const choice = detail.getByRole('group', { name: app.t('Delete which dates?') });
    await expect(choice.getByRole('button', { name: app.t('Delete this date') })).toBeVisible();
    await expect(choice.getByRole('button', { name: app.t('Delete the whole series') })).toBeVisible();
    await app.check('delete: this date or the whole series');
    await choice.getByRole('button', { name: app.t('Delete this date') }).click();
    await app.settle();
    const db = await app.readDb();
    const ev = (db.events as Record<string, any>[]).find((e) => e.title === SEED.rehearsalTomorrow);
    expect(ev, 'the series row is still there').toBeTruthy();
    expect(ev?.recurrence_rule?.skip_dates).toEqual([String(ev?.event_date).slice(0, 10)]);
  });
});
