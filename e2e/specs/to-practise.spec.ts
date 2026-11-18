import { test, expect, type App } from '../fixtures';
import { openEvent, eventDetail, openCreate, isWide } from '../support/flows';
import { FOCUS, WEEKLY, isLaptop, liveDialog, openLive, openWithFocusSongs, savedNotes, sheet, type SeedNote } from '../support/live';

/**
 * "To practise" (plan A3): open rehearsal notes on Home, on the song page
 * (tempo / key → the song, 108), on the next rehearsal ("From last time" +
 * Live mode badges) and as focus songs for the next rehearsal (097).
 */

const fromLastTime = (app: App) => eventDetail(app).getByRole('group', { name: app.t('From last time') });

/** Notes from the rehearsal a week before "Weekly rehearsal". */
const LAST_WEEK: SeedNote[] = [
  { id: '20000000-0000-4000-8000-000000000a01', song: FOCUS[0], preset: 'ending', daysBefore: 7 },
  { id: '20000000-0000-4000-8000-000000000a02', song: FOCUS[1], preset: 'tempo', body: 'Tempo: 96', forMe: true, byOther: true, daysBefore: 7 },
];

for (const role of ['admin', 'member'] as const) {
  test.describe(`To practise as ${role}`, () => {
    test.use({ role, autoOpen: false });

    test(`@smoke ${role}: Home card → the song page → the tempo goes to the song`, async ({ app }) => {
      await openWithFocusSongs(app, undefined, LAST_WEEK);
      if (isLaptop()) {
        // Duo Laptop: Home is the Band desk; the songs to practise are action items.
        const desk = app.page.getByRole('region', { name: app.t('Action items') });
        await expect(desk).toContainText(FOCUS[1]);
        await expect(desk).toContainText(app.t('To practise'));
        await desk.getByRole('button', { name: new RegExp(FOCUS[1]) }).first().click();
        await app.settle();
        await expect(app.page.getByRole('group', { name: app.t('From rehearsals') })).toBeVisible();
        await app.check('Band desk → song page, From rehearsals');
        return;
      }
      const card = app.page.getByRole('region', { name: app.t('To practise · {title}', { title: FOCUS[1] }) });
      await expect(card).toBeVisible();
      await expect(app.page.getByRole('region', { name: app.t('To practise · {title}', { title: FOCUS[0] }) })).toBeVisible();

      // Practised: mine to tick, it leaves the list once read again.
      await card.getByRole('button', { name: app.t('Practised') }).click();
      await expect(card.getByRole('button', { name: app.t('Practised') })).toHaveAttribute('aria-pressed', 'true');
      await app.check('Home, To practise');

      await card.getByRole('button', { name: app.t('Open {title}', { title: FOCUS[1] }) }).click();
      await app.settle();
      const strip = app.page.getByRole('group', { name: app.t('From rehearsals') });
      await expect(strip).toBeVisible();
      const what = app.t('{bpm} BPM', { bpm: 96 });
      if (role === 'admin') {
        await strip.getByRole('button', { name: app.t('Set on the song: {what}', { what }) }).click();
        await expect.poll(async () => (await app.readDb()).songs.find((s) => s.title === FOCUS[1])?.bpm).toBe(96);
      } else {
        await strip.getByRole('button', { name: app.t('Suggest to the band: {what}', { what }) }).click();
        await expect(app.page.getByRole('dialog').last()).toContainText(what);
      }
      await app.check('song page, From rehearsals');
    });

    test(`${role}: the next rehearsal shows "From last time"; Live mode badges open them`, async ({ app }) => {
      await openWithFocusSongs(app, undefined, LAST_WEEK);
      await openEvent(app, WEEKLY);
      const group = fromLastTime(app);
      await expect(group).toContainText(FOCUS[0]);
      await expect(group).toContainText(FOCUS[1]);
      const okButtons = group.getByRole('button', { name: app.t('OK', { context: 'note' }) });
      // Admins confirm any note; a member only their own (none here).
      await expect(okButtons).toHaveCount(role === 'admin' ? 2 : 0);
      if (role === 'admin') {
        await okButtons.first().click();
        await expect.poll(async () => (await savedNotes(app)).find((n) => n.id === LAST_WEEK[0].id)?.status).toBe('ok');
        // Still there, to take it back.
        await expect(okButtons.first()).toHaveAttribute('aria-pressed', 'true');
      }
      await app.check('rehearsal page, From last time');

      if (isLaptop()) return; // the floor wedge has no song list
      await openLive(app);
      const badge = liveDialog(app).getByRole('button', { name: app.t('From last time · {title}: {count}', { title: FOCUS[1], count: 1 }) });
      await badge.click();
      await expect(sheet(app, FOCUS[1])).toContainText(app.t('Tempo'));
      await app.check('Live mode, notes from last time');
    });
  });
}

test.describe('Focus songs from open notes (097)', () => {
  test.use({ role: 'admin', autoOpen: false });

  test('a new rehearsal offers the songs with open notes, one tap adds one', async ({ app }) => {
    await openWithFocusSongs(app, undefined, LAST_WEEK);
    await openCreate(app, 'New rehearsal');
    if (!(await isWide(app))) {
      // Phone: the songs are on the last step, in the Setlist card.
      await app.button('Next', { exact: true }).last().click();
      await app.page.getByPlaceholder(app.t('Search venue or studio…')).filter({ visible: true }).first().fill('Blackbox');
      await app.page.keyboard.press('Escape');
      await app.button('Next', { exact: true }).last().click();
      await app.settle();
      await app.page.getByRole('button', { name: new RegExp(`^${app.t('Setlist')}`) }).first().click();
    }
    const offer = app.page.getByRole('group', { name: app.t('From open rehearsal notes') }).last();
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: app.t('Add focus song: {title}', { title: FOCUS[1] }) }).click();
    await expect(offer.getByRole('button', { name: app.t('Add focus song: {title}', { title: FOCUS[1] }) })).toHaveCount(0);
    await expect(offer.getByRole('button', { name: app.t('Add focus song: {title}', { title: FOCUS[0] }) })).toBeVisible();
    await app.check('rehearsal wizard, focus songs from notes');
  });
});
