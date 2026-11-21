import type { Locator } from '@playwright/test';
import { test, expect, type App } from '../fixtures';
import { openEvent, SEED } from '../support/flows';
import { openWithFocusSongs, WEEKLY } from '../support/live';

/**
 * The Score view (sheet music plan, docs/plans/sheet-music.md §4): a song's
 * MusicXML drawn note by note by OpenSheetMusicDisplay, next to Lyrics /
 * Lyrics & chords / Chord chart, in Stage / Live mode and the Duo floor
 * wedge. The demo's made-up scores: Paper Boats (16 bars, C, lyrics under
 * the notes), Harbor Lights (8 bars, G) and Night Ferry (32 bars, F, a
 * score and nothing else).
 */

const isLaptop = () => test.info().project.name === 'duo-laptop';

const liveDialog = (app: App, kind: 'gig' | 'rehearsal', title: string) =>
  app.page.getByRole('dialog', { name: app.t(kind === 'gig' ? 'Stage mode: {title}' : 'Live mode: {title}', { title }) });

/** The score on screen (in Laptop pose the floor wedge's, over Stage mode). */
const score = (app: App) => app.page.locator('[data-score]').filter({ visible: true }).last();

/** The vertical fold of a two-pane Duo (Book), if any. */
const verticalFold = () => {
  const duo = (test.info().project.use as { duo?: { regions?: { division?: { x: number; w: number; h: number } | null } } | null }).duo;
  const d = duo?.regions?.division;
  return d && d.h > d.w ? { left: d.x, right: d.x + d.w } : null;
};

/** Nothing on the vertical fold (Book), nothing in the Laptop fold band. */
async function expectOffFolds(el: Locator, what: string) {
  // What is on screen of it: its box cut by every ancestor that clips (the reader scrolls a long score).
  const b = await el.evaluate((node) => {
    let r = node.getBoundingClientRect();
    let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
    for (let p = node.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY)) {
        r = p.getBoundingClientRect();
        x0 = Math.max(x0, r.left); y0 = Math.max(y0, r.top); x1 = Math.min(x1, r.right); y1 = Math.min(y1, r.bottom);
      }
    }
    return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  });
  expect(b.height, `${what} is on screen`).toBeGreaterThan(0);
  const v = verticalFold();
  if (v) expect(b.x + b.width <= v.left + 1 || b.x >= v.right - 1, `${what} stays off the fold`).toBe(true);
  const band = (test.info().project.use as { duo?: { foldBand?: { top: number; bottom: number } } | null }).duo?.foldBand;
  if (band) expect(b.y + b.height <= band.top || b.y >= band.bottom, `${what} sits off the fold`).toBe(true);
}

async function openSongView(app: App, kind: 'gig' | 'rehearsal', title: string) {
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

/** The chord names OSMD drew, in order. */
const drawnChords = (s: Locator) =>
  s.locator('svg text').evaluateAll((ts) => ts.map((t) => t.textContent || '').filter((x) => /^[A-G][♭♯]?(maj|m|7|6|sus|dim|\(|\/|$)/.test(x)));

async function expectScore(app: App, song: string, bars: number, key: string) {
  const s = score(app);
  await expect(s).toHaveAttribute('data-score-state', 'ready', { timeout: 20_000 });
  await expect(s).toHaveAttribute('data-score-bars', String(bars));
  await expect(s).toHaveAttribute('data-score-key', key);
  // Every bar of the part is drawn, as one picture with a text alternative.
  await expect(s.locator('svg g.vf-measure')).toHaveCount(bars);
  const img = s.getByRole('img', { name: app.t('Score: {title}', { title: song }) });
  await expect(img).toBeVisible();
  await expect(img).toHaveAccessibleDescription(new RegExp(`${bars} bars`));
  // It fits the width it has: no sideways scrolling on any screen.
  const fits = await s.evaluate((el) => {
    const svg = el.querySelector('svg')!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return svg.right <= box.right + 1 && svg.left >= box.left - 1;
  });
  expect(fits, 'the score fits its column').toBe(true);
}

test.describe('Score view', () => {
  test.use({ autoOpen: false });

  test('@smoke rehearsal Live mode: the score draws every bar, transposes with the chords control (+2: C → D), and stays off the Duo fold', async ({ app }) => {
    test.slow();
    await openWithFocusSongs(app);
    await app.page.evaluate(() => localStorage.setItem('bw-song-view', 'score'));
    await openEvent(app, WEEKLY);
    await openSongView(app, 'rehearsal', WEEKLY);

    await expectScore(app, 'Paper Boats', 16, 'C');
    const s = score(app);
    await s.scrollIntoViewIfNeeded();
    const before = await drawnChords(s);
    expect(before.slice(0, 4)).toEqual(['C', 'G', 'Am', 'F']);
    await expectOffFolds(s.locator('svg'), 'the score');
    await app.check('score, Live mode');

    // + + : the same control and semitones as the chords.
    // In Laptop pose Stage mode stays under the floor wedge: its controls are the bottom half's.
    const controls = isLaptop() ? app.page.getByRole('region', { name: app.t('Song controls') }) : app.page;
    const up = controls.getByRole('button', { name: app.t('Transpose up a semitone') }).filter({ visible: true }).first();
    await up.click();
    await up.click();
    await expect(s).toHaveAttribute('data-score-key', 'D');
    await expect.poll(() => drawnChords(s).then((c) => c.slice(0, 4))).toEqual(['D', 'A', 'Bm', 'G']);
    await expect(s.getByRole('img', { name: app.t('Score: {title}', { title: 'Paper Boats' }) })).toHaveAccessibleDescription(/key of D\./);
    await expect(s.locator('svg g.vf-measure')).toHaveCount(16);
    await expectOffFolds(s.locator('svg'), 'the transposed score');

    // Back to the original key with one tap on the key.
    await controls.getByRole('button', { name: app.t('Back to the original key') }).filter({ visible: true }).first().click();
    await expect(s).toHaveAttribute('data-score-key', 'C');
  });

  test('gig Stage mode: a song with only a score opens on it, also in Full screen', async ({ app }) => {
    test.skip(isLaptop(), 'the Laptop pose draws the song on the floor wedge: covered by the @smoke test');
    test.slow();
    await app.open();
    await app.page.evaluate(() => localStorage.setItem('bw-song-view', 'lyrics'));
    await openEvent(app, SEED.gigToday);
    await app.button('Open stage mode', { exact: true }).first().click();
    const live = liveDialog(app, 'gig', SEED.gigToday);
    await expect(live).toBeAttached();
    await app.settle();
    await live.getByRole('button', { name: app.t('Go to {title}', { title: 'Night Ferry' }) }).click();
    await live.getByRole('tablist', { name: app.t('Setlist') }).getByRole('tab').nth(1).click();
    await app.settle();
    // The reader picked Lyrics; Night Ferry has only its score, so the score it is.
    await expectScore(app, 'Night Ferry', 32, 'F');

    await app.button('Full screen', { exact: true }).first().click();
    await app.settle();
    const only = app.page.getByRole('dialog', { name: app.t('Song only: {title}', { title: 'Night Ferry' }) });
    await expect(only).toBeVisible();
    await expect(only.locator('[data-score]')).toHaveAttribute('data-score-state', 'ready', { timeout: 20_000 });
    await expect(only.locator('svg g.vf-measure')).toHaveCount(32);
    await app.check('score, Stage full screen');
  });
});
