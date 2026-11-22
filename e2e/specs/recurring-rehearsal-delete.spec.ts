import { test, expect, type App } from '../fixtures';
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

/**
 * Duo Laptop pose: Home is the Band desk (the next gig and what needs doing)
 * and has no list of upcoming dates, so a rehearsal's dates are read and
 * opened on the Calendar's Planner there. Picks `day` on its month grid
 * (moving on a month when needed) and returns the rehearsal's rows in that
 * day's agenda.
 */
const isLaptop = () => test.info().project.name === 'duo-laptop';
async function plannerRows(app: App, day: string) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  // The Planner lies over the Calendar (which has a "Next month" of its own).
  const planner = app.page.locator('.bw-fold-split').last();
  const month = planner.getByRole('heading', { name: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), exact: true });
  for (let i = 0; i < 3 && !(await month.isVisible()); i++) {
    await planner.getByRole('button', { name: app.t('Next month'), exact: true }).click();
    await app.settle();
  }
  await expect(month).toBeVisible();
  const label = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  await planner.getByRole('gridcell', { name: new RegExp(`^${label}(,|$)`) }).click();
  await app.settle();
  return planner.getByRole('region', { name: app.t('Agenda') }).getByRole('button', { name: new RegExp(SEED.rehearsalTomorrow, 'i') });
}

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
    if (isLaptop()) {
      // The date tapped on the Planner (no list of dates on the Band desk).
      await app.tab('Calendar');
      await (await plannerRows(app, tomorrow)).first().click();
    } else {
      await app.tab('Home');
      await app.page.getByRole('button', { name: new RegExp(SEED.rehearsalTomorrow, 'i') }).filter({ visible: true }).first().click();
    }
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
    if (isLaptop()) {
      // The same three dates, on the Planner.
      await app.tab('Calendar');
      await expect(await plannerRows(app, tomorrow), 'the first date is on the Planner').toHaveCount(1);
      await expect(await plannerRows(app, shift(tomorrow, 7)), 'the deleted date is not').toHaveCount(0);
      await expect(await plannerRows(app, shift(tomorrow, 14)), 'the date after the deleted one is').toHaveCount(1);
      return;
    }
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

/**
 * Codex #297 round 3 B2: west of Greenwich a series' first date read as UTC
 * midnight was the evening before, so every later date fell a day early
 * (a Monday rehearsal on Sunday) and "Delete this date" took out the wrong day.
 */
test.describe('a repeating rehearsal in New York @smoke', () => {
  test.use({ timezoneId: 'America/New_York' });
  let tomorrow = '';
  test.beforeEach(async ({ app }) => {
    await app.editDb((db) => {
      const events = db.events as Record<string, any>[];
      const ev = events.find((e) => e.title === SEED.rehearsalTomorrow);
      if (!ev) return;
      tomorrow = String(ev.event_date).slice(0, 10);
      for (const other of events) {
        const day = String(other.event_date || '').slice(0, 10);
        if (other !== ev && day >= shift(tomorrow, -1) && day <= shift(tomorrow, 14)) {
          other.event_date = String(other.event_date).replace(day, shift(day, 30));
        }
      }
      ev.event_date = String(ev.event_date).replace(tomorrow, shift(tomorrow, -7));
      ev.is_recurring = true;
      ev.recurrence_rule = { frequency: 'weekly', interval: 1 };
    });
  });

  test('keeps its weekday on Home, and Delete this date takes out that day', async ({ app }) => {
    expect(tomorrow).not.toBe('');
    await app.tab('Home');
    const tile = (day: string) => {
      const [y, m, d] = day.split('-').map(Number);
      const mon = new Date(y, m - 1, d).toLocaleString('en-US', { month: 'short' });
      return app.page.getByRole('button', { name: new RegExp(`^${d} ${mon}\\b.*${SEED.rehearsalTomorrow}`, 'i') }).filter({ visible: true });
    };
    if (isLaptop()) {
      // The Planner's month grid and agenda, read in New York too.
      await app.tab('Calendar');
      await expect(await plannerRows(app, shift(tomorrow, -1)), 'no rehearsal the day before').toHaveCount(0);
      const row = await plannerRows(app, tomorrow);
      await expect(row, 'on its weekday').toHaveCount(1);
      await row.click();
    } else {
      await expect(tile(shift(tomorrow, -1)), 'no rehearsal the day before').toHaveCount(0);
      await expect(tile(tomorrow), 'on its weekday').toHaveCount(1);
      await tile(tomorrow).click();
    }
    await app.settle();
    const detail = eventDetail(app);
    await detail.getByRole('button', { name: app.t('DELETE THIS REHEARSAL') }).filter({ visible: true }).first().click();
    await detail.getByRole('group', { name: app.t('Delete which dates?') }).getByRole('button', { name: app.t('Delete this date') }).click();
    await app.settle();
    const db = await app.readDb();
    const ev = (db.events as Record<string, any>[]).find((e) => e.title === SEED.rehearsalTomorrow);
    expect(ev?.recurrence_rule?.skip_dates).toEqual([tomorrow]);
  });
});

/**
 * Claude #297 r5 minor 5: a deleted date can come back. Right after
 * "Delete this date" the toast offers Undo; later, an admin restores it from
 * the series' "Deleted dates".
 */
test.describe('a deleted rehearsal date comes back @smoke', () => {
  let tomorrow = '';
  test.beforeEach(async ({ app }) => {
    await app.editDb((db) => {
      const ev = (db.events as Record<string, any>[]).find((e) => e.title === SEED.rehearsalTomorrow);
      if (!ev) return;
      tomorrow = String(ev.event_date).slice(0, 10);
      ev.is_recurring = true;
      ev.recurrence_rule = { frequency: 'weekly', interval: 1, skip_dates: [shift(tomorrow, 7)] };
    });
    await openEvent(app, SEED.rehearsalTomorrow);
  });

  const skipsNow = async (app: App) => {
    const db = await app.readDb();
    return (db.events as Record<string, any>[]).find((e) => e.title === SEED.rehearsalTomorrow)?.recurrence_rule?.skip_dates;
  };

  test('Undo right after deleting puts the date back', async ({ app }) => {
    const detail = eventDetail(app);
    await detail.getByRole('button', { name: app.t('DELETE THIS REHEARSAL') }).filter({ visible: true }).first().click();
    await detail.getByRole('group', { name: app.t('Delete which dates?') }).getByRole('button', { name: app.t('Delete this date') }).click();
    await app.settle();
    expect(await skipsNow(app)).toEqual([tomorrow, shift(tomorrow, 7)].sort());
    const undo = app.page.locator('.bw-toast').getByRole('button', { name: app.t('Undo') });
    await expect(undo).toBeVisible();
    await app.check('undo toast after deleting one date');
    await undo.click();
    await app.settle();
    expect(await skipsNow(app), 'only the date just deleted came back').toEqual([shift(tomorrow, 7)]);
  });

  test('an admin restores a deleted date from the series', async ({ app }) => {
    const detail = eventDetail(app);
    const list = detail.getByTestId('ed-deleted-dates');
    await list.scrollIntoViewIfNeeded();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await app.check('deleted dates with Restore');
    await list.getByRole('button', { name: /^Restore / }).click();
    await app.settle();
    expect(await skipsNow(app)).toEqual([]);
    await expect(detail.getByTestId('ed-deleted-dates')).toHaveCount(0);
  });
});
