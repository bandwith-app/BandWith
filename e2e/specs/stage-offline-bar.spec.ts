import type { BrowserContext } from '@playwright/test';
import { test, expect, type App } from '../fixtures';
import { openEvent, eventDetail, SEED } from '../support/flows';
import { openWith } from '../support/rehearsal';

/**
 * The offline bar in Stage mode. With no signal the app's bar ("You’re
 * offline · …") stays on screen above Stage mode and every Stage layer (the
 * setlist, a song, Song only, the floor wedge in Laptop pose), which all
 * start below it: no empty band where the bar should be, nothing of the
 * screen under it. And the bar counts every change waiting on this phone,
 * the notes written in Stage included (the Stage header's own tag counted
 * them, the bar said "showing cached info").
 */

const isLaptop = () => test.info().project.name === 'duo-laptop';
const stageDialog = (app: App) => app.page.getByRole('dialog', { name: app.t('Stage mode: {title}', { title: SEED.gigToday }) });
/** The app's bar, by the words it shows. */
const bar = (app: App, text: string) => app.page.getByRole('status').filter({ hasText: text });

const waitingText = (app: App, n: number) =>
  app.t('You’re offline · {changes} waiting for signal', {
    changes: n === 1 ? app.t('{count} change', { count: n }) : app.t('{count} changes', { count: n }),
  });

/**
 * The bar is what is on screen in its strip (nothing covers it), and no text
 * of the screen below sits under it.
 */
async function expectBarAbove(app: App, text: string, where: string) {
  const el = bar(app, text).first();
  await expect(el, `${where}: the bar says "${text}"`).toBeVisible();
  await app.settle();
  const seen = await el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const y = r.top + r.height - Math.min(16, r.height / 2);
    const covered = [0.1, 0.3, 0.5, 0.7, 0.9]
      .map((f) => document.elementFromPoint(r.left + r.width * f, y))
      .filter((top) => !node.contains(top))
      .map((top) => (top ? `${top.tagName.toLowerCase()}.${String((top as HTMLElement).className).slice(0, 50)}` : 'nothing'));
    // Text of the screen that would show in the strip without the bar.
    const under: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const words = (n.textContent || '').trim();
      const parent = n.parentElement;
      if (!words || !parent || node.contains(parent)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const b of Array.from(range.getClientRects())) {
        const left = Math.max(b.left, r.left);
        const right = Math.min(b.right, r.right);
        const top = Math.max(b.top, r.top);
        const bottom = Math.min(b.bottom, r.bottom);
        // A real overlap, not a line box brushing the strip's edge.
        if (right - left < 2 || bottom - top < 4) continue;
        const below = document.elementsFromPoint((left + right) / 2, (top + bottom) / 2).filter((e) => !node.contains(e))[0];
        if (below && (below === parent || parent.contains(below))) {
          under.push(words.slice(0, 40));
          break;
        }
      }
    }
    return { covered, under, height: r.height };
  });
  expect(seen.height, `${where}: the bar has a height`).toBeGreaterThan(20);
  expect(seen.covered, `${where}: nothing covers the offline bar`).toEqual([]);
  expect(seen.under, `${where}: nothing of the screen sits under the offline bar`).toEqual([]);
}

/** Open the gig once with signal (its setlist stays on the phone), then lose it and open Stage. */
async function stageWithoutSignal(app: App, context: BrowserContext) {
  await openWith(app, (db) => {
    db.songs.find((s) => s.title === 'Superstition')!.lyrics = '[Verse]\n[Ebm]Very superstitious, [Ab7]writing on the wall';
  });
  await openEvent(app, SEED.gigToday);
  await expect(
    eventDetail(app).getByText(app.t('Offline ready · updated {time}', { time: '§' }).split('§')[0], { exact: false }).first(),
  ).toBeAttached();
  await context.setOffline(true);
  await app.button('Open stage mode', { exact: true }).first().click();
  await app.settle();
  await expect(stageDialog(app)).toBeAttached();
  await app.settle();
}

