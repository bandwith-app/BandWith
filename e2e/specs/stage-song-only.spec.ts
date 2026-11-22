import type { Locator } from '@playwright/test';
import { test, expect, type App } from '../fixtures';
import { openEvent, systemBack, SEED } from '../support/flows';
import { openWith } from '../support/rehearsal';
import { openWithFocusSongs, WEEKLY } from '../support/live';

/**
 * "Song only" in gig Stage mode and rehearsal Live mode: the song (lyrics,
 * lyrics & chords, or the chord chart) clean and full screen, with no other
 * information, and only Show everything, Prev, the click and Next at the
 * bottom. Asked by the band (11-20): reading on stage without the run of
 * show, the tabs and the status lines in the way. One way in (11-20, the
 * band's follow-up): the header's Full screen, from the setlist or the song.
 */

const isLaptop = () => test.info().project.name === 'duo-laptop';

const liveDialog = (app: App, kind: 'gig' | 'rehearsal', title: string) =>
  app.page.getByRole('dialog', { name: app.t(kind === 'gig' ? 'Stage mode: {title}' : 'Live mode: {title}', { title }) });

const songOnly = (app: App, song: string) => app.page.getByRole('dialog', { name: app.t('Song only: {title}', { title: song }) });

const isFull = (app: App) => app.page.evaluate(() => document.documentElement.hasAttribute('data-bw-stage-full'));

/** The vertical fold of a two-pane Duo (Book), if any. */
const verticalFold = () => {
  const duo = (test.info().project.use as { duo?: { regions?: { division?: { x: number; w: number; h: number } | null } } | null }).duo;
  const d = duo?.regions?.division;
  return d && d.h > d.w ? { left: d.x, right: d.x + d.w } : null;
};

/** Nothing on the vertical fold (Book), nothing in the Laptop fold band. */
async function expectOffFolds(el: Locator, what: string) {
  const b = (await el.boundingBox())!;
  const v = verticalFold();
  if (v) expect(b.x + b.width <= v.left + 1 || b.x >= v.right - 1, `${what} stays off the fold`).toBe(true);
  const band = (test.info().project.use as { duo?: { foldBand?: { top: number; bottom: number } } | null }).duo?.foldBand;
  if (band) expect(b.y + b.height <= band.top || b.y >= band.bottom, `${what} sits off the fold`).toBe(true);
}

async function openLiveSong(app: App, kind: 'gig' | 'rehearsal', title: string) {
  await app.button(kind === 'gig' ? 'Open stage mode' : 'Open live mode', { exact: true }).first().click();
  await expect(liveDialog(app, kind, title)).toBeAttached();
  await app.settle();
  if (isLaptop()) {
    await app.page.getByRole('region', { name: app.t('Song controls') }).getByRole('button', { name: app.t('Lyrics'), exact: true }).click();
  } else {
    await liveDialog(app, kind, title).getByRole('tablist', { name: app.t('Setlist') }).getByRole('tab').nth(1).click();
  }
  await app.settle();
}

