import type { Page } from '@playwright/test';
import { test, expect, fakeDate, FIXED_NOW, type App } from '../fixtures';
import { openHub } from '../support/hub';
import { escapeRe, openEvent, SEED } from '../support/flows';
import { settle } from '../support/settle';

/**
 * Live mode: Follow the tempo and the count-in (plan live-offline-and-tempo
 * §4, §6). The song form's live fields (migration 171), the count-in on
 * every phone, every meter, and the playhead.
 */


/** Repertoire → a song's menu → Edit → step 2 (Details). */
async function editSongDetails(app: App, title: string) {
  // The hub's Repertoire row ("Repertoire: 17 songs…"), not Home's quick action behind it.
  await openHub(app);
  await app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Repertoire'))}:`) }).first().click();
  await app.settle();
  await app.page.getByText(title, { exact: true }).first().click();
  await app.page.getByRole('menuitem', { name: app.t('Edit'), exact: true }).click();
  await app.settle();
  await app.button('Next', { exact: true }).click();
  await app.settle();
}

test.describe('Song form: live mode fields', () => {
  test('@smoke time signature, 2 bars of count-in, a pickup and the backing track are saved with the song', async ({ app }) => {
    await editSongDetails(app, 'Harbor Lights');
    // The chart is in 4/4: that is the pick until another one is chosen.
    const ts = (time: string) => app.page.getByRole('button', { name: app.t('Time signature {time}', { time }), exact: true });
    await expect(ts('4/4')).toHaveAttribute('aria-pressed', 'true');
    await expect(app.page.getByText(app.t('From the chord chart.'))).toBeVisible();
    await ts('6/8').click();
    await app.page.getByRole('button', { name: app.t('2 bars'), exact: true }).click();
    await app.button('One beat more', { exact: true }).click();
    await expect(app.page.getByText(app.t('Starts 1 beat early'))).toBeVisible();
    await app.page.getByRole('switch', { name: app.t('Played with a backing track') }).click();
    await app.check('song form, live mode fields');

    await app.button('Save now', { exact: true }).click();
    await expect.poll(async () => (await app.readDb()).songs.find((s) => s.title === 'Harbor Lights')).toMatchObject({
      time_signature: '6/8',
      count_in_bars: 2,
      pickup_beats: 1,
      backing_track: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Count-in (plan §6): the leader's Count in, on every phone.

/** Gives Rooftop Session's first song (Superstition) a tempo, meter and count-in, and the band a direction. */
async function openWithCount(app: App, song: { bpm: number; time: string; bars?: number; pickup?: number }, style: 'down' | 'up' = 'down') {
  const { page } = app;
  await page.goto('/');
  await expect(page.getByRole('button', { name: app.t('Home'), exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => !!localStorage.getItem('bw-demo-db-v6')), { timeout: 30_000 }).toBe(true);
  await page.evaluate(
    ({ song, style }) => {
      const k = 'bw-demo-db-v6';
      const db = JSON.parse(localStorage.getItem(k) || '{}');
      const s = db.songs.find((x: { title: string }) => x.title === 'Superstition');
      Object.assign(s, { bpm: song.bpm, time_signature: song.time, count_in_bars: song.bars ?? 1, pickup_beats: song.pickup ?? 0, backing_track: false });
      for (const b of db.bands) b.count_in_style = style;
      localStorage.setItem(k, JSON.stringify(db));
    },
    { song, style },
  );
  await app.open();
}

/** Records every number the countdown shows, with when (this page's clock, ms since epoch). */
const recordCount = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __count: { text: string; at: number }[] };
    w.__count = [];
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="countin-number"]');
      const text = el?.textContent ?? '';
      const last = w.__count[w.__count.length - 1];
      if (text && last?.text !== text) w.__count.push({ text, at: performance.timeOrigin + performance.now() });
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
const counted = (page: Page) => page.evaluate(() => (window as unknown as { __count: { text: string; at: number }[] }).__count);

const countDialog = (page: Page, app: App) => page.getByRole('dialog', { name: app.t('Count-in · {title}', { title: 'Superstition' }) });

/** Open Stage mode on the gig of tonight (the leader's: the demo user is an admin). */
async function openStage(app: App) {
  await openEvent(app, SEED.gigToday);
  await app.button('Open stage mode', { exact: true }).first().click();
  await app.settle();
}

/** The Count in button on screen (Stage mode's, or the floor wedge's in Laptop pose). */
async function countIn(app: App) {
  const buttons = app.page.getByRole('button', { name: app.t('Count in the band'), exact: true });
  await expect(buttons.first()).toBeAttached();
  // The floor wedge covers Stage mode in Laptop pose: its own button is the last one.
  await buttons.last().click();
}

const METERS: { time: string; bpm: number; labels: string[]; ms: number }[] = [
  { time: '4/4', bpm: 120, labels: ['4', '3', '2', '1'], ms: 500 },
  { time: '3/4', bpm: 120, labels: ['3', '2', '1'], ms: 500 },
  { time: '2/4', bpm: 120, labels: ['2', '1'], ms: 500 },
  { time: '5/4', bpm: 150, labels: ['5', '4', '3', '2', '1'], ms: 400 },
  // Compound: the BPM is the dotted beat.
  { time: '6/8', bpm: 80, labels: ['2', '1'], ms: 750 },
  { time: '12/8', bpm: 100, labels: ['4', '3', '2', '1'], ms: 600 },
  // Odd: 2+2+3 eighths at quarter = 120 → 500, 500, 750 ms.
  { time: '7/8', bpm: 120, labels: ['3', '2', '1'], ms: 500 },
];

test.describe('Count-in: every meter', () => {
  test.use({ autoOpen: false });
  for (const m of METERS) {
    test(`${m.time}: ${m.labels.join(' ')} GO, in tempo`, async ({ app }) => {
      await openWithCount(app, { bpm: m.bpm, time: m.time });
      await openStage(app);
      await recordCount(app.page);
      await countIn(app);
      await expect(countDialog(app.page, app)).toBeVisible();
      await expect(countDialog(app.page, app)).toBeHidden({ timeout: 15_000 });
      const seen = await counted(app.page);
      expect(seen.map((s) => s.text)).toEqual([...m.labels, app.t('GO')]);
      // A beat apart (the first beats; 7/8's last one is the long one).
      const gaps = seen.slice(1).map((s, i) => s.at - seen[i].at);
      for (const gap of gaps.slice(0, m.time === '7/8' ? 2 : gaps.length)) expect(Math.abs(gap - m.ms)).toBeLessThan(90);
    });
  }

  test('two bars (the first in half time), a pickup, and the band counting up', async ({ app }) => {
    await openWithCount(app, { bpm: 150, time: '4/4', bars: 2, pickup: 1 }, 'up');
    await openStage(app);
    await recordCount(app.page);
    await countIn(app);
    await expect(countDialog(app.page, app)).toBeHidden({ timeout: 15_000 });
    // 1 — 2 — (half time), 1 2 3, GO on the 4 (the pickup).
    expect((await counted(app.page)).map((s) => s.text)).toEqual(['1', '2', '1', '2', '3', app.t('GO')]);
  });
});

test.describe('Count-in on two devices, one clock', () => {
  test.use({ autoOpen: false });

  test('@smoke the leader counts in: the member’s phone shows the same count at the same moment; Stop ends it on both', async ({ app }) => {
    test.slow();
    await openWithCount(app, { bpm: 90, time: '3/4' });
    await openStage(app);
    // A member's phone, Stage mode open on the same gig.
    await becomeMember(app);
    const { page, other } = await secondDevice(app);
    await page.goto('/');
    await expect(page.getByRole('button', { name: app.t('Home'), exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await openEvent(other, SEED.gigToday);
    await other.button('Open stage mode', { exact: true }).first().click();
    await settle(page);
    // Members don't count in; the leader does.
    await expect(page.getByRole('button', { name: app.t('Count in the band'), exact: true })).toHaveCount(0);
    await recordCount(app.page);
    await recordCount(page);
    await countIn(app);
    await expect(countDialog(page, app)).toBeVisible({ timeout: 5_000 });
    await expect(countDialog(app.page, app)).toBeHidden({ timeout: 15_000 });
    await expect(countDialog(page, app)).toBeHidden({ timeout: 5_000 });
    const lead = await counted(app.page);
    const member = await counted(page);
    const want = ['3', '2', '1', app.t('GO')];
    expect(lead.map((s) => s.text)).toEqual(want);
    expect(member.map((s) => s.text)).toEqual(want);
    // Same machine, same clock: each count within a frame or two of the leader's.
    lead.forEach((s, i) => expect(Math.abs(s.at - member[i].at)).toBeLessThan(120));

    // Stop during the count: gone on both.
    await countIn(app);
    await expect(countDialog(page, app)).toBeVisible({ timeout: 5_000 });
    await countDialog(app.page, app).getByRole('button', { name: app.t('Stop the count-in'), exact: true }).click();
    await expect(countDialog(app.page, app)).toBeHidden();
    await expect(countDialog(page, app)).toBeHidden({ timeout: 5_000 });
    await page.close();
  });
});

/** A second device of the band, in the same browser (the demo's live channel is a BroadcastChannel). */
async function secondDevice(app: App): Promise<{ page: Page; other: App }> {
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
  return { page, other };
}

/** The demo user becomes a member in the shared demo database (read by tabs loaded after this). */
const becomeMember = (app: App) =>
  app.page.evaluate(() => {
    const k = 'bw-demo-db-v6';
    const d = JSON.parse(localStorage.getItem(k) || '{}');
    for (const m of d.band_members || []) if (m.user_id === '10000001-0000-4000-8000-000000000001') m.role = 'member';
    localStorage.setItem(k, JSON.stringify(d));
  });
