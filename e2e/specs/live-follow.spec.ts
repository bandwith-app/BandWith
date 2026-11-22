import type { Page } from '@playwright/test';
import { test, expect, fakeDate, FIXED_NOW, type App } from '../fixtures';
import { openEvent, SEED } from '../support/flows';
import { settle } from '../support/settle';

/**
 * Live mode B2: Follow the tempo (plan live-offline-and-tempo §4.1–4.2).
 * The leader starts the song on their phone; a member's phone, on the same
 * clock, shows the same place at the same moment: the one line above the
 * song ("Next: Chorus in 2 bars"), the line being sung lit. Re-align, Hold
 * and Stop reach it too.
 */

const DB = 'bw-demo-db-v6';
// 4/4 at 120: a bar is 2 s. Verse 4 bars, Chorus 4 bars.
const CHART = {
  v: 1,
  source: 'ireal',
  title: 'Superstition',
  time: '4/4',
  sections: [
    { label: 'Verse', bars: [{ chords: ['C'] }, { chords: ['F'] }, { chords: ['G'] }, { chords: ['C'] }] },
    { label: 'Chorus', bars: [{ chords: ['F'] }, { chords: ['G'] }, { chords: ['F'] }, { chords: ['C'] }] },
  ],
};
const LYRICS = '# Verse\n[C]Walking down to Canal [F]Street\n[G]The train is running [C]late\n# Chorus\n[F]Hold on [G]tight\n[F]Hold on, the [C]night';

