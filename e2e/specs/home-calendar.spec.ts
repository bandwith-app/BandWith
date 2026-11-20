import { test, expect, type App } from '../fixtures';
import { checkWholeScreen, eventDetail, back, openEventHere, SEED, systemBack } from '../support/flows';

/**
 * Home (every card), the notifications inbox, and the Calendar: month
 * navigation, filters, search, and opening each kind of event.
 */

const agendaCard = (app: App, title: string) => app.page.getByRole('button', { name: new RegExp(title, 'i') }).first();

for (const role of ['admin', 'member'] as const) {
  test.describe(`Home as ${role}`, () => {
    test.use({ role });

    test(`@smoke every Home card renders healthy, top to bottom`, async ({ app }) => {
      await expect(app.page.getByRole('heading', { name: /Velvet Static/i }).first()).toBeVisible();
      await expect(app.page.getByText(SEED.gigToday, { exact: false }).first()).toBeVisible();
      await checkWholeScreen(app, `Home (${role})`);
    });

    test('@smoke Calendar renders healthy, top to bottom', async ({ app }) => {
      await app.tab('Calendar');
      await expect(agendaCard(app, SEED.gigToday)).toBeVisible();
      await checkWholeScreen(app, `Calendar (${role})`);
    });

    test('@smoke Mark all as read clears the Unread count and the red dots', async ({ app }) => {
      await app.page.getByRole('button', { name: new RegExp(`^${app.t('Notifications')}, \\d`) }).filter({ visible: true }).first().click();
      await expect(app.page.getByRole('heading', { name: app.t('Inbox'), exact: true })).toBeVisible();
      await app.settle();
      const markAll = app.page.getByRole('button', { name: app.t('Mark all read'), exact: true });
      const unreadFilter = app.page.getByRole('button', { name: new RegExp(`^${app.t('Unread')}`) });
      const dots = app.page.getByLabel(app.t('Unread'), { exact: true }).filter({ visible: true });
      await expect(unreadFilter).toHaveAccessibleName(new RegExp(`^${app.t('Unread')}\\s*[1-9]`));
      await expect(dots.first()).toBeVisible();
      await markAll.click();
      await expect(markAll).toBeHidden();
      await expect(dots).toHaveCount(0);
      await expect(unreadFilter).toHaveAccessibleName(new RegExp(`^${app.t('Unread')}\\s*0?$`));
      await app.check('inbox after Mark all as read');
      // Nothing comes back with the next refresh of the list either.
      await unreadFilter.click();
      await expect(app.page.getByRole('heading', { name: app.t('All caught up'), exact: true })).toBeVisible();
    });

    test('the notifications inbox lists the alerts and opens one', async ({ app }) => {
      await app.page.getByRole('button', { name: new RegExp(`^${app.t('Notifications')}`) }).first().click();
      const inbox = app.page.getByRole('button', { name: app.t('Close notifications'), exact: true }).first();
      await expect(inbox).toBeVisible();
      await expect(app.page.getByText(/Vote on rehearsal dates/i).first()).toBeVisible();
      await app.check('notifications');
      await app.page.getByRole('button', { name: /Vote on rehearsal dates/i }).first().click();
      // The poll's vote sheet opens on its dates.
      const sheet = app.page.getByRole('dialog').last();
      await expect(sheet.getByRole('button', { name: /25/ }).first()).toBeVisible();
      await app.check('poll from a notification');
      await systemBack(app);
      await expect(sheet).toBeHidden();
    });
  });
}

