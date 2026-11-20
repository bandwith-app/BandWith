import { test, expect, type App } from '../fixtures';
import { openEvent, systemBack, SEED } from '../support/flows';
import { openWith } from '../support/rehearsal';

/**
 * Real full screen for gig Stage mode and rehearsal Live mode
 * (src/lib/stageChrome.ts), asked by the band after rehearsals: one tap hides
 * the app's chrome (Duo rail, list pane, nav) and the system bars, the
 * setlist, chords and notes keep working, and Exit full screen or system
 * Back leaves it. Every chart draws its markers as named symbols
 * (src/lib/musicSymbols.ts), never raw "%", "{" or "N1".
 */

const isLaptop = () => test.info().project.name === 'duo-laptop';

const liveDialog = (app: App, kind: 'gig' | 'rehearsal', title: string) =>
  app.page.getByRole('dialog', { name: app.t(kind === 'gig' ? 'Stage mode: {title}' : 'Live mode: {title}', { title }) });

async function openLive(app: App, kind: 'gig' | 'rehearsal', title: string) {
  await app.button(kind === 'gig' ? 'Open stage mode' : 'Open live mode', { exact: true }).first().click();
  await expect(liveDialog(app, kind, title)).toBeAttached();
  await app.settle();
}

/** In Laptop pose the floor wedge's Deck covers Stage mode: its own buttons are the last ones. */
const pick = (l: import('@playwright/test').Locator) => (isLaptop() ? l.last() : l.first());

const isFull = (app: App) => app.page.evaluate(() => document.documentElement.hasAttribute('data-bw-stage-full'));

/** Full screen is on: no app chrome on screen, Exit full screen in view (and off the Laptop fold). */
async function expectFullScreen(app: App, kind: 'gig' | 'rehearsal', title: string) {
  await expect.poll(() => isFull(app)).toBe(true);
  await expect(app.page.locator('.bw-duo-rail').filter({ visible: true })).toHaveCount(0);
  await expect(app.page.locator('.bw-nav-bar').filter({ visible: true })).toHaveCount(0);
  const exit = pick(app.button('Exit full screen', { exact: true }));
  await expect(exit).toBeInViewport({ ratio: 1 });
  const fold = test.info().project.use as { duo?: { foldBand?: { top: number; bottom: number } } | null };
  const band = fold.duo?.foldBand;
  if (band) {
    const b = (await exit.boundingBox())!;
    expect(b.y + b.height <= band.top || b.y >= band.bottom, 'Exit full screen sits off the fold').toBe(true);
  }
  if (!isLaptop()) {
    // The live view covers the whole window: both panes on two-pane layouts.
    const vp = app.page.viewportSize()!;
    const box = (await liveDialog(app, kind, title).boundingBox())!;
    expect(box.x).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(vp.width - 1);
  }
}

