import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fromStatus, capText, meterCells, keptForInvites, meterLabel, capLineShown, capBlockShown, counterShown, COUNTER_FROM } from '../src/core/capacity';
import { HOME_ANSWERS } from '../src/content/answers';
import { llmsTxt } from '../tools/seo';
import { it as IT } from '../src/i18n/dict/it';
import { es as ES } from '../src/i18n/dict/es';
import { doneText } from '../src/ui/forms';
import { APK_URL, TESTFLIGHT_URL, signupUrl } from '../src/content/site';

const SITE = path.resolve(__dirname, '..');
const read = (f: string) => readFileSync(path.join(SITE, f), 'utf8');

// bw_capacity_status (migration 128): 300 spots, 45 kept for band invites.
const status = (taken: number, cap = 300, reserved = 45) => {
  const publicLeft = Math.max(0, cap - reserved - taken);
  const inviteLeft = Math.max(0, cap - taken);
  return { cap, reserved, taken: Math.min(taken, cap), public_left: publicLeft, invite_left: inviteLeft, state: publicLeft > 0 ? 'open' : inviteLeft > 0 ? 'invites' : 'full' };
};

describe('beta counter', () => {
  it('starts at 300: 255 open spots and 45 kept for band invites', () => {
    const c = fromStatus(status(0))!;
    expect(c.state).toBe('open');
    expect(c.publicLeft).toBe(255);
    expect(keptForInvites(c)).toBe(45);
    expect(capText(c)).toBe('255 of 255 open spots left · 45 kept for band invites');
  });

  it('goes down by one for every account', () => {
    expect(fromStatus(status(8))!.publicLeft).toBe(247);
    expect(capText(fromStatus(status(254))!)).toBe('1 of 255 open spots left · 45 kept for band invites');
  });

  it('keeps the reserve for invited people once the open spots are gone', () => {
    const c = fromStatus(status(255))!;
    expect(c.state).toBe('invites');
    expect(capText(c)).toMatch(/^Open spots are gone\. Invited by a band that’s already inside\? 45 spots are still kept for you\.$/);
    expect(capText(fromStatus(status(299))!)).toMatch(/1 spot is still kept/);
  });

  it('says full when the reserve is gone too', () => {
    const c = fromStatus(status(300))!;
    expect(c.state).toBe('full');
    expect(capText(c)).toBe('Every spot is taken right now. Join the waitlist.');
    expect(meterLabel(c)).toBe('All 300 beta spots are taken');
  });

  it('draws taken cells, then empty ones, then the reserve at the end', () => {
    const cells = meterCells(fromStatus(status(150))!, 40);
    expect(cells).toHaveLength(40);
    expect(cells.filter((k) => k === 'on')).toHaveLength(20);
    expect(cells.slice(-6)).toEqual(Array(6).fill('res'));
    expect(meterCells(fromStatus(status(300))!, 40).every((k) => k === 'on')).toBe(true);
  });

  it('hides the counter when there is no limit or the answer makes no sense', () => {
    expect(fromStatus({ cap: null, state: 'open' })).toBeNull();
    expect(fromStatus(null)).toBeNull();
    expect(fromStatus({ cap: 0 })).toBeNull();
    expect(fromStatus({ cap: 300, state: 'weird', public_left: -3 })!.state).toBe('open');
    expect(fromStatus({ cap: 300, state: 'weird', public_left: -3 })!.publicLeft).toBe(0);
  });
});

describe('closed-beta blocks on the Get page', () => {
  it('the waitlist and the lines for invited people show only once open spots are gone', () => {
    const open = fromStatus(status(10))!;
    const invites = fromStatus(status(255))!;
    const full = fromStatus(status(300))!;
    // Open, or no answer from the counter: nothing of the closed state is on the page.
    for (const when of ['closed', 'invites', 'full']) {
      expect(capBlockShown(open, when), when).toBe(false);
      expect(capBlockShown(null, when), when).toBe(false);
    }
    expect(capBlockShown(invites, 'closed')).toBe(true);
    expect(capBlockShown(invites, 'invites')).toBe(true);
    expect(capBlockShown(invites, 'full')).toBe(false);
    expect(capBlockShown(full, 'closed')).toBe(true);
    expect(capBlockShown(full, 'invites')).toBe(false);
    expect(capBlockShown(full, 'full')).toBe(true);
  });

  it('are written hidden in the page, each with the state that shows it', () => {
    const html = read('get/index.html');
    expect(html).toMatch(/<section class="full" id="waitlist"[^>]*data-cap-show="closed" hidden>/);
    expect(html).toMatch(/class="full__inv-open" data-cap-show="invites" hidden>/);
    expect(html).toMatch(/class="full__inv-shut" data-cap-show="full" hidden>/);
    expect(html).toMatch(/class="wrap gdoors__inv mono" data-cap-show="invites" hidden>/);
    // Shown by the script (core/capacity.ts), never by a stylesheet rule that a reader without CSS would miss.
    expect(read('src/styles/get.css')).not.toMatch(/\.full\s*\{[^}]*display:\s*none/);
  });
});

