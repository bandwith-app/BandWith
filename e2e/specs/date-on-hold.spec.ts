import { test, expect, type App } from '../fixtures';
import { openEvent, eventDetail, SEED } from '../support/flows';
import { readableText } from '../support/event';

/**
 * Date on hold (178): a gig that is still a quote. Members see only a hold
 * card on Home (day, time, place) and answer "I'm free" / "I can't". The
 * admin sees the answers on the quote. Seed: Jazz Club Night, Blue Note,
 * 22:00–01:00, client fee 1400.
 */

const SECRETS = [SEED.tentativeGig, '1,400', '1.400', '€1400', 'Availability check'];

/**
 * The hold card: on Home, or (Duo Laptop pose, Home under the desk) in the
 * sheet its desk action item opens.
 */
async function holdCard(app: App) {
  if (test.info().project.name === 'duo-laptop') {
    await app.page.getByRole('button', { name: new RegExp(app.t('Possible gig – keep the date free')) }).filter({ visible: true }).first().click();
    const card = app.page.getByRole('dialog').getByTestId('date-hold-card');
    await expect(card).toBeVisible();
    return card;
  }
  const card = app.page.getByTestId('date-hold-card').first();
  await card.scrollIntoViewIfNeeded();
  return card;
}

async function myAnswer(app: App) {
  const db = await app.readDb();
  const ev = db.events.find((e) => e.title === SEED.tentativeGig)!;
  return (db.event_hold_answers || []).find((a) => a.event_id === ev.id && a.user_id === '10000001-0000-4000-8000-000000000001')?.answer;
}

test.describe('member: a possible gig is only a hold card', () => {
  test.use({ role: 'member' });

  test('@smoke Home shows day, time and place, nothing else, and the answer sticks', async ({ app }) => {
    const card = await holdCard(app);
    await expect(card).toBeVisible();
    await expect(card.getByText(app.t('Possible gig – keep the date free'))).toBeVisible();
    await expect(card.getByText(/22:00–01:00/)).toBeVisible();
    await expect(card.getByText(/Blue Note, Milano/)).toBeVisible();
    const text = (await card.innerText()).toLowerCase();
    for (const s of SECRETS) expect(text, `hold card shows ${s}`).not.toContain(s.toLowerCase());
    await app.check('Home with a hold card');

    await card.getByRole('button', { name: app.t("I'm free") }).click();
    await expect(card.getByRole('button', { name: app.t("I'm free") })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => myAnswer(app)).toBe('free');
    await card.getByRole('button', { name: app.t("I can't") }).click();
    await expect.poll(() => myAnswer(app)).toBe('busy');
    // Still there after a reload.
    await app.page.reload();
    await expect((await holdCard(app)).getByRole('button', { name: app.t("I can't") })).toHaveAttribute('aria-pressed', 'true');
  });

  test('@smoke the hold is in the calendar too: same neutral card, same answers', async ({ app }) => {
    // (app.tab waits for the Calendar itself: Home has a hold card too, and
    // while Home was still leaving this test took that one, which then went
    // away under it: "Element is not attached to the DOM", CI 11-23.)
    await app.tab('Calendar');
    let card = app.page.getByTestId('date-hold-card').filter({ visible: true }).first();
    if (test.info().project.name === 'duo-laptop') {
      // Laptop pose: the Planner. Its day (a neutral dot), then the agenda row opens the hold's sheet.
      const ev = (await app.readDb()).events.find((e) => e.title === SEED.tentativeGig)!;
      const [y, m, d] = String(ev.event_date).slice(0, 10).split('-').map(Number);
      const day = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      await app.page.getByRole('gridcell', { name: new RegExp(`^${day}`) }).filter({ visible: true }).first().click();
      await app.page.getByRole('button', { name: new RegExp(app.t('Possible gig – keep the date free')) }).filter({ visible: true }).first().click();
      card = app.page.getByRole('dialog').getByTestId('date-hold-card');
    }
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card.getByText(/22:00–01:00/)).toBeVisible();
    await expect(card.getByText(/Blue Note, Milano/)).toBeVisible();
    const text = (await card.innerText()).toLowerCase();
    for (const s of SECRETS) expect(text, `calendar hold shows ${s}`).not.toContain(s.toLowerCase());
    await app.check('Calendar with a hold');
    await card.getByRole('button', { name: app.t("I'm free") }).click();
    await expect.poll(() => myAnswer(app)).toBe('free');
  });

  test('@smoke a hold notice opens that hold directly', async ({ app }) => {
    const db = await app.readDb();
    const ev = db.events.find((e) => e.title === SEED.tentativeGig)!;
    await app.tab('Calendar');
    // A tap on the hold's push (178 sends type event_date_hold + hold_event_id).
    await app.page.evaluate((id) => {
      window.dispatchEvent(new CustomEvent('push-navigate', { detail: { screen: 'home', holdEventId: id } }));
    }, ev.id);
    const sheet = app.page.getByRole('dialog').filter({ has: app.page.getByTestId('date-hold-card') });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/Blue Note, Milano/)).toBeVisible();
    await app.check('hold sheet from a notice');
    await sheet.getByRole('button', { name: app.t("I can't") }).click();
    await expect.poll(() => myAnswer(app)).toBe('busy');
  });

  test('the quote itself is nowhere: calendar, search, inbox', async ({ app }) => {
    await app.tab('Calendar');
    await app.page.getByRole('button', { name: app.t('Search events'), exact: true }).filter({ visible: true }).first().click();
    await app.page.getByPlaceholder(app.t('Search title, venue, city, client…')).filter({ visible: true }).first().fill('Jazz');
    await app.settle();
    await expect(app.page.getByRole('button', { name: new RegExp(SEED.tentativeGig, 'i') })).toHaveCount(0);
    await app.page.keyboard.press('Escape');

    await app.tab('Home');
    await app.page.getByRole('button', { name: new RegExp(`^${app.t('Notifications')}`) }).filter({ visible: true }).first().click();
    await expect(app.page.getByText(app.t('Possible gig – keep the date free')).first()).toBeVisible();
    const text = (await readableText(app)).toLowerCase();
    expect(text).not.toContain(SEED.tentativeGig.toLowerCase());
    expect(text).not.toContain('availability check');
  });
});

test.describe('admin: who is free for the quote', () => {
  test('a member answers, the admin sees it on the quote', async ({ app }) => {
    // The admin gets no hold card (they run the quote).
    await expect(app.page.getByTestId('date-hold-card')).toHaveCount(0);
    await app.editDb((db) => {
      const ev = db.events.find((e) => e.title === SEED.tentativeGig)!;
      const marta = db.profiles.find((p) => String(p.full_name).startsWith('Marta'))!;
      db.event_hold_answers = [{ event_id: ev.id, user_id: marta.id, answer: 'free', answered_at: new Date().toISOString() }];
    });
    await openEvent(app, SEED.tentativeGig);
    const answers = eventDetail(app).getByTestId('date-hold-answers');
    await answers.scrollIntoViewIfNeeded();
    await expect(answers).toBeVisible();
    await expect(answers.getByTestId('hold-free')).toContainText(/Marta/);
    await expect(answers.getByTestId('hold-none')).toContainText(/Jonah/);
    await app.check('quote with the hold answers');
  });
});
