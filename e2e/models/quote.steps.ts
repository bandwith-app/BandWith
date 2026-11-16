import { expect } from '../fixtures';
import type { App } from '../fixtures';
import { escapeRe, eventDetail, openEvent, SEED } from '../support/flows';
import { quote } from './quote.model.ts';
import { stepsFor, type Ctx } from './steps.ts';

const QUOTE_ID = '10000384-0000-4000-8000-000000000900';
const EVENT = SEED.quoteDraft; // "40th birthday party"
const JAZZ = SEED.tentativeGig;

const btn = (app: App, name: string, exact = true) =>
  app.page.getByRole('button', { name: app.t(name), exact }).filter({ visible: true });

async function dbQuote(app: App) {
  const db = await app.readDb();
  return db.quotes.find((q) => q.id === QUOTE_ID)!;
}
async function dbEvent(app: App, title: string) {
  const db = await app.readDb();
  return db.events.find((e) => e.title === title);
}

/** The quote's row in the Quotes list. */
const quoteRow = (app: App) => app.page.getByRole('button', { name: new RegExp(`Client B ${escapeRe(EVENT)}`) }).filter({ visible: true }).first();

/** Recording an answer closes the quote, back on the list: open it again, as a user would. */
async function reopenQuote(app: App) {
  await app.settle();
  if (await quoteRow(app).isVisible()) {
    await quoteRow(app).click();
    await app.settle();
  }
}

const answerButtons = (app: App) => [btn(app, 'Declined'), btn(app, 'Accepted')];

/** The event's title for this run: the converted quote or Jazz Club Night. */
const current = (c: Ctx) => String(c.data.title ?? EVENT);

