import type { BrowserContext, Locator } from '@playwright/test';
import { test, expect, type App } from '../fixtures';
import { openEvent, eventDetail, SEED } from '../support/flows';
import { openWith } from '../support/rehearsal';

/**
 * Stage mode on the iPhone Duo in Laptop pose, with the device's real
 * status-bar inset. The duo-laptop profile has no safe area (a browser has
 * none), so the offline bar there is 42pt tall. On the device (simulator,
 * iOS 27.2: env(safe-area-inset-top) 82pt, the clock block; bottom 34pt) the
 * bar pads by that inset and ends at 124pt: the floor wedge's first rows
 * ("Rooftop Session", the timer, "1 / 10") sat under it. These tests give the
 * page the device's insets through the variables the app reads first
 * (--safe-area-inset-*, theme.css), as Capacitor does on Android.
 *
 * And the count-in: its ring and number were centred on the whole screen,
 * across the fold. In Laptop pose the countdown is whole on the Display and
 * Stop is on the Deck.
 */

/** What the iPhone Duo simulator reports in Laptop pose (11-24). */
const DEVICE_INSETS = { top: 82, bottom: 34 };

const stageDialog = (app: App) => app.page.getByRole('dialog', { name: app.t('Stage mode: {title}', { title: SEED.gigToday }) });
const bar = (app: App, text: string) => app.page.getByRole('status').filter({ hasText: text });

async function deviceInsets(app: App) {
  await app.page.evaluate((i) => {
    const root = document.documentElement;
    root.style.setProperty('--safe-area-inset-top', `${i.top}px`);
    root.style.setProperty('--safe-area-inset-bottom', `${i.bottom}px`);
  }, DEVICE_INSETS);
  await app.settle();
}

/**
 * The bar is what is on screen in its strip (nothing covers it), and no text
 * of the screen below sits under it (as stage-offline-bar.spec.ts).
 */
async function expectBarAbove(app: App, text: string, where: string) {
  const el = bar(app, text).first();
  await expect(el, `${where}: the bar says "${text}"`).toBeVisible();
  await app.settle();
  const seen = await el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const y = r.top + r.height - Math.min(16, r.height / 2);
    const covered = [0.1, 0.3, 0.5, 0.7]
      .map((f) => document.elementFromPoint(r.left + r.width * f, y))
      .filter((top) => !node.contains(top))
      .map((top) => (top ? `${top.tagName.toLowerCase()}.${String((top as HTMLElement).className).slice(0, 50)}` : 'nothing'));
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
        if (right - left < 2 || bottom - top < 4) continue;
        const below = document.elementsFromPoint((left + right) / 2, (top + bottom) / 2).filter((e) => !node.contains(e))[0];
        if (below && (below === parent || parent.contains(below))) {
          under.push(words.slice(0, 40));
          break;
        }
      }
    }
    return { covered, under, bottom: r.bottom };
  });
  expect(seen.covered, `${where}: nothing covers the offline bar`).toEqual([]);
  expect(seen.under, `${where}: nothing of the screen sits under the offline bar`).toEqual([]);
  return seen.bottom;
}

async function openStage(app: App, context: BrowserContext, opts: { offline: boolean }) {
  await openWith(app, (db) => {
    const song = db.songs.find((s) => s.title === 'Superstition')!;
    song.lyrics = '[Verse]\n[Ebm]Very superstitious, [Ab7]writing on the wall';
    // Slow, so the countdown stays up long enough to be measured.
    song.bpm = 40;
  });
  await openEvent(app, SEED.gigToday);
  await expect(
    eventDetail(app).getByText(app.t('Offline ready · updated {time}', { time: '§' }).split('§')[0], { exact: false }).first(),
  ).toBeAttached();
  await deviceInsets(app);
  if (opts.offline) await context.setOffline(true);
  await app.button('Open stage mode', { exact: true }).first().click();
  await app.settle();
  await expect(stageDialog(app)).toBeAttached();
  await app.settle();
}

const box = async (el: Locator) => (await el.boundingBox())!;

