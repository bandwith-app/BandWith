import { test, expect, type App } from '../fixtures';
import { openEvent, eventDetail, escapeRe, SEED } from '../support/flows';
import { openHubPage } from '../support/hub';

/**
 * The offline live pack, asked and followed (plan docs/plans/live-offline-and-tempo.md
 * §3.3–3.4, migration 170):
 * - the "setlist ready without signal" push opens the event with one sheet in
 *   plain words: what, where, how big; "Download and keep it automatic",
 *   "Only this gig", "Not now";
 * - admins see "Offline: N of M members ready" and can remind who is not;
 * - Settings › Offline & live: automatic on/off, Wi-Fi only, space used,
 *   delete all.
 */

const sheet = (app: App) =>
  app.page.getByRole('dialog', { name: new RegExp(escapeRe(app.t('Have the setlist with you, even without signal.'))) });

async function gigId(app: App): Promise<string> {
  const db = await app.readDb();
  const ev = (db.events as Array<{ id: string; title: string }>).find((e) => e.title === SEED.gigToday);
  if (!ev) throw new Error('seed gig not found');
  return ev.id;
}

/** What tapping the live_pack_ready push does (src/lib/notificationRouting.ts). */
async function tapLivePackPush(app: App, eventId: string) {
  await app.page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent('push-navigate', { detail: { screen: 'event', eventId: id, livePack: true } }));
  }, eventId);
  await app.settle();
}

const storedChoice = (app: App) =>
  app.page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('bw-live-pack:'));
    return k ? JSON.parse(localStorage.getItem(k) || 'null') : null;
  });

test.describe('Live pack consent as member', () => {
  test.use({ role: 'member' });

  test('@smoke the push opens the gig with the offline sheet; "Only this gig" keeps just this one', async ({ app }) => {
    const id = await gigId(app);
    await tapLivePackPush(app, id);
    const s = sheet(app);
    await expect(s).toBeVisible();
    await expect(s.getByText(app.t('Lyrics, chords, structures and your own notes for the songs of this gig. No fees, no contracts.'))).toBeVisible();
    await expect(s.getByText(app.t('About {size} MB, plus your own files.', { size: '§' }).split('§')[0], { exact: false })).toBeVisible();
    await app.check('offline consent sheet');
    await s.getByRole('button', { name: app.t('Only this gig'), exact: true }).click();
    await app.settle();
    await expect(s).toBeHidden();
    const choice = await storedChoice(app);
    expect(choice?.auto).toBe(false);
    expect(choice?.events).toContain(id);
    await expect(
      eventDetail(app).getByText(app.t('Offline ready · updated {time}', { time: '§' }).split('§')[0], { exact: false }).first(),
    ).toBeAttached();
  });

  test('"Not now" downloads nothing new and remembers the answer', async ({ app }) => {
    await tapLivePackPush(app, await gigId(app));
    await sheet(app).getByRole('button', { name: app.t('Not now'), exact: true }).click();
    await app.settle();
    await expect(sheet(app)).toBeHidden();
    const choice = await storedChoice(app);
    expect(choice?.auto).toBe(false);
    expect(typeof choice?.notNowAt).toBe('string');
  });
});

test.describe('Offline readiness as admin', () => {
  test.use({ role: 'admin' });

  test('@smoke the gig shows who has the setlist offline, and Remind reaches one member', async ({ app }) => {
    const id = await gigId(app);
    await app.editDb((db) => {
      const users = (db.event_members as Array<{ event_id: string; user_id: string; status: string }>)
        .filter((m) => m.event_id === id && m.status !== 'declined')
        .map((m) => m.user_id)
        .slice(0, 2);
      (db as Record<string, unknown[]>).live_pack_status = users.map((u, i) => ({
        event_id: id,
        user_id: u,
        device_id: `device-${i}`,
        version: 'v1',
        downloaded_at: new Date().toISOString(),
      }));
    });
    await openEvent(app, SEED.gigToday);
    const ready = app.t('Offline: {n} of {m} members ready', { n: '§', m: '¤' });
    const [pre, mid] = ready.split('§');
    const row = app.page
      .getByRole('button', { name: new RegExp(`^${escapeRe(pre)}2${escapeRe(mid.split('¤')[0])}\\d+`) })
      .filter({ visible: true })
      .first();
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeVisible();
    await row.click();
    const remind = app.page.getByRole('button', { name: app.t('Remind {name}', { name: 'Lena P.' }), exact: true }).filter({ visible: true }).first();
    await remind.scrollIntoViewIfNeeded();
    await app.check('offline readiness, not ready list');
    await remind.click();
    await expect(app.page.getByText(app.t('Reminded'), { exact: true }).filter({ visible: true }).first()).toBeVisible();
    const calls = await app.page.evaluate(
      () => ((globalThis as { __bwDemoNotifications?: Array<{ fn: string; args: Record<string, unknown> }> }).__bwDemoNotifications ?? []).filter((c) => c.fn === 'bw_live_pack_remind'),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].args.p_event_id).toBe(id);
  });
});

test.describe('Settings › Offline & live', () => {
  test.use({ role: 'member' });

  test('@smoke automatic, Wi-Fi only, space used and delete all', async ({ app }) => {
    // A gig opened online keeps its setlist on the device.
    await openEvent(app, SEED.gigToday);
    await expect(
      eventDetail(app).getByText(app.t('Offline ready · updated {time}', { time: '§' }).split('§')[0], { exact: false }).first(),
    ).toBeAttached();
    await app.page.keyboard.press('Escape');
    await app.settle();

    await openHubPage(app, 'Settings & account');
    const section = app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Offline & live'))}`) }).filter({ visible: true }).first();
    await section.scrollIntoViewIfNeeded();
    await section.click();
    await app.settle();

    const auto = app.page.getByRole('switch', { name: app.t('Automatic download'), exact: true }).filter({ visible: true }).first();
    const wifi = app.page.getByRole('switch', { name: app.t('Wi-Fi only'), exact: true }).filter({ visible: true }).first();
    await expect(auto).not.toBeChecked();
    await auto.click();
    await expect(auto).toBeChecked();
    await wifi.click();
    await expect(wifi).toBeChecked();
    const choice = await storedChoice(app);
    expect(choice?.auto).toBe(true);
    expect(choice?.wifiOnly).toBe(true);

    const one = app.t('1 setlist · {size} MB', { size: '§' }).split('§')[0];
    await expect(app.page.getByText(one, { exact: false }).filter({ visible: true }).first()).toBeVisible();
    await app.check('Settings › Offline & live');
    await app.button('Delete all', { exact: true }).first().click();
    await expect(app.page.getByText(app.t('Delete all offline setlists?'), { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await app.button('Delete all', { exact: true }).first().click();
    await expect(app.page.getByText(app.t('Nothing kept on this device'), { exact: true }).filter({ visible: true }).first()).toBeVisible();
  });
});
