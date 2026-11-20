import { test, expect } from '../fixtures';
import { openEvent, eventDetail, systemBack, SEED } from '../support/flows';
import {
  EVENT_IDS,
  editSheet,
  lineupList,
  openEditor,
  saveSheet,
  sectionEdit,
  showGigSetlist,
} from '../support/event';

/**
 * #178: an admin edits a band gig or rehearsal card by card, right in its
 * overview. Every editor saves through the same services as before and the
 * overview shows the new value at once, without leaving the event.
 */

test.describe('admin edits a gig from its overview', () => {
  test.beforeEach(async ({ app }) => {
    await openEvent(app, SEED.gigToday);
  });

  test('gigs have no bottom Edit button: every card has its own editor', async ({ app }) => {
    const detail = eventDetail(app);
    await expect(detail.getByRole('button', { name: app.t('Edit title, date & times') }).first()).toBeVisible();
    await expect(detail.getByRole('button', { name: app.t('Edit venue') })).toBeVisible();
    await expect(detail.getByRole('button', { name: app.t('Edit fee') })).toBeVisible();
    await expect(sectionEdit(app, 'LINEUP')).toBeVisible();
    await expect(detail.getByRole('button', { name: app.t('EDIT'), exact: true })).toHaveCount(0);
    await app.check('gig overview (admin)');
  });

  test('hero pencil: a new title shows on the overview at once', async ({ app }) => {
    const sheet = await openEditor(
      app,
      eventDetail(app).getByRole('button', { name: app.t('Edit title, date & times'), exact: true }).first(),
      'Title, date & times',
    );
    await app.check('title, date & times sheet');
    await sheet.getByLabel(app.t('Event title')).fill('Rooftop Session XL');
    await saveSheet(app, sheet);
    await expect(eventDetail(app).getByRole('heading', { name: /Rooftop Session XL/i }).first()).toBeVisible();
    const db = await app.readDb();
    expect(db.events.find((e) => e.id === EVENT_IDS.rooftop)?.title).toBe('Rooftop Session XL');
  });

  test('time tiles open the same title, date & times editor', async ({ app }) => {
    const tile = eventDetail(app).getByRole('button', { name: new RegExp(`${app.t('Edit date & times')}$`) }).first();
    await openEditor(app, tile, 'Title, date & times');
    await expect(editSheet(app, 'Title, date & times').getByLabel(app.t('Event title'))).toHaveValue(SEED.gigToday);
  });

  test('venue pencil: the new address shows on the overview at once', async ({ app }) => {
    const sheet = await openEditor(app, eventDetail(app).getByRole('button', { name: app.t('Edit venue') }), 'Venue & location');
    await app.check('venue sheet');
    await sheet.getByLabel(app.t('Address')).fill('Via Roma 1');
    await sheet.getByLabel(app.t('City'), { exact: true }).fill('Bergamo');
    await saveSheet(app, sheet);
    await expect(eventDetail(app).getByText(/Via Roma 1/i).first()).toBeVisible();
  });

  test('lineup: unticking yourself takes you off the lineup', async ({ app }) => {
    await expect(lineupList(app)).toContainText(SEED.me, { ignoreCase: true });
    const sheet = await openEditor(app, sectionEdit(app, 'LINEUP'), 'Lineup');
    await app.check('lineup sheet');
    const me = sheet.getByRole('checkbox', { name: SEED.me, exact: true });
    await expect(me).toHaveAttribute('aria-checked', 'true');
    await me.click();
    await expect(me).toHaveAttribute('aria-checked', 'false');
    await saveSheet(app, sheet);
    await expect(lineupList(app)).not.toContainText(SEED.me, { ignoreCase: true });
    await expect(lineupList(app)).toContainText(SEED.members[0], { ignoreCase: true });
    const db = await app.readDb();
    const rows = db.event_members.filter((m) => m.event_id === EVENT_IDS.rooftop);
    expect(rows.map((r) => r.user_id)).not.toContain('10000001-0000-4000-8000-000000000001');
    expect(rows).toHaveLength(4);
  });

  test('lineup: an empty lineup never invites the whole band', async ({ app }) => {
    const before = (await app.readDb()).notifications.length;
    const sheet = await openEditor(app, sectionEdit(app, 'LINEUP'), 'Lineup');
    for (const name of [SEED.me, ...SEED.members]) {
      const box = sheet.getByRole('checkbox', { name, exact: true });
      await box.click();
      await expect(box).toHaveAttribute('aria-checked', 'false');
    }
    const save = sheet.getByRole('button', { name: app.t('Save'), exact: true });
    if (await save.isEnabled()) {
      await save.click();
      await expect(sheet).toBeHidden();
      await app.settle();
      await expect(eventDetail(app).getByText(app.t('No musicians added yet'))).toBeVisible();
      const db = await app.readDb();
      expect(db.event_members.filter((m) => m.event_id === EVENT_IDS.rooftop)).toHaveLength(0);
      // Nobody got an invitation for it.
      const invites = db.notifications
        .slice(before)
        .filter((n) => n.type === 'event_invite');
      expect(invites).toHaveLength(0);
    } else {
      // Refusing the save is fine too: the saved lineup stays as it was.
      await sheet.getByRole('button', { name: app.t('Cancel'), exact: true }).click();
      const db = await app.readDb();
      expect(db.event_members.filter((m) => m.event_id === EVENT_IDS.rooftop)).toHaveLength(5);
    }
  });

  test('lineup: Duo preset keeps you and one more musician', async ({ app }) => {
    const sheet = await openEditor(app, sectionEdit(app, 'LINEUP'), 'Lineup');
    await sheet.getByRole('button', { name: app.t('Duo'), exact: true }).click();
    const ticked = async () => {
      let n = 0;
      for (const name of [SEED.me, ...SEED.members]) {
        if ((await sheet.getByRole('checkbox', { name, exact: true }).getAttribute('aria-checked')) === 'true') n++;
      }
      return n;
    };
    await expect.poll(ticked).toBe(2);
    await expect(sheet.getByRole('checkbox', { name: SEED.me, exact: true })).toHaveAttribute('aria-checked', 'true');
    await saveSheet(app, sheet);
    const db = await app.readDb();
    expect(db.event_members.filter((m) => m.event_id === EVENT_IDS.rooftop)).toHaveLength(2);
    await expect(lineupList(app)).toContainText(SEED.me, { ignoreCase: true });
    await expect(lineupList(app)).not.toContainText(SEED.members[3], { ignoreCase: true });
  });

  test('lineup: a musician’s fee is saved and the payouts follow', async ({ app }) => {
    const sheet = await openEditor(app, sectionEdit(app, 'LINEUP'), 'Lineup');
    await sheet.getByLabel(app.t('Fee for {name}', { name: 'Marta C.' })).fill('400');
    await saveSheet(app, sheet);
    // Payouts were 5 musicians: 300 + 4 × 250 = 1,300.
    await expect(eventDetail(app).getByText('€1,450').first()).toBeVisible();
    const db = await app.readDb();
    const marta = db.event_members.find((m) => m.event_id === EVENT_IDS.rooftop && m.user_id === '10000002-0000-4000-8000-000000000002');
    expect(Number(marta?.fee)).toBe(400);
  });

  test('fee pencil: extra band fee shows as the band fund at once', async ({ app }) => {
    await expect(eventDetail(app).getByText('€500').first()).toBeVisible();
    const sheet = await openEditor(app, eventDetail(app).getByRole('button', { name: app.t('Edit fee') }), 'Edit fee');
    await app.check('fee sheet');
    await sheet.getByLabel(app.t('Extra band fee / services')).fill('700');
    await saveSheet(app, sheet);
    await expect(eventDetail(app).getByText('€700').first()).toBeVisible();
    const db = await app.readDb();
    expect(Number(db.events.find((e) => e.id === EVENT_IDS.rooftop)?.fee)).toBe(2000);
  });

  test('fee pencil: member fees change the payouts', async ({ app }) => {
    const sheet = await openEditor(app, eventDetail(app).getByRole('button', { name: app.t('Edit fee') }), 'Edit fee');
    await sheet.getByLabel(app.t('Fee for {name}', { name: 'Sam O.' })).fill('300');
    await saveSheet(app, sheet);
    await expect(eventDetail(app).getByText('€1,350').first()).toBeVisible();
  });

  test('fee pencil: fee to be discussed (TBD)', async ({ app }) => {
    const sheet = await openEditor(app, eventDetail(app).getByRole('button', { name: app.t('Edit fee') }), 'Edit fee');
    await sheet.getByRole('button', { name: app.t('Fee to be discussed (TBD)') }).click();
    await expect(sheet.getByText(app.t('TBD'), { exact: true })).toBeVisible();
    await saveSheet(app, sheet);
    await expect(eventDetail(app).getByText(app.t('To be discussed'), { exact: true })).toBeVisible();
  });

  test('setlist: loading a template replaces the songs once saved', async ({ app }) => {
    await showGigSetlist(app);
    const detail = eventDetail(app);
    await detail.getByRole('button', { name: app.t('Templates'), exact: true }).click();
    await detail.getByRole('button', { name: /Wedding — dinner \+ party/i }).click();
    await expect(detail.getByRole('button', { name: 'Reorder I Wish' })).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Reorder Superstition' })).toHaveCount(0);
    await app.page.getByRole('button', { name: app.t('Save'), exact: true }).last().click();
    await app.settle();
    const db = await app.readDb();
    const setlistId = db.events.find((e) => e.id === EVENT_IDS.rooftop)?.setlist_id;
    const songs = db.setlist_songs.filter((s) => s.setlist_id === setlistId);
    expect(songs).toHaveLength(8);
    await expect(detail.getByRole('button', { name: 'Reorder I Wish' })).toBeVisible();
    await expect(app.page.getByRole('button', { name: app.t('Save'), exact: true })).toHaveCount(0);
  });

  test('setlist: removing a song is saved', async ({ app }) => {
    await showGigSetlist(app);
    const detail = eventDetail(app);
    await detail.getByRole('button', { name: app.t('Remove song') }).first().click();
    await expect(detail.getByRole('button', { name: 'Reorder Superstition' })).toHaveCount(0);
    await app.page.getByRole('button', { name: app.t('Save'), exact: true }).last().click();
    await app.settle();
    const db = await app.readDb();
    const setlistId = db.events.find((e) => e.id === EVENT_IDS.rooftop)?.setlist_id;
    expect(db.setlist_songs.filter((s) => s.setlist_id === setlistId)).toHaveLength(9);
  });

  test('to-dos: load a to-do list, then add one by hand', async ({ app }) => {
    let sheet = await openEditor(app, sectionEdit(app, 'TASKS'), 'Tasks');
    await app.check('tasks sheet');
    await sheet.getByRole('button', { name: /Wedding day checklist/i }).click();
    await expect(sheet.getByLabel(app.t('Task {number}', { number: 6 }))).toHaveValue('Send final invoice');
    await saveSheet(app, sheet);
    await expect(eventDetail(app).getByText('Contract signed')).toBeVisible();
    await expect(eventDetail(app).getByText(app.t('{done} of {total} done', { done: 0, total: 6 }), { exact: false }).first()).toBeVisible();

    sheet = await openEditor(app, sectionEdit(app, 'TASKS'), 'Tasks');
    await sheet.getByPlaceholder(app.t('Add a preparation task...')).fill('Print the setlist');
    await sheet.getByRole('button', { name: app.t('Add'), exact: true }).click();
    await saveSheet(app, sheet);
    await expect(eventDetail(app).getByText('Print the setlist')).toBeVisible();
  });

  test('client & notes: new client and notes show at once', async ({ app }) => {
    const sheet = await openEditor(app, sectionEdit(app, 'CLIENT & NOTES'), 'Client & notes');
    await app.check('client & notes sheet');
    await sheet.getByLabel(app.t('Client / promoter')).fill('Aurora Group');
    await sheet.getByLabel(app.t('Notes for the band')).fill('Lift to the roof is behind the bar.');
    await saveSheet(app, sheet);
    await expect(eventDetail(app).getByText(/Aurora Group/i)).toBeVisible();
    await expect(eventDetail(app).getByText('Lift to the roof is behind the bar.')).toBeVisible();
  });
});