/** Tonight's gig's first song (Superstition) gets a BPM, a chart and lyrics; the song view is Lyrics & chords. */
async function openWithSong(app: App) {
  const { page } = app;
  await page.goto('/');
  await expect(page.getByRole('button', { name: app.t('Home'), exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate((k) => !!localStorage.getItem(k), DB), { timeout: 30_000 }).toBe(true);
  await page.evaluate(
    ({ k, chart, lyrics }) => {
      const db = JSON.parse(localStorage.getItem(k) || '{}');
      const s = db.songs.find((x: { title: string }) => x.title === 'Superstition');
      Object.assign(s, { bpm: 120, time_signature: '4/4', chord_chart: chart, lyrics, line_timing: null, backing_track: false });
      localStorage.setItem(k, JSON.stringify(db));
      localStorage.setItem('bw-song-view', 'chords');
    },
    { k: DB, chart: CHART, lyrics: LYRICS },
  );
  await app.open();
}

/** Stage mode on tonight's gig, on the song tab. */
async function openStageSong(app: App) {
  await openEvent(app, SEED.gigToday);
  await app.button('Open stage mode', { exact: true }).first().click();
  await app.settle();
  const tabs = app.page.getByRole('tablist', { name: app.t('Setlist') });
  await tabs.getByRole('tab').nth(1).click();
  await app.settle();
}

const strip = (page: Page) => page.locator('[data-follow-strip] [role="status"]');

/** Records every text of the strip, with when (ms since epoch on this page's clock, the playhead's). */
const recordStrip = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __strip: { text: string; at: number }[] };
    w.__strip = [];
    const read = () => {
      const text = document.querySelector('[data-follow-strip] [role="status"]')?.textContent ?? '';
      const last = w.__strip[w.__strip.length - 1];
      if (text && last?.text !== text) w.__strip.push({ text, at: performance.timeOrigin + performance.now() });
    };
    read();
    new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
const stripSeen = (page: Page) => page.evaluate(() => (window as unknown as { __strip: { text: string; at: number }[] }).__strip);

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
  app.page.evaluate((k) => {
    const d = JSON.parse(localStorage.getItem(k) || '{}');
    for (const m of d.band_members || []) if (m.user_id === '10000001-0000-4000-8000-000000000001') m.role = 'member';
    localStorage.setItem(k, JSON.stringify(d));
  }, DB);

test.describe('Follow the tempo on two devices, one clock', () => {
  test.use({ autoOpen: false });

  test('the leader starts: both phones show the same place at the same moment; re-align, Hold and Stop reach the member', async ({ app }) => {
    test.slow();
    await openWithSong(app);
    await openStageSong(app);
    const lead = app.page;
    // Off by default: today's Stage, untouched.
    const leadSwitch = lead.getByRole('switch', { name: app.t('Follow the tempo') });
    await expect(leadSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(lead.locator('[data-follow-strip]')).toHaveCount(0);
    await leadSwitch.click();
    await expect(strip(lead)).toHaveText(app.t('The band follows when you start'));
    await app.check('stage, follow the tempo, leader ready');

    // A member's phone, Stage mode open on the same gig (the switch is per device: this browser's).
    await becomeMember(app);
    const { page, other } = await secondDevice(app);
    await page.goto('/');
    await expect(page.getByRole('button', { name: app.t('Home'), exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await openStageSong(other);
    await expect(page.getByRole('switch', { name: app.t('Follow the tempo') })).toHaveAttribute('aria-checked', 'true');
    await expect(strip(page)).toHaveText(app.t('Starts when the leader starts the song'));
    // Members don't drive it.
    await expect(page.getByRole('button', { name: app.t('Start', { context: 'follow' }), exact: true })).toHaveCount(0);

    await recordStrip(lead);
    await recordStrip(page);
    await lead.getByRole('button', { name: app.t('Start', { context: 'follow' }), exact: true }).click();
    const twoBars = app.t('Next: {section} in {n} bars', { section: app.t('Chorus'), n: 2 });
    await expect(strip(page)).toHaveText(twoBars, { timeout: 15_000 });
    await expect(strip(lead)).toHaveText(twoBars);
    // The verse's second line is lit on the member's phone.
    await expect(page.locator('[data-line="0:1"][data-follow-now]')).toHaveCount(1);
    const seenLead = await stripSeen(lead);
    const seenMember = await stripSeen(page);
    const want = [
      app.t('Starting…'),
      app.t('Next: {section} in {n} bars', { section: app.t('Chorus'), n: 4 }),
      app.t('Next: {section} in {n} bars', { section: app.t('Chorus'), n: 3 }),
      twoBars,
    ];
    // What each phone showed up to "in 2 bars" (it may have moved on since).
    const upTo = (seen: { text: string }[]) => {
      const texts = seen.map((s) => s.text);
      return texts.slice(0, texts.indexOf(twoBars) + 1).slice(-4);
    };
    expect(upTo(seenLead)).toEqual(want);
    expect(upTo(seenMember)).toEqual(want);
    // One clock: each bar turns within a frame or two on both phones.
    const at = (seen: { text: string; at: number }[], text: string) => seen.find((s) => s.text === text)!.at;
    for (const text of want.slice(2)) expect(Math.abs(at(seenLead, text) - at(seenMember, text))).toBeLessThan(150);
    // A bar apart.
    expect(Math.abs(at(seenMember, twoBars) - at(seenMember, want[2]) - 2_000)).toBeLessThan(150);

    // Re-align: the leader taps the chorus' first line, everyone is there.
    await lead.locator('[data-line="1:0"]').click();
    await expect(page.locator('[data-line="1:0"][data-follow-now]')).toHaveCount(1, { timeout: 5_000 });
    await expect(strip(page)).toHaveText(app.t('Last section: {section}', { section: app.t('Chorus') }));

    // Hold: the chorus again and again until the leader lets go.
    await lead.getByRole('button', { name: app.t('Hold', { context: 'follow' }), exact: true }).click();
    await expect(strip(page)).toHaveText(app.t('Repeating {section} until the leader lets go', { section: app.t('Chorus') }), { timeout: 5_000 });
    await app.check('stage, follow the tempo, holding');

    // Stop: gone on both, the member back to waiting.
    await lead.getByRole('button', { name: app.t('Stop', { context: 'follow' }), exact: true }).click();
    await expect(strip(page)).toHaveText(app.t('Starts when the leader starts the song'), { timeout: 5_000 });
    await expect(page.locator('[data-follow-now]')).toHaveCount(0);
    await page.close();
  });
});
