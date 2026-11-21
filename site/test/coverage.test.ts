import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { PAGES } from '../src/content/pages';

/**
 * What the app does, the site says. Each row is a feature that shipped (or is on
 * main) and the words the site uses for it, on the page where a musician looks
 * for it. Labels are the app's own (see the Academy articles).
 */
const SITE = path.resolve(__dirname, '..');
const text = (slug: string) => JSON.stringify(PAGES[slug]);
const home = readFileSync(path.join(SITE, 'index.html'), 'utf8');
const get = readFileSync(path.join(SITE, 'get/index.html'), 'utf8');

const FEATURES: [string, string, RegExp[]][] = [
  ['rehearsal timer and summary (#207)', 'rehearsals-polls', [/Start rehearsal/, /Pause/, /Rehearsal summary/]],
  ['rehearsal notes, mark now, write later (#209)', 'rehearsals-polls', [/\bMark\b/, /To write/]],
  ['To practise and From last time (#211)', 'rehearsals-polls', [/To practise/, /FROM LAST TIME/]],
  ['one push when a rehearsal ends (#212)', 'rehearsals-polls', [/one push/i]],
  ['a note on a lyric line (#225)', 'songs', [/Note for me/, /Note for the band/]],
  ['From rehearsals on the song page (#211)', 'songs', [/From rehearsals/, /Set on the song/]],
  ['music symbols in charts (#228)', 'songs', [/What the symbols mean/, /coda/i]],
  ['stage manager (#223, #243)', 'stage', [/Stage manager: play audio here/, /Audio ready/, /Now playing/]],
  ['full screen (#228)', 'stage', [/Full screen/]],
  ['Song only and pedals (#236)', 'stage', [/Song only/, /page-turner pedal/i]],
  ['stage manager audio ahead of the gig (#246)', 'stage', [/Audio on this device/, /Download audio/, /Try again/, /3 days before a confirmed gig/]],
  ['Full screen is Song only, one way in (#245)', 'stage', [/Full screen opens Song only/, /number and title/]],
  ['calendar sync for everyone (#220)', 'calendar-gigs', [/Calendar sync/, /Apple/, /Google/, /Outlook/, /Add to calendar/]],
  ['venue search finds venues by name (#222)', 'calendar-gigs', [/by name/]],
  ['pending invites (#224)', 'people', [/Invited/, /Send again/, /Cancel invite/]],
  ['final balance (#229)', 'quotes-contracts', [/FINAL BALANCE/, /Mark deposit received/, /Mark as paid/, /Stripe/]],
  ['opt-in usage statistics in the apps (#238)', 'privacy', [/Anonymous usage statistics/]],
];

describe('the site covers the app', () => {
  for (const [what, slug, words] of FEATURES) {
    it(`${slug}: ${what}`, () => {
      const t = text(slug);
      expect(words.filter((w) => !w.test(t)).map(String)).toEqual([]);
    });
  }

  it('home: one night has the rehearsal notes and the stage manager', () => {
    const scenes = home.match(/<article class="nt[^>]*data-night-scene[\s\S]*?<\/article>/g) ?? [];
    expect(scenes.some((s) => /To practise/.test(s))).toBe(true);
    expect(scenes.some((s) => /Stage manager/.test(s))).toBe(true);
    // The clock only moves forward.
    const times = scenes.map((s) => /data-time="(\d\d:\d\d)"/.exec(s)![1]);
    expect([...times].sort()).toEqual(times);
  });

  it('get: the data question says the app statistics are opt-in', () => {
    expect(get).toMatch(/Who sees my data\?[\s\S]*?anonymous usage statistics/i);
  });
});
