import type { Page } from '@playwright/test';
import { test, expect, fakeDate, FIXED_NOW, type App } from '../fixtures';
import { openEvent, eventDetail, systemBack, SEED } from '../support/flows';
import { openWith } from '../support/rehearsal';
import { settle } from '../support/settle';

/**
 * Live mode (Stage mode, src/app/components/dashboard/StageMode.tsx): gigs
 * open it as Stage mode; since 11-17 upcoming band rehearsals open the same
 * live screen as "Live mode", without the gig's run of show (load in,
 * soundcheck, show, end) and without striking songs off for tonight.
 * Everyone on the rehearsal can open it (admin leads, members follow),
 * like a gig.
 */

/** Focus songs given to "Weekly rehearsal": two with lyrics / chords, one plain. */
const REHEARSAL_SETLIST = '20000000-0000-4000-8000-000000000990';
const FOCUS = ['Paper Boats', 'Harbor Lights', 'Superstition'] as const;

/** Gives "Weekly rehearsal" (tomorrow) a setlist of focus songs. */
async function openWithFocusSongs(app: App) {
  await openWith(app, (db, ids) => {
    const reh = ids.byTitle('Weekly rehearsal');
    const song = (title: string) => db.songs.find((s) => s.title === title)!;
    db.setlists.push({
      id: '20000000-0000-4000-8000-000000000990', band_id: reh.band_id, name: 'Weekly focus', description: null,
      is_template: false, song_count: 3, total_duration_seconds: 660, created_by: ids.me,
      created_at: reh.created_at, updated_at: reh.created_at,
    });
    ['Paper Boats', 'Harbor Lights', 'Superstition'].forEach((title, i) =>
      db.setlist_songs.push({
        id: `20000000-0000-4000-8000-00000000099${i + 1}`, setlist_id: '20000000-0000-4000-8000-000000000990',
        song_id: song(title).id, position: i + 1, set_number: 1, notes: null, created_at: reh.created_at,
      }),
    );
    reh.setlist_id = '20000000-0000-4000-8000-000000000990';
  });
  // Chords view in every live screen (the per-device song view preference).
  await app.page.evaluate(() => localStorage.setItem('bw-song-view', 'chords'));
}

/** Duo Laptop pose: the floor wedge (FloorWedgeMode) covers the live screen. */
const isLaptop = () => test.info().project.name === 'duo-laptop';

/** The live screen's header label without its date ("Live mode · "). */
const headPrefix = (app: App, source: string) => app.t(source, { date: '§' }).split('§')[0];

/** The live screen of a gig or rehearsal (a dialog; the floor wedge covers it in Laptop pose). */
const liveDialog = (app: App, kind: 'gig' | 'rehearsal', title: string) =>
  app.page.getByRole('dialog', { name: app.t(kind === 'gig' ? 'Stage mode: {title}' : 'Live mode: {title}', { title }) });

/** The play button of the event on screen (hero header, or the Duo rail). */
const openLiveButton = (app: App, kind: 'gig' | 'rehearsal') =>
  app.button(kind === 'gig' ? 'Open stage mode' : 'Open live mode', { exact: true }).first();

async function openLive(app: App, kind: 'gig' | 'rehearsal', title: string) {
  await openLiveButton(app, kind).click();
  await expect(liveDialog(app, kind, title)).toBeAttached();
  await app.settle();
}

/** The live screen is gone and the event is the screen in front again. */
async function expectBackOnEvent(app: App, kind: 'gig' | 'rehearsal', title: string) {
  await expect(liveDialog(app, kind, title)).toHaveCount(0);
  await expect(app.page.getByRole('region', { name: app.t('Song controls') })).toHaveCount(0);
  await expect(eventDetail(app)).toBeVisible();
  await expect(eventDetail(app).getByText(title).first()).toBeVisible();
  await expect(openLiveButton(app, kind)).toBeVisible();
}

/** The current song's chords show (Stage mode's song tab, or the floor wedge's Lyrics). */
async function expectSongChords(app: App, kind: 'gig' | 'rehearsal', title: string, song: string, line: RegExp) {
  if (isLaptop()) {
    await app.page.getByRole('region', { name: app.t('Song controls') }).getByRole('button', { name: app.t('Lyrics'), exact: true }).click();
  } else {
    const tabs = liveDialog(app, kind, title).getByRole('tablist', { name: app.t('Setlist') });
    await tabs.getByRole('tab').nth(1).click();
  }
  const sheet = app.page.getByLabel(app.t('Chords · {title}', { title: song }), { exact: true }).filter({ visible: true }).first();
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(line);
}

