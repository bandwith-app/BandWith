import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { PAGES } from '../src/content/pages';
import { ANSWERS, HOME_ANSWERS } from '../src/content/answers';
import { CHANNELS } from '../src/content/features';
import { FRAGMENTS } from '../src/content/fragments';
import { BY_ID } from '../../academy/content';

/**
 * What the app does, the site says. Each row is a feature that shipped (or is on
 * main) and the words the site uses for it, on the page where a musician looks
 * for it. Labels are the app's own (see the Academy articles).
 */
const SITE = path.resolve(__dirname, '..');
/** What a channel page says: its content, the fragments it draws and the questions at its end. */
const drawn = (slug: string) =>
  PAGES[slug].details.featured.map((f) => ('fragment' in f.ui ? FRAGMENTS[f.ui.fragment].html.replace(/<[^>]+>/g, ' ') : '')).join(' ');
const text = (slug: string) => JSON.stringify(PAGES[slug]) + drawn(slug) + JSON.stringify(ANSWERS[slug] ?? []);
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
  ['stage manager (#223, #243)', 'stage', [/stage manager plays the songs/i, /Audio ready/, /Now playing/]],
  ['full screen (#228)', 'stage', [/Full screen/]],
  ['Song only and pedals (#236)', 'stage', [/Song only/, /page-turner pedal/i]],
  ['Full screen is Song only, one way in (#245)', 'stage', [/Full screen is the song/, /Song only: its number and title/]],
  ['calendar sync for everyone (#220)', 'calendar-gigs', [/Calendar sync/, /Apple/, /Google/, /Outlook/, /Add to calendar/]],
  ['venue search finds venues by name (#222)', 'calendar-gigs', [/by name/]],
  ['pending invites (#224)', 'people', [/Invited/, /Send again/, /Cancel invite/]],
  ['final balance (#229)', 'quotes-contracts', [/FINAL BALANCE/, /Mark deposit received/, /Mark as paid/, /Stripe/]],
  ['opt-in usage statistics in the apps (#238)', 'privacy', [/Anonymous usage statistics/]],
  // Release d3515141 (11-22). Labels as the app shows them (src/lib/i18n, English source).
  ['the click over Bluetooth (#274)', 'stage', [/same click over Bluetooth/]],
  ['live without signal: say yes once (#267, #269)', 'stage', [/Say yes once/, /next 7 days/]],
  ['who is ready offline, Remind (#269)', 'stage', [/Offline: 4 of 5 members ready/, /Remind/]],
  ['changes wait for signal (#270, #271)', 'devices', [/changes waiting for signal/, /Settings › Offline & live/, /next 7 days/, /Wi-Fi only/]],
  ['count-in (#290), over Bluetooth too (#311)', 'stage', [/Count in/, /full-screen countdown/, /Vibrate on every beat/, /Sound in headphones/]],
  ['follow the tempo (#272, #276)', 'stage', [/Follow the tempo/, /Next: Chorus in 2 bars/, /bar being played is lit/]],
  ['voice parts (#264, #266)', 'songs', [/Lead, 2nd voice, Backing, All or Spoken/, /Highlight my part/, /who sings what/]],
  ['voice parts on stage (#264)', 'stage', [/Highlight my part/, /2nd voice, Backing, All and Spoken/]],
  ['song tempo fields for the stage (#272)', 'songs', [/time signature/, /count-in of 1 or 2 bars/]],
  ['date on hold (#294)', 'quotes-contracts', [/Possible gig – keep the date free/, /I’m free/, /I can’t/, /No client, no fee/]],
  ['one date of a repeating rehearsal (#297)', 'rehearsals-polls', [/Delete this date/, /Delete the whole series/]],
  ['error reports, on by default (#277)', 'privacy', [/Send crash reports/, /on by default/i, /no name, email or account id/i, /14 days/, /Firebase Crashlytics only with that yes/]],
  ['the hold and the offline copies are private (#294, #267)', 'privacy', [/Possible gig – keep the date free/, /never fees or contracts/]],
];