test.describe('admin edits a rehearsal from its overview', () => {
  test.beforeEach(async ({ app }) => {
    await openEvent(app, SEED.rehearsalTomorrow);
  });

  test('rehearsals have no bottom Edit button', async ({ app }) => {
    await expect(sectionEdit(app, 'STUDIO COST')).toBeVisible();
    await expect(eventDetail(app).getByRole('button', { name: app.t('EDIT'), exact: true })).toHaveCount(0);
    await app.check('rehearsal overview (admin)');
  });

  test('studio cost: paid, then free again', async ({ app }) => {
    let sheet = await openEditor(app, sectionEdit(app, 'STUDIO COST'), 'Studio cost');
    await app.check('studio cost sheet');
    await sheet.getByRole('radio', { name: app.t('Paid') }).or(sheet.getByRole('button', { name: app.t('Paid'), exact: true })).first().click();
    await sheet.getByRole('spinbutton').fill('120');
    await saveSheet(app, sheet);
    await expect(eventDetail(app).getByText('€120').first()).toBeVisible();
    await expect(eventDetail(app).getByText(app.t('Split between {count} going', { count: 5 }))).toBeVisible();

    sheet = await openEditor(app, sectionEdit(app, 'STUDIO COST'), 'Studio cost');
    await sheet.getByRole('radio', { name: app.t('Free') }).or(sheet.getByRole('button', { name: app.t('Free'), exact: true })).first().click();
    await saveSheet(app, sheet);
    await expect(eventDetail(app).getByText('€120')).toHaveCount(0);
  });

  test('roster: you can untick yourself, but not everyone', async ({ app }) => {
    const sheet = await openEditor(app, sectionEdit(app, 'ATTENDANCE'), 'Band roster');
    for (const name of [SEED.me, ...SEED.members]) await sheet.getByRole('checkbox', { name, exact: true }).click();
    // A rehearsal for nobody isn't one.
    await expect(sheet.getByRole('button', { name: app.t('Save'), exact: true })).toBeDisabled();
    await sheet.getByRole('checkbox', { name: SEED.members[0], exact: true }).click();
    await saveSheet(app, sheet);
    await expect(lineupList(app)).not.toContainText(SEED.me, { ignoreCase: true });
    const db = await app.readDb();
    expect(db.event_members.filter((m) => m.event_id === EVENT_IDS.weeklyRehearsal)).toHaveLength(1);
  });

  test('focus songs: loading a template is saved and shown on the overview', async ({ app }) => {
    await sectionEdit(app, 'FOCUS SONGS').click();
    const sheet = app.page.getByRole('dialog').last();
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: /Rooftop set/i }).click();
    await expect(sheet.getByRole('button', { name: 'Reorder Superstition' })).toBeVisible();
    await sheet.getByRole('button', { name: app.t('Save'), exact: true }).click();
    await app.settle();
    // Back on the overview, the focus songs are the template's.
    await app.page.keyboard.press('Escape');
    await app.settle();
    await expect(eventDetail(app).getByRole('button', { name: 'Superstition', exact: true })).toBeVisible();
  });

  test('to-dos: rename one and delete another', async ({ app }) => {
    const sheet = await openEditor(app, sectionEdit(app, 'TASKS'), 'Tasks');
    await sheet.getByLabel(app.t('Task {number}', { number: 1 })).fill('Learn horn lines for "Superstition"');
    await sheet.getByRole('button', { name: app.t('Delete task') }).nth(1).click();
    await saveSheet(app, sheet);
    await expect(eventDetail(app).getByText('Learn horn lines for "Superstition"')).toBeVisible();
    await expect(eventDetail(app).getByText('Bring the new in-ear mixer')).toHaveCount(0);
  });

  test('notes: rehearsal notes are editable and show at once', async ({ app }) => {
    const sheet = await openEditor(app, sectionEdit(app, 'NOTES'), 'Notes');
    await sheet.getByLabel(app.t('Notes for the band')).fill('Bring in-ears; we record the run-through.');
    await saveSheet(app, sheet);
    await expect(eventDetail(app).getByText('Bring in-ears; we record the run-through.')).toBeVisible();
  });
});

