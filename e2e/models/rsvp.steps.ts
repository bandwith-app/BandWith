import { expect } from '../fixtures';
import type { App } from '../fixtures';
import { back, eventDetail, escapeRe, openEvent, SEED } from '../support/flows';
import { openWith } from '../support/rehearsal';
import { rsvpGig, rsvpRehearsal } from './rsvp.model.ts';
import { stepsFor, type Ctx } from './steps.ts';

const ME = '10000001-0000-4000-8000-000000000001';

/** Opens the app with Leo's answer to `title` set (and, optionally, the event moved). */
async function seedAnswer(app: App, title: string, status: string, moveDays: number | null = null) {
  // openWith runs the mutation's source in the page: the values go in as literals.
  const body = `(db, ids) => {
    const ev = ids.byTitle(${JSON.stringify(title)});
    for (const m of db.event_members) if (m.event_id === ev.id && m.user_id === ids.me) {
      m.status = ${JSON.stringify(status)};
      m.responded_at = ${JSON.stringify(status)} === 'pending' ? null : m.responded_at;
    }
    if (${JSON.stringify(moveDays)} !== null) {
      const d = new Date('2026-11-16T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + ${JSON.stringify(moveDays)});
      ev.event_date = d.toISOString().slice(0, 10);
    }
    // No pop-up about it on launch: the test opens the event itself.
    db.notifications = db.notifications.filter((n) => n.type !== 'event_invite');
  }`;
  // eslint-disable-next-line no-new-func
  await openWith(app, new Function(`return ${body}`)() as never);
}

const radio = (app: App, name: string) => app.page.getByRole('radio', { name: app.t(name), exact: true });
const btn = (app: App, name: string) => app.page.getByRole('button', { name: app.t(name), exact: true });

async function myStatus(app: App, title: string) {
  const db = await app.readDb();
  const e = db.events.find((x) => x.title === title)!;
  return db.event_members.find((m) => m.event_id === e.id && m.user_id === ME)?.status;
}

async function noMaybe(app: App) {
  await expect(app.page.getByRole('button', { name: /^maybe$/i })).toHaveCount(0);
  await expect(app.page.getByRole('radio', { name: /maybe/i })).toHaveCount(0);
}

async function closedWithToast(app: App, toast: string) {
  await expect(app.page.getByText(app.t(toast)).first()).toBeVisible();
  await expect(eventDetail(app)).toBeHidden();
}

/** The event's card in the calendar agenda (none once the member is out). */
const agendaCard = (app: App, title: string) =>
  app.page.getByRole('button', { name: new RegExp(escapeRe(title), 'i') });

async function answeredGoing(app: App, title: string) {
  await closedWithToast(app, "You're confirmed!");
  await expect.poll(() => myStatus(app, title)).toBe('confirmed');
  await expect(agendaCard(app, title).first()).toBeVisible();
  await app.check(`${title}: going`);
}

async function answeredOut(app: App, title: string) {
  await closedWithToast(app, 'You dropped out of this event.');
  await expect.poll(() => myStatus(app, title)).toBe('declined');
  await expect(agendaCard(app, title)).toHaveCount(0);
  await app.check(`${title}: out`);
}

async function maybePrompt(c: Ctx) {
  const { app } = c;
  await expect(app.page.getByText(app.t("Your answer was Maybe. Choose GOING or CAN'T."))).toBeVisible();
  await expect(radio(app, 'GOING')).toHaveAttribute('aria-checked', 'false');
  await expect(radio(app, "CAN'T")).toHaveAttribute('aria-checked', 'false');
  await noMaybe(app);
  await app.check('legacy maybe prompt');
}

/** Nothing open yet: each path's first event seeds the answer and opens the app. */
const start = async (_c: Ctx) => {};

const GIG = SEED.wedding;

export const rsvpGigSteps = stepsFor(rsvpGig, {
  boot: async () => {},
  states: {
    start,
    invited: async ({ app }) => {
      await expect(eventDetail(app).getByText(app.t('Are you in?'))).toBeVisible();
      await expect(btn(app, 'ACCEPT')).toBeVisible();
      await expect(btn(app, 'DECLINE')).toBeVisible();
      await noMaybe(app);
      await app.check('gig invite');
    },
    maybePrompt,
    going: ({ app }) => answeredGoing(app, GIG),
    goingOpen: async ({ app }) => {
      await expect(btn(app, 'DROP OUT')).toBeVisible();
      await expect(btn(app, 'EVENT CHAT')).toBeVisible();
      await expect(btn(app, 'ACCEPT')).toHaveCount(0);
      await expect(radio(app, 'GOING')).toHaveCount(0);
      await app.check('gig, going');
    },
    dropPrompt: async ({ app }) => {
      await expect(app.page.getByText(app.t('Drop out?'))).toBeVisible();
      await expect(btn(app, 'Confirm drop')).toBeVisible();
      await expect(btn(app, 'CANCEL')).toBeVisible();
    },
    out: ({ app }) => answeredOut(app, GIG),
    past: async ({ app }) => {
      await expect(eventDetail(app).getByText(app.t('PAST GIG')).first()).toBeVisible();
      for (const b of ['ACCEPT', 'DECLINE', 'DROP OUT']) await expect(btn(app, b)).toHaveCount(0);
      await expect(app.page.getByRole('radio')).toHaveCount(0);
      await expect(btn(app, 'VIEW SETLIST')).toBeVisible();
      await app.check('past gig');
    },
  },
  events: {
    INVITED: async ({ app }) => {
      await seedAnswer(app, GIG, 'pending');
      await openEvent(app, GIG);
    },
    OLD_MAYBE: async ({ app }) => {
      await seedAnswer(app, GIG, 'maybe');
      await openEvent(app, GIG);
    },
    ALREADY_GOING: async ({ app }) => {
      await seedAnswer(app, GIG, 'confirmed');
      await openEvent(app, GIG);
    },
    PAST_GIG: async ({ app }) => {
      await seedAnswer(app, 'Summer Fest Opening', 'pending');
      await openEvent(app, 'Summer Fest Opening');
    },
    ACCEPT: async ({ app }) => btn(app, 'ACCEPT').click(),
    DECLINE: async ({ app }) => btn(app, 'DECLINE').click(),
    GOING: async ({ app }) => radio(app, 'GOING').click(),
    CANT: async ({ app }) => radio(app, "CAN'T").click(),
    REOPEN: async ({ app }) => {
      await openEvent(app, GIG);
      // The member reads the gig: it must stay open meanwhile.
      await expect(eventDetail(app)).toBeVisible();
      await app.page.waitForTimeout(3000);
      await expect(eventDetail(app), 'the reopened gig stays open').toBeVisible();
    },
    DROP_OUT: async ({ app }) => btn(app, 'DROP OUT').click(),
    CONFIRM_DROP: async ({ app }) => btn(app, 'Confirm drop').click(),
    KEEP: async ({ app }) => {
      await btn(app, 'CANCEL').click();
      await expect(app.page.getByText(app.t('Drop out?'))).toBeHidden();
    },
  },
});