test.describe('Home actions (admin)', () => {
  test('See all opens the calendar agenda; Upcoming cards open their event', async ({ app }) => {
    await app.page.getByRole('button', { name: /^See all: Upcoming/i }).first().click();
    await app.settle();
    await expect(agendaCard(app, SEED.rehearsalTomorrow)).toBeVisible();
    await app.tab('Home');
    await openEventHere(app, SEED.rehearsalTomorrow);
    await app.check('rehearsal from Home');
    await back(app);
    await expect(eventDetail(app)).toHaveCount(0);
  });

  test('a quote draft on Home opens the quote', async ({ app }) => {
    await app.page.getByRole('button', { name: new RegExp(`Quote · Draft ${SEED.quoteDraft}`, 'i') }).first().click();
    await app.settle();
    await expect(app.page.getByText(/Q-2026-0012/).first()).toBeVisible();
    await app.check('quote draft');
    await systemBack(app);
    await expect(app.page.getByRole('button', { name: new RegExp(`Quote · Draft ${SEED.quoteDraft}`, 'i') }).first()).toBeVisible();
  });

  test('Review payouts opens the payouts of the past gig', async ({ app }) => {
    await app.button('REVIEW PAYOUTS').first().click();
    await expect(app.page.getByText(/Summer Fest Opening/i).first()).toBeVisible();
    await app.check('payouts');
    await systemBack(app);
    await app.settle();
    await expect(app.page.getByRole('button', { name: app.t('Home'), exact: true }).first()).toBeVisible();
  });
});

test.describe('Calendar', () => {
  test.beforeEach(async ({ app }) => {
    await app.tab('Calendar');
  });

  test('month navigation: next and previous month', async ({ app }) => {
    const month = (name: string) => app.page.getByText(new RegExp(`^${name} 2026$`, 'i')).first();
    const go = (label: string) => app.page.getByRole('button', { name: app.t(label), exact: true }).first().click();
    await expect(month('November')).toBeVisible();
    await go('Next month');
    await expect(month('December')).toBeVisible();
    await go('Previous month');
    await expect(month('November')).toBeVisible();
    await go('Previous month');
    await expect(month('October')).toBeVisible();
    await app.check('calendar, October');
    // Away from this month, Today brings it back.
    await app.page.getByRole('button', { name: app.t('Today'), exact: true }).first().click();
    await expect(month('November')).toBeVisible();
  });

  test('filters: Gigs shows gigs only, Rehearsals rehearsals only', async ({ app }) => {
    await app.page.getByRole('button', { name: new RegExp(`^${app.t('GIGS')}`, 'i') }).first().click();
    await expect(agendaCard(app, SEED.gigToday)).toBeVisible();
    await expect(app.page.getByRole('button', { name: new RegExp(SEED.rehearsalTomorrow, 'i') })).toHaveCount(0);
    await app.page.getByRole('button', { name: new RegExp(`^${app.t('REHEARSALS')}`, 'i') }).first().click();
    await expect(agendaCard(app, SEED.rehearsalTomorrow)).toBeVisible();
    await expect(app.page.getByRole('button', { name: new RegExp(SEED.gigToday, 'i') })).toHaveCount(0);
    await app.check('calendar filtered');
  });

  test('search finds an event by venue', async ({ app }) => {
    await app.page.getByRole('button', { name: app.t('Search events') }).first().click();
    const field = app.page.getByPlaceholder(app.t('Search title, venue, city, client…'));
    await field.fill('Blue Note');
    await expect(agendaCard(app, SEED.tentativeGig)).toBeVisible();
    await expect(app.page.getByRole('button', { name: new RegExp(SEED.gigToday, 'i') })).toHaveCount(0);
    await app.check('calendar search');
    await app.page.getByRole('button', { name: app.t('Close search') }).first().click();
    await expect(agendaCard(app, SEED.gigToday)).toBeVisible();
  });

  for (const ev of [
    { kind: 'gig', title: SEED.wedding },
    { kind: 'rehearsal', title: SEED.rehearsalTomorrow },
    { kind: 'quote (tentative gig)', title: SEED.tentativeGig },
    { kind: 'personal gig', title: SEED.personal },
  ]) {
    test(`opens a ${ev.kind} and comes back`, async ({ app }) => {
      await openEventHere(app, ev.title);
      await app.check(`${ev.kind} detail`);
      await back(app);
      await expect(eventDetail(app)).toHaveCount(0);
      await expect(agendaCard(app, ev.title)).toBeVisible();
    });
  }

  test('Quotes lists only the open quote', async ({ app }) => {
    await app.page.getByRole('button', { name: new RegExp(`^${app.t('QUOTES')}`, 'i') }).first().click();
    await expect(agendaCard(app, SEED.tentativeGig)).toBeVisible();
    await expect(app.page.getByRole('button', { name: new RegExp(SEED.gigToday, 'i') })).toHaveCount(0);
    await app.check('calendar, quotes');
  });
});