/** The clean view is up: the song and the four controls at the bottom, nothing else. */
async function expectSongOnly(app: App, song: string, text: RegExp) {
  await expect.poll(() => isFull(app)).toBe(true);
  await expect(app.page.locator('.bw-duo-rail').filter({ visible: true })).toHaveCount(0);
  await expect(app.page.locator('.bw-nav-bar').filter({ visible: true })).toHaveCount(0);
  const vp = app.page.viewportSize()!;
  if (isLaptop()) {
    // Laptop pose: the song on the Display, the pads on the Deck (the leader's Count in by the click).
    const display = app.page.getByRole('region', { name: app.t('Now playing') });
    const deck = app.page.getByRole('region', { name: app.t('Song controls') });
    await expect(display).toContainText(text);
    await expect(display.getByRole('heading', { name: song })).toHaveCount(0);
    // One small line names the song, as on every other device.
    await expect(display.getByText(song, { exact: true }).filter({ visible: true })).toHaveCount(1);
    await expect(deck.getByRole('tablist')).toHaveCount(0);
    const names = await deck.getByRole('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim()));
    expect(names.map((n) => (n?.startsWith(app.t('Start the click')) ? 'click' : n))).toEqual([
      app.t('Show everything'), app.t('Previous song'), 'click', ...(app.role === 'admin' ? [app.t('Count in the band')] : []), app.t('Next song'),
    ]);
    return;
  }
  const view = songOnly(app, song);
  await expect(view).toBeVisible();
  await expect(view).toContainText(text);
  // The whole window, on top of everything (both panes on two-pane layouts).
  const box = (await view.boundingBox())!;
  expect(box.x).toBeLessThanOrEqual(1);
  expect(box.y).toBeLessThanOrEqual(1);
  expect(box.width).toBeGreaterThanOrEqual(vp.width - 1);
  expect(box.height).toBeGreaterThanOrEqual(vp.height - 1);
  const onTop = await view.evaluate((el) =>
    [[0.5, 0.3], [0.2, 0.6], [0.8, 0.9]].every(([x, y]) => el.contains(document.elementFromPoint(innerWidth * x, innerHeight * y))),
  );
  expect(onTop, 'nothing of the live screen shows through').toBe(true);
  // No title heading, no tabs, no status: the song, one small line naming it, and
  // the controls, the leader's Count in by the click. (The song's own section names, Verse / Chorus, are part of the song.)
  await expect(view.getByRole('heading', { name: song })).toHaveCount(0);
  await expect(view.getByRole('tablist')).toHaveCount(0);
  await expect(view.getByText(song, { exact: true }).filter({ visible: true })).toHaveCount(1);
  const buttons = view.getByRole('button');
  const names = await buttons.evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
  expect(names.map((n) => (n?.startsWith(app.t('Start the click')) ? 'click' : n))).toEqual([
    app.t('Show everything'), app.t('Previous song'), 'click', ...(app.role === 'admin' ? [app.t('Count in the band')] : []), app.t('Next song'),
  ]);
  for (let i = 0; i < names.length; i++) {
    const b = buttons.nth(i);
    await expect(b).toBeInViewport({ ratio: 1 });
    const bb = (await b.boundingBox())!;
    expect(bb.y + bb.height, 'the controls are at the bottom').toBeGreaterThan(vp.height * 0.7);
    expect(bb.height).toBeGreaterThanOrEqual(44);
    await expectOffFolds(b, names[i] ?? 'control');
  }
  await expectOffFolds(view.locator('[data-song-only-body]'), 'the song');
}

/** The one way in: the header's Full screen (in Laptop pose the rail's). */
const fullScreen = (app: App) => app.button('Full screen', { exact: true }).first();

const songControls = (app: App, song: string) =>
  isLaptop() ? app.page.getByRole('region', { name: app.t('Song controls') }) : songOnly(app, song);

for (const kind of ['gig', 'rehearsal'] as const) {
  test.describe(`Song only in ${kind === 'gig' ? 'gig Stage mode' : 'rehearsal Live mode'}`, () => {
    test.use({ autoOpen: false });

    test(`@smoke ${kind}: Song only shows just the song, Prev / Next move through the setlist, the click toggles; Show everything and system Back return`, async ({ app }) => {
      test.slow();
      const title = kind === 'gig' ? SEED.gigToday : WEEKLY;
      // Two songs with words in each setlist.
      const [first, second] = kind === 'gig' ? ['Superstition', 'September'] : ['Paper Boats', 'Harbor Lights'];
      const [firstText, secondText] = kind === 'gig' ? [/Very superstitious/i, /Do you remember/i] : [/Paper boats on the/i, /Harbor lights/i];
      if (kind === 'gig') {
        await openWith(app, (db) => {
          const song = (t: string) => db.songs.find((s) => s.title === t)!;
          song('Superstition').lyrics = '[Verse]\n[Ebm]Very superstitious, [Ab7]writing on the wall';
          song('September').lyrics = '[Verse]\n[Ab]Do you remember the [Gm]twenty-first night';
        });
      } else {
        await openWithFocusSongs(app);
      }
      await app.page.evaluate(() => localStorage.setItem('bw-song-view', 'chords'));
      await openEvent(app, title);
      await openLiveSong(app, kind, title);

      await fullScreen(app).click();
      await app.settle();
      await expectSongOnly(app, first, firstText);
      await expect(app.button('Song only', { exact: true }).filter({ visible: true })).toHaveCount(0);
      await app.check(`${kind} live, song only`);

      // Next / Prev move through the setlist.
      await songControls(app, first).getByRole('button', { name: app.t('Next song'), exact: true }).click();
      await app.settle();
      await expectSongOnly(app, second, secondText);
      await songControls(app, second).getByRole('button', { name: app.t('Previous song'), exact: true }).click();
      await app.settle();
      await expectSongOnly(app, first, firstText);

      // The click: on, then off (the synced click of the current song).
      const click = songControls(app, first).getByRole('button', { name: new RegExp(`^${app.t('Start the click')}`) });
      await click.click();
      const stop = songControls(app, first).getByRole('button', { name: new RegExp(`^${app.t('Stop the click')}`) });
      await expect(stop).toHaveAttribute('aria-pressed', 'true');
      await stop.click();
      await expect(songControls(app, first).getByRole('button', { name: new RegExp(`^${app.t('Start the click')}`) })).toHaveAttribute('aria-pressed', 'false');

      // Show everything: back to the full live screen, still on the song.
      await songControls(app, first).getByRole('button', { name: app.t('Show everything'), exact: true }).click();
      await app.settle();
      await expect(songOnly(app, first)).toHaveCount(0);
      await expect.poll(() => isFull(app)).toBe(false);
      await expect(fullScreen(app)).toBeVisible();

      // System Back leaves Song only first, not the live screen.
      await fullScreen(app).click();
      await app.settle();
      await expectSongOnly(app, first, firstText);
      await systemBack(app);
      await app.settle();
      await expect(songOnly(app, first)).toHaveCount(0);
      await expect(liveDialog(app, kind, title)).toBeAttached();
      await expect(fullScreen(app)).toBeVisible();
      await app.check(`${kind} live, after song only`);
    });

    test(`${kind}: Full screen from the setlist is the song alone (no times, no Stage Manager); Show everything goes back to the setlist`, async ({ app }) => {
      test.skip(isLaptop(), 'the Laptop pose shows the song on the Display and the pads on the Deck: covered above');
      const title = kind === 'gig' ? SEED.gigToday : WEEKLY;
      const [first, firstText] = kind === 'gig' ? ['Superstition', /Very superstitious/i] : ['Paper Boats', /Paper boats on the/i];
      if (kind === 'gig') {
        await openWith(app, (db) => {
          db.songs.find((s) => s.title === 'Superstition')!.lyrics = '[Verse]\n[Ebm]Very superstitious, [Ab7]writing on the wall';
        });
      } else {
        await openWithFocusSongs(app);
      }
      await openEvent(app, title);
      await app.button(kind === 'gig' ? 'Open stage mode' : 'Open live mode', { exact: true }).first().click();
      await expect(liveDialog(app, kind, title)).toBeAttached();
      await app.settle();
      const tabs = liveDialog(app, kind, title).getByRole('tablist', { name: app.t('Setlist') }).getByRole('tab');
      await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');

      await fullScreen(app).click();
      await app.settle();
      await expectSongOnly(app, first, firstText);
      const view = songOnly(app, first);
      if (kind === 'gig') {
        await expect(view).not.toContainText(title);
        await expect(view).not.toContainText(/\b17:00\b|\b21:00\b/);
        await expect(view).not.toContainText(new RegExp(app.t('Stage manager'), 'i'));
      }
      await app.check(`${kind} live, full screen from the setlist`);

      await view.getByRole('button', { name: app.t('Show everything'), exact: true }).click();
      await app.settle();
      await expect(songOnly(app, first)).toHaveCount(0);
      await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    });
  });
}

test.describe('Song view names', () => {
  test.use({ autoOpen: false });

  test('@smoke the reader says Lyrics, Lyrics & chords and Chord chart', async ({ app }) => {
    test.skip(isLaptop(), 'the floor wedge shows the same tabs; covered in the unit tests');
    await openWithFocusSongs(app);
    await openEvent(app, WEEKLY);
    await openLiveSong(app, 'rehearsal', WEEKLY);
    // Harbor Lights has lyrics with chords and an iReal chart: all three views.
    await liveDialog(app, 'rehearsal', WEEKLY).getByRole('button', { name: app.t('Next song') }).click();
    const tabs = app.page.getByRole('tablist', { name: app.t('Song view') }).filter({ visible: true }).first();
    await expect(tabs.getByRole('tab')).toHaveText([app.t('Lyrics'), app.t('Lyrics & chords'), app.t('Chord chart')]);
    await tabs.getByRole('tab', { name: app.t('Chord chart'), exact: true }).click();
    await expect(app.page.locator('[data-chart-grid]').filter({ visible: true }).first()).toBeVisible();
  });
});