/**
 * Since "The small things" became three panels and one line per item (2026-11),
 * the page keeps the capability and the Guide keeps the steps. For these, the
 * page still names the feature (above) and links the article that has the detail.
 */
const IN_THE_GUIDE: [string, string, string, RegExp[]][] = [
  ['turning the stage manager on (#223)', 'stage', 'stage-manager', [/Stage manager: play audio here/]],
  ['stage manager audio ahead of the gig (#246)', 'stage', 'stage-manager', [/Audio on this device/, /Download audio/, /Try again/, /3 days before a confirmed gig/]],
  ['the click over Bluetooth (#274)', 'stage', 'stage-click', [/Bluetooth/]],
  ['say yes once (#267)', 'stage', 'live-mode-offline', [/Download and keep it automatic/]],
  ['the count-in over Bluetooth and in a browser (#311)', 'stage', 'count-in', [/Bluetooth/, /same beat/, /in a browser/]],
  ['follow the tempo: hold, and the BPM it needs (#272, #276)', 'stage', 'follow-the-tempo', [/\*\*Hold\*\* to repeat the current section/, /Add a BPM to follow this song/, /Next: Bridge in 4 bars/]],
];

/** What the app no longer does (or never did): these words must not come back. */
const GONE: [string, RegExp][] = [
  // ("in a browser it needs the internet" is true of the count-in and stays.)
  ['the click needs the internet (#274)', /click needs the internet|BPM, and needs the internet|isn’t sent over Bluetooth/],
  ['open the gig once while online is the whole story (#267)', /Open the gig once while online/],
  ['Ask the lineup now switch (#294)', /Ask the lineup|availability check|when you ask the lineup/],
  ['a strip that syncs (#271)', /wait in a strip|sync when the connection comes back/],
  ['the count-in needs a connection (#311)', /count-in needs a connection|only the leader’s phone shows|Only the count-in needs/],
];

describe('the site covers the app', () => {
  for (const [what, slug, words] of FEATURES) {
    it(`${slug}: ${what}`, () => {
      const t = text(slug);
      expect(words.filter((w) => !w.test(t)).map(String)).toEqual([]);
    });
  }

  for (const [what, slug, id, words] of IN_THE_GUIDE) {
    it(`${slug} links the Guide article with: ${what}`, () => {
      expect(PAGES[slug].learn.map((l) => l.id), `${slug} → ${id}`).toContain(id);
      const article = JSON.stringify(BY_ID.get(id));
      expect(words.filter((w) => !w.test(article)).map(String)).toEqual([]);
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

  it('get: the data question names the error reports and how to switch them off (#277)', () => {
    const answer = /Who sees my data\?<\/summary><p>([\s\S]*?)<\/p>/.exec(get)?.[1] ?? '';
    expect(answer).toMatch(/error report/);
    expect(answer).toMatch(/no name, email or account id/);
    expect(answer).toMatch(/switch that off in Settings/);
  });

  for (const [what, re] of GONE) {
    it(`no page, answer or door says: ${what}`, () => {
      const all = Object.keys(PAGES).map(text).join('\n') + JSON.stringify(ANSWERS) + JSON.stringify(HOME_ANSWERS) + JSON.stringify(CHANNELS) + home + get;
      expect(all).not.toMatch(re);
    });
  }

  it('the answers cover the release: offline setlists, count-in, follow the tempo, voice parts, the hold, error reports', () => {
    const a = (slug: string) => ANSWERS[slug].map((x) => `${x.q} ${x.a}`).join(' ');
    expect(HOME_ANSWERS.map((x) => x.a).join(' ')).toMatch(/setlists of your next 7 days/);
    expect(a('stage')).toMatch(/next 7 days/);
    expect(a('stage')).toMatch(/taps Count in/);
    expect(a('stage')).toMatch(/Stop the count-in ends it on every phone/);
    expect(a('stage')).toMatch(/Follow the tempo/);
    expect(a('songs')).toMatch(/Highlight my part/);
    expect(a('quotes-contracts')).toMatch(/Possible gig – keep the date free/);
    expect(a('privacy')).toMatch(/Send crash reports/);
    expect(a('rehearsals-polls')).toMatch(/delete one date or the whole series/);
  });
});
