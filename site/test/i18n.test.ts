/**
 * Site languages (EN default, IT at /it/, ES at /es/).
 * - Every built page in IT and ES has no English left (the dictionaries cover every unit).
 * - Translations keep their markup and placeholders.
 * - Country → language rules; links; the head (lang, canonical, hreflang, og:locale).
 * - Every whole sentence a script writes (string literals in src/ui) has a translation.
 * What scripts write at runtime, rendered: e2e/site/i18n-runtime.spec.ts.
 */
import { describe, expect, it as test } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { PAGES, englishPage } from '../tools/pages';
import { finalizePage, translatorFor, type Misses } from '../tools/i18n';
import { it as IT } from '../src/i18n/dict/it';
import { es as ES } from '../src/i18n/dict/es';
import { makeTranslator, translateTree } from '../src/i18n/translate';
import { SAME } from '../src/i18n/same';
import { basePath, langOfPath, localizeHref, pathIn } from '../src/i18n/langs';
import { languageFor, suggestion, placeName } from '../src/i18n/suggest';
import { SLOTS } from '../src/ui/demos/rehearsals-polls';

const FILES = Object.values(PAGES);

/**
 * The text pieces of every string literal in the site's scripts: template
 * parts between ${…} and text between tags. Only what reads as words for a
 * visitor (a capital or a sentence end, a space), not code (keys, selectors, CSS).
 */
function scriptText(): Map<string, string> {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
    const p = path.join(d, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
  const out = new Map<string, string>();
  for (const f of walk(path.resolve(__dirname, '../src/ui'))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|`([^`]*)`/g)) {
      const lit = (m[1] ?? m[2]).replace(/\\'/g, "'");
      const whole = m[1] != null || !lit.includes('${');
      for (const seg of lit.split(/\$\{(?:[^{}]|\{[^{}]*\})*\}/)) {
        for (let piece of seg.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').split(/<[^>]+>/)) {
          piece = piece.replace(/\s+/g, ' ').trim();
          if (!/[a-z]{2}/.test(piece) || !/\s|^[A-Z]/.test(piece)) continue;
          if (/[{};=\\]|=>|^[a-z-]+(__[a-z-]+)?$|^[a-z]+\.[a-z]|rgba|cubic-bezier|max-width|px|^[.([#,:·”“"'>)-]|[(·:“"]$/.test(piece)) continue;
          if (/^(Arrow\w+|End|Enter|Escape|Home|Tab|Backspace|Delete|Content-Type)$/.test(piece)) continue;
          // A piece of a sentence built around a value: the rendered sentence is checked in the browser.
          if (/^[a-z]/.test(piece) && (!whole || !/[.!?]$/.test(piece))) continue;
          if (!out.has(piece)) out.set(piece, path.basename(f));
        }
      }
    }
  }
  return out;
}

/** Sentence starts and ends around a value, and code that reads like words. */
const NOT_SENTENCES = new Set([
  'Gig confirmed by', 'Nov · 20:30 · Villa Necchi', 'Sara’s phone · her own fee,', 'Ivo answered · Leo reads', 'Leo asked',
  'Leo cancelled the request · Ivo reads', '12 Oct,', 'Accepted by', 'Client opens the link · Leo’s quote moves to', 'Leo taps',
  'Message sent · Leo’s quote moves to', 'Leo taps Lock in on', 'Rehearsal locked in for', 'Sara can make', 'Sara takes back',
  'Key of', 'Original key,', 'Your screen is back in', 'Your screen: key of', 'Beta 52', 'We’ll write to', 'You’re', 'You’re already',
  'Leo →', '14px sans-serif', 'BPM on every phone', 'BPM over Bluetooth · the web app misses it', 's phone (admin) and Ivo M.',
]);

describe('text written by scripts', () => {
  const pieces = [...scriptText()].filter(([p]) => !NOT_SENTENCES.has(p));
  for (const [lang, dict] of [['it', IT], ['es', ES]] as const) {
    test(`${lang}: every sentence in src/ui has a translation`, () => {
      const t = makeTranslator(lang, dict, SAME);
      const missing = pieces.filter(([p]) => !t.skip(p) && t.text(p) == null).map(([p, f]) => `${f}: ${p}`);
      expect(missing).toEqual([]);
    });
  }

  // The rehearsal poll writes sentences with any set of its dates: the top picks (in date order)
  // and Sara's votes (in the order she tapped them). Every one of them has a translation.
  const longs = SLOTS.map((x) => x.long);
  const join = (a: string[]) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  const subsets = longs.flatMap((_, i) => longs.slice(i + 1).map((b) => [longs[i], b])).concat([[...longs]], longs.map((l) => [l]));
  const orders = (a: string[]): string[][] => (a.length < 2 ? [a] : a.flatMap((x, i) => orders(a.filter((_, j) => j !== i)).map((r) => [x, ...r])));
  const pollSentences = [
    ...subsets.map((s) => `Top pick so far: ${join(s)}. Tap Done when you’re set, or change your dates.`),
    ...subsets.filter((s) => s.length > 1).map((s) => `Now you hold Leo’s phone. Tap Lock in next to the Top pick (${join(s)} are tied: his call).`),
    ...subsets.flatMap(orders).map((s) => `Sara is done · ${join(s)}`),
  ];
  for (const [lang, dict] of [['it', IT], ['es', ES]] as const) {
    test(`${lang}: the rehearsal poll's sentences with every set of dates`, () => {
      const t = makeTranslator(lang, dict, SAME);
      expect(pollSentences.filter((p) => t.text(p) == null)).toEqual([]);
    });
  }
});

