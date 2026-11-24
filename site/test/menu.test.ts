/**
 * The menu (2026-11): "The index" on wide screens, an accordion on the phone
 * sheet, one information architecture for both.
 * - Three verbs in the order of a band's week, then "Built in"; the pages
 *   keep their names.
 * - Desktop panel: every page and its one-liner in the markup (nothing waits
 *   for a hover), a button with aria-expanded, no preview image.
 * - Sheet: account first, the four groups as an accordion, three chips, the
 *   language last, the app pinned under the scroll area.
 * Behaviour (open, close, keyboard, focus, current page): e2e/site/menu.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { CHANNELS, GROUPS, MENU, bySlug, channelsOf } from '../src/content/features';
import { GENERATED } from '../src/content/render';
import { PAGES as FILES, englishPage } from '../tools/pages';
import { pageMain } from '../src/content/pageRender';
import { it as IT } from '../src/i18n/dict/it';
import { es as ES } from '../src/i18n/dict/es';

const SITE = path.resolve(__dirname, '..');
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('information architecture', () => {
  it('three verbs in the order of a band’s week, then Built in, each with its promise and its pages', () => {
    expect(MENU.map((g) => [g.no, g.name, g.promise, g.slugs.map((s) => bySlug(s)!.name)])).toEqual([
      ['01', 'Book & get paid', 'From the first quote to the last payout.', ['Calendar & gigs', 'Quotes & contracts', 'Fees & payouts']],
      ['02', 'Line up the band', 'One date, the right players, one conversation.', ['Rehearsals & polls', 'Members, deputies & gear', 'Band chat']],
      ['03', 'Play the show', 'The same song on every phone, signal or not.', ['Songs & setlists', 'Stage mode', 'Stage plot & rider']],
      ['Always', 'Built in', 'True on every page above.', ['Privacy by role', 'Every device']],
    ]);
  });

  it('puts every page in exactly one group, and the page knows its group', () => {
    const all = MENU.flatMap((g) => g.slugs);
    expect([...all].sort()).toEqual(CHANNELS.map((c) => c.slug).sort());
    expect(new Set(all).size).toBe(11);
    for (const g of MENU) for (const c of channelsOf(g)) expect(c.group, c.slug).toBe(g.name);
    expect(GROUPS).toEqual(MENU.map((g) => g.name));
  });

  it('a channel hero says what the band is doing, then the page', () => {
    for (const c of CHANNELS) {
      const doc = new JSDOM(`<main>${pageMain(c.slug)}</main>`).window.document;
      expect(text(doc.querySelector('.fhero__ch')), c.slug).toBe(`${c.group}${c.name}`);
      expect(doc.querySelector('.fhero__ch .fhero__of')!.textContent).toBe(c.name);
    }
  });

  it('Italian and Spanish have the groups and their promises', () => {
    for (const g of MENU) for (const [lang, d] of [['it', IT], ['es', ES]] as const) {
      expect(d[g.name], `${lang}: ${g.name}`).toBeTruthy();
      expect(d[g.promise], `${lang}: ${g.promise}`).toBeTruthy();
    }
  });
});

describe('the header and the features panel', () => {
  const doc = new JSDOM(englishPage('features/stage/index.html')).window.document;
  const nav = doc.querySelector('header.nav')!;
  const panel = doc.querySelector('#rack-panel')!;

  it('Features is a button that says whether its panel is open; the deck ends with FAQ', () => {
    const btn = nav.querySelector('[data-rack-btn]')!;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBe('rack-panel');
    expect([...nav.querySelectorAll('.nav__deck .nav__item')].map(text)).toEqual(['Features', 'How it works', 'Guide', 'FAQ']);
    expect(nav.querySelector('.nav__deck a[href="/faq/"]')).not.toBeNull();
  });

  it('keeps the account and the app where they were: Log in, Sign up, Get the app → /get/', () => {
    expect(text(nav.querySelector('.nav__login'))).toBe('Log in');
    expect(text(nav.querySelector('.nav__signup[data-web-door]'))).toMatch(/^Sign up/);
    expect(nav.querySelector('.nav__cta')!.getAttribute('href')).toBe('/get/');
    expect(text(nav.querySelector('.nav__cta'))).toMatch(/^Get the app/);
  });

  it('shows the four groups as columns, every page a link with its one-liner, in the menu’s order', () => {
    expect(panel.hasAttribute('hidden')).toBe(true);
    const cols = [...panel.querySelectorAll('.mm__cols > section.mm__g')];
    expect(cols.map((c) => [text(c.querySelector('.mm__n')), text(c.querySelector('h2.mm__t')), text(c.querySelector('.mm__p'))]))
      .toEqual(MENU.map((g) => [g.no, g.name, g.promise]));
    cols.forEach((col, i) => {
      const rows = [...col.querySelectorAll('ul.mm__list > li > a.mm__row')];
      expect(rows.map((a) => a.getAttribute('href'))).toEqual(MENU[i].slugs.map((s) => `/features/${s}/`));
      expect(rows.map((a) => [text(a.querySelector('.mm__name')), text(a.querySelector('.mm__line'))])).toEqual(channelsOf(MENU[i]).map((c) => [c.name, c.line]));
      // Named by its heading, for a screen reader moving by region.
      expect(col.getAttribute('aria-labelledby')).toBe(col.querySelector('h2')!.id);
    });
    expect(panel.querySelectorAll('a.mm__row')).toHaveLength(11);
  });

  it('ends with the way to all eleven, and has no preview image any more', () => {
    const all = panel.querySelector('.mm__foot a.mm__all')!;
    expect(text(all)).toBe('All eleven on one page');
    expect(all.getAttribute('href')).toBe('/#rack');
    expect(panel.querySelector('img, .crop, .fp__preview, [data-fp-crop]')).toBeNull();
    expect(doc.querySelector('[data-rack-scrim]')!.hasAttribute('hidden')).toBe(true);
  });
});

describe('the menu sheet', () => {
  const doc = new JSDOM(englishPage('features/stage/index.html')).window.document;
  const sheet = doc.querySelector('#menu[data-menu]')!;
  const scroll = sheet.querySelector('[data-menu-scroll]')!;

  it('runs in this order: account, the four groups, three chips, the language; the app is pinned under it', () => {
    expect([...sheet.children].map((el) => el.className)).toEqual(['sheet__scroll', 'sheet__cta']);
    const order = [...scroll.children].map((el) => el.className.split(' ').pop());
    expect(order).toEqual(['sheet__acct', 'sheet__web', 'acc', 'sheet__util', 'sheet__end']);
    expect([...scroll.querySelectorAll('.sheet__acct a')].map(text)).toEqual(['Log in', 'Sign up', 'Join the waitlist']);
    expect([...scroll.querySelectorAll('.sheet__util a')].map((a) => [text(a), a.getAttribute('href')])).toEqual([
      ['How it works', '/#night'], ['Guide', 'https://app.bandwith.fun/academy/en/'], ['FAQ', '/faq/'],
    ]);
    // The language switch is the last thing in the scroll area.
    expect(scroll.lastElementChild!.innerHTML).toContain('<!--@lang-switch-->'); // filled per page and language by tools/i18n.ts
    const cta = sheet.querySelector('.sheet__cta a.btn--lime')!;
    expect(text(cta)).toMatch(/^Get the app/);
    expect(cta.getAttribute('href')).toBe('/get/');
    // One lime button in the sheet.
    expect(sheet.querySelectorAll('.btn--lime')).toHaveLength(1);
  });

  it('is an accordion: each group a button that controls a hidden list of its pages', () => {
    const groups = [...scroll.querySelectorAll('[data-acc-group]')];
    expect(groups).toHaveLength(4);
    groups.forEach((g, i) => {
      const btn = g.querySelector('button[data-acc-btn]')!;
      const list = g.querySelector('[data-acc-panel]')!;
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      expect(btn.getAttribute('aria-controls')).toBe(list.id);
      expect(list.getAttribute('aria-labelledby')).toBe(btn.id);
      expect(list.hasAttribute('hidden')).toBe(true);
      expect(text(btn.querySelector('.acc__t'))).toBe(MENU[i].name);
      expect(text(btn.querySelector('.acc__p'))).toBe(MENU[i].promise);
      expect([...list.querySelectorAll('a.acc__row')].map((a) => [a.getAttribute('href'), text(a.querySelector('b')), text(a.querySelector('em'))]))
        .toEqual(channelsOf(MENU[i]).map((c) => [`/features/${c.slug}/`, c.name, c.line]));
    });
  });

  it('is the same on every page', () => {
    for (const rel of Object.values(FILES)) {
      const d = new JSDOM(englishPage(rel)).window.document;
      expect(d.querySelectorAll('#menu [data-acc-group]').length, rel).toBe(4);
      expect(d.querySelectorAll('#rack-panel a.mm__row').length, rel).toBe(11);
    }
  });
});

describe('the old menu is gone', () => {
  it('no hover preview, no four departments, in markup, script or styles', () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
      const p = path.join(d, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    const files = [...walk(path.join(SITE, 'src')), ...walk(path.join(SITE, 'partials'))].filter((f) => /\.(css|ts|html)$/.test(f));
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, path.relative(SITE, f)).not.toMatch(/fp__|data-fp\b|data-fp-|menu__row|menu__links|menu__label/);
    }
    expect(GENERATED['feature-panel']()).not.toMatch(/Business|Everywhere/);
  });
});
