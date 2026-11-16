import { expect } from '../fixtures';
import type { App } from '../fixtures';
import { escapeRe, openCreate } from '../support/flows';
import { proposal } from './proposal.model.ts';
import { actionItem, builderTitle, dbPoll, JONAH, lockedToast, lockInTopPick, ME, publishBtn, reachable } from './poll.steps.ts';
import { stepsFor } from './steps.ts';

const BAND = '10000064-0000-4000-8000-000000000100';
const TOPIC = 'Tighten the horn section';
const REASON = 'Room booked all week';

const topicField = (app: App) => app.page.getByPlaceholder(app.t('e.g. Practice new setlist transitions'));
const openUntil = (app: App) =>
  app.page.getByText(new RegExp(escapeRe(app.t('Open until {date}', { date: '§' })).replace('§', 'Thu, Nov 19')));
const withdrawQ = (app: App) => app.page.getByRole('alertdialog').filter({ hasText: app.t('Withdraw your proposal?') });
const declinePanel = (app: App) => app.page.getByRole('alertdialog').filter({ hasText: app.t('Decline this proposal?') });

/** Makes the demo user the band's admin and adds a proposal Jonah sent at `sent`. */
async function jonahProposal(app: App, sent: string, days: string | null) {
  await app.editDb((db, { me }) => {
    for (const m of db.band_members) if (m.user_id === me) m.role = 'admin';
    db.rehearsal_polls.push({
      id: '10000fff-0000-4000-8000-000000004095',
      band_id: BAND,
      created_by: JONAH,
      creator_role: 'member',
      title: TOPIC,
      notes: days ? `[Preferred Days: ${days}]\n\nThe two new songs` : 'The two new songs',
      status: 'proposed',
      confirmed_event_id: null,
      created_at: sent,
      updated_at: sent,
    });
  });
}

async function adminCard(app: App) {
  await expect(app.page.getByText(app.t('Member rehearsal proposal')).first()).toBeVisible();
  await expect(app.page.getByText(TOPIC).first()).toBeVisible();
  await expect(openUntil(app).first()).toBeVisible();
  await expect(app.page.getByRole('button', { name: app.t('Decline'), exact: true }).first()).toBeVisible();
  await expect(app.page.getByRole('button', { name: app.t('Build poll'), exact: true }).first()).toBeVisible();
}

async function jonahNotice(app: App) {
  const db = await app.readDb();
  return db.notifications.find((n) => n.user_id === JONAH && n.title === 'Rehearsal proposal declined');
}

async function declinedCommon(app: App) {
  await expect(app.page.getByText(app.t('Proposal declined.'))).toBeVisible();
  await expect(app.page.getByText(app.t('Member rehearsal proposal'))).toHaveCount(0);
  expect((await dbPoll(app, TOPIC))?.status).toBe('cancelled');
}