test.describe('Stage and Live mode full screen', () => {
  test.use({ autoOpen: false });

  test('@smoke gig Stage mode: Full screen hides the app chrome and keeps the setlist; system Back and the button leave it; the choice is remembered', async ({ app }) => {
    test.slow();
    await app.open();
    await openEvent(app, SEED.gigToday);
    await openLive(app, 'gig', SEED.gigToday);
    expect(await isFull(app)).toBe(false);

    await app.button('Full screen', { exact: true }).first().click();
    await app.settle();
    await expectFullScreen(app, 'gig', SEED.gigToday);
    if (!isLaptop()) {
      // The setlist and Prev / Next keep working.
      await expect(liveDialog(app, 'gig', SEED.gigToday).getByText('Superstition', { exact: true }).first()).toBeVisible();
    }
    await app.check('gig Stage mode, full screen');

    // System Back leaves full screen, not Stage mode.
    await systemBack(app);
    await app.settle();
    await expect.poll(() => isFull(app)).toBe(false);
    await expect(liveDialog(app, 'gig', SEED.gigToday)).toBeAttached();
    await expect(app.button('Full screen', { exact: true }).first()).toBeVisible();

    // The button leaves it too.
    await app.button('Full screen', { exact: true }).first().click();
    await app.settle();
    await expectFullScreen(app, 'gig', SEED.gigToday);
    // Exit closes Stage mode; opened again, it comes back full screen.
    await pick(app.button('Exit stage mode', { exact: true })).click();
    await app.settle();
    await expect(liveDialog(app, 'gig', SEED.gigToday)).toHaveCount(0);
    await openLive(app, 'gig', SEED.gigToday);
    await expectFullScreen(app, 'gig', SEED.gigToday);
    await pick(app.button('Exit full screen', { exact: true })).click();
    await app.settle();
    await expect.poll(() => isFull(app)).toBe(false);
    await app.check('gig Stage mode, full screen left');
  });

  test('@smoke rehearsal Live mode full screen: the chart draws named symbols, no raw markers', async ({ app }) => {
    test.slow();
    await openWith(app, (db, ids) => {
      const reh = ids.byTitle('Weekly rehearsal');
      const song = db.songs.find((s) => s.title === 'Harbor Lights')!;
      // Made-up chart with every kind of symbol.
      song.chord_chart = {
        v: 1, source: 'ireal', title: 'Harbor Lights', key: 'G', bpm: 88, time: '4/4',
        sections: [
          { label: 'A', bars: [{ chords: ['G^7'], repeatStart: true, segno: true }, { chords: ['%'] }, { chords: ['E-7', 'A7'], ending: 1, repeatEnd: true }, { chords: ['C', '/', '/', '/'], ending: 2, fermata: true }] },
          { label: 'B', bars: [{ chords: ['%%'], span: 2, time: '3/4' }, { chords: ['N.C.'], text: 'D.S. al Coda' }, { chords: ['D7'], coda: true, text: '3x' }, { chords: ['G6'], final: true, text: 'Fine' }] },
        ],
      };
      const list = '20000000-0000-4000-8000-000000000990';
      db.setlists.push({
        id: list, band_id: reh.band_id, name: 'Weekly focus', description: null, is_template: false, song_count: 2,
        total_duration_seconds: 400, created_by: ids.me, created_at: reh.created_at, updated_at: reh.created_at,
      });
      ['Harbor Lights', 'Paper Boats'].forEach((title, i) =>
        db.setlist_songs.push({
          id: `20000000-0000-4000-8000-00000000099${i + 1}`, setlist_id: list, song_id: db.songs.find((s) => s.title === title)!.id,
          position: i + 1, set_number: 1, notes: null, created_at: reh.created_at,
        }),
      );
      reh.setlist_id = list;
    });
    await app.page.evaluate(() => localStorage.setItem('bw-song-view', 'structure'));
    await openEvent(app, SEED.rehearsalTomorrow);
    await openLive(app, 'rehearsal', SEED.rehearsalTomorrow);
    await app.button('Full screen', { exact: true }).first().click();
    await app.settle();
    await expectFullScreen(app, 'rehearsal', SEED.rehearsalTomorrow);

    if (isLaptop()) {
      await app.page.getByRole('region', { name: app.t('Song controls') }).getByRole('button', { name: app.t('Lyrics'), exact: true }).click();
    } else {
      await liveDialog(app, 'rehearsal', SEED.rehearsalTomorrow).getByRole('tablist', { name: app.t('Setlist') }).getByRole('tab').nth(1).click();
    }
    await app.settle();
    const chart = app.page.locator('[data-chart-grid]').filter({ visible: true }).first();
    await expect(chart).toBeVisible();
    // On a short screen (a phone sideways) the chart still gets room: scroll to it and it is on screen.
    await chart.scrollIntoViewIfNeeded();
    await expect(chart).toBeInViewport();
    const sheet = chart.locator('xpath=ancestor::div[.//h3][1]/..');
    for (const name of ['Repeat start', 'Repeat end', 'Segno', 'Coda', 'Repeat the previous bar', 'Repeat the previous two bars', 'No chord', 'Fermata: hold', 'Final bar line']) {
      await expect(sheet.getByRole('img', { name: app.t(name), exact: true }).first()).toBeAttached();
    }
    await expect(sheet.getByRole('img', { name: app.t('Ending {n}', { n: 2 }), exact: true }).first()).toBeAttached();
    const text = (await sheet.innerText()).replace(/\s+/g, ' ');
    expect(text).not.toMatch(/%|[{}<>]|\bN[12]\b|\bSegno\b/);
    await app.check('rehearsal Live mode, full screen chart');

    // The legend: every symbol sits beside its meaning, never on top of it
    // ("D.C. al Coda" is wider than an icon). The Laptop pose's floor wedge is
    // read at a glance and has none (showLegend={false}).
    if (!isLaptop()) {
      await sheet.getByText(app.t('What the symbols mean'), { exact: true }).first().click();
      await expect(sheet.getByRole('definition').first()).toBeVisible();
      const overlaps = await sheet.locator('dl').first().evaluate((dl) => {
        const bad: string[] = [];
        dl.querySelectorAll('dt').forEach((dt) => {
          const dd = dt.nextElementSibling as HTMLElement;
          const a = (dt.firstElementChild || dt).getBoundingClientRect();
          if (!dd || a.width === 0) bad.push(`${dd?.textContent}: nothing drawn`);
          else if (a.right > dd.getBoundingClientRect().left + 1) bad.push(`${dd.textContent}: overlaps`);
        });
        return bad;
      });
      expect(overlaps).toEqual([]);
    }

    await systemBack(app);
    await app.settle();
    await expect.poll(() => isFull(app)).toBe(false);
    await expect(liveDialog(app, 'rehearsal', SEED.rehearsalTomorrow)).toBeAttached();
  });
});