/**
 * With plenty of open spots the count works against the invitation ("239 of
 * 255 open spots left" reads as a small room): the counter and the "Why a
 * limit?" section stay out of the page until 50 or fewer are left. From
 * there on, and whenever only invites, or nobody, get in, all is as before.
 */
describe('the counter shows only when the limit matters', () => {
  const left = (n: number) => fromStatus(status(255 - n))!;

  it('more than 50 open spots left: no counter, no "Why a limit?"', () => {
    expect(COUNTER_FROM).toBe(50);
    for (const n of [255, 239, 113, 51]) {
      const c = left(n);
      expect(c.state, String(n)).toBe('open');
      expect(c.publicLeft).toBe(n);
      expect(counterShown(c), String(n)).toBe(false);
      expect(capBlockShown(c, 'limit'), String(n)).toBe(false);
    }
  });

  it('50 or fewer: the counter is back, with the sentence it always had', () => {
    for (const n of [50, 49, 12, 1]) {
      const c = left(n);
      expect(c.state, String(n)).toBe('open');
      expect(counterShown(c), String(n)).toBe(true);
      expect(capBlockShown(c, 'limit'), String(n)).toBe(true);
    }
    expect(capText(left(50))).toBe('50 of 255 open spots left · 45 kept for band invites');
  });

  it('only invites, or nobody, get in: the counter shows, as before', () => {
    for (const c of [fromStatus(status(255))!, fromStatus(status(271))!, fromStatus(status(300))!]) {
      expect(counterShown(c), c.state).toBe(true);
      expect(capBlockShown(c, 'limit'), c.state).toBe(true);
    }
  });

  it('no answer from the database: nothing shows', () => {
    expect(counterShown(null)).toBe(false);
    expect(capBlockShown(null, 'limit')).toBe(false);
  });

  it('the threshold does not touch the closed-beta blocks', () => {
    for (const n of [239, 50, 1]) for (const when of ['closed', 'invites', 'full']) expect(capBlockShown(left(n), when), `${n} ${when}`).toBe(false);
  });

  it('the home counter and the Get page’s "Why a limit?" section are written hidden, shown by the script', () => {
    expect(read('index.html')).toMatch(/<div class="capblock" data-cap-block data-cap-show="limit" hidden>/);
    expect(read('get/index.html')).toMatch(/<section class="sec sec--bone why" id="why"[^>]*data-cap-show="limit" hidden>/);
    // The counter stays inside that section (pages/get.ts moves it up when the open spots are gone).
    const why = read('get/index.html').split('id="why"')[1];
    expect(why).toContain('data-cap-block');
  });
});

describe('waitlist reply', () => {
  it('gives the place in line and escapes the email', () => {
    expect(doneText('a<b>@x.io', { ok: true, position: 12 })).toContain('#12 in line');
    expect(doneText('a<b>@x.io', { ok: true, position: 12 })).toContain('a&lt;b&gt;@x.io');
    expect(doneText('a@x.io', { ok: true, position: 3, already: true })).toMatch(/already #3 in line/);
  });
});

describe('Get page doors', () => {
  const html = read('get/index.html');

  it('link straight to the web app, the APK and TestFlight', () => {
    expect(html).toContain(`href="${signupUrl('site-get-web').replace(/&/g, '&amp;')}" data-door="web"`);
    expect(html).toContain(`href="${APK_URL}" data-door="android"`);
    expect(html).toContain(`href="${TESTFLIGHT_URL}" data-door="ios"`);
  });

  it('has only the waitlist form (no email round trip for the apps)', () => {
    expect(html.match(/data-beta-form="([a-z]+)"/g)).toEqual(['data-beta-form="waitlist"']);
  });

  it('never promises a hold or a release of spots the database does not do', () => {
    expect(html).not.toMatch(/72 hours|14 days|last 30 days|open today/);
  });
});

/**
 * While open spots are left the beta is open to anyone: the site says "Open
 * beta" and the doors come first. The limit is still explained (the counter
 * next to "Why a limit?"), and once only band invites get in, or nobody, the
 * labels go back to "Private beta" and the notice returns to the top.
 */
describe('open beta wording', () => {
  const pages = ['index.html', 'get/index.html', 'partials/nav.html'].map((f) => [f, read(f)] as const);
  /** What a visitor reads: tags and attributes dropped. */
  const visible = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

  it('says Open beta wherever the page names the beta', () => {
    expect(visible(read('index.html'))).toContain('Open beta · iPhone · Android · Web');
    expect(visible(read('get/index.html'))).toContain('Open beta · free');
    expect(visible(read('partials/nav.html'))).toContain('Open beta · iPhone, Android & web');
    expect(read('index.html')).toMatch(/<section class="sec sec--bone getband"[\s\S]*?<p class="label"[^>]*>Open beta<\/p>/);
    for (const [f, html] of pages) expect(visible(html), f).not.toMatch(/private beta/i);
  });

  it('keeps the Private beta label for when only invites, or nobody, get in', () => {
    const labels = pages.flatMap(([, html]) => [...html.matchAll(/data-cap-beta="([^"]*)"[^>]*>(?:<span class="led"><\/span>)?([^<]*)</g)]);
    expect(labels.map((m) => m[1].replace(/&amp;/g, '&'))).toEqual([
      'Private beta · iPhone · Android · Web', 'Private beta', 'Private beta · free', 'Private beta · iPhone, Android & web',
    ]);
    for (const [, shut, open] of labels) expect(shut).toBe(open.replace('Open beta', 'Private beta'));
  });

  it('names the open beta in the descriptions search engines show', () => {
    const desc = (f: string) => /<meta name="description" content="([^"]*)"/.exec(read(f))![1];
    expect(desc('index.html')).toContain('Open beta on iPhone, Android and the web.');
    expect(desc('get/index.html')).toContain('Join the BandWith open beta:');
    for (const f of ['index.html', 'get/index.html']) expect(desc(f)).not.toMatch(/private/i);
  });

  it('answers "Is BandWith free?" without calling the beta private', () => {
    const a = HOME_ANSWERS.find((x) => x.q === 'Is BandWith free?')!.a;
    expect(a).toContain('BandWith is free while it’s in beta,');
    expect(a).not.toMatch(/private/i);
    // The limit stays in the answer: it is real.
    expect(a).toContain('Beta spots are limited');
    expect(llmsTxt()).not.toMatch(/private beta/i);
  });

  it('has the Italian and Spanish names', () => {
    expect(IT['Open beta']).toBe('Beta aperta');
    expect(ES['Open beta']).toBe('Beta abierta');
    for (const k of ['Open beta · free', 'Open beta · iPhone · Android · Web', 'Open beta · iPhone, Android & web']) {
      expect(IT[k], k).toMatch(/^Beta aperta · /);
      expect(ES[k], k).toMatch(/^Beta abierta · /);
    }
    // The private names stay: the pages go back to them when the open spots are gone.
    expect(IT['Private beta · free']).toBe('Beta privata · gratis');
    expect(ES['Private beta · free']).toBe('Beta privada · gratis');
  });
});

