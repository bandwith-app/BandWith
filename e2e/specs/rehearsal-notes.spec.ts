import { test, expect, fakeDate, FIXED_NOW, type App } from '../fixtures';
import { openEvent, eventDetail } from '../support/flows';
import { settle } from '../support/settle';
import { FOCUS, WEEKLY, isLaptop, liveDialog, notesBar, openLive, openWithFocusSongs, savedNotes, sheet } from '../support/live';

/**
 * Rehearsal notes (plan A2, migration 132): "Mark now, write later" in Live
 * mode, presets, who a note is for, Practised / OK, the rehearsal page's
 * list, live between devices. Flag `rehearsal_notes` (on by default).
 */

const notesSection = (app: App) => eventDetail(app).getByRole('group', { name: app.t('Rehearsal notes') });

for (const role of ['admin', 'member'] as const) {
  test.describe(`Rehearsal notes as ${role}`, () => {
    test.use({ role, autoOpen: false });

    test(`@smoke ${role}: mark while playing, write it at the pause, read it on the rehearsal page`, async ({ app }) => {
      await openWithFocusSongs(app, { minutesAgo: 12 });
      await openEvent(app, WEEKLY);
      await expect(notesSection(app)).toContainText(app.t('No notes yet.'));
      await openLive(app);

      if (isLaptop()) {
        // The floor wedge's notes pad: Mark, and a preset in one tap.
        const pad = app.page.getByRole('region', { name: app.t('Song controls') }).getByRole('region', { name: app.t('Notes pad') });
        await pad.getByRole('button', { name: app.t('Mark', { context: 'note' }), exact: true }).click();
        await expect(pad).toContainText(app.t('Marked'));
        await pad.getByRole('button', { name: app.t('Tempo'), exact: true }).click();
        await expect(pad).toContainText(app.t('Saved: {what}', { what: app.t('Tempo') }));
        await expect.poll(async () => (await savedNotes(app)).map((n) => n.status).sort()).toEqual(['marked', 'open']);
        await app.check('floor wedge, notes pad');
        return;
      }

      await notesBar(app).getByRole('button', { name: app.t('Mark', { context: 'note' }), exact: true }).click();
      await expect(notesBar(app)).toContainText(app.t('Marked'));
      await expect.poll(async () => (await savedNotes(app)).map((n) => [n.status, n.song_title])).toEqual([['marked', FOCUS[0]]]);

      await notesBar(app).getByRole('button', { name: app.t('To write: {count}', { count: 1 }) }).click();
      const list = sheet(app, new RegExp(app.t('Notes · {count}', { count: 1 })));
      await expect(list).toContainText(app.t('Marked at {time}', { time: '12:' }).replace(/\s*$/, ''));
      await app.check('notes sheet, a mark to write');
      await list.getByRole('button', { name: app.t('Write', { context: 'note' }), exact: true }).click();
      const editor = sheet(app, app.t('Edit note'));
      await editor.getByRole('button', { name: app.t('Tempo'), exact: true }).click();
      await editor.getByRole('textbox').fill('Count the bridge in');
      await app.check('note editor');
      await editor.getByRole('button', { name: app.t('Save note') }).click();
      await expect
        .poll(async () => (await savedNotes(app)).map((n) => [n.status, n.preset, n.body]))
        .toEqual([['open', 'tempo', 'Count the bridge in']]);

      await app.page.keyboard.press('Escape');
      await app.button('Exit live mode', { exact: true }).first().click();
      await app.settle();
      await expect(notesSection(app)).toContainText(app.t('Tempo'));
      await expect(notesSection(app)).toContainText('Count the bridge in');
      await expect(notesSection(app)).toContainText(FOCUS[0]);
      await app.check('rehearsal page, notes');
    });
  });
}

test.describe('Rehearsal notes: who does what (Q-A1, Q-A4)', () => {
  test.use({ autoOpen: false });

  test.describe('member', () => {
    test.use({ role: 'member' });
    test("the assignee marks Practised; OK is the admin's", async ({ app }) => {
      await openWithFocusSongs(app, undefined, [
        { id: '30000000-0000-4000-8000-000000000001', song: FOCUS[1], preset: 'ending', forMe: true, byOther: true },
        { id: '30000000-0000-4000-8000-000000000002', song: null, body: 'Tune before we start', byOther: true },
      ]);
      await openEvent(app, WEEKLY);
      const section = notesSection(app);
      await expect(section).toContainText(app.t('Open for you: {count}', { count: 2 }));
      await section.getByRole('button', { name: app.t('Practised') }).click();
      await expect
        .poll(async () => ((await app.readDb()).rehearsal_note_assignees ?? []).map((a) => !!a.practised_at))
        .toEqual([true]);
      await expect(section.getByRole('button', { name: app.t('OK', { context: 'note' }), exact: true })).toHaveCount(0);
      // Someone else's note: no Edit.
      await expect(section.getByRole('button', { name: new RegExp(app.t('Edit note: {title}', { title: '' })) })).toHaveCount(0);
    });
  });

  test.describe('admin', () => {
    test.use({ role: 'admin' });
    test('an admin confirms a note OK and assigns it to a member', async ({ app }) => {
      await openWithFocusSongs(app, undefined, [
        { id: '30000000-0000-4000-8000-000000000003', song: FOCUS[2], preset: 'solo', byOther: true },
      ]);
      await openEvent(app, WEEKLY);
      const section = notesSection(app);
      await section.getByRole('button', { name: app.t('OK', { context: 'note' }), exact: true }).click();
      await expect.poll(async () => (await savedNotes(app)).map((n) => n.status)).toEqual(['ok']);

      await section.getByRole('button', { name: app.t('New note') }).click();
      const editor = sheet(app, app.t('New note'));
      await editor.getByRole('button', { name: FOCUS[1], exact: true }).click();
      await editor.getByRole('button', { name: app.t('Key'), exact: true }).click();
      const who = editor.getByRole('group', { name: app.t('Who it’s for') });
      const people = await who.getByRole('button').allTextContents();
      expect(people.length).toBeGreaterThan(2);
      await who.getByRole('button').nth(2).click();
      await editor.getByRole('button', { name: app.t('Save note') }).click();
      await expect
        .poll(async () => {
          const db = await app.readDb();
          const n = (db.rehearsal_notes ?? []).find((x) => x.preset === 'key');
          return n && { scope: n.scope, assignees: (db.rehearsal_note_assignees ?? []).filter((a) => a.note_id === n.id).length };
        })
        .toEqual({ scope: 'members', assignees: 1 });
    });
  });
});

test.describe('Rehearsal notes between two devices', () => {
  test.use({ role: 'admin', autoOpen: false });

  test("a note written on one phone shows on the other's Live mode", async ({ app }) => {
    test.skip(isLaptop(), 'the floor wedge covers Live mode');
    test.slow();
    await openWithFocusSongs(app, { minutesAgo: 5 });
    await openEvent(app, WEEKLY);
    await openLive(app);

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
    await page.goto('/');
    await expect(page.getByRole('button', { name: app.t('Home'), exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await openEvent(other, WEEKLY);
    await openLive(other);
    await expect(notesBar(other).getByRole('button', { name: app.t('Notes · {count}', { count: 0 }) })).toBeVisible();

    await notesBar(app).getByRole('button', { name: app.t('Mark', { context: 'note' }), exact: true }).click();
    await expect(notesBar(other).getByRole('button', { name: app.t('To write: {count}', { count: 1 }) })).toBeVisible({ timeout: 15_000 });
    await expect(liveDialog(other)).toBeVisible();
    await page.close();
  });
});
