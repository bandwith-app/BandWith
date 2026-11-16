import { test, expect, type App } from '../fixtures';
import { escapeRe, isWide, openCreate, systemBack } from '../support/flows';

/**
 * Create wizards (gig, quote, rehearsal): leaving one half-way with
 * something typed asks Save draft / Discard / Keep editing. Save draft puts
 * it under Drafts on Home; Discard leaves nothing behind. Leaving an
 * untouched wizard just closes it.
 */

interface Wizard {
  kind: 'gig' | 'quote' | 'rehearsal';
  item: string;
  title: string;
  close: string;
}

const WIZARDS: Wizard[] = [
  { kind: 'gig', item: 'New gig', title: 'New gig', close: 'Close gig wizard' },
  { kind: 'quote', item: 'New quote', title: 'Client full name', close: 'Close quote wizard' },
  { kind: 'rehearsal', item: 'New rehearsal', title: 'Rehearsal title (optional)', close: 'Close rehearsal wizard' },
];

const leaveSheet = (app: App, w: Wizard) =>
  app.page.getByRole('dialog').filter({ hasText: app.t(`Save this ${w.kind} as a draft?`) });

/** The wizard's first text field, by placeholder or label (the composer labels it). */
const titleField = (app: App, w: Wizard) =>
  app.page
    .getByPlaceholder(app.t(w.title))
    .or(app.page.getByRole('textbox', { name: app.t(w.title), exact: true }))
    .filter({ visible: true })
    .first();

async function startAndType(app: App, w: Wizard, text: string) {
  await openCreate(app, w.item);
  await titleField(app, w).fill(text);
  // Half-way: the next step on phones (tablets compose on one screen).
  if (!(await isWide(app))) {
    await app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('NEXT'))}$`, 'i') }).filter({ visible: true }).last().click();
    await app.settle();
  }
}

const closeWizard = (app: App, w: Wizard) =>
  app.page.getByRole('button', { name: app.t(w.close), exact: true }).filter({ visible: true }).first().click();

for (const w of WIZARDS) {
  test.describe(`${w.kind} wizard`, () => {
    test(`✕ half-way asks; Keep editing returns; Save draft puts it under Drafts`, async ({ app }) => {
      const name = `Harbour ${w.kind} draft`;
      await startAndType(app, w, name);
      await closeWizard(app, w);
      await expect(leaveSheet(app, w)).toBeVisible();
      await app.check(`${w.kind}: save as draft?`);

      await leaveSheet(app, w).getByRole('button', { name: app.t('Keep editing'), exact: true }).last().click();
      await expect(leaveSheet(app, w)).toBeHidden();
      await expect(app.page.getByRole('button', { name: app.t(w.close), exact: true }).filter({ visible: true }).first()).toBeVisible();

      // System Back never loses what was typed: it asks right away (gig,
      // quote) or goes one step back with the text kept and asks on step 1
      // (rehearsal).
      await systemBack(app);
      await app.settle();
      if (!(await leaveSheet(app, w).isVisible())) {
        await expect(titleField(app, w), 'system Back keeps the text').toHaveValue(name);
        await systemBack(app);
      }
      await expect(leaveSheet(app, w), 'system Back asks too').toBeVisible();
      await leaveSheet(app, w).getByRole('button', { name: app.t('Save draft'), exact: true }).click();
      await expect(leaveSheet(app, w)).toBeHidden();
      await app.settle();
      await app.tab('Home');
      await expect(app.page.getByRole('button', { name: new RegExp(escapeRe(name), 'i') }).first()).toBeVisible();
      await app.check(`${w.kind}: draft on Home`);
    });

    test('Discard leaves nothing behind', async ({ app }) => {
      const name = `Discarded ${w.kind}`;
      await startAndType(app, w, name);
      await closeWizard(app, w);
      await leaveSheet(app, w).getByRole('button', { name: app.t('Discard'), exact: true }).click();
      await expect(leaveSheet(app, w)).toBeHidden();
      await expect(app.page.getByRole('button', { name: app.t(w.close), exact: true })).toHaveCount(0);
      await app.tab('Home');
      await expect(app.page.getByText(name)).toHaveCount(0);
    });

    test('an untouched wizard just closes', async ({ app }) => {
      await openCreate(app, w.item);
      await closeWizard(app, w);
      await expect(app.page.getByRole('button', { name: app.t(w.close), exact: true })).toHaveCount(0);
      await expect(leaveSheet(app, w)).toHaveCount(0);
    });
  });
}
