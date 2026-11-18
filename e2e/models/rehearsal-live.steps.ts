import { expect } from '../fixtures';
import { eventDetail, openEvent } from '../support/flows';
import { FOCUS, WEEKLY, liveDialog, openLive, openWithFocusSongs, savedSession, timer, timerBar } from '../support/live';
import { rehearsalLive } from './rehearsal-live.model.ts';
import { stepsFor, type Ctx } from './steps.ts';

const bar = (c: Ctx) => timerBar(c.app);
const barButton = (c: Ctx, name: string, vars?: Record<string, string | number>) =>
  bar(c).getByRole('button', { name: c.app.t(name, vars), exact: true });
const summary = (c: Ctx) => c.app.page.getByRole('dialog', { name: c.app.t('Rehearsal summary') });
/** Songs played in this run (the current song at the start, then the second one before ending). */
const playedCount = (c: Ctx) => (c.data.second ? 2 : 1);

export const rehearsalLiveSteps = stepsFor(rehearsalLive, {
  boot: async () => {},
  states: {
    start: async () => {},
    idle: async (c) => {
      await expect(liveDialog(c.app).getByRole('button', { name: c.app.t('Start rehearsal') })).toBeVisible();
      await expect(timer(c.app)).toHaveCount(0);
      expect(await savedSession(c.app)).toBeUndefined();
      await c.app.check('live mode, not started');
    },
    live: async (c) => {
      await expect(timer(c.app)).toBeVisible();
      await expect(bar(c)).toContainText(c.app.t('Rehearsing'));
      await expect(barButton(c, 'Pause')).toBeVisible();
      await expect(barButton(c, 'End', { context: 'session' })).toBeVisible();
      await expect.poll(async () => {
        const row = await savedSession(c.app);
        return !!row && !row.ended_at && !row.paused_at;
      }).toBe(true);
    },
    paused: async (c) => {
      await expect(bar(c)).toContainText(c.app.t('Paused'));
      const frozen = await timer(c.app).textContent();
      await c.app.page.waitForTimeout(1500);
      expect(await timer(c.app).textContent()).toBe(frozen);
      await expect(barButton(c, 'Resume')).toBeVisible();
      await expect.poll(async () => (await savedSession(c.app))?.paused_at ?? null).not.toBeNull();
    },
    confirming: async (c) => {
      await expect(bar(c)).toContainText(c.app.t('End rehearsal?'));
      await expect(barButton(c, 'Keep going')).toBeVisible();
      await expect(barButton(c, 'End now')).toBeVisible();
      expect((await savedSession(c.app))?.ended_at ?? null).toBeNull();
    },
    summary: async (c) => {
      const d = summary(c);
      await expect(d).toBeVisible();
      await expect(d).toContainText(c.app.t('{played} of {total} songs played', { played: playedCount(c), total: 3 }));
      const list = d.getByRole('list', { name: c.app.t('Songs played') });
      await expect(list).toContainText(FOCUS[0]);
      await expect(d.getByRole('button', { name: c.app.t('Resume rehearsal') })).toBeVisible();
      await expect(d.getByRole('button', { name: c.app.t('Done') })).toBeVisible();
      await expect.poll(async () => {
        const row = await savedSession(c.app);
        return row ? { ended: !!row.ended_at, played: (row.summary?.played ?? []).length } : null;
      }).toEqual({ ended: true, played: playedCount(c) });
      await c.app.check('rehearsal summary');
    },
    ended: async (c) => {
      await expect(summary(c)).toHaveCount(0);
      await expect(bar(c)).toContainText(c.app.t('Ended'));
      await expect(barButton(c, 'Summary')).toBeVisible();
      await expect(barButton(c, 'Pause')).toHaveCount(0);
    },
    page: async (c) => {
      await expect(liveDialog(c.app)).toHaveCount(0);
      const card = eventDetail(c.app).getByRole('group', { name: c.app.t('Rehearsal session') });
      await expect(card).toContainText(c.app.t('Ended'));
      await expect(card).toContainText(c.app.t('{played} of {total} songs played', { played: playedCount(c), total: 3 }));
      await c.app.check('rehearsal page, session ended');
    },
  },
  events: {
    OPEN_LIVE: async (c) => {
      await openWithFocusSongs(c.app);
      await openEvent(c.app, WEEKLY);
      await openLive(c.app);
    },
    START: async (c) => liveDialog(c.app).getByRole('button', { name: c.app.t('Start rehearsal') }).click(),
    PAUSE: async (c) => barButton(c, 'Pause').click(),
    RESUME: async (c) => barButton(c, 'Resume').click(),
    END: async (c) => barButton(c, 'End', { context: 'session' }).click(),
    KEEP_GOING: async (c) => barButton(c, 'Keep going').click(),
    END_NOW: async (c) => {
      // Move on to the second song first, so the summary lists two.
      if (!c.data.second) {
        await barButton(c, 'Keep going').click();
        await liveDialog(c.app).getByRole('button', { name: c.app.t('Next song') }).click();
        await expect(liveDialog(c.app).getByRole('button', { name: c.app.t('Now playing: {title}', { title: FOCUS[1] }) }).first()).toBeVisible();
        c.data.second = true;
        await barButton(c, 'End', { context: 'session' }).click();
      }
      await barButton(c, 'End now').click();
    },
    DONE: async (c) => summary(c).getByRole('button', { name: c.app.t('Done') }).click(),
    RESUME_REHEARSAL: async (c) => {
      await summary(c).getByRole('button', { name: c.app.t('Resume rehearsal') }).click();
      await expect(summary(c)).toHaveCount(0);
    },
    SHOW_SUMMARY: async (c) => barButton(c, 'Summary').click(),
    EXIT: async (c) => {
      await c.app.button('Exit live mode', { exact: true }).first().click();
      await c.app.settle();
    },
    RELOAD: async (c) => {
      await expect.poll(async () => (await savedSession(c.app))?.started_at ?? null).not.toBeNull();
      await c.app.open();
      await openEvent(c.app, WEEKLY);
      await openLive(c.app);
    },
  },
});
