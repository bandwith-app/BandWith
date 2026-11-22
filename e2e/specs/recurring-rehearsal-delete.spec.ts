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

/**
 * Codex #297 B1: a date opened from Home is the date deleted, not the first
 * date of the series. The series starts last week, so Home lists its next
 * date (tomorrow), not the row's own date.
 */
const shift = (day: string, by: number) => {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  const t = new Date(y, m - 1, d + by);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

test.describe('a repeating rehearsal opened from Home @smoke', () => {
  let tomorrow = '';
  test.beforeEach(async ({ app }) => {
    await app.editDb((db) => {
      const ev = (db.events as Record<string, any>[]).find((e) => e.title === SEED.rehearsalTomorrow);
      if (ev) {
        tomorrow = String(ev.event_date).slice(0, 10);
        ev.event_date = String(ev.event_date).replace(tomorrow, shift(tomorrow, -7));
        ev.is_recurring = true;
        ev.recurrence_rule = { frequency: 'weekly', interval: 1 };
      }
    });
  });

  test('Delete this date takes out the date tapped on Home', async ({ app }) => {
    expect(tomorrow).not.toBe('');
    await app.tab('Home');
    await app.page.getByRole('button', { name: new RegExp(SEED.rehearsalTomorrow, 'i') }).filter({ visible: true }).first().click();
    await app.settle();
    const detail = eventDetail(app);
    await detail.getByRole('button', { name: app.t('DELETE THIS REHEARSAL') }).filter({ visible: true }).first().click();
    await detail.getByRole('group', { name: app.t('Delete which dates?') }).getByRole('button', { name: app.t('Delete this date') }).click();
    await app.settle();
    const db = await app.readDb();
    const ev = (db.events as Record<string, any>[]).find((e) => e.title === SEED.rehearsalTomorrow);
    expect(ev?.recurrence_rule?.skip_dates, 'the date tapped, not the first date').toEqual([tomorrow]);
  });
});

/**
 * A deleted date stays off Home (HomeView's series expansion). If #298's
 * repeatDates() loop lands too, it must keep `!isSkippedOccurrence(e, occDate)`.
 * Other events of the next two weeks move a month out, so Home's three
 * upcoming rows are: today's gig, the rehearsal tomorrow, its next date.
 */
test.describe('a deleted date on Home @smoke', () => {
  let tomorrow = '';
  test.beforeEach(async ({ app }) => {
    await app.editDb((db) => {
      const events = db.events as Record<string, any>[];
      const ev = events.find((e) => e.title === SEED.rehearsalTomorrow);
      if (!ev) return;
      tomorrow = String(ev.event_date).slice(0, 10);
      for (const other of events) {
        const day = String(other.event_date || '').slice(0, 10);
        if (other !== ev && day >= tomorrow && day <= shift(tomorrow, 14)) {
          other.event_date = String(other.event_date).replace(day, shift(day, 30));
        }
      }
      ev.is_recurring = true;
      ev.recurrence_rule = { frequency: 'weekly', interval: 1, skip_dates: [shift(tomorrow, 7)] };
    });
  });

  test('does not come back; the date after shows instead', async ({ app }) => {
    expect(tomorrow).not.toBe('');
    await app.tab('Home');
    const tile = (day: string) => {
      const [y, m, d] = day.split('-').map(Number);
      const mon = new Date(y, m - 1, d).toLocaleString('en-US', { month: 'short' });
      return app.page.getByRole('button', { name: new RegExp(`^${d} ${mon}\\b.*${SEED.rehearsalTomorrow}`, 'i') }).filter({ visible: true });
    };
    await expect(tile(tomorrow), 'the first date is on Home').toHaveCount(1);
    await expect(tile(shift(tomorrow, 14)), 'the date after the deleted one is on Home').toHaveCount(1);
    await expect(tile(shift(tomorrow, 7)), 'the deleted date is not').toHaveCount(0);
  });
});