for (const role of ['admin', 'member'] as const) {
  test.describe(`Rehearsal live mode as ${role}`, () => {
    test.use({ role, autoOpen: false });

    test(`@smoke ${role}: opens live mode from an upcoming rehearsal, its focus songs with chords, no run of show; Close and system Back return to the rehearsal`, async ({ app }) => {
      test.slow();
      await openWithFocusSongs(app);
      await openEvent(app, SEED.rehearsalTomorrow);
      await openLive(app, 'rehearsal', SEED.rehearsalTomorrow);
      const live = liveDialog(app, 'rehearsal', SEED.rehearsalTomorrow);

      // The rehearsal's setlist (focus songs), in order.
      if (isLaptop()) {
        await expect(app.page.getByRole('region', { name: app.t('Song controls') })).toBeVisible();
        await expect(app.page.getByRole('region', { name: app.t('Now playing') })).toContainText(FOCUS[0]);
      } else {
        await expect(live.getByText(headPrefix(app, 'Live mode · {date}'), { exact: false }).first()).toBeVisible();
        for (const title of FOCUS) await expect(live.getByText(title, { exact: true }).first()).toBeVisible();
      }
      // No gig phases or times, nothing to strike off for tonight.
      await expect(app.page.getByRole('list', { name: app.t('Run of show') })).toHaveCount(0);
      for (const phase of ['Load in', 'Soundcheck', 'Show']) {
        await expect(live.getByText(app.t(phase), { exact: true })).toHaveCount(0);
      }
      await expect(app.page.getByRole('button', { name: app.t('Strike {title} off tonight', { title: FOCUS[0] }) })).toHaveCount(0);
      await app.check('rehearsal live mode');

      await expectSongChords(app, 'rehearsal', SEED.rehearsalTomorrow, FOCUS[0], /Paper boats on the/i);
      await app.check('rehearsal live mode, chords');

      // Close (the screen's ✕, or the Duo rail's).
      await app.button('Exit live mode', { exact: true }).first().click();
      await app.settle();
      await expectBackOnEvent(app, 'rehearsal', SEED.rehearsalTomorrow);

      // System Back leaves live mode, not the rehearsal beneath.
      await openLive(app, 'rehearsal', SEED.rehearsalTomorrow);
      await systemBack(app);
      await app.settle();
      await expectBackOnEvent(app, 'rehearsal', SEED.rehearsalTomorrow);
    });
  });
}

test.describe('Live mode is offered only where it belongs', () => {
  test.use({ autoOpen: false });

  test('@smoke a past rehearsal has no live mode', async ({ app }) => {
    await openWith(app, (db, ids) => {
      // Weekly rehearsal moved to two days ago (Sat 14 Nov 2026).
      ids.byTitle('Weekly rehearsal').event_date = '2026-11-14';
    });
    await openEvent(app, SEED.rehearsalTomorrow);
    await expect(eventDetail(app).getByText(SEED.rehearsalTomorrow).first()).toBeVisible();
    await expect(app.button('Open live mode', { exact: true })).toHaveCount(0);
    await expect(app.button('Open stage mode', { exact: true })).toHaveCount(0);
    await app.check('past rehearsal');
  });

  test('@smoke a personal gig has no live mode', async ({ app }) => {
    await app.open();
    await openEvent(app, SEED.personal);
    await expect(app.button('Open live mode', { exact: true })).toHaveCount(0);
    await expect(app.button('Open stage mode', { exact: true })).toHaveCount(0);
    await app.check('personal gig');
  });

  test('a rehearsal without focus songs says so in live mode', async ({ app }) => {
    await app.open();
    await openEvent(app, SEED.rehearsalNext);
    await openLive(app, 'rehearsal', SEED.rehearsalNext);
    await expect(liveDialog(app, 'rehearsal', SEED.rehearsalNext).getByText(app.t('No songs picked for this rehearsal yet.'))).toBeVisible();
    await app.check('rehearsal live mode, no songs');
  });
});

test.describe('Gig Stage mode is unchanged', () => {
  test('@smoke a gig still opens Stage mode with its run of show; Exit and system Back return to the gig', async ({ app }) => {
    await openEvent(app, SEED.gigToday);
    await openLive(app, 'gig', SEED.gigToday);
    const stage = liveDialog(app, 'gig', SEED.gigToday);
    if (isLaptop()) {
      await expect(app.page.getByRole('region', { name: app.t('Song controls') })).toBeVisible();
    } else {
      await expect(stage.getByText(headPrefix(app, 'Stage mode · {date}'), { exact: false }).first()).toBeVisible();
      const run = stage.getByRole('list', { name: app.t('Run of show') });
      await expect(run).toBeVisible();
      for (const phase of ['Load in', 'Soundcheck', 'Show', 'End']) {
        await expect(run.getByText(new RegExp(`^(${app.t('Next · {label}', { label: app.t(phase) })}|${app.t(phase)})$`)).first()).toBeVisible();
      }
      // The leader can still strike songs off for tonight.
      await expect(stage.getByRole('button', { name: app.t('Strike {title} off tonight', { title: 'Superstition' }) })).toBeVisible();
    }
    await app.check('gig Stage mode');

    await app.button('Exit stage mode', { exact: true }).first().click();
    await app.settle();
    await expectBackOnEvent(app, 'gig', SEED.gigToday);

    await openLive(app, 'gig', SEED.gigToday);
    await systemBack(app);
    await app.settle();
    await expectBackOnEvent(app, 'gig', SEED.gigToday);
  });
});