describe('built pages in Italian and Spanish', () => {
  for (const lang of ['it', 'es'] as const) {
    test(`${lang}: no English left on any page`, () => {
      const misses: Misses = new Map();
      for (const rel of FILES) finalizePage(englishPage(rel), rel, lang, misses);
      expect([...misses.keys()]).toEqual([]);
    });
  }

  test('an Italian page: lang, head, links', () => {
    const html = finalizePage(englishPage('features/money/index.html'), 'features/money/index.html', 'it');
    const doc = new JSDOM(html).window.document;
    expect(doc.documentElement.lang).toBe('it');
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://bandwith.fun/it/features/money/');
    const alt = [...doc.querySelectorAll('link[rel="alternate"]')].map((l) => `${l.getAttribute('hreflang')} ${l.getAttribute('href')}`);
    expect(alt).toEqual([
      'en https://bandwith.fun/features/money/',
      'it https://bandwith.fun/it/features/money/',
      'es https://bandwith.fun/es/features/money/',
      'x-default https://bandwith.fun/features/money/',
    ]);
    expect(doc.querySelector('meta[property="og:locale"]')?.getAttribute('content')).toBe('it_IT');
    // Every site link stays in Italian, apart from the switcher's EN and ES.
    const hrefs = [...doc.querySelectorAll('a[href^="/"]')].filter((a) => !a.closest('[data-lang-switch]')).map((a) => a.getAttribute('href')!);
    expect(hrefs.length).toBeGreaterThan(10);
    expect(hrefs.filter((h) => !h.startsWith('/it/'))).toEqual([]);
    expect([...doc.querySelectorAll('footer [data-lang-switch] a')].map((a) => `${a.textContent} ${a.getAttribute('href')}`))
      .toEqual(['EN /features/money/', 'IT /it/features/money/', 'ES /es/features/money/']);
    expect(doc.title).not.toBe('Fees & payouts · BandWith');
  });

  test('the English page keeps its text and gets the head and the switcher', () => {
    const html = finalizePage(englishPage('index.html'), 'index.html', 'en');
    const doc = new JSDOM(html).window.document;
    expect(doc.documentElement.lang).toBe('en');
    expect(doc.title).toBe('BandWith · Run the band. Play the show.');
    expect(doc.querySelector('footer [data-lang-switch] [aria-current="page"]')?.textContent).toBe('EN');
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://bandwith.fun/');
  });
});

