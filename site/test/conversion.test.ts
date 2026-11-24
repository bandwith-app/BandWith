/**
 * The path to sign-up (site review, 2026-11-23):
 * - the home hero says what BandWith is, for whom, and that it is free, and
 *   its main button opens the web app's Create account;
 * - every link to the app's sign-up says which spot of the site it is (`src`);
 * - one label per destination: "Start free in your browser" for the web
 *   sign-up as the main call to action, "Get the app" for the Get page;
 * - "What is BandWith?" comes right after the group-chat section;
 * - the trust line says only what the app really offers;
 * - "Made by" is ready and switched off.
 * In a browser, per device: e2e/site/conversion.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import path from 'path';
import { PAGES, englishPage } from '../tools/pages';
import { finalizePage, translatorFor } from '../tools/i18n';
import { translateTree } from '../src/i18n/translate';
import { APP_URL, MADE_BY, SIGNUP_SPOTS, STAGE_DEMO_URL, signupUrl } from '../src/content/site';
import { madeBy } from '../src/content/render';

const SITE = path.resolve(__dirname, '..');
const read = (f: string) => readFileSync(path.join(SITE, f), 'utf8');
const FILES = Object.values(PAGES);
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const page = (rel: string, lang: 'en' | 'it' | 'es' = 'en') => new JSDOM(finalizePage(englishPage(rel), rel, lang)).window.document;

describe('home hero', () => {
  const doc = page('index.html');
  const hero = doc.querySelector('.hero')!;

  it('keeps its headline', () => {
    expect(text(hero.querySelector('h1'))).toBe('Run the band. Play the show.');
  });

  it('says what it is, for whom, and that it is free', () => {
    expect(text(hero.querySelector('.hero__what'))).toBe('The free app for gigging bands.');
    expect(text(hero.querySelector('[data-hero-lead]'))).toBe(
      'The free app for gigging bands. Gigs, rehearsals, setlists, quotes and pay in one place, and a live setlist on every phone at the show.',
    );
  });

  it('the main button opens the web app on Create account, from the hero', () => {
    const primary = hero.querySelector<HTMLAnchorElement>('.hero__cta .btn--lime[data-web-cta]')!;
    expect(text(primary)).toBe('Start free in your browser');
    expect(primary.getAttribute('href')).toBe(signupUrl('site-hero'));
    expect(signupUrl('site-hero')).toBe('https://app.bandwith.fun/?start=signup&src=site-hero');
    // It is the first thing in the block, and the only lime button a visitor sees.
    expect(hero.querySelector('.hero__cta')!.firstElementChild).toBe(primary);
  });

  it('one quiet line under it', () => {
    const fine = hero.querySelector('.hero__fine')!;
    expect(text(fine)).toBe('Free during the beta · No card · 2 minutes');
    expect(fine.previousElementSibling?.matches('.cta-full')).toBe(true);
    expect(fine.previousElementSibling?.previousElementSibling?.matches('[data-web-cta]')).toBe(true);
  });

  it('then the phone apps, quieter, and the demo, as a text link', () => {
    const apps = hero.querySelector<HTMLAnchorElement>('.hero__apps')!;
    expect(text(apps)).toBe('Get the iPhone or Android app');
    expect(apps.getAttribute('href')).toBe('/get/');
    expect(apps.className).toContain('btn--ghost');
    const demo = hero.querySelector<HTMLAnchorElement>('.hero__try')!;
    expect(text(demo)).toBe('Try it first, no account');
    expect(demo.getAttribute('href')).toBe(STAGE_DEMO_URL);
    expect(demo.className).not.toContain('btn');
    expect([...hero.querySelectorAll('.hero__more > a')]).toEqual([apps, demo]);
  });

  it('the demo link lands on the Stage demo itself', () => {
    expect(STAGE_DEMO_URL).toBe('/features/stage/#try');
    const stage = page('features/stage/index.html');
    expect(stage.querySelector('#try [data-stage-demo]')).not.toBeNull();
  });

  it('open spots gone: the waitlist takes the button’s place (html.is-full), the small print goes', () => {
    const full = hero.querySelector<HTMLAnchorElement>('.hero__cta .cta-full')!;
    expect(text(full)).toBe('Join the waitlist');
    expect(full.getAttribute('href')).toBe('/get/#waitlist');
    expect(hero.querySelector('.hero__fine')!.hasAttribute('data-web-cta')).toBe(true);
    const css = read('src/styles/base.css');
    expect(css).toMatch(/\.cta-full \{ display: none !important; \}/);
    expect(css).toMatch(/html\.is-full \[data-web-cta\] \{ display: none !important; \}/);
    expect(css).toMatch(/html\.is-full \.cta-full \{ display: inline-flex !important; \}/);
  });

  for (const lang of ['it', 'es'] as const) {
    it(`/${lang}/: the same links, the site ones in ${lang}`, () => {
      const h = page('index.html', lang).querySelector('.hero')!;
      expect(h.querySelector('[data-web-cta]')!.getAttribute('href')).toBe(signupUrl('site-hero'));
      expect(h.querySelector('.hero__apps')!.getAttribute('href')).toBe(`/${lang}/get/`);
      expect(h.querySelector('.hero__try')!.getAttribute('href')).toBe(`/${lang}/features/stage/#try`);
      expect(h.querySelector('.cta-full')!.getAttribute('href')).toBe(`/${lang}/get/#waitlist`);
      expect(text(h.querySelector('.hero__what'))).not.toBe('The free app for gigging bands.');
    });
  }
});

describe('every link to the app’s sign-up names its spot', () => {
  const links = FILES.flatMap((rel) =>
    [...page(rel).querySelectorAll<HTMLAnchorElement>('a[href]')]
      .filter((a) => a.getAttribute('href')!.startsWith(APP_URL) && /[?&]start=signup/.test(a.getAttribute('href')!))
      .map((a) => ({ rel, href: a.getAttribute('href')!, src: new URL(a.getAttribute('href')!).searchParams.get('src'), a })));

  it('each one carries a src from the list (content/site.ts), never a bare "site"', () => {
    expect(links.length).toBeGreaterThan(FILES.length * 3 - 1);
    for (const l of links) expect(SIGNUP_SPOTS as readonly (string | null)[], `${l.rel}: ${l.href}`).toContain(l.src);
    for (const l of links) expect(l.href, l.rel).toBe(signupUrl(l.src as (typeof SIGNUP_SPOTS)[number]));
  });

  it('the src says where the link is', () => {
    const where = (l: (typeof links)[number]) =>
      l.a.closest('.hero') ? 'site-hero' : l.a.closest('.menu') ? 'site-menu' : l.a.closest('.nav') ? 'site-nav' : l.a.closest('.foot') ? 'site-footer' : l.a.closest('#web') ? 'site-get-web' : 'elsewhere';
    for (const l of links) expect(l.src, `${l.rel}: ${text(l.a)}`).toBe(where(l));
  });

  it('every page has the header, menu and footer ones; the home its hero, the Get page its web door', () => {
    for (const rel of FILES) {
      const own = links.filter((l) => l.rel === rel).map((l) => l.src).sort();
      const extra = rel === 'index.html' ? ['site-hero'] : rel === 'get/index.html' ? ['site-get-web'] : [];
      expect(own, rel).toEqual(['site-footer', 'site-menu', 'site-nav', ...extra].sort());
    }
  });

  it('the Italian and Spanish pages link the same addresses', () => {
    for (const lang of ['it', 'es'] as const) {
      const hrefs = [...page('get/index.html', lang).querySelectorAll('a[href*="start=signup"]')].map((a) => a.getAttribute('href')).sort();
      expect(hrefs).toEqual(['site-footer', 'site-get-web', 'site-menu', 'site-nav'].map((s) => signupUrl(s as (typeof SIGNUP_SPOTS)[number])));
    }
  });
});

describe('one label for each call to action', () => {
  const all = FILES.concat('404.html').flatMap((rel) => [...page(rel).querySelectorAll<HTMLAnchorElement>('a[href]')].map((a) => ({ rel, a, href: a.getAttribute('href')!, label: text(a) })));

  it('"Get the beta" is no longer a button: the Get page is "Get the app" wherever a link leads to it', () => {
    expect(all.filter((l) => /get the beta/i.test(l.label)).map((l) => `${l.rel}: ${l.label}`)).toEqual([]);
    const toGet = all.filter((l) => l.href === '/get/' && !l.a.closest('[data-lang-switch]'));
    expect(toGet.length).toBeGreaterThan(FILES.length * 2 - 1);
    // The hero's quieter button names the phones; every other one starts with the same three words.
    const labels = [...new Set(toGet.map((l) => l.label))].sort();
    expect(labels).toEqual(['Get the app', 'Get the app · iOS & Android', 'Get the appiOS · Android', 'Get the iPhone or Android app']);
  });

  it('the main call to action reads the same in the hero and in every footer', () => {
    const main = all.filter((l) => l.a.matches('.btn--lime[data-web-cta]'));
    expect([...new Set(main.map((l) => l.label))]).toEqual(['Start free in your browser']);
    expect(main.filter((l) => l.a.closest('.foot')).length).toBe(FILES.length + 1);
    for (const l of main.filter((x) => x.a.closest('.foot'))) {
      expect(l.href).toBe(signupUrl('site-footer'));
      expect(text(l.a.nextElementSibling)).toBe('Join the waitlist');
    }
  });
});

describe('"What is BandWith?" comes right after the group chat', () => {
  it('in the page source: chat, the questions, then the night', () => {
    const html = read('index.html');
    const at = (s: string) => { const i = html.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    expect(at('id="noise"')).toBeLessThan(at('<!--@home-answers-->'));
    expect(at('<!--@home-answers-->')).toBeLessThan(at('id="night"'));
    expect(html.match(/<!--@home-answers-->/g)).toHaveLength(1);
  });

  it('on the built page it is the section after #noise, with its first questions', () => {
    const doc = page('index.html');
    const what = doc.querySelector('#noise')!.nextElementSibling!;
    expect(what.id).toBe('what');
    expect(what.querySelector('h2')!.innerHTML).toBe('What is<br>BandWith?');
    expect(what.nextElementSibling!.id).toBe('night');
    expect([...what.querySelectorAll('summary')].slice(0, 2).map(text)).toEqual(['Who is BandWith for?', 'Is BandWith free?']);
  });

  it('still without FAQPage markup on the home page (one URL per question: /faq/)', () => {
    const types = (rel: string) => (JSON.parse(page(rel).querySelector('script[type="application/ld+json"]')!.textContent!)['@graph'] as { '@type': string | string[] }[]).flatMap((n) => n['@type']);
    expect(types('index.html')).not.toContain('FAQPage');
    expect(types('faq/index.html')).toContain('FAQPage');
    expect(types('get/index.html')).toContain('FAQPage');
  });
});

describe('trust line on the Get page', () => {
  const LINE = 'Beta means: free, updated every week, and your data stays yours: export a copy or delete your account anytime.';

  it('is written once, with the doors', () => {
    const doc = page('get/index.html');
    expect([...doc.querySelectorAll('[data-trust]')]).toHaveLength(1);
    expect(text(doc.querySelector('[data-doors] [data-trust] .gtrust__line'))).toBe(LINE);
  });

  it('promises only what the app does: its privacy policy names both tools', () => {
    // The app's own pages (read only): if export or deletion ever leave Settings, this line has to change too.
    const policy = readFileSync(path.resolve(SITE, '../public/legal/privacy.html'), 'utf8');
    expect(policy).toContain('Export my data');
    expect(policy).toContain('Settings › Privacy &amp; account › Delete account');
    expect(policy).toContain('You can export your data or delete your account at any time from Settings.');
  });
});

describe('"Made by" is ready, and off', () => {
  it('is switched off, with no name, role or address in the code', () => {
    expect(MADE_BY).toEqual({ on: false, name: '', role: '', contact: '' });
    expect(madeBy()).toBe('');
  });

  it('nothing of it is on any page', () => {
    for (const rel of FILES) {
      const html = englishPage(rel);
      expect(html, rel).not.toContain('gtrust__by');
      expect(html, rel).not.toContain('<!--@made-by-->');
      expect(html, rel).not.toMatch(/Made by/);
    }
    expect(read('get/index.html')).toContain('<!--@made-by-->');
  });

  // Placeholders, not a person: the owner fills the real ones in content/site.ts.
  const sample = { on: true, name: 'Name Surname', role: 'bass player in a wedding band', contact: 'someone@example.com' };

  it('filled in and on: one line, with a way to write', () => {
    expect(madeBy(sample)).toBe(
      '<p class="gtrust__by">Made by <b>Name Surname</b>, bass player in a wedding band. Write to me: <a href="mailto:someone@example.com">someone@example.com</a></p>',
    );
    expect(madeBy({ ...sample, contact: 'https://example.com/contact' })).toContain('<a href="https://example.com/contact">example.com/contact</a>');
    expect(madeBy({ ...sample, name: '<b>x</b>' })).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('stays off while any slot is empty, or the switch is off', () => {
    expect(madeBy({ ...sample, on: false })).toBe('');
    for (const k of ['name', 'role', 'contact'] as const) expect(madeBy({ ...sample, [k]: '  ' }), k).toBe('');
  });

  it('has its Italian and Spanish sentence', () => {
    for (const [lang, start] of [['it', 'Fatto da <b>Name Surname</b>, '], ['es', 'Hecho por <b>Name Surname</b>, ']] as const) {
      const doc = new JSDOM(`<body>${madeBy(sample)}</body>`).window.document;
      const t = translatorFor(lang);
      t.misses.clear();
      translateTree(doc.body, t);
      expect([...t.misses], lang).toEqual([]);
      expect(doc.body.innerHTML, lang).toContain(start);
      expect(doc.body.innerHTML, lang).toContain('<a href="mailto:someone@example.com">someone@example.com</a>');
    }
  });
});