test.describe('Stage mode in Laptop pose with the device’s status-bar inset', () => {
  test.use({ autoOpen: false });

  test('@laptop no signal: the floor wedge starts below the offline bar’s real bottom (the song, a song’s words, Song only)', async ({ app, context }) => {
    test.slow();
    await openStage(app, context, { offline: true });
    const cached = app.t('You’re offline · showing cached info');
    const display = app.page.getByRole('region', { name: app.t('Now playing') });

    const bottom = await expectBarAbove(app, cached, 'the wedge');
    // The bar pads by the inset: taller than the profile's own 42pt.
    expect(bottom).toBeGreaterThan(DEVICE_INSETS.top + 30);
    const firstRow = await box(display.getByText(SEED.gigToday, { exact: false }).first());
    expect(firstRow.y, 'the gig’s name is below the bar').toBeGreaterThanOrEqual(bottom);
    const counter = await box(display.getByText(/^1\s*\/\s*10$/).first());
    expect(counter.y, 'the song counter is below the bar').toBeGreaterThanOrEqual(bottom);
    await app.check('laptop wedge offline, device inset');

    await app.page.getByRole('region', { name: app.t('Song controls') }).getByRole('button', { name: app.t('Lyrics'), exact: true }).click();
    await app.settle();
    await expectBarAbove(app, cached, 'the wedge, a song’s words');

    await app.button('Full screen', { exact: true }).first().click();
    await app.settle();
    await expectBarAbove(app, cached, 'the wedge, Song only');
    await app.check('laptop wedge offline, Song only, device inset');
    await context.setOffline(false);
  });

  test('@laptop with signal the wedge keeps its top: the first row starts at the clock block’s top, not below it', async ({ app, context }) => {
    await openStage(app, context, { offline: false });
    const display = app.page.getByRole('region', { name: app.t('Now playing') });
    const firstRow = await box(display.getByText(SEED.gigToday, { exact: false }).first());
    expect(firstRow.y).toBeLessThan(DEVICE_INSETS.top / 2);
  });

  test('@laptop the count-in sits whole on the Display, Stop on the Deck above the rail, nothing on the fold', async ({ app, context, duo }) => {
    test.slow();
    const fold = duo!.foldBand!;
    const clock = duo!.regions.status!;
    await openStage(app, context, { offline: false });
    await app.page.getByRole('region', { name: app.t('Song controls') }).getByRole('button', { name: app.t('Count in the band'), exact: true }).click();
    const countdown = app.page.getByRole('dialog', { name: app.t('Count-in · {title}', { title: 'Superstition' }) });
    await expect(countdown).toBeVisible();
    const number = countdown.getByTestId('countin-number');
    await expect(number).toHaveText(/^\d$/, { timeout: 8_000 });

    const ring = await box(countdown.locator('svg').first());
    const num = await box(number);
    const title = await box(countdown.getByText('Superstition', { exact: true }));
    const stopButton = countdown.getByRole('button', { name: app.t('Stop the count-in'), exact: true });
    const stop = await box(stopButton);
    const rail = await box(app.page.locator('.bw-duo-rail').filter({ visible: true }).first());

    // The Display: the song's name, the ring and the number, whole, above the fold.
    expect(ring.y + ring.height, 'the ring ends above the fold').toBeLessThanOrEqual(fold.top);
    expect(num.y + num.height, 'the number ends above the fold').toBeLessThanOrEqual(fold.top);
    expect(ring.y, 'the ring is on screen').toBeGreaterThanOrEqual(0);
    expect(title.y, 'the song’s name is on screen').toBeGreaterThanOrEqual(0);
    expect(title.y + title.height, 'the song’s name is above the ring’s middle').toBeLessThan(ring.y + ring.height / 2);
    // Big enough to read from the floor: most of the Display's height.
    expect(ring.height).toBeGreaterThan(fold.top * 0.6);
    // Clear of the clock block in the Display's corner.
    expect(title.x + title.width, 'the song’s name is clear of the clock').toBeLessThanOrEqual(clock.x);
    expect(ring.x + ring.width, 'the ring is clear of the clock').toBeLessThanOrEqual(clock.x);

    // The Deck: Stop, below the fold and above the rail, a real tap.
    expect(stop.y, 'Stop is below the fold').toBeGreaterThanOrEqual(fold.bottom);
    expect(stop.y + stop.height, 'Stop is above the rail').toBeLessThanOrEqual(rail.y);
    expect(stop.height).toBeGreaterThanOrEqual(44);
    const onTop = await stopButton.evaluate((b) => {
      const r = b.getBoundingClientRect();
      return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    expect(onTop, 'nothing covers Stop').toBe(true);
    await stopButton.click();
    await expect(countdown).toHaveCount(0);
    await app.check('laptop count-in stopped');
  });

  test('@laptop no signal: the count-in starts below the offline bar and still ends above the fold', async ({ app, context, duo }) => {
    test.slow();
    const fold = duo!.foldBand!;
    await openStage(app, context, { offline: true });
    const cached = app.t('You’re offline · showing cached info');
    await app.page.getByRole('region', { name: app.t('Song controls') }).getByRole('button', { name: app.t('Count in the band'), exact: true }).click();
    const countdown = app.page.getByRole('dialog', { name: app.t('Count-in · {title}', { title: 'Superstition' }) });
    await expect(countdown.getByTestId('countin-number')).toHaveText(/^\d$/, { timeout: 8_000 });
    const strip = await box(bar(app, cached).first());
    const ring = await box(countdown.locator('svg').first());
    const title = await box(countdown.getByText('Superstition', { exact: true }));
    expect(title.y, 'the song’s name is below the bar').toBeGreaterThanOrEqual(strip.y + strip.height);
    expect(ring.y, 'the ring is below the bar').toBeGreaterThanOrEqual(strip.y + strip.height);
    expect(ring.y + ring.height, 'the ring ends above the fold').toBeLessThanOrEqual(fold.top);
    await countdown.getByRole('button', { name: app.t('Stop the count-in'), exact: true }).click();
    await expect(countdown).toHaveCount(0);
    await context.setOffline(false);
  });
});
