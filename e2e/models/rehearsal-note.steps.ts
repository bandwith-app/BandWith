import { expect } from '../fixtures';
import { eventDetail, openEvent } from '../support/flows';
import { FOCUS, WEEKLY, liveDialog, notesBar, openLive, openWithFocusSongs, savedNotes, sheet } from '../support/live';
import { rehearsalNote } from './rehearsal-note.model.ts';
import { stepsFor, type Ctx } from './steps.ts';

const BODY = 'Count the bridge in';
const list = (c: Ctx) => sheet(c.app, new RegExp(c.app.t('Notes · {count}', { count: 1 })));
const editor = (c: Ctx) => sheet(c.app, c.app.t('Edit note'));
const section = (c: Ctx) => eventDetail(c.app).getByRole('group', { name: c.app.t('Rehearsal notes') });
const okButton = (c: Ctx) => section(c).getByRole('button', { name: c.app.t('OK', { context: 'note' }), exact: true });
const statuses = async (c: Ctx) => (await savedNotes(c.app)).map((n) => n.status);
const closeSheet = async (c: Ctx, s: ReturnType<typeof sheet>) => {
  await s.getByRole('button', { name: c.app.t('Close sheet') }).first().click();
  await expect(s).toHaveCount(0);
};

export const rehearsalNoteSteps = stepsFor(rehearsalNote, {
  boot: async () => {},
  states: {
    start: async () => {},
    live: async (c) => {
      await expect(notesBar(c.app).getByRole('button', { name: c.app.t('Mark', { context: 'note' }), exact: true })).toBeVisible();
      await expect(notesBar(c.app).getByRole('button', { name: c.app.t('Notes · {count}', { count: 0 }) })).toBeVisible();
      expect(await savedNotes(c.app)).toEqual([]);
    },
    marked: async (c) => {
      await expect(notesBar(c.app).getByRole('button', { name: c.app.t('To write: {count}', { count: 1 }) })).toBeVisible();
      await expect.poll(async () => (await savedNotes(c.app)).map((n) => [n.status, n.song_title])).toEqual([['marked', FOCUS[0]]]);
    },
    list: async (c) => {
      await expect(list(c)).toContainText(FOCUS[0]);
      await expect(list(c).getByRole('button', { name: c.app.t('Write', { context: 'note' }), exact: true })).toBeVisible();
      await c.app.check('notes sheet, a mark');
    },
    editing: async (c) => {
      await expect(editor(c).getByRole('button', { name: c.app.t('Save note') })).toBeVisible();
      await expect(editor(c).getByRole('group', { name: c.app.t('Who it’s for') })).toBeVisible();
    },
    written: async (c) => {
      await expect(list(c)).toContainText(c.app.t('Tempo'));
      await expect(list(c)).toContainText(BODY);
      await expect.poll(async () => (await savedNotes(c.app)).map((n) => [n.status, n.preset, n.body])).toEqual([['open', 'tempo', BODY]]);
    },
    noted: async (c) => {
      await expect(notesBar(c.app).getByRole('button', { name: c.app.t('Notes · {count}', { count: 1 }) })).toBeVisible();
      await expect(notesBar(c.app).getByRole('button', { name: c.app.t('To write: {count}', { count: 1 }) })).toHaveCount(0);
    },
    page: async (c) => {
      await expect(liveDialog(c.app)).toHaveCount(0);
      await expect(section(c)).toContainText(c.app.t('Tempo'));
      await expect(section(c)).toContainText(BODY);
      await expect(okButton(c)).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(() => statuses(c)).toEqual(['open']);
      await c.app.check('rehearsal page, a note');
    },
    confirmed: async (c) => {
      await expect(okButton(c)).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => statuses(c)).toEqual(['ok']);
    },
  },
  events: {
    OPEN_LIVE: async (c) => {
      await openWithFocusSongs(c.app, { minutesAgo: 12 });
      await openEvent(c.app, WEEKLY);
      await openLive(c.app);
    },
    MARK: async (c) => notesBar(c.app).getByRole('button', { name: c.app.t('Mark', { context: 'note' }), exact: true }).click(),
    OPEN_NOTES: async (c) => notesBar(c.app).getByRole('button', { name: c.app.t('To write: {count}', { count: 1 }) }).click(),
    WRITE: async (c) => list(c).getByRole('button', { name: c.app.t('Write', { context: 'note' }), exact: true }).click(),
    CANCEL: async (c) => closeSheet(c, editor(c)),
    SAVE: async (c) => {
      await editor(c).getByRole('button', { name: c.app.t('Tempo'), exact: true }).click();
      await editor(c).getByRole('textbox').fill(BODY);
      await editor(c).getByRole('button', { name: c.app.t('Save note') }).click();
      await expect(editor(c)).toHaveCount(0);
    },
    CLOSE: async (c) => closeSheet(c, list(c)),
    EXIT: async (c) => {
      await c.app.button('Exit live mode', { exact: true }).first().click();
      await c.app.settle();
    },
    OK: async (c) => okButton(c).click(),
    REOPEN: async (c) => okButton(c).click(),
  },
});