export const quoteSteps = stepsFor(quote, {
  states: {
    home: async ({ app }) => {
      await expect(app.page.getByRole('button', { name: app.t('Home'), exact: true }).first()).toBeVisible();
    },
    draft: async ({ app }) => {
      await expect(app.page.getByText('Q-2026-0012').first()).toBeVisible();
      await expect(btn(app, 'Mark as sent')).toBeVisible();
      for (const b of answerButtons(app)) await expect(b).toHaveCount(0);
      await app.check('quote draft');
    },
    sent: async ({ app }) => {
      await expect(app.page.getByText(app.t('Client answered by phone or in person?'))).toBeVisible();
      for (const b of answerButtons(app)) await expect(b).toBeVisible();
      await expect(btn(app, 'Mark as sent')).toHaveCount(0);
      expect((await dbQuote(app)).status).toBe('sent');
      await app.check('quote sent');
    },
    declined: async ({ app }) => {
      await expect(app.page.getByText(app.t('Declined')).first()).toBeVisible();
      for (const b of answerButtons(app)) await expect(b).toHaveCount(0);
      expect((await dbQuote(app)).status).toBe('declined');
      await app.check('quote declined');
    },
    accepted: async ({ app }) => {
      await expect(btn(app, 'Create gig from quote')).toBeVisible();
      await expect(btn(app, 'Prepare contract')).toBeVisible();
      expect((await dbQuote(app)).status).toBe('accepted');
      await app.check('quote accepted');
    },
    contractForm: async ({ app }) => {
      await expect(app.page.getByText(app.t('Create contract')).first()).toBeVisible();
      await expect(app.page.locator('input').filter({ visible: true }).first()).toBeVisible();
      await expect
        .poll(() => app.page.locator('input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)))
        .toContain(`Performance agreement · ${EVENT}`);
      await app.check('create contract');
    },
    contract: async ({ app }) => {
      await expect(app.page.getByText(`Performance agreement · ${EVENT}`).first()).toBeVisible();
      const db = await app.readDb();
      expect(db.contracts.some((k) => String(k.title).includes(EVENT))).toBe(true);
      await app.check('contract created');
    },
    gig: async (c) => {
      const { app } = c;
      await expect(eventDetail(app)).toBeVisible();
      await expect(eventDetail(app).getByRole('heading', { name: new RegExp(escapeRe(EVENT), 'i') }).first()).toBeVisible();
      await expect(eventDetail(app).getByRole('button', { name: app.t('REVERT TO QUOTE') })).toBeVisible();
      const ev = await dbEvent(app, EVENT);
      expect(ev?.status).toBe('confirmed');
      expect((await dbQuote(app)).converted_to_event_id).toBe(ev?.id);
      await app.check('gig from quote');
    },
    rider: async ({ app }) => {
      await expect(app.page.getByRole('button', { name: app.t('CREATE RIDER') }).filter({ visible: true }).first()).toBeVisible();
      await app.check('rider & stage of the new gig');
    },
    revertPrompt: async ({ app }) => {
      const g = app.page.getByRole('group', { name: app.t('Revert to quote?') });
      await expect(g).toBeVisible();
      await expect(g.getByRole('button', { name: app.t('Revert to quote'), exact: true })).toBeVisible();
      await expect(g.getByRole('button', { name: app.t('Keep the gig'), exact: true })).toBeVisible();
    },
    quoteAgain: async (c) => {
      const { app } = c;
      await expect(eventDetail(app).getByRole('button', { name: app.t('CONFIRM AS GIG') })).toBeVisible();
      await expect(eventDetail(app).getByRole('button', { name: app.t('REVERT TO QUOTE') })).toHaveCount(0);
      await expect.poll(async () => (await dbEvent(app, EVENT))?.status).toBe('tentative');
      await expect.poll(async () => (await dbQuote(app)).status).toBe('sent');
      await app.check('back to a quote');
    },
    tentativeQuote: async (c) => {
      const { app } = c;
      c.data.title = JAZZ;
      await expect(eventDetail(app).getByRole('button', { name: app.t('CONFIRM AS GIG') })).toBeVisible();
      await expect(eventDetail(app).getByRole('button', { name: app.t('REVERT TO QUOTE') })).toHaveCount(0);
      await app.check('tentative gig (quote)');
    },
    confirmed: async (c) => {
      const { app } = c;
      await expect(app.page.getByText(app.t('Quote confirmed as Gig!'))).toBeVisible();
      await expect(btn(app, 'UNDO')).toBeVisible();
      await expect.poll(async () => (await dbEvent(app, current(c)))?.status).toBe('confirmed');
    },
    undone: async (c) => {
      await expect.poll(async () => (await dbEvent(c.app, current(c)))?.status).toBe('tentative');
    },
    noRevert: async ({ app }) => {
      await expect(eventDetail(app)).toBeVisible();
      await expect(eventDetail(app).getByRole('button', { name: app.t('REVERT TO QUOTE') })).toHaveCount(0);
      await app.check('no revert to quote');
    },
  },
  events: {
    OPEN_DRAFT_QUOTE: async ({ app }) => {
      await app.page.getByRole('button', { name: new RegExp(`${escapeRe(EVENT)}.*Q-2026-0012`) }).first().click();
      await app.settle();
      await app.page.getByRole('button', { name: new RegExp(`Client B ${escapeRe(EVENT)}`) }).first().click();
      await app.settle();
    },
    MARK_SENT: async ({ app }) => {
      await btn(app, 'Mark as sent').click();
      await reopenQuote(app);
    },
    CLIENT_DECLINES: async ({ app }) => {
      await btn(app, 'Declined').click();
      await expect(app.page.getByText(app.t('Quote marked as declined'))).toBeVisible();
      await reopenQuote(app);
    },
    CLIENT_ACCEPTS: async ({ app }) => {
      await btn(app, 'Accepted').click();
      await expect(app.page.getByText(app.t('Quote accepted. Open it to create the gig.'))).toBeVisible();
      await reopenQuote(app);
    },
    CREATE_GIG: async ({ app }) => {
      await btn(app, 'Create gig from quote').click();
      await expect(app.page.getByText(app.t('Gig created from the quote')).or(app.page.getByText(app.t('Gig confirmed'))).first()).toBeVisible();
      await app.settle();
    },
    PREPARE_CONTRACT: async ({ app }) => {
      await btn(app, 'Prepare contract').click();
      await app.settle();
    },
    CREATE_CONTRACT: async ({ app }) => {
      await app.page.getByRole('button', { name: app.t('Create contract'), exact: true }).filter({ visible: true }).last().click();
      await app.settle();
    },
    OPEN_RIDER: async ({ app }) => {
      const tab = eventDetail(app).getByRole('tab', { name: new RegExp(`^${escapeRe(app.t('Rider & stage'))}$`, 'i') });
      if (await tab.count()) await tab.click();
      else await eventDetail(app).getByRole('button', { name: new RegExp(`^${escapeRe(app.t('OPEN'))}: ${escapeRe(app.t('RIDER & STAGE'))}`, 'i') }).click();
      await app.settle();
    },
    REVERT: ({ app }) => eventDetail(app).getByRole('button', { name: app.t('REVERT TO QUOTE') }).click(),
    KEEP_GIG: ({ app }) => app.page.getByRole('button', { name: app.t('Keep the gig'), exact: true }).click(),
    CONFIRM_REVERT: async ({ app }) => {
      await app.page.getByRole('group', { name: app.t('Revert to quote?') }).getByRole('button', { name: app.t('Revert to quote'), exact: true }).click();
      await app.settle();
    },
    CONFIRM_AS_GIG: async ({ app }) => {
      await eventDetail(app).getByRole('button', { name: app.t('CONFIRM AS GIG') }).click();
    },
    UNDO: async ({ app }) => {
      await btn(app, 'UNDO').click();
      await app.settle();
    },
    OPEN_TENTATIVE: ({ app }) => openEvent(app, JAZZ),
    OPEN_PAST_GIG: async ({ app }) => {
      await app.tab('Calendar');
      await app.page.getByRole('button', { name: app.t('Search events'), exact: true }).filter({ visible: true }).first().click();
      await app.page.getByPlaceholder(app.t('Search title, venue, city, client…')).filter({ visible: true }).first().fill('Summer Fest');
      await app.settle();
      await app.page.getByRole('dialog', { name: app.t('Search events') }).last().getByRole('button', { name: /Summer Fest Opening/i }).first().click();
      await app.settle();
    },
    OPEN_REHEARSAL: ({ app }) => openEvent(app, SEED.rehearsalTomorrow),
  },
});