test('a personal gig keeps its Edit button', async ({ app }) => {
  await openEvent(app, SEED.personal);
  await expect(eventDetail(app).getByRole('button', { name: app.t('EDIT'), exact: true })).toBeVisible();
  await expect(eventDetail(app).getByRole('button', { name: app.t('Edit venue') })).toHaveCount(0);
});

test.describe('Show readiness (admin)', () => {
  test('"No contract yet" opens Contracts & docs with a new contract for the gig', async ({ app }) => {
    await openEvent(app, SEED.gigToday);
    const row = eventDetail(app).getByRole('button', { name: new RegExp(app.t('No contract yet')) });
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await app.settle();
    // The new-contract form, filled in for this gig.
    await expect(app.page.getByRole('heading', { name: app.t('Create contract'), exact: true })).toBeVisible();
    const values = () => app.page.locator('input').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value));
    await expect.poll(values).toContain(`${app.t('Performance agreement')} · ${SEED.gigToday}`);
    await expect.poll(values).toContain(SEED.clients[0]);
    await app.check('new contract for the gig');
  });

  // Emulator pass 11-16 (iPad landscape): the form scrolled in the top part
  // of the pane and CREATE CONTRACT floated mid-screen over the tab bar's
  // place. Like the other composers: the form fills the pane, the action sits
  // at its bottom edge, the tab bar steps away.
  test('the new contract form fills the pane, its action pinned at the bottom', async ({ app }) => {
    await openEvent(app, SEED.gigToday);
    const row = eventDetail(app).getByRole('button', { name: new RegExp(app.t('No contract yet')) });
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await app.settle();
    await expect(app.page.getByRole('heading', { name: app.t('Create contract'), exact: true })).toBeVisible();
    const create = app.page.getByRole('button', { name: app.t('Create contract'), exact: true });
    const layout = await create.evaluate((button) => {
      const pane = button.closest('.bw-pane-detail') as HTMLElement;
      const scroller = [...pane.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === 'auto') as HTMLElement;
      const nav = document.querySelector('.bw-nav-bar');
      const navBox = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect() : null;
      return {
        pane: pane.getBoundingClientRect().toJSON(),
        button: button.getBoundingClientRect().toJSON(),
        scrollerBottom: scroller.getBoundingClientRect().bottom,
        navOverPane: !!navBox && navBox.height > 0 && navBox.right > pane.getBoundingClientRect().left && navBox.top < innerHeight,
      };
    });
    // The action sits at the bottom of the pane (safe area + 16), not above an empty band.
    expect(layout.pane.bottom - layout.button.bottom, 'gap under CREATE CONTRACT').toBeLessThan(48);
    // The fields scroll down to the action bar.
    expect(layout.button.top - layout.scrollerBottom, 'gap between the fields and the action').toBeLessThan(24);
    expect(layout.navOverPane, 'tab bar over the form').toBe(false);
    await app.check('new contract form');
  });

  // Emulator pass 11-16: Back from Contracts & docs went to the Calendar. It
  // returns to the gig, whichever Back the device has: the screen's own (in
  // the Duo rail on a Duo), or the system Back (Android, Escape).
  for (const how of ['the screen Back', 'the system Back'] as const) {
    test(`@smoke opened from "No contract yet", ${how} returns to the gig`, async ({ app }) => {
      await openEvent(app, SEED.gigToday);
      const row = eventDetail(app).getByRole('button', { name: new RegExp(app.t('No contract yet')) });
      await row.scrollIntoViewIfNeeded();
      await row.click();
      await app.settle();
      const form = app.page.getByRole('heading', { name: app.t('Create contract'), exact: true });
      await expect(form).toBeVisible();
      await app.check('new contract from the gig');
      const hub = app.page.getByRole('heading', { name: app.t('Contracts & docs'), exact: true });
      if (how === 'the screen Back') {
        await app.button('Back', { exact: true }).last().click();
        await app.settle();
        await expect(form).toBeHidden();
        await expect(hub).toBeVisible();
        await app.button('Go back', { exact: true }).last().click();
      } else {
        await systemBack(app);
        await app.settle();
        await expect(form).toBeHidden();
        await expect(hub).toBeVisible();
        await systemBack(app);
      }
      await app.settle();
      await expect(hub).toBeHidden();
      await expect(eventDetail(app)).toBeVisible();
      await expect(eventDetail(app).getByText(SEED.gigToday).first()).toBeVisible();
      await app.check('back on the gig from Contracts & docs');
      // And the gig's own Back still closes it, back to the Calendar.
      if (how === 'the screen Back') {
        await app.button('Back', { exact: true }).last().click();
      } else {
        await systemBack(app);
      }
      await app.settle();
      await expect(eventDetail(app)).toBeHidden();
    });
  }

  // CI 11-20: a gig opened from Calendar's "Search events" (z-70) sent
  // Contracts & docs (a hub page, z-60) under the search: Back from the new
  // contract showed the search results instead of the hub.
  test('@smoke a gig opened from Search: Back from the new contract shows Contracts & docs, not the search', async ({ app }) => {
    await app.tab('Calendar');
    await app.page.getByRole('button', { name: app.t('Search events'), exact: true }).filter({ visible: true }).first().click();
    await app.page.getByPlaceholder(app.t('Search title, venue, city, client…')).filter({ visible: true }).first().fill(SEED.gigToday);
    await app.settle();
    const search = app.page.getByRole('dialog', { name: app.t('Search events') });
    await search.last().getByRole('button', { name: new RegExp(SEED.gigToday, 'i') }).first().click();
    await expect(eventDetail(app)).toBeVisible();
    await app.settle();
    const row = eventDetail(app).getByRole('button', { name: new RegExp(app.t('No contract yet')) });
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await app.settle();
    await expect(app.page.getByRole('heading', { name: app.t('Create contract'), exact: true })).toBeVisible();
    await app.button('Back', { exact: true }).last().click();
    await app.settle();
    const hub = app.page.getByRole('heading', { name: app.t('Contracts & docs'), exact: true });
    await expect(hub).toBeVisible();
    // On top, not under the search: what's drawn at the title is the title.
    const onTop = await hub.evaluate((h) => {
      const r = h.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + Math.min(8, r.width / 2), r.top + r.height / 2);
      return !!el && h.contains(el);
    });
    expect(onTop, 'Contracts & docs is drawn above everything').toBe(true);
    await expect(search).toHaveCount(0);
    await app.button('Go back', { exact: true }).last().click();
    await app.settle();
    await expect(eventDetail(app)).toBeVisible();
    await expect(eventDetail(app).getByText(SEED.gigToday).first()).toBeVisible();
    await app.check('back on the gig opened from Search');
  });
});
