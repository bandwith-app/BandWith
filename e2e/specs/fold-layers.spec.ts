import type { Locator } from '@playwright/test';
import { test, expect, type App } from '../fixtures';
import { escapeRe, eventDetail, isWide, leaveBand, openCreate, openEvent, SEED } from '../support/flows';
import { hubRow, openHub, openHubPage } from '../support/hub';
import { DUO_KEYBOARD_DECK_H, focusedField, showKeyboard } from '../support/keyboard';

/**
 * Layers that must work on special layouts.
 *
 * - @laptop (Duo in Laptop pose only): the Create layers keep every control
 *   off the fold band (app.check measures it). Known open bug on main:
 *   member "Log personal gig" (its venue search) and the rehearsal wizard
 *   put controls on it.
 * - iPad composers: the location field suggests venues while typing
 *   (reported on device; passes here with the stubbed place search).
 */

const venueSuggestion = (app: App, q: string) => app.page.getByRole('option', { name: new RegExp(`${q} Studios`) });

test.describe('Duo Laptop pose: nothing on the fold', () => {
  test.describe('member', () => {
    test.use({ role: 'member' });

    test('@laptop Log personal gig and its venue search stay off the fold', async ({ app }) => {
      await openCreate(app, 'Add personal gig');
      await app.check('Log personal gig');
      // The field's placeholder changed in #180 ("Search venue…").
      const venue = app.page
        .getByPlaceholder(app.t('Search venue…'))
        .or(app.page.getByPlaceholder(app.t('Search venue or location...')))
        .filter({ visible: true })
        .first();
      await venue.click();
      await venue.fill('Blackbox');
      await expect(venueSuggestion(app, 'Blackbox').first()).toBeVisible();
      await app.check('Log personal gig: venue search');
    });

    test('@laptop Propose rehearsal stays off the fold', async ({ app }) => {
      await openCreate(app, 'Propose rehearsal');
      await expect(app.page.getByPlaceholder(app.t('e.g. Practice new setlist transitions'))).toBeVisible();
      await app.check('Propose rehearsal');
    });
  });

  test('@laptop the rehearsal wizard stays off the fold', async ({ app }) => {
    await openCreate(app, 'New rehearsal');
    await app.check('rehearsal wizard');
  });

  test('@laptop the poll builder stays off the fold', async ({ app }) => {
    await openCreate(app, 'New rehearsal');
    await app.page.getByRole('radio', { name: app.t('Poll availability') }).click();
    await expect(app.page.getByPlaceholder(app.t('e.g. Extra rehearsal before the wedding'))).toBeVisible();
    await app.check('poll builder');
  });

  test('@laptop the Create menu and the gig wizard stay off the fold', async ({ app }) => {
    await app.tab('Create');
    await app.check('Create menu');
    await app.page.getByRole('dialog').last().getByRole('button', { name: new RegExp(`^${app.t('New gig')}`, 'i') }).first().click();
    await app.check('gig wizard');
  });
});