const REH = SEED.rehearsalTomorrow;

export const rsvpRehearsalSteps = stepsFor(rsvpRehearsal, {
  boot: async () => {},
  states: {
    start,
    invited: async ({ app }) => {
      await expect(eventDetail(app).getByText(app.t('Are you coming?'))).toBeVisible();
      await expect(radio(app, 'GOING')).toHaveAttribute('aria-checked', 'false');
      await expect(radio(app, "CAN'T")).toHaveAttribute('aria-checked', 'false');
      await expect(eventDetail(app).getByText(new RegExp(escapeRe(app.t('Answer by {date} so the admin can confirm the room.', { date: '§' })).replace('§', '.+')))).toBeVisible();
      await noMaybe(app);
      await app.check('rehearsal invite');
    },
    maybePrompt,
    going: ({ app }) => answeredGoing(app, REH),
    goingOpen: async ({ app }) => {
      const rsvp = eventDetail(app).getByRole('region', { name: app.t('Your RSVP') }).or(eventDetail(app).locator('section', { hasText: app.t('Your RSVP') })).first();
      await expect(rsvp).toContainText(app.t('Going'));
      await expect(btn(app, 'Change')).toBeVisible();
      await expect(radio(app, 'GOING')).toHaveCount(0);
      await app.check('rehearsal, going');
    },
    changing: async ({ app }) => {
      await expect(radio(app, 'GOING')).toHaveAttribute('aria-checked', 'true');
      await expect(radio(app, "CAN'T")).toHaveAttribute('aria-checked', 'false');
      await expect.poll(() => myStatus(app, REH)).toBe('confirmed');
    },
    out: ({ app }) => answeredOut(app, REH),
    past: async ({ app }) => {
      await expect(eventDetail(app)).toBeVisible();
      await expect(app.page.getByRole('radio')).toHaveCount(0);
      await expect(eventDetail(app).getByText(app.t('Are you coming?'))).toHaveCount(0);
      await app.check('past rehearsal');
    },
  },
  events: {
    INVITED: async ({ app }) => {
      await seedAnswer(app, REH, 'pending');
      await openEvent(app, REH);
    },
    OLD_MAYBE: async ({ app }) => {
      await seedAnswer(app, REH, 'maybe');
      await openEvent(app, REH);
    },
    PAST_REHEARSAL: async ({ app }) => {
      await seedAnswer(app, REH, 'pending', -2);
      await openPastEvent(app, REH);
    },
    GOING: async ({ app }) => radio(app, 'GOING').click(),
    CANT: async ({ app }) => radio(app, "CAN'T").click(),
    REOPEN: async ({ app }) => {
      // An answer keeps a rehearsal open (handleRespond): leave it, then open it again.
      if (await eventDetail(app).isVisible()) {
        await back(app);
        await expect(eventDetail(app)).toBeHidden();
      }
      // Opened from Search (Duo Laptop's Planner): Back lands on the results.
      const results = app.page.getByRole('dialog', { name: app.t('Search events') }).last();
      if (await results.isVisible()) {
        await results.getByRole('button', { name: new RegExp(escapeRe(REH), 'i') }).first().click();
        await expect(eventDetail(app)).toBeVisible();
        await app.settle();
      } else await openEvent(app, REH);
    },
    CHANGE: async ({ app }) => btn(app, 'Change').click(),
    SAME_ANSWER: async ({ app }) => {
      await radio(app, 'GOING').click();
      await app.settle();
    },
  },
});

/** Past events sit in the calendar's archive: find them with Search. */
async function openPastEvent(app: App, title: string) {
  await app.tab('Calendar');
  await app.page.getByRole('button', { name: app.t('Search events'), exact: true }).filter({ visible: true }).first().click();
  await app.page.getByPlaceholder(app.t('Search title, venue, city, client…')).filter({ visible: true }).first().fill(title);
  await app.settle();
  const results = app.page.getByRole('dialog', { name: app.t('Search events') }).last();
  await results.getByRole('button', { name: new RegExp(escapeRe(title), 'i') }).first().click();
  await expect(eventDetail(app)).toBeVisible();
  await app.settle();
}