export const proposalSteps = stepsFor(proposal, {
  states: {
    start: async ({ app }) => {
      await expect(app.page.getByRole('button', { name: app.t('Home'), exact: true }).first()).toBeVisible();
    },
    proposed: async ({ app }) => {
      await expect(topicField(app)).toBeHidden();
      await expect(app.page.getByText(app.t('Your rehearsal proposal')).first()).toBeVisible();
      await expect(app.page.getByText(app.t('Pending admin')).first()).toBeVisible();
      await expect(openUntil(app).first()).toBeVisible();
      const p = await dbPoll(app, TOPIC);
      expect(p?.status).toBe('proposed');
      expect(p?.created_by).toBe(ME);
      await app.check('member proposal on Home');
    },
    limitReached: async ({ app }) => {
      await expect(app.page.getByText(app.t('Weekly limit reached'))).toBeVisible();
      await expect(app.page.getByText(app.t('Next available proposal'))).toBeVisible();
      await expect(app.page.getByText(app.t('In {count} days', { count: 7 }))).toBeVisible();
      await expect(topicField(app)).toHaveCount(0);
      await app.check('weekly limit reached');
    },
    withdrawPrompt: async ({ app }) => {
      await expect(withdrawQ(app)).toBeVisible();
      await expect(withdrawQ(app)).toContainText(app.t('The admins will no longer see it.'));
      await app.check('withdraw your proposal?');
    },
    withdrawn: async ({ app }) => {
      await expect(app.page.getByText(app.t('Proposal withdrawn.'))).toBeVisible();
      await expect(app.page.getByText(app.t('Your rehearsal proposal'))).toHaveCount(0);
      expect(await dbPoll(app, TOPIC)).toBeUndefined();
    },
    formOpen: async ({ app }) => {
      await expect(topicField(app)).toBeVisible();
      await expect(app.page.getByText(app.t('Weekly limit reached'))).toHaveCount(0);
    },
    ownProposalAdmin: async ({ app }) => {
      await adminCard(app);
      await app.check('admin sees the proposal');
    },
    adminSees: async ({ app }) => {
      await adminCard(app);
      await expect(app.page.getByText('Jonah R.').first()).toBeVisible();
      await app.check('admin sees Jonah’s proposal');
    },
    declinePanel: async ({ app }) => {
      await expect(declinePanel(app)).toBeVisible();
      await expect(declinePanel(app).getByPlaceholder(app.t('e.g. The room is booked that week'))).toBeVisible();
      await app.check('decline this proposal?');
    },
    declined: async ({ app }) => {
      await declinedCommon(app);
      await expect.poll(async () => (await jonahNotice(app))?.body).toBe(`An admin declined your rehearsal proposal "${TOPIC}".`);
    },
    declinedWithReason: async ({ app }) => {
      await declinedCommon(app);
      await expect.poll(async () => (await jonahNotice(app))?.body).toBe(`An admin declined your rehearsal proposal "${TOPIC}". Reason: ${REASON}`);
    },
    builderFromProposal: async ({ app }) => {
      await expect(builderTitle(app)).toHaveValue(TOPIC);
      await expect(app.page.getByText(app.t('From {name}:', { name: 'Jonah R.' }))).toBeVisible();
      await app.check('poll builder from a proposal');
    },
    polling: async ({ app }) => {
      await expect(app.page.getByText(app.t('Rehearsal availability poll published to band!'))).toBeVisible();
      await expect(app.page.getByRole('heading', { name: TOPIC }).first()).toBeVisible();
      await expect(app.page.getByText(app.t('Member rehearsal proposal'))).toHaveCount(0);
      expect((await dbPoll(app, TOPIC))?.status).toBe('polling');
    },
    rehearsal: async ({ app }) => {
      await expect(lockedToast(app)).toBeVisible();
      await expect.poll(async () => (await dbPoll(app, TOPIC))?.status).toBe('confirmed');
      const p = await dbPoll(app, TOPIC);
      const db = await app.readDb();
      expect(db.events.find((e) => e.id === p?.confirmed_event_id)?.event_type).toBe('rehearsal');
    },
    expired: async ({ app }) => {
      await expect(app.page.getByRole('heading', { name: app.t('Action center') })).toBeVisible();
      await expect(app.page.getByText(TOPIC)).toHaveCount(0);
      await expect(app.page.getByText(app.t('Member rehearsal proposal'))).toHaveCount(0);
    },
  },
  events: {
    PROPOSE: async ({ app }) => {
      await openCreate(app, 'Propose rehearsal');
      await topicField(app).fill(TOPIC);
      await app.page.getByRole('button', { name: app.t('Thu'), exact: true }).first().click();
      await app.page.getByRole('button', { name: app.t('Submit to admin') }).click();
      await expect(app.page.getByText(app.t('Proposal sent to band admin.'))).toBeVisible();
      await app.settle();
    },
    PROPOSE_AGAIN: async ({ app }) => {
      await openCreate(app, 'Propose rehearsal');
      await expect(topicField(app).or(app.page.getByText(app.t('Weekly limit reached')))).toBeVisible();
    },
    CLOSE: async ({ app }) => {
      await app.page.getByRole('button', { name: app.t('Close'), exact: true }).filter({ visible: true }).last().click();
      await app.settle();
    },
    WITHDRAW: ({ app }) => app.page.getByRole('button', { name: app.t('Withdraw'), exact: true }).first().click(),
    KEEP: async ({ app }) => {
      const q = withdrawQ(app).or(declinePanel(app));
      await q.getByRole('button', { name: app.t('Cancel'), exact: true }).click();
      await expect(q).toHaveCount(0);
    },
    CONFIRM_WITHDRAW: async ({ app }) => {
      await withdrawQ(app).getByRole('button', { name: app.t('Withdraw'), exact: true }).click();
      await app.settle();
    },
    AS_ADMIN: ({ app }) =>
      app.editDb((db, { me }) => {
        for (const m of db.band_members) if (m.user_id === me) m.role = 'admin';
      }),
    PROPOSED_BY_JONAH: ({ app }) => jonahProposal(app, '2026-11-16T07:00:00.000Z', 'Thu'),
    STALE_PROPOSAL: ({ app }) => jonahProposal(app, '2026-11-07T07:00:00.000Z', null),
    DECLINE: async ({ app }) => {
      const decline = app.page.getByRole('button', { name: app.t('Decline'), exact: true }).first();
      if (!(await reachable(decline))) {
        // Duo Laptop: the proposal opens from Home's Action items.
        await actionItem(app, TOPIC).click();
        await app.settle();
      }
      await app.page.getByRole('button', { name: app.t('Decline'), exact: true }).filter({ visible: true }).last().click();
    },
    CONFIRM_DECLINE: async ({ app }) => {
      await declinePanel(app).getByRole('button', { name: app.t('Decline'), exact: true }).click();
      await app.settle();
    },
    CONFIRM_DECLINE_WITH_REASON: async ({ app }) => {
      await declinePanel(app).getByPlaceholder(app.t('e.g. The room is booked that week')).fill(REASON);
      await declinePanel(app).getByRole('button', { name: app.t('Decline'), exact: true }).click();
      await app.settle();
    },
    BUILD_POLL: async ({ app }) => {
      await app.page.getByRole('button', { name: app.t('Build poll'), exact: true }).first().click();
      await expect(builderTitle(app)).toBeVisible();
      await app.settle();
    },
    PUBLISH: async ({ app }) => {
      await app.page.getByRole('button', { name: app.t('Next week'), exact: true }).click();
      await app.page.getByRole('button', { name: app.t('Add selected days to poll') }).click();
      await publishBtn(app).click();
      await app.settle();
    },
    LOCK_IN: ({ app }) => lockInTopPick(app, TOPIC),
  },
});