describe('dictionaries', () => {
  const tags = (s: string) => (s.match(/<\/?[a-z][a-z0-9]*/gi) ?? []).map((t) => t.toLowerCase()).sort();
  const holes = (s: string) => (s.match(/\{(n|num|eur|x)\}/g) ?? []).sort();
  for (const [name, dict] of [['it', IT], ['es', ES]] as const) {
    test(`${name}: markup and placeholders survive, nothing empty`, () => {
      const bad: string[] = [];
      for (const [k, v] of Object.entries(dict)) {
        if (!v.trim()) bad.push(`empty: ${k}`);
        if (tags(k).join() !== tags(v).join()) bad.push(`tags: ${k} → ${v}`);
        if (holes(k).join() !== holes(v).join()) bad.push(`placeholders: ${k} → ${v}`);
      }
      expect(bad).toEqual([]);
    });
  }
  test('Italian and Spanish cover the same text', () => {
    const a = Object.keys(IT).sort();
    const b = Object.keys(ES).sort();
    expect(a.filter((k) => !(k in ES))).toEqual([]);
    expect(b.filter((k) => !(k in IT))).toEqual([]);
  });
});

describe('translator', () => {
  const t = makeTranslator('it', {
    'Run the band.': 'Guida la band.',
    'Play the <em>show.</em>': 'Suona lo <em>show.</em>',
    '{n} of 5 voted': '{n} su 5 hanno votato',
    'Five fees · {eur}': 'Cinque compensi · {eur}',
    'Ask {x}': 'Chiedi a {x}',
    'Deputy': 'Sostituto',
  }, ['Leo M.']);
  const tr = (html: string) => {
    const doc = new JSDOM(`<body>${html}</body>`).window.document;
    translateTree(doc.body, t);
    return doc.body.innerHTML;
  };
  test('sentences with inline markup are one unit', () => {
    expect(tr('<h1><span>Run the band.</span> <span>Play the <em>show.</em></span></h1>')).toBe('<h1><span>Guida la band.</span> <span>Suona lo <em>show.</em></span></h1>');
  });
  test('numbers, amounts and names', () => {
    expect(tr('<p>3 of 5 voted</p>')).toBe('<p>3 su 5 hanno votato</p>');
    expect(tr('<p>Five fees · €1,900</p>')).toBe('<p>Cinque compensi · 1.900 €</p>');
    expect(tr('<b>€2,400</b>')).toBe('<b>2.400 €</b>');
    expect(tr('<button aria-label="Ask Leo M.">Deputy</button>')).toBe('<button aria-label="Chiedi a Leo M.">Sostituto</button>');
    expect(tr('<p>Leo M.</p>')).toBe('<p>Leo M.</p>');
  });
  test('channel numbers at the edge stay out of the sentence', () => {
    const t2 = makeTranslator('es', { 'One poll. Everyone votes.': 'Una encuesta. Todos votan.' });
    const doc = new JSDOM('<body><p class="fix"><span class="fix__ch">CH 04</span>One poll. Everyone votes.</p></body>').window.document;
    translateTree(doc.body, t2);
    expect(doc.body.innerHTML).toBe('<p class="fix"><span class="fix__ch">CH 04</span>Una encuesta. Todos votan.</p>');
    expect([...t2.misses]).toEqual([]);
  });
  test('a missing unit is reported, and stays as it was', () => {
    const before = translatorFor('it').misses.size;
    expect(tr('<p>Something nobody wrote down</p>')).toBe('<p>Something nobody wrote down</p>');
    expect(t.misses.has('Something nobody wrote down')).toBe(true);
    expect(before).toBeGreaterThanOrEqual(0);
  });
});

