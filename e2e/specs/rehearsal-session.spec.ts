import { test, expect, fakeDate, FIXED_NOW, type App } from '../fixtures';
import { openEvent, eventDetail } from '../support/flows';
import { settle } from '../support/settle';
import { FOCUS, WEEKLY, isLaptop, liveDialog, openLive, openWithFocusSongs, savedSession, timer, timerBar } from '../support/live';

/**
 * Rehearsal session in Live mode (plan A1b, migration 131): the admin starts,
 * pauses and ends the rehearsal; members see the same clock; the end shows a
 * summary (time rehearsed without pauses, songs played) that is saved and
 * shown on the rehearsal's page. Flag `rehearsal_sessions` (on by default).
 */

const text = async (app: App) => (await timer(app).textContent())?.trim() ?? '';

for (const role of ['admin', 'member'] as const) {
  test.describe(`Rehearsal session as ${role}`, () => {
    test.use({ role, autoOpen: false });

    test(`@smoke ${role}: a running session shows its clock in Live mode; the rehearsal page shows it too`, async ({ app }) => {
      await openWithFocusSongs(app, { minutesAgo: 47, played: [FOCUS[0]] });
      await openEvent(app, WEEKLY);
      const card = eventDetail(app).getByRole('group', { name: app.t('Rehearsal session') });
      await expect(card).toContainText(app.t('{m} min', { m: 47 }));
      await expect(card).toContainText(app.t('{played} of {total} songs played', { played: 1, total: 3 }));
      await app.check('rehearsal page, session running');

      await openLive(app);
      if (isLaptop()) {
        // The floor wedge shows the session's clock; the admin can pause it there.
        await expect(app.page.getByRole('region', { name: app.t('Now playing') }).getByLabel(new RegExp(app.t('Rehearsed {time}', { time: '47:' }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeVisible();
        if (role === 'admin') {
          const deck = app.page.getByRole('region', { name: app.t('Song controls') });
          await deck.getByRole('button', { name: app.t('Pause'), exact: true }).click();
          await expect(deck.getByRole('button', { name: app.t('Resume'), exact: true })).toBeVisible();
          await expect.poll(async () => (await savedSession(app))?.paused_at).not.toBeNull();
        } else {
          await expect(app.page.getByRole('region', { name: app.t('Song controls') }).getByRole('button', { name: app.t('Pause'), exact: true })).toHaveCount(0);
        }
        await app.check('floor wedge, session clock');
        return;
      }
      await expect(timer(app)).toHaveText(/^47:\d\d$/);
      await expect(timerBar(app)).toContainText(app.t('Rehearsing'));
      if (role === 'admin') {
        await expect(timerBar(app).getByRole('button', { name: app.t('Pause'), exact: true })).toBeVisible();
        await expect(timerBar(app).getByRole('button', { name: app.t('End', { context: 'session' }), exact: true })).toBeVisible();
      } else {
        await expect(timerBar(app).getByRole('button')).toHaveCount(0);
      }
      await app.check('live mode, session clock');
    });

    test(`@smoke ${role}: before the start only the admin sees Start rehearsal`, async ({ app }) => {
      await openWithFocusSongs(app);
      await openEvent(app, WEEKLY);
      await expect(eventDetail(app).getByRole('group', { name: app.t('Rehearsal session') })).toHaveCount(0);
      await openLive(app);
      test.skip(isLaptop(), 'the floor wedge covers Live mode; starting is done unfolded');
      if (role === 'admin') await expect(liveDialog(app).getByRole('button', { name: app.t('Start rehearsal') })).toBeVisible();
      else await expect(timerBar(app)).toHaveCount(0);
      await app.check('live mode, session not started');
    });
  });
}

test.describe('Rehearsal session: the admin runs it', () => {
  test.use({ role: 'admin', autoOpen: false });

  test('start, pause, resume, two songs, end: the summary is shown, saved and on the rehearsal page', async ({ app }) => {
    test.slow();
    await openWithFocusSongs(app);
    await openEvent(app, WEEKLY);
    await openLive(app);
    const live = liveDialog(app);

    await live.getByRole('button', { name: app.t('Start rehearsal') }).click();
    await expect(timer(app)).toHaveText(/^0:0\d$/);
    await expect.poll(async () => (await savedSession(app))?.started_at).toBeTruthy();

    // Pause: the clock stands still.
    await timerBar(app).getByRole('button', { name: app.t('Pause'), exact: true }).click();
    await expect(timerBar(app)).toContainText(app.t('Paused'));
    const frozen = await text(app);
    await app.page.waitForTimeout(2200);
    expect(await text(app)).toBe(frozen);
    await expect.poll(async () => (await savedSession(app))?.paused_at).not.toBeNull();
    await timerBar(app).getByRole('button', { name: app.t('Resume'), exact: true }).click();
    await expect(timerBar(app)).toContainText(app.t('Rehearsing'));

    // Second song.
    await live.getByRole('button', { name: app.t('Next song') }).click();
    await expect(live.getByRole('button', { name: app.t('Now playing: {title}', { title: FOCUS[1] }) }).first()).toBeVisible();

    // End asks first.
    await timerBar(app).getByRole('button', { name: app.t('End', { context: 'session' }), exact: true }).click();
    await timerBar(app).getByRole('button', { name: app.t('Keep going') }).click();
    await expect(timerBar(app)).toContainText(app.t('Rehearsing'));
    await timerBar(app).getByRole('button', { name: app.t('End', { context: 'session' }), exact: true }).click();
    await timerBar(app).getByRole('button', { name: app.t('End now') }).click();

    const summary = app.page.getByRole('dialog', { name: app.t('Rehearsal summary') });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(app.t('{played} of {total} songs played', { played: 2, total: 3 }));
    const played = summary.getByRole('list', { name: app.t('Songs played') });
    await expect(played).toContainText(FOCUS[0]);
    await expect(played).toContainText(FOCUS[1]);
    await expect(played).not.toContainText(FOCUS[2]);
    await app.check('rehearsal summary');

    await expect
      .poll(async () => {
        const row = await savedSession(app);
        return row && { ended: !!row.ended_at, played: (row.summary?.played ?? []).map((p: { title: string }) => p.title) };
      })
      .toEqual({ ended: true, played: [FOCUS[0], FOCUS[1]] });

    await summary.getByRole('button', { name: app.t('Done') }).click();
    await expect(summary).toHaveCount(0);
    await expect(timerBar(app)).toContainText(app.t('Ended'));

    await app.button('Exit live mode', { exact: true }).first().click();
    await app.settle();
    const card = eventDetail(app).getByRole('group', { name: app.t('Rehearsal session') });
    await expect(card).toContainText(app.t('Ended'));
    await expect(card).toContainText(app.t('{played} of {total} songs played', { played: 2, total: 3 }));
    await app.check('rehearsal page, session ended');
  });

  test('the running session survives closing Live mode and reloading the app', async ({ app }) => {
    await openWithFocusSongs(app);
    await openEvent(app, WEEKLY);
    await openLive(app);
    await liveDialog(app).getByRole('button', { name: app.t('Start rehearsal') }).click();
    await expect(timer(app)).toBeVisible();
    await expect.poll(async () => (await savedSession(app))?.started_at).toBeTruthy();
    await app.open();
    await openEvent(app, WEEKLY);
    await openLive(app);
    await expect(timerBar(app)).toContainText(app.t('Rehearsing'));
    await expect(liveDialog(app).getByRole('button', { name: app.t('Start rehearsal') })).toHaveCount(0);
  });
});

test.describe('Rehearsal session between two devices', () => {
  test.use({ role: 'admin', autoOpen: false });

  test("the admin's start, pause and end reach a member with Live mode open", async ({ app }) => {
    test.slow();
    await openWithFocusSongs(app);
    await openEvent(app, WEEKLY);
    await openLive(app);

    // A member's device in the same browser (the demo's channel is a BroadcastChannel).
    await app.page.evaluate(() => {
      const k = 'bw-demo-db-v6';
      const d = JSON.parse(localStorage.getItem(k) || '{}');
      for (const m of d.band_members || []) if (m.user_id === '10000001-0000-4000-8000-000000000001') m.role = 'member';
      localStorage.setItem(k, JSON.stringify(d));
    });
    const page = await app.page.context().newPage();
    await page.addInitScript(fakeDate, FIXED_NOW.getTime() - Date.now());
    await page.addLocatorHandler(page.getByRole('button', { name: app.t('Dismiss alert'), exact: true }), (b) => b.click());
    await page.addLocatorHandler(page.getByRole('button', { name: app.t('Close tour'), exact: true }), (b) => b.click());
    const other = {
      ...app,
      page,
      settle: () => settle(page),
      tab: async (name: string) => {
        await page.getByRole('button', { name: app.t(name), exact: true }).first().click();
        await settle(page);
      },
      button: (source: string, opts: { exact?: boolean } = {}) =>
        page.getByRole('button', { name: app.t(source), exact: opts.exact ?? false }).filter({ visible: true }),
    } as unknown as App;
    await page.goto('/');
    await expect(page.getByRole('button', { name: app.t('Home'), exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await openEvent(other, WEEKLY);
    await openLive(other);
    await expect(timerBar(other)).toHaveCount(0);

    await liveDialog(app).getByRole('button', { name: app.t('Start rehearsal') }).click();
    await expect(timerBar(other)).toContainText(app.t('Rehearsing'), { timeout: 15_000 });
    await timerBar(app).getByRole('button', { name: app.t('Pause'), exact: true }).click();
    await expect(timerBar(other)).toContainText(app.t('Paused'), { timeout: 15_000 });
    await timerBar(app).getByRole('button', { name: app.t('End', { context: 'session' }), exact: true }).click();
    await timerBar(app).getByRole('button', { name: app.t('End now') }).click();
    await expect(other.page.getByRole('dialog', { name: app.t('Rehearsal summary') })).toBeVisible({ timeout: 15_000 });
    await expect(other.page.getByRole('button', { name: app.t('Resume rehearsal') })).toHaveCount(0);
    await page.close();
  });
});
