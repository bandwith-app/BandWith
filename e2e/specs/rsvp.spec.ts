import { test, expect, type App } from '../fixtures';
import { escapeRe, eventDetail, openEvent, openEventHere, SEED } from '../support/flows';

/**
 * RSVP (#174): a member answers a gig or a rehearsal with GOING or CAN'T
 * only; "Maybe" is gone. An answer saved as "maybe" by an older version
 * asks the member to choose again.
 *
 * Known open bug on main: the legacy "maybe" prompt is missing on gigs.
 */

/** Sets Leo's answer on one event, as the database would hold it. */
async function setMyAnswer(app: App, title: string, status: string) {
  await app.editDb((db, { me }) => {
    const ev = db.events.find((e) => e.title === title)!;
    for (const m of db.event_members) {
      if (m.event_id === ev.id && m.user_id === me) {
        m.status = status;
        m.responded_at = status === 'pending' ? null : m.responded_at;
      }
    }
    // No pop-up asking about it on launch: the test opens the event itself.
    db.notifications = db.notifications.filter((n) => n.type !== 'event_invite');
  });
}

/** The two answers: GOING / CAN'T on the RSVP card, ACCEPT / DECLINE on a gig invitation. */
const yes = (app: App) =>
  app.page.getByRole('radio', { name: app.t('GOING'), exact: true }).or(app.page.getByRole('button', { name: app.t('ACCEPT'), exact: true }));
const no = (app: App) =>
  app.page.getByRole('radio', { name: app.t("CAN'T"), exact: true }).or(app.page.getByRole('button', { name: app.t('DECLINE'), exact: true }));

async function expectGoingOrCant(app: App) {
  await expect(yes(app).first()).toBeVisible();
  await expect(no(app).first()).toBeVisible();
  // No third answer.
  await expect(app.page.getByRole('button', { name: /^maybe$/i })).toHaveCount(0);
  await expect(app.page.getByRole('radio', { name: /maybe/i })).toHaveCount(0);
}

const myStatus = async (app: App, title: string) => {
  const db = await app.readDb();
  const e = db.events.find((x) => x.title === title)!;
  return db.event_members.find((m) => m.event_id === e.id && m.user_id === '10000001-0000-4000-8000-000000000001')?.status;
};

const EVENTS = [
  { kind: 'rehearsal', title: SEED.rehearsalTomorrow },
  { kind: 'gig', title: SEED.wedding },
];

test.describe('member RSVP', () => {
  test.use({ role: 'member' });

  for (const ev of EVENTS) {
    test(`${ev.kind}: only GOING or CAN'T, and the answer sticks`, async ({ app }) => {
      await setMyAnswer(app, ev.title, 'pending');
      await openEvent(app, ev.title);
      await expectGoingOrCant(app);
      await app.check(`${ev.kind} RSVP`);
      await yes(app).first().click();
      await expect.poll(() => myStatus(app, ev.title)).toBe('confirmed');
      await expect(yes(app)).toHaveCount(0);
    });

    test(`${ev.kind}: an old "maybe" asks to choose GOING or CAN'T`, async ({ app }) => {
      await setMyAnswer(app, ev.title, 'maybe');
      await openEvent(app, ev.title);
      // The prompt names the old answer ("Your answer was Maybe…").
      await expect(app.page.getByText(new RegExp(app.t('Maybe'), 'i')).first()).toBeVisible();
      await expectGoingOrCant(app);
      await app.check(`${ev.kind} legacy maybe`);
    });
  }
});

test.describe('member answers a gig invitation, then opens an event at once', () => {
  test.use({ role: 'member' });

  const ANSWERS = [
    { button: 'ACCEPT', toast: "You're confirmed!", reopen: SEED.wedding },
    // Out of the gig: it leaves the member's calendar, so another event.
    { button: 'DECLINE', toast: 'You dropped out of this event.', reopen: SEED.rehearsalTomorrow },
  ];

  for (const a of ANSWERS) {
    test(`${a.button}: the event opened right after stays open`, async ({ app }) => {
      await setMyAnswer(app, SEED.wedding, 'pending');
      // Both events from the calendar agenda (no search layer left beneath).
      const card = (title: string) =>
        app.page.getByRole('button', { name: new RegExp(escapeRe(title), 'i') }).filter({ visible: true }).first();
      await app.tab('Calendar');
      await expect(card(SEED.wedding)).toBeVisible();
      await openEventHere(app, SEED.wedding);
      await app.page.getByRole('button', { name: app.t(a.button), exact: true }).click();
      // The gig closes at once; saving and syncing go on in the background.
      await expect(app.page.getByText(app.t(a.toast)).first()).toBeVisible();
      await expect(eventDetail(app)).toBeHidden();
      await expect(card(a.reopen)).toBeVisible();
      await openEventHere(app, a.reopen);
      // The member reads it while the background sync finishes (about 3 s
      // in the demo): nothing may close it meanwhile.
      await app.page.waitForTimeout(4000);
      await expect(eventDetail(app)).toBeVisible();
      await expect(eventDetail(app).getByText(a.reopen, { exact: false }).first()).toBeVisible();
    });
  }
});