describe('paths and links', () => {
  test('language of a path and the same page in another language', () => {
    expect(langOfPath('/it/features/money/')).toBe('it');
    expect(langOfPath('/es/')).toBe('es');
    expect(langOfPath('/italy/')).toBe('en');
    expect(basePath('/es/get/')).toBe('/get/');
    expect(pathIn('/it/features/stage/', 'en')).toBe('/features/stage/');
    expect(pathIn('/', 'es')).toBe('/es/');
  });
  test('links on a page in a language', () => {
    expect(localizeHref('/get/#waitlist', 'it')).toBe('/it/get/#waitlist');
    expect(localizeHref('/#rack', 'es')).toBe('/es/#rack');
    expect(localizeHref('/shots/x@phone.webp', 'it')).toBe('/shots/x@phone.webp');
    // The Academy's static pages, in the page's language (the bare /academy/ is the app shell, noindex).
    expect(localizeHref('https://app.bandwith.fun/academy/en/a/stage-mode/', 'it')).toBe('https://app.bandwith.fun/academy/it/a/stage-mode/');
    expect(localizeHref('https://app.bandwith.fun/academy/en/a/count-in/', 'es')).toBe('https://app.bandwith.fun/academy/es/a/count-in/');
    expect(localizeHref('https://app.bandwith.fun/academy/en/', 'es')).toBe('https://app.bandwith.fun/academy/es/');
    expect(localizeHref('https://app.bandwith.fun/academy/', 'it')).toBe('https://app.bandwith.fun/academy/it/');
    expect(localizeHref('https://app.bandwith.fun/academy/en/a/stage-mode/', 'en')).toBe('https://app.bandwith.fun/academy/en/a/stage-mode/');
    // Already in a language, or not a page of the guide: untouched.
    expect(localizeHref('https://app.bandwith.fun/academy/it/a/stage-mode/', 'es')).toBe('https://app.bandwith.fun/academy/it/a/stage-mode/');
    expect(localizeHref('https://app.bandwith.fun/academy/llms.txt', 'it')).toBe('https://app.bandwith.fun/academy/llms.txt');
    expect(localizeHref('https://app.bandwith.fun/?start=signup', 'it')).toBe('https://app.bandwith.fun/?start=signup');
    expect(localizeHref('/get/', 'en')).toBe('/get/');
    // The privacy policy exists in Italian and Spanish; the terms are English only.
    expect(localizeHref('https://app.bandwith.fun/legal/privacy.html', 'it')).toBe('https://app.bandwith.fun/legal/privacy-it.html');
    expect(localizeHref('https://app.bandwith.fun/legal/privacy.html', 'es')).toBe('https://app.bandwith.fun/legal/privacy-es.html');
    expect(localizeHref('https://app.bandwith.fun/legal/privacy.html', 'en')).toBe('https://app.bandwith.fun/legal/privacy.html');
    expect(localizeHref('https://app.bandwith.fun/legal/terms.html', 'it')).toBe('https://app.bandwith.fun/legal/terms.html');
  });
});

describe('country → language', () => {
  test('Spanish, Italian and English countries', () => {
    for (const c of ['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'UY', 'PR']) expect(languageFor({ country: c })).toBe('es');
    for (const c of ['IT', 'SM', 'VA']) expect(languageFor({ country: c })).toBe('it');
    expect(languageFor({ country: 'CH', region: 'TI' })).toBe('it');
    for (const c of ['US', 'GB', 'IE', 'CA', 'AU', 'NZ']) expect(languageFor({ country: c })).toBe('en');
  });
  test('any other country, or none: no suggestion', () => {
    for (const g of [{ country: 'DE' }, { country: 'FR' }, { country: 'CH', region: 'ZH' }, { country: 'BR' }, { country: null }, { country: 'xx1' }]) {
      expect(languageFor(g)).toBeNull();
    }
  });
  test('only when it differs from the page, and never after a choice', () => {
    expect(suggestion({ country: 'ES' }, 'en', null)).toBe('es');
    expect(suggestion({ country: 'ES' }, 'es', null)).toBeNull();
    expect(suggestion({ country: 'US' }, 'en', null)).toBeNull();
    expect(suggestion({ country: 'US' }, 'it', null)).toBe('en');
    expect(suggestion({ country: 'IT' }, 'en', 'no')).toBeNull();
    expect(suggestion({ country: 'IT' }, 'en', 'en')).toBeNull();
    expect(suggestion({ country: 'DE' }, 'it', null)).toBeNull();
  });
  test('the place, written in the suggested language', () => {
    expect(placeName({ country: 'ES' }, 'es')).toBe('España');
    expect(placeName({ country: 'MX' }, 'es')).toBe('México');
    expect(placeName({ country: 'IT' }, 'it')).toBe('Italia');
    expect(placeName({ country: 'US' }, 'en')).toBe('United States');
    expect(placeName({ country: 'CH', region: 'TI' }, 'it')).toBe('Ticino, Svizzera');
  });
});