/**
 * A second device of the band, in the same browser: the demo's live channel
 * reaches the other tabs (src/lib/demo/demoClient.ts, BroadcastChannel).
 */
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

/** Makes the demo user a member in the shared demo database (read by tabs loaded after this). */
const becomeMember = (app: App) =>
  app.page.evaluate(() => {
    const k = 'bw-demo-db-v6';
    const d = JSON.parse(localStorage.getItem(k) || '{}');
    for (const m of d.band_members || []) if (m.user_id === '10000001-0000-4000-8000-000000000001') m.role = 'member';
    localStorage.setItem(k, JSON.stringify(d));
  });

const nowPlaying = (app: App, kind: 'gig' | 'rehearsal', title: string, song: string) =>
  liveDialog(app, kind, title).getByRole('button', { name: app.t('Now playing: {title}', { title: song }) }).first();

for (const kind of ['rehearsal', 'gig'] as const) {
  test.describe(`${kind} live sync between two devices`, () => {
    test.use({ autoOpen: false });

    test(`the admin's song change reaches a member with ${kind === 'gig' ? 'Stage' : 'live'} mode open`, async ({ app }) => {
      test.slow();
      const title = kind === 'gig' ? SEED.gigToday : SEED.rehearsalTomorrow;
      const [first, second] = kind === 'gig' ? ['Superstition', 'September'] : [FOCUS[0], FOCUS[1]];
      await openWithFocusSongs(app);
      test.skip(isLaptop(), 'the floor wedge has its own counter; Stage mode syncs the same way');

      // Leader: the admin's device, live mode open.
      await openEvent(app, title);
      await openLive(app, kind, title);
      await expect(nowPlaying(app, kind, title, first)).toBeVisible();

      // Follower: a member's device, opened after.
      await becomeMember(app);
      const { page, other } = await secondDevice(app);
      await page.goto('/');
      await expect(page.getByRole('button', { name: app.t('Home'), exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await settle(page);
      await openEvent(other, title);
      await openLive(other, kind, title);
      await expect(other.button('Follow leader').or(other.button('Waiting for leader')).or(other.button('Following leader')).first()).toBeVisible();

      // The leader moves on: the member's screen follows.
      await liveDialog(app, kind, title).getByRole('button', { name: app.t('Next song') }).click();
      await expect(nowPlaying(app, kind, title, second)).toBeVisible();
      await expect(nowPlaying(other, kind, title, second)).toBeVisible({ timeout: 15_000 });
      await expect(other.button('Following leader').first()).toBeVisible();
      await page.close();
    });
  });
}

/** A short silent WAV (8 kHz mono, 16-bit): what the Regia plays in the tests. */
function silentWav(seconds = 20): Buffer {
  const rate = 8000;
  const data = rate * seconds * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(data, 40);
  return b;
}

test.describe('Stage manager mode (Regia): the admin plays, the band follows', () => {
  test.use({ autoOpen: false });

  test('@smoke with the Regia on, the setlist stays usable under the player on every screen', async ({ app }) => {
    test.skip(isLaptop(), 'the floor wedge is a musician’s screen at their feet: no Regia controls there');
    const title = SEED.gigToday;
    await app.page.context().route('**/regia-e2e/**', (route) =>
      route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav(), headers: { 'access-control-allow-origin': '*' } }),
    );
    await openWith(app, (db) => {
      db.songs.forEach((s, i) => {
        s.audio_url = `https://media.example/regia-e2e/${i}.wav`;
      });
    });
    await openEvent(app, title);
    await openLive(app, 'gig', title);
    const stage = liveDialog(app, 'gig', title);
    await stage.getByRole('button', { name: app.t('Stage manager: play audio here') }).click();
    await expect(stage.getByRole('region', { name: app.t('Stage manager') })).toBeVisible();
    // At least two songs of the setlist fully on screen, each with its ▶.
    const rowPlays = stage.getByRole('button', { name: /^Play (?!a song not in)/ });
    await expect(rowPlays.nth(0)).toBeInViewport({ ratio: 1 });
    await expect(rowPlays.nth(1)).toBeInViewport({ ratio: 1 });
    // A phone held upright (any height): the run of show gives its room to the setlist
    // under the player (field report 11-20: one row left on a 412×815 Android phone).
    const vp = app.page.viewportSize()!;
    if (vp.width < 600 && vp.height > 520) {
      await expect(stage.getByRole('list', { name: app.t('Run of show') })).toBeHidden();
      await expect(rowPlays.nth(2)).toBeInViewport({ ratio: 1 });
    }
  });

  test('the admin plays a song out of order on the Regia: a member jumps to it, sees it playing, and loads no audio', async ({ app }) => {
    test.slow();
    test.skip(isLaptop(), 'the floor wedge has its own counter; Stage mode syncs the same way');
    const title = SEED.gigToday;
    const audioRequests: string[] = [];
    await app.page.context().route('**/regia-e2e/**', (route) => {
      audioRequests.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav(), headers: { 'access-control-allow-origin': '*' } });
    });
    await openWith(app, (db) => {
      db.songs.forEach((s, i) => {
        s.audio_url = `https://media.example/regia-e2e/${i}.wav`;
      });
    });

    // The Regia: the admin's device (the one wired to the mixer).
    await openEvent(app, title);
    await openLive(app, 'gig', title);
    const stage = liveDialog(app, 'gig', title);
    await stage.getByRole('button', { name: app.t('Stage manager: play audio here') }).click();
    const bar = stage.getByRole('region', { name: app.t('Stage manager') });
    await expect(bar).toBeVisible();
    await expect(bar.getByText(app.t('Audio ready {ready}/{total}', { ready: 10, total: 10 }))).toBeVisible({ timeout: 20_000 });
    await app.check('Stage mode, Regia on');

    // A member's device, opened after.
    await becomeMember(app);
    const { page, other } = await secondDevice(app);
    const memberAudio: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('regia-e2e')) memberAudio.push(r.url());
    });
    await page.goto('/');
    await expect(page.getByRole('button', { name: app.t('Home'), exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await openEvent(other, title);
    await openLive(other, 'gig', title);
    await expect(nowPlaying(other, 'gig', title, 'Superstition')).toBeVisible({ timeout: 15_000 });
    // No Regia controls on a member's device.
    await expect(liveDialog(other, 'gig', title).getByRole('button', { name: app.t('Stage manager: play audio here') })).toHaveCount(0);

    // Play on the fourth song (out of order): the band jumps to it.
    await stage.getByRole('button', { name: app.t('Play {title}', { title: 'Uptown Funk' }) }).click();
    await expect(bar.getByRole('button', { name: app.t('Pause'), exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(nowPlaying(other, 'gig', title, 'Uptown Funk')).toBeVisible({ timeout: 15_000 });
    const strip = liveDialog(other, 'gig', title).getByText(app.t('Now playing'), { exact: true });
    await expect(strip).toBeVisible({ timeout: 15_000 });

    // Pause on the Regia: the member's strip says so.
    await bar.getByRole('button', { name: app.t('Pause'), exact: true }).click();
    await expect(liveDialog(other, 'gig', title).getByText(app.t('Paused'), { exact: true })).toBeVisible({ timeout: 15_000 });

    expect(audioRequests.length).toBeGreaterThan(0);
    expect(memberAudio).toEqual([]);
    await page.close();
  });

  test('a song off the setlist: added right after the current one, everyone sees it', async ({ app }) => {
    test.slow();
    test.skip(isLaptop(), 'the floor wedge has its own counter; Stage mode syncs the same way');
    const title = SEED.gigToday;
    await app.page.context().route('**/regia-e2e/**', (route) =>
      route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav(), headers: { 'access-control-allow-origin': '*' } }),
    );
    await openWith(app, (db) => {
      db.songs.forEach((s, i) => {
        s.audio_url = `https://media.example/regia-e2e/${i}.wav`;
      });
    });
    await openEvent(app, title);
    await openLive(app, 'gig', title);
    const stage = liveDialog(app, 'gig', title);
    await stage.getByRole('button', { name: app.t('Stage manager: play audio here') }).click();
    await stage.getByRole('button', { name: app.t('Play a song not in the setlist') }).click();
    const sheet = app.page.getByRole('dialog', { name: app.t('Play a song not in the setlist') });
    await sheet.getByRole('searchbox', { name: app.t('Search songs') }).fill('Rehab');
    await sheet.getByRole('button', { name: /Rehab/ }).click();
    await expect(sheet).toHaveCount(0);
    await expect(nowPlaying(app, 'gig', title, 'Rehab')).toBeVisible({ timeout: 15_000 });
    // Right after the first song: second in the list.
    const rows = stage.getByRole('list', { name: app.t('Setlist') }).first().getByRole('listitem');
    await expect(rows.nth(1)).toContainText('Rehab', { timeout: 15_000 });
  });
});
