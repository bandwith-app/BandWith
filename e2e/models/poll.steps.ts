import type { Locator } from '@playwright/test';
import { expect } from '../fixtures';
import type { App } from '../fixtures';
import { escapeRe, eventDetail, openCreate, openEvent, SEED } from '../support/flows';
import { poll } from './poll.model.ts';
import { stepsFor } from './steps.ts';

export const ME = '10000001-0000-4000-8000-000000000001';
export const JONAH = '10000003-0000-4000-8000-000000000003';
const MARTA = '10000002-0000-4000-8000-000000000002';
const LENA = '10000004-0000-4000-8000-000000000004';
export const SEED_POLL = '100005dc-0000-4000-8000-000000001500';
const TITLE = 'Horn section run-through';

export const builderTitle = (app: App) => app.page.getByPlaceholder(app.t('e.g. Extra rehearsal before the wedding'));
const wizardStep1 = (app: App) => app.page.getByPlaceholder(app.t('e.g. New setlist run-through'));
const discardSheet = (app: App) => app.page.getByRole('dialog').filter({ hasText: app.t('Discard this poll?') });
export const publishBtn = (app: App) => app.page.getByRole('button', { name: app.t('Publish poll'), exact: true });

/** A poll's card on Home, by its title. */
export const pollCard = (app: App, title: string): Locator =>
  app.page
    .locator('div, section, article')
    .filter({ has: app.page.getByRole('heading', { name: title, exact: true }) })
    .filter({ has: app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Details · Lock in'))}|^${escapeRe(app.t('Hide details'))}`) }) })
    .last();

/** Can a user tap it here (on screen, not under another layer)? */
export const reachable = (l: Locator) => l.first().click({ trial: true, timeout: 2500 }).then(() => true, () => false);

/** A Home action item ("{title} · Rehearsal poll · vote on dates"), the Duo Laptop's way to a poll or proposal. */
export const actionItem = (app: App, title: string) =>
  app.page.getByRole('button', { name: new RegExp(`^${escapeRe(title)} `) }).filter({ visible: true }).first();

/** Slot pad of the published poll: "MON 23 20:00–22:00 …". */
const pad = (app: App, day: string) => app.page.getByRole('button', { name: new RegExp(`^${day} 20:00`) }).first();

export async function dbPoll(app: App, title: string) {
  const db = await app.readDb();
  return db.rehearsal_polls.find((p) => p.title === title);
}

/** The lock-in toast: the poll card's, or the vote sheet's (Duo Laptop "Find a date"). */
export const lockedToast = (app: App) =>
  app.page.getByText(app.t('Rehearsal scheduled and added to the calendar!')).or(app.page.getByText(app.t('Rehearsal scheduled and confirmed!'))).first();

/** Opens the poll's details and locks in its top pick. */
export async function lockInTopPick(app: App, title: string) {
  const details = pollCard(app, title).getByRole('button', { name: app.t('Details · Lock in') });
  if (!(await reachable(details))) {
    // Duo Laptop: Home's lower pane lists the poll under Action items; it
    // opens "Find a date" with the best slot's "Lock {date}".
    await actionItem(app, title).click();
    await app.settle();
    const lockDay = new RegExp(`^${escapeRe(app.t('Lock {day}', { day: '§' })).replace('§', `(?!${escapeRe(app.t('in'))}$).+`)}$`, 'i');
    await app.page.getByRole('button', { name: lockDay }).filter({ visible: true }).last().click();
    await app.settle();
    return;
  }
  await details.click();
  await app.settle();
  // One poll's details are open at a time: its Lock in buttons are the only ones.
  await app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Lock in'))}$`) }).first().click();
  await app.page.getByRole('button', { name: app.t('Confirm & create event') }).click();
  await app.settle();
}

/** The rehearsal a poll was locked into, with its roster. */
async function lockedEvent(app: App, title: string) {
  const db = await app.readDb();
  const p = db.rehearsal_polls.find((x) => x.title === title);
  const ev = p?.confirmed_event_id ? db.events.find((e) => e.id === p.confirmed_event_id) : undefined;
  const roster = ev ? db.event_members.filter((m) => m.event_id === ev.id) : [];
  return { poll: p, event: ev, roster };
}

export const pollSteps = stepsFor(poll, {
  states: {
    home: async ({ app }) => {
      await expect(app.page.getByRole('heading', { name: SEED.poll }).first()).toBeVisible();
    },
    builderEmpty: async ({ app }) => {
      // A default title is not something the user typed (RehearsalPollModal baseline).
      await expect(builderTitle(app)).toHaveValue(app.t('Upcoming Rehearsal Availability'));
      await expect(publishBtn(app)).toBeDisabled();
      await app.check('poll builder');
    },
    builderTyped: async ({ app }) => {
      await expect(builderTitle(app)).toHaveValue(TITLE);
      await expect(discardSheet(app)).toHaveCount(0);
    },
    discardPrompt: async ({ app }) => {
      await expect(discardSheet(app)).toBeVisible();
      await expect(discardSheet(app).getByRole('button', { name: app.t('Keep editing'), exact: true }).last()).toBeVisible();
      await expect(discardSheet(app).getByRole('button', { name: app.t('Discard'), exact: true })).toBeVisible();
      await app.check('discard this poll?');
    },
    wizard: async ({ app }) => {
      await expect(wizardStep1(app)).toBeVisible();
      await expect(builderTitle(app)).toBeHidden();
      await expect(discardSheet(app)).toHaveCount(0);
      expect(await dbPoll(app, TITLE)).toBeUndefined();
    },
    builderReady: async ({ app }) => {
      await expect(app.page.getByRole('heading', { name: new RegExp(`${escapeRe(app.t('Candidate slots'))} · 4`) })).toBeVisible();
      await expect(publishBtn(app)).toBeEnabled();
    },
    published: async ({ app }) => {
      await expect(app.page.getByText(app.t('Rehearsal availability poll published to band!'))).toBeVisible();
      await expect(app.page.getByRole('heading', { name: TITLE }).first()).toBeVisible();
      await expect(pollCard(app, TITLE)).toContainText(app.t('{answered} of {total} answered', { answered: 0, total: 5 }));
      const p = await dbPoll(app, TITLE);
      expect(p?.status).toBe('polling');
      expect(p?.invited_user_ids ?? []).toEqual([]);
      await app.check('published poll');
    },
    voted: async ({ app }) => {
      await expect(pad(app, 'MON 23')).toHaveAttribute('aria-pressed', 'true');
      await expect(pad(app, 'TUE 24')).toHaveAttribute('aria-pressed', 'false');
      const p = await dbPoll(app, TITLE);
      await expect
        .poll(async () => {
          const db = await app.readDb();
          const days = db.rehearsal_poll_votes
            .filter((v) => v.poll_id === p?.id && v.user_id === ME)
            .map((v) => db.rehearsal_poll_options.find((o) => o.id === v.option_id)?.proposed_date);
          return days;
        }, { timeout: 15_000 })
        .toEqual(['2026-11-23']);
      await app.check('poll after fast votes');
    },
    lockedIn: async ({ app }) => {
      await expect(lockedToast(app)).toBeVisible();
      await expect.poll(async () => (await lockedEvent(app, TITLE)).poll?.status).toBe('confirmed');
      const { event, roster } = await lockedEvent(app, TITLE);
      expect(event?.event_date).toBe('2026-11-23');
      expect(roster.find((m) => m.user_id === ME)?.status).toBe('confirmed');
      await app.tab('Calendar');
      await expect(app.page.getByRole('button', { name: new RegExp(escapeRe(TITLE), 'i') }).first()).toBeVisible();
      await app.check('calendar with the locked-in rehearsal');
    },
    rehearsalCancelled: async ({ app }) => {
      await expect(eventDetail(app)).toBeHidden();
      await expect(app.page.getByRole('button', { name: new RegExp(escapeRe(TITLE), 'i') })).toHaveCount(0);
      const db = await app.readDb();
      expect(db.events.filter((e) => e.title === TITLE)).toHaveLength(0);
    },
    pollDeleted: async ({ app }) => {
      await expect(app.page.getByText(app.t('Rehearsal poll deleted.'))).toBeVisible();
      await expect(app.page.getByRole('heading', { name: TITLE })).toHaveCount(0);
      expect(await dbPoll(app, TITLE)).toBeUndefined();
    },
    restrictedPoll: async ({ app }) => {
      await expect(pollCard(app, SEED.poll)).toContainText(app.t('Not invited'));
      await app.check('poll the admin is not invited to');
    },
    lockedInWithoutAdmin: async ({ app }) => {
      await expect(lockedToast(app)).toBeVisible();
      await expect.poll(async () => (await lockedEvent(app, SEED.poll)).roster.length).toBe(3);
      const { roster } = await lockedEvent(app, SEED.poll);
      expect(roster.map((m) => m.user_id).sort()).toEqual([MARTA, JONAH, LENA].sort());
    },
  },
  events: {
    OPEN_BUILDER: async ({ app }) => {
      await openCreate(app, 'New rehearsal');
      await app.page.getByRole('radio', { name: app.t('Poll availability') }).click();
      await expect(builderTitle(app)).toBeVisible();
      await app.settle();
    },
    BACK: async ({ app }) => {
      await app.page.getByRole('button', { name: app.t('Back'), exact: true }).filter({ visible: true }).first().click();
      await app.settle();
    },
    TYPE_TITLE: ({ app }) => builderTitle(app).fill(TITLE),
    KEEP_EDITING: async ({ app }) => {
      await discardSheet(app).getByRole('button', { name: app.t('Keep editing'), exact: true }).last().click();
      await expect(discardSheet(app)).toBeHidden();
    },
    DISCARD: async ({ app }) => {
      await discardSheet(app).getByRole('button', { name: app.t('Discard'), exact: true }).click();
      await app.settle();
    },
    ADD_SLOTS: async ({ app }) => {
      await app.page.getByRole('button', { name: app.t('Next week'), exact: true }).click();
      await app.page.getByRole('button', { name: app.t('Add selected days to poll') }).click();
      await app.settle();
    },
    PUBLISH: async ({ app }) => {
      await publishBtn(app).click();
      await app.settle();
    },
    MEMBER_VOTES_FAST: async ({ app }) => {
      await app.setRole('member');
      await expect(pad(app, 'MON 23')).toBeVisible();
      for (const day of ['MON 23', 'TUE 24', 'MON 23', 'TUE 24', 'MON 23']) await pad(app, day).click();
    },
    LOCK_IN: async (c) => {
      const { app } = c;
      if (app.role === 'admin' && (await app.readDb()).band_members.find((m) => m.user_id === ME)?.role !== 'admin') {
        await app.setRole('admin');
      }
      const title = (await dbPoll(app, TITLE)) ? TITLE : SEED.poll;
      await lockInTopPick(app, title);
    },
    CANCEL_REHEARSAL: async ({ app }) => {
      await openEvent(app, TITLE);
      await eventDetail(app).getByRole('button', { name: app.t('DELETE THIS REHEARSAL') }).click();
      await eventDetail(app).getByRole('button', { name: app.t('Confirm delete') }).click();
      await app.settle();
    },
    DELETE_POLL: async ({ app }) => {
      const card = pollCard(app, TITLE);
      await card.getByRole('button', { name: app.t('Details · Lock in') }).click();
      await app.page.getByRole('button', { name: app.t('Delete poll'), exact: true }).first().click();
      await expect(app.page.getByText(app.t('Delete rehearsal poll?'))).toBeVisible();
      await app.page.getByRole('button', { name: app.t('Delete poll'), exact: true }).last().click();
      await app.settle();
    },
    RESTRICT_INVITEES: async ({ app }) => {
      await app.editDb((db) => {
        const p = db.rehearsal_polls.find((x) => x.id === SEED_POLL)!;
        p.invited_user_ids = [JONAH, MARTA, LENA];
      });
    },
  },
});