describe('home hero', () => {
  const open = fromStatus(status(15))!;
  const invites = fromStatus(status(271))!;
  const full = fromStatus(status(300))!;

  it('shows no spots count while the beta is open', () => {
    expect(capLineShown(open, 'closed')).toBe(false);
  });

  it('still tells the visitor when only invites, or nobody, get in', () => {
    expect(capLineShown(invites, 'closed')).toBe(true);
    expect(capLineShown(full, 'closed')).toBe(true);
  });

  it('the other counters (Get page, the home’s Get in section) show in every state', () => {
    for (const c of [open, invites, full]) expect(capLineShown(c, '')).toBe(true);
    expect(capLineShown(open, undefined)).toBe(true);
  });

  it('nothing shows without numbers', () => {
    expect(capLineShown(null, 'closed')).toBe(false);
    expect(capLineShown(null, '')).toBe(false);
  });

  it('the hero’s line is the closed-only one; the section further down keeps its counter', () => {
    const html = read('index.html');
    expect(html).toMatch(/<p class="cap-line hero__cap" data-cap-line="closed" hidden>/);
    const band = html.slice(html.indexOf('class="sec sec--bone getband"'));
    expect(band).toMatch(/<span data-cap-line hidden>/);
    expect(band).toContain('href="/get/#why"');
  });
});

describe('Get page: the doors come first', () => {
  const html = read('get/index.html');
  const at = (s: string) => { const i = html.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };

  it('headline and intro, then the three doors, then the counter', () => {
    const head = html.slice(at('<section class="gethead"'), at('class="full"'));
    expect(head).toContain('id="get-h"');
    expect(head).toContain('class="lead"');
    // No counter between the headline and the doors.
    expect(head).not.toMatch(/data-cap-block|data-cap-num|data-cap-meter/);
    expect(at('class="gdoors"')).toBeLessThan(at('data-cap-block'));
    expect(at('data-door="ios"')).toBeLessThan(at('data-cap-num="left"'));
  });

  it('the counter, the meter and its line sit in the Why a limit? section', () => {
    const why = html.slice(at('id="why"'), at('class="sec faq"'));
    expect(why).toContain('data-cap-block');
    expect(why).toContain('data-cap-num="left"');
    expect(why).toContain('data-cap-num="kept"');
    expect(why).toContain('data-cap-meter');
    expect(why).toContain('data-cap-line');
    expect(html.match(/data-cap-block/g)).toHaveLength(1);
  });

  it('keeps a place under the headline for the notice when the open spots are gone', () => {
    const head = html.slice(at('<section class="gethead"'), at('class="full"'));
    expect(head).toContain('data-cap-top');
    // The waitlist still comes before the doors.
    expect(at('id="waitlist"')).toBeLessThan(at('class="gdoors"'));
  });
});
