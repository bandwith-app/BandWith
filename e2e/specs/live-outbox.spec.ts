import { test, expect, type App } from '../fixtures';
import { openEvent, eventDetail, SEED } from '../support/flows';
import { openWith } from '../support/rehearsal';

/**
 * Changes made with no signal at the venue (plan docs/plans/live-offline-and-tempo.md
 * §3.5): a personal note and a "Note for the band" written in Stage mode
 * with the network gone are kept on this phone, said so in plain words
 * ("Note saved on this phone…", "1 change waiting for signal"), and sent by
 * themselves when the signal comes back. The demo backend fails every
 * request while the browser is offline (dev builds), like the real one.
 */

const isLaptop = () => test.info().project.name === 'duo-laptop';
const stageDialog = (app: App) => app.page.getByRole('dialog', { name: app.t('Stage mode: {title}', { title: SEED.gigToday }) });
const waiting = (app: App, n: number) =>
  app.page.getByRole('status').filter({ hasText: n === 1 ? app.t('1 change waiting for signal') : app.t('{n} changes waiting for signal', { n }) });
const anyWaiting = (app: App) =>
  app.page.getByRole('status').filter({ hasText: app.t('{n} changes waiting for signal', { n: '§' }).split('§')[1].trim() });

/** Open the gig once with signal (its setlist stays on the phone), then lose it and open Stage. */
async function stageWithoutSignal(app: App, context: import('@playwright/test').BrowserContext) {
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
  // The first song (Superstition), with its lyrics.
  await stageDialog(app).getByRole('tablist', { name: app.t('Setlist') }).getByRole('tab').nth(1).click();
  await app.settle();
}

async function writeNote(app: App, body: string) {
  const stage = stageDialog(app);
  await stage.getByRole('button', { name: app.t('Add note') }).first().click();
  // First time only: what My notes are, then on to the note.
  const gotIt = app.page.getByRole('button', { name: app.t('Got it'), exact: true });
  if (await gotIt.isVisible({ timeout: 1500 }).catch(() => false)) await gotIt.click();
  await app.page.getByRole('button', { name: app.t('Whole song'), exact: true }).click();
  const sheet = app.page.getByRole('dialog', { name: 'Superstition', exact: true }).filter({ hasText: app.t('Save note') }).last();
  await sheet.getByRole('textbox').first().fill(body);
  return sheet;
}

test.describe('Changes with no signal, as member', () => {
  test.use({ role: 'member' });

  test('@smoke a note written offline is kept on the phone, then sent when the signal is back', async ({ app, context }) => {
    test.skip(isLaptop(), 'Stage controls live on the other screen in laptop posture');
    test.slow();
    await stageWithoutSignal(app, context);

    const sheet = await writeNote(app, 'Capo 2 on the last chorus');
    await sheet.getByRole('button', { name: app.t('Save note'), exact: true }).click();
    await expect(app.page.getByText(app.t('Note saved on this phone. It reaches your account when you’re back online.'))).toBeVisible();
    await expect(waiting(app, 1).first()).toBeVisible();
    await expect(waiting(app, 1).first()).not.toContainText(/sync/i);
    // The note is there at once, on this phone.
    await expect(stageDialog(app).getByText('Capo 2 on the last chorus').first()).toBeAttached();
    await app.check('stage note kept offline');

    await context.setOffline(false);
    await expect(anyWaiting(app)).toHaveCount(0, { timeout: 15_000 });
    const db = await app.readDb();
    const notes = (db.song_personal_notes as Array<{ body: string }> | undefined) ?? [];
    expect(notes.filter((n) => n.body === 'Capo 2 on the last chorus')).toHaveLength(1);
  });

  test('a note for the band written offline reaches the admin when the signal is back', async ({ app, context }) => {
    test.skip(isLaptop(), 'Stage controls live on the other screen in laptop posture');
    test.slow();
    await stageWithoutSignal(app, context);

    const sheet = await writeNote(app, 'Count in 4 before the bridge');
    await sheet.getByRole('button', { name: app.t('Suggest to the band'), exact: true }).click();
    const suggest = app.page.getByRole('dialog', { name: 'Superstition', exact: true }).filter({ hasText: app.t('Note for the band') }).last();
    await suggest.getByRole('button', { name: app.t('Send suggestion'), exact: true }).click();
    await expect(suggest.getByText(app.t('Saved on this phone. It goes to the admin when you’re back online.'))).toBeVisible();
    await expect(waiting(app, 1).first()).toBeAttached();
    await app.check('band note kept offline');

    await context.setOffline(false);
    await expect(anyWaiting(app)).toHaveCount(0, { timeout: 15_000 });
    const db = await app.readDb();
    const rows = (db.song_suggestions as Array<{ kind: string; proposed?: { note?: string } }> | undefined) ?? [];
    expect(rows.filter((r) => r.kind === 'note' && (r.proposed?.note || '').includes('Count in 4 before the bridge'))).toHaveLength(1);
  });
});

test.describe('Changes with no signal, as leader', () => {
  test.use({ role: 'admin' });

  test('@smoke the leader reorders offline: the new order stays, "Saved on this phone", saved for the band when back online', async ({ app, context }) => {
    test.skip(isLaptop(), 'Stage controls live on the other screen in laptop posture');
    test.slow();
    await openEvent(app, SEED.gigToday);
    await expect(
      eventDetail(app).getByText(app.t('Offline ready · updated {time}', { time: '§' }).split('§')[0], { exact: false }).first(),
    ).toBeAttached();
    await context.setOffline(true);
    await app.button('Open stage mode', { exact: true }).first().click();
    await app.settle();
    const stage = stageDialog(app);
    const handle = stage.getByRole('button', { name: app.t('Reorder {title}', { title: 'Superstition' }) });
    await handle.focus();
    await app.page.keyboard.press('ArrowDown');
    await expect(stage.getByText(app.t('Saved on this phone'), { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(waiting(app, 1).first()).toBeAttached();
    await app.check('leader order kept offline');

    await context.setOffline(false);
    await expect(anyWaiting(app)).toHaveCount(0, { timeout: 15_000 });
    // Sent: Stage no longer says it is only on this phone.
    await expect(stage.getByText(app.t('Saved on this phone'), { exact: true })).toHaveCount(0, { timeout: 10_000 });
    const db = await app.readDb();
    const ev = (db.events as Array<{ title: string; setlist_id: string }>).find((e) => e.title === SEED.gigToday)!;
    const songs = db.songs as Array<{ id: string; title: string }>;
    const rows = (db.setlist_songs as Array<{ setlist_id: string; song_id: string; position: number; set_number: number }>)
      .filter((r) => r.setlist_id === ev.setlist_id)
      .sort((a, b) => a.set_number - b.set_number || a.position - b.position);
    expect(rows.slice(0, 2).map((r) => songs.find((s) => s.id === r.song_id)?.title)).toEqual(['September', 'Superstition']);
  });
});