test.describe('Duo Laptop pose: screens off the fold', () => {
  test('@laptop Stage mode: no setlist row rests on the fold', async ({ app }) => {
    await openEvent(app, SEED.gigToday);
    await app.page.getByRole('button', { name: app.t('Open stage mode'), exact: true }).filter({ visible: true }).first().click();
    await expect(app.page.getByRole('button', { name: new RegExp(`^${app.t('Go to')} `) }).first()).toBeVisible();
    // Laptop pose: the floor wedge covers Stage mode, also when the gig was
    // opened over a hub (search, Calendar).
    await expect(app.page.getByRole('region', { name: app.t('Song controls') })).toBeVisible();
    await app.check('Stage mode');
  });

  test('@laptop Deputy gigs: the reply field is off the fold', async ({ app }) => {
    await leaveBand(app, true);
    await expect(app.page.getByRole('textbox').filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await app.check('Deputy gigs');
  });

  test('@laptop onboarding: "What brings you here?" keeps its path cards off the fold', async ({ app }) => {
    await leaveBand(app, false);
    await expect(app.page.getByRole('radio', { name: new RegExp(app.t('Manage my band')) })).toBeVisible({ timeout: 30_000 });
    await app.check('What brings you here?');
  });

  test.describe('signed out', () => {
    test.use({ autoOpen: false });

    test('@laptop Create account: no field or Show password on the fold', async ({ app }) => {
      await app.page.addInitScript(() => localStorage.removeItem('bw-demo-session'));
      await app.page.goto('/');
      await app.page.getByRole('button', { name: app.t('Get started'), exact: true }).click();
      await expect(app.page.getByRole('heading', { name: new RegExp(app.t('Create account'), 'i') }).first()).toBeVisible();
      await app.check('Create account');
    });
  });
});

/**
 * Laptop pose with the keyboard up: the web view ends at the keyboard but the
 * fold stays where it is, so only a strip of the Deck is left above the keys.
 * The field being typed in rests there (or on the Display), never on the fold
 * band or under a pinned header (seen on the Duo simulator: Deputy gigs'
 * message field at y 418–488, inside the fold band).
 */
test.describe('Duo Laptop pose: the field being typed in stays in sight', () => {
  async function typeOnDeck(app: App, field: Locator, fold: { top: number; bottom: number }, scrolledTo?: number, height?: number) {
    const kb = await showKeyboard(app, field, { scrolledTo, height });
    // On the Deck strip between the fold band and the keys; a field taller
    // than that strip (a long text box) rests whole on the Display instead.
    const rests = async () => {
      const at = await focusedField(app);
      expect(at, 'a focused field').not.toBeNull();
      const where = `field at ${at!.top}–${at!.bottom}, fold ${fold.top}–${fold.bottom}, keyboard from ${at!.viewH}`;
      const onDeck = at!.top >= fold.bottom && at!.bottom <= at!.viewH;
      const tall = at!.bottom - at!.top > at!.viewH - fold.bottom;
      const onDisplay = at!.top >= 0 && at!.bottom <= fold.top;
      expect(onDeck || (tall && onDisplay), where).toBe(true);
      expect(at!.shows, `nothing covers the field (${where})`).toBe(true);
    };
    await rests();
    await field.pressSequentially('See you there');
    await expect(field).toHaveValue(/See you there/);
    await rests();
    await kb.hide();
  }

  test('@laptop Deputy gigs: the message to the band stays on the Deck while typing', async ({ app, duo }) => {
    await leaveBand(app, true);
    const note = app.page.getByPlaceholder(app.t('e.g. I can bring my own amp')).filter({ visible: true }).first();
    await expect(note).toBeVisible({ timeout: 30_000 });
    await app.settle();
    // Where iOS's own focus scroll left it on the simulator: on the fold.
    await typeOnDeck(app, note, duo!.foldBand!, 418);
    await app.check('Deputy gigs after typing');
  });

  test('@laptop Deputy gigs over the app: the message stays clear of the pinned header', async ({ app, duo }) => {
    await openHubPage(app, 'Deputy gigs');
    const note = app.page.getByPlaceholder(app.t('e.g. I can bring my own amp')).filter({ visible: true }).first();
    await typeOnDeck(app, note, duo!.foldBand!, 418);
    await app.check('Deputy gigs (in the app) after typing');
  });

  test('@laptop Create contract: a field stays on the Deck while typing', async ({ app, duo }) => {
    await openEvent(app, SEED.gigToday);
    const row = eventDetail(app).getByRole('button', { name: new RegExp(app.t('No contract yet')) });
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await app.settle();
    await expect(app.page.getByRole('heading', { name: app.t('Create contract'), exact: true })).toBeVisible();
    const fields = app.page.locator('.bw-fold-form input:visible, .bw-fold-form textarea:visible');
    await expect(fields.first()).toBeVisible();
    await typeOnDeck(app, fields.first(), duo!.foldBand!);
    await typeOnDeck(app, fields.last(), duo!.foldBand!);
    await app.check('Create contract after typing');
  });

  test('@laptop the gig wizard: a field stays on the Deck while typing', async ({ app, duo }) => {
    await app.tab('Create');
    await app.page.getByRole('dialog').last().getByRole('button', { name: new RegExp(`^${app.t('New gig')}`, 'i') }).first().click();
    await app.settle();
    const fields = app.page.locator('.bw-fold-form input[type="text"]:visible, .bw-fold-form input:not([type]):visible, .bw-fold-form textarea:visible');
    await expect(fields.first()).toBeVisible();
    await typeOnDeck(app, fields.first(), duo!.foldBand!);
    await app.check('gig wizard after typing');
  });

  /**
   * The EV Duo simulator's keyboard covers the whole Deck: the web view ends
   * at the fold (456 pt), so a hub's pinned header (it holds the Display)
   * covered the whole view and the field had nowhere to rest (Deputy gigs'
   * message at 850–920, hidden). The field rests on the Display instead.
   */
  test.describe('keyboard over the whole Deck', () => {
    async function typeOnDisplay(app: App, field: Locator, fold: { top: number; bottom: number }, backInSight = true) {
      await typeOnDeck(app, field, fold, undefined, DUO_KEYBOARD_DECK_H);
      // The rail's search field closes with the keyboard.
      if (!backInSight) return;
      // Keyboard down: the header is pinned again and the field is back in
      // sight, not left under it.
      const after = await field.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + Math.min(24, r.width / 2), (r.top + r.bottom) / 2);
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), shows: !!at && (at === el || el.contains(at)) };
      });
      expect(after.shows, `the field shows after the keyboard closes (${after.top}–${after.bottom})`).toBe(true);
    }
    // A hub row further down: scrolled onto the Deck (under the pinned
    // header, above the Deck bar) and tapped there, as a person does.
    async function openLowerHubPage(app: App, source: string, deckTop: number) {
      await openHub(app);
      const row = hubRow(app, source);
      await row.evaluate((el, y) => {
        let s = el.parentElement;
        while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement;
        if (s) s.scrollTop += el.getBoundingClientRect().top - y;
      }, deckTop + 24);
      await row.click();
      await app.settle();
    }

    test('@laptop Deputy gigs over the app: the message rests on the Display', async ({ app, duo }) => {
      await openHubPage(app, 'Deputy gigs');
      const note = app.page.getByPlaceholder(app.t('e.g. I can bring my own amp')).filter({ visible: true }).first();
      await typeOnDisplay(app, note, duo!.foldBand!);
      await app.check('Deputy gigs (in the app) after typing, keyboard over the Deck');
    });

    test('@laptop Account hub: the band details rest on the Display', async ({ app, duo }) => {
      await openHub(app);
      await app.page.getByRole('region', { name: app.t('Current band') }).getByRole('button', { name: app.t('Edit'), exact: true }).click();
      const name = app.page.locator('#hub-band-name');
      await expect(name).toBeVisible();
      await typeOnDisplay(app, name, duo!.foldBand!);
      await typeOnDisplay(app, app.page.locator('#hub-band-bio'), duo!.foldBand!);
      await app.check('Account hub band details after typing, keyboard over the Deck');
    });

    // On the Duo a hub's search lives in the rail (Duo/Rail Search Field).
    for (const [page, label, placeholder] of [
      ['Gear & inventory', 'Search equipment', 'Search equipment, mics, cables…'],
      ['Contracts & docs', 'Search documents', 'Search by title, client or event…'],
    ] as const) {
      test(`@laptop ${page}: the search field rests on the Display`, async ({ app, duo }) => {
        await openLowerHubPage(app, page, duo!.foldBand!.bottom);
        await app.page.getByRole('button', { name: app.t(label), exact: true }).filter({ visible: true }).first().click();
        const search = app.page.getByPlaceholder(app.t(placeholder)).filter({ visible: true }).first();
        await expect(search).toBeVisible();
        await typeOnDisplay(app, search, duo!.foldBand!, false);
        await app.check(`${page} search after typing, keyboard over the Deck`);
      });
    }

    test('@laptop Gear & inventory: Add equipment rests on the Display', async ({ app, duo }) => {
      await openLowerHubPage(app, 'Gear & inventory', duo!.foldBand!.bottom);
      await app.page.getByRole('button', { name: app.t('Add equipment'), exact: true }).filter({ visible: true }).first().click();
      const name = app.page.getByPlaceholder(app.t('e.g. Vocal mic, drum kit, DI box')).filter({ visible: true }).first();
      await expect(name).toBeVisible();
      await typeOnDisplay(app, name, duo!.foldBand!);
      await app.check('Add equipment after typing, keyboard over the Deck');
    });

    test('@laptop Members: the invite search rests on the Display', async ({ app, duo }) => {
      await openHub(app);
      await app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Members'))} \\(\\d+\\)`) }).first().click();
      await app.settle();
      await app.page.getByRole('button', { name: app.t('Invite member') }).filter({ visible: true }).first().click();
      const search = app.page.getByPlaceholder(app.t('Name or email address…')).filter({ visible: true }).first();
      await expect(search).toBeVisible();
      await typeOnDisplay(app, search, duo!.foldBand!);
      await app.check('Invite member after typing, keyboard over the Deck');
    });
  });

  test.describe('signed out', () => {
    test.use({ autoOpen: false });
    test.beforeEach(async ({ app }) => {
      await app.page.addInitScript(() => localStorage.removeItem('bw-demo-session'));
      await app.page.goto('/');
    });

    test('@laptop Sign in: email and password stay on the Deck while typing', async ({ app, duo }) => {
      await app.button('Sign in').first().click();
      const email = app.page.getByPlaceholder('you@yourband.com');
      await expect(email).toBeVisible();
      await typeOnDeck(app, email, duo!.foldBand!);
      await typeOnDeck(app, app.page.getByPlaceholder(app.t('Your password')), duo!.foldBand!);
      await app.check('Sign in after typing');
    });

    test('@laptop Create account: every field stays on the Deck while typing', async ({ app, duo }) => {
      await app.page.getByRole('button', { name: app.t('Get started'), exact: true }).click();
      const name = app.page.getByPlaceholder(app.t('Your name'));
      await expect(name).toBeVisible();
      await typeOnDeck(app, name, duo!.foldBand!);
      await typeOnDeck(app, app.page.getByPlaceholder('you@email.com'), duo!.foldBand!);
      await typeOnDeck(app, app.page.getByPlaceholder(app.t('Password'), { exact: true }), duo!.foldBand!);
      await app.check('Create account after typing');
    });
  });
});

test.describe('iPad composers', () => {
  test.beforeEach(async ({ app }) => {
    test.skip(!(await isWide(app)), 'one-screen composers are a tablet layout');
  });

  test('gig composer: the venue field suggests venues while typing', async ({ app }) => {
    await openCreate(app, 'New gig');
    const venue = app.page.getByPlaceholder(app.t('Search venue or location...')).filter({ visible: true }).first();
    await venue.fill('Blackbox');
    await expect(venueSuggestion(app, 'Blackbox').first()).toBeVisible();
    await venueSuggestion(app, 'Blackbox').first().click();
    await expect(venue).toHaveValue(/Blackbox Studios/);
    await app.check('gig composer venue');
  });

  test('rehearsal composer: the venue field suggests venues while typing', async ({ app }) => {
    await openCreate(app, 'New rehearsal');
    const venue = app.page.getByPlaceholder(app.t('Search venue or studio…')).filter({ visible: true }).first();
    await venue.fill('Blackbox');
    await expect(venueSuggestion(app, 'Blackbox').first()).toBeVisible();
    await app.check('rehearsal composer venue');
  });
});