/** The first song (Superstition), with its lyrics. */
async function openFirstSong(app: App) {
  if (isLaptop()) {
    await app.page.getByRole('region', { name: app.t('Song controls') }).getByRole('button', { name: app.t('Lyrics'), exact: true }).click();
  } else {
    await stageDialog(app).getByRole('tablist', { name: app.t('Setlist') }).getByRole('tab').nth(1).click();
  }
  await app.settle();
}

test.describe('No signal in Stage mode: the offline bar', () => {
  test.use({ autoOpen: false });

  test('@smoke the bar stays on screen above Stage mode, which starts below it: the setlist, a song, Song only', async ({ app, context }) => {
    test.slow();
    await stageWithoutSignal(app, context);
    const cached = app.t('You’re offline · showing cached info');

    await expectBarAbove(app, cached, 'Stage mode, the setlist');
    if (!isLaptop()) {
      // The bar and Stage mode start at the same edge (one pane, or the whole window).
      const strip = (await bar(app, cached).first().boundingBox())!;
      const stage = (await stageDialog(app).boundingBox())!;
      expect(Math.abs(strip.x - stage.x), 'the bar starts where Stage mode starts').toBeLessThanOrEqual(1);
    }
    await app.check('stage offline, the bar above the setlist');

    await openFirstSong(app);
    await expectBarAbove(app, cached, 'Stage mode, a song');

    // Full screen is the song alone (Song only), over both panes where there are two.
    await app.button('Full screen', { exact: true }).first().click();
    await app.settle();
    await expect.poll(() => app.page.evaluate(() => document.documentElement.hasAttribute('data-bw-stage-full'))).toBe(true);
    await expectBarAbove(app, cached, 'Song only');
    if (!isLaptop()) {
      const strip = (await bar(app, cached).first().boundingBox())!;
      expect(strip.x, 'full screen: the bar starts at the window edge, as Stage does').toBeLessThanOrEqual(1);
    }
    await app.check('stage offline, the bar above Song only');
    await context.setOffline(false);
  });

  test.describe('as member', () => {
    test.use({ role: 'member' });

    test('@smoke notes written in Stage with no signal are counted by the bar, one then two; back online it lets go of them', async ({ app, context }) => {
      test.skip(isLaptop(), 'Stage controls live on the other screen in laptop posture');
      test.slow();
      await stageWithoutSignal(app, context);
      await openFirstSong(app);
      await expectBarAbove(app, app.t('You’re offline · showing cached info'), 'before any change');

      const writeNote = async (body: string) => {
        await stageDialog(app).getByRole('button', { name: app.t('Add note') }).first().click();
        // First time only: what My notes are, then on to the note.
        const gotIt = app.page.getByRole('button', { name: app.t('Got it'), exact: true });
        if (await gotIt.isVisible({ timeout: 1500 }).catch(() => false)) await gotIt.click();
        await app.page.getByRole('button', { name: app.t('Whole song'), exact: true }).click();
        const sheet = app.page.getByRole('dialog', { name: 'Superstition', exact: true }).filter({ hasText: app.t('Save note') }).last();
        await sheet.getByRole('textbox').first().fill(body);
        await sheet.getByRole('button', { name: app.t('Save note'), exact: true }).click();
        await expect(stageDialog(app).getByText(body).first()).toBeAttached();
        await app.settle();
      };

      await writeNote('Capo 2 on the last chorus');
      await expectBarAbove(app, waitingText(app, 1), 'one note waiting');
      await writeNote('Watch the drummer for the stop');
      await expectBarAbove(app, waitingText(app, 2), 'two notes waiting');
      await expect(bar(app, app.t('You’re offline · showing cached info'))).toHaveCount(0);
      await app.check('stage offline, the bar counts the notes');

      // The signal is back: the notes go out by themselves and the bar leaves.
      await context.setOffline(false);
      const sent = async () =>
        (((await app.readDb()).song_personal_notes as Array<{ body: string }> | undefined) ?? []).filter(
          (n) => n.body === 'Capo 2 on the last chorus' || n.body === 'Watch the drummer for the stop',
        ).length;
      await expect.poll(sent, { timeout: 15_000 }).toBe(2);
      await expect(app.page.getByRole('status').filter({ hasText: app.t('You’re offline · showing cached info').split('·')[0].trim() })).toHaveCount(0, { timeout: 15_000 });
    });
  });
});
