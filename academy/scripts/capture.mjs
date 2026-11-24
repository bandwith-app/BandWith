#!/usr/bin/env node
/**
 * Captures Academy screenshots from the web demo with headless Chrome, over the
 * DevTools protocol (no puppeteer: Node's built-in WebSocket is enough).
 *
 *   VITE_DEMO_MODE=true npx vite --port 5185 --strictPort   # in another shell
 *   node academy/scripts/capture.mjs <shot-id>[,<shot-id>…] [--devices phone,tablet,web] [--base http://localhost:5185] [--out <folder>]
 *   node academy/scripts/capture.mjs --explore "<step>;<step>" --devices phone   # prints the buttons on screen (and what js: steps return), saves out/explore@phone.png
 *
 * Each capture starts from empty site data: demo session on, role tours seen,
 * song view on Lyrics & chords, the page's clock at 9:41 of the capture day, then the late urgent alert is dismissed. The steps for a
 * shot live in RECIPES below (click by visible text or aria-label, scroll, wait).
 * Run one capture job at a time (two-phone shots share one browser's storage).
 * A recipe named <id>@wide replaces <id> on tablet and web; <id>@tablet or <id>@web on that device only.
 * Output: academy/public/shots/<id>@<device>.webp at the Academy widths
 * (phone 780, tablet 1600, web 1800). Then run `node academy/scripts/shot-files.mjs`.
 *
 * Duo captures come from the iPhone Duo simulator (see the Academy notes); this
 * script covers phone, tablet and web only.
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(HERE, '../public/shots');
const OUT = path.resolve(HERE, '../../docs/handbook/out');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const DEVICES = {
  phone: { width: 390, height: 844, mobile: true, webp: 780 },
  tablet: { width: 1180, height: 820, mobile: true, webp: 1600 },
  web: { width: 1440, height: 900, mobile: false, webp: 1800 },
};

/**
 * Steps: 'click:<text>' (button/link/role=button whose aria-label or text starts
 * with it, case-insensitive), 'clickin:<css>|<text>' (same inside a selector),
 * 'scroll:<text>' (bring the element with that text to the top third),
 * 'top:<text>[|<px>]' (the label with exactly that text goes to the top of its scroll area, <px> below it: 16, or more under a fixed header),
 * 'wait:<ms>', 'js:<expression>', 'until:<expression>' (waits until it is true),
 * 'fill:<css>|<text>' (types into the last visible match), 'offline' / 'online' (the network),
 * 'push:<event|live-pack|hold>|<event title>' (what tapping that event's push does: the gig opens,
 * with the offline question for live-pack; hold opens the hold card),
 * 'now' (last step: capture at once, for a screen that moves in time),
 * 'member' (the demo user becomes a member of the band, as the e2e's setRole does),
 * 'seed:<name>' (changes the demo data with SEEDS[name], then reloads; one or more, first in a recipe),
 * 'lead:<step>' (runs the step on a second tab that stays the admin: the leader's phone,
 * for screens a member only sees while the leader drives; the two tabs share the demo data).
 */
const ME = '10000001-0000-4000-8000-000000000001';
const DB = 'bw-demo-db-v6';
/** A seed written as a function of the demo database (it runs in the page). */
const dbSeed = (fn) => `(() => { const db = JSON.parse(localStorage.getItem('${DB}') || '{}');
  const ok = (${fn})(db, '${ME}'); localStorage.setItem('${DB}', JSON.stringify(db)); return ok !== false; })()`;
const SEEDS = {
  // As e2e/support/live.ts: Weekly rehearsal gets Paper Boats, Harbor Lights and Superstition as focus songs.
  focus: `(() => {
    const k = 'bw-demo-db-v6';
    const db = JSON.parse(localStorage.getItem(k) || '{}');
    const reh = db.events.find((e) => e.title === 'Weekly rehearsal');
    const list = '20000000-0000-4000-8000-000000000990';
    if (!db.setlists.some((l) => l.id === list)) {
      db.setlists.push({ id: list, band_id: reh.band_id, name: 'Weekly focus', description: null, is_template: false, song_count: 3,
        total_duration_seconds: 660, created_by: reh.created_by, created_at: reh.created_at, updated_at: reh.created_at });
      ['Paper Boats', 'Harbor Lights', 'Superstition'].forEach((title, i) => db.setlist_songs.push({
        id: '20000000-0000-4000-8000-00000000099' + (i + 1), setlist_id: list, song_id: db.songs.find((s) => s.title === title).id,
        position: i + 1, set_number: 1, notes: null, created_at: reh.created_at }));
    }
    reh.setlist_id = list;
    localStorage.setItem(k, JSON.stringify(db));
    return !!reh;
  })()`,
  // Tonight's gig for the live shots: a New York venue, Paper Boats and Harbor Lights open the set.
  // Harbor Lights' chart: Verse (4 bars, played once) then Chorus, so Follow the tempo says
  // "Next: Chorus in 2 bars" on bar 3.
  live: dbSeed(`(db) => {
    const gig = db.events.find((e) => e.title === 'Rooftop Session');
    Object.assign(gig, { venue_name: 'The Loft', venue_address: null, venue_city: 'Brooklyn', venue_country: 'United States', currency: 'USD' });
    const song = (title) => db.songs.find((x) => x.title === title);
    const rows = db.setlist_songs.filter((r) => r.setlist_id === gig.setlist_id).sort((a, b) => a.set_number - b.set_number || a.position - b.position);
    rows[0].song_id = song('Paper Boats').id;
    rows[1].song_id = song('Harbor Lights').id;
    const chart = song('Harbor Lights').chord_chart;
    chart.sections[0].label = 'Verse';
    chart.sections[1].label = 'Chorus';
    for (const bar of chart.sections[0].bars) for (const k of ['repeatStart', 'repeatEnd', 'text']) delete bar[k];
  }`),
  // Paper Boats with voice parts (made-up lyrics) and who sings them: Lena P. the lead,
  // Marta C. the second voice, Sam O. and the demo user (Leo M.) the backing vocals.
  voices: dbSeed(`(db, me) => {
    const who = (name) => db.profiles.find((p) => String(p.full_name).startsWith(name)).id;
    Object.assign(db.songs.find((x) => x.title === 'Paper Boats'), {
      lyrics: [
        '# Verse 1',
        '[C]Paper boats on the [G]river',
        '{bv}(ooh, [Am]down the river){/bv}',
        '{v2}[C]Every light is a [G]letter{/v2}',
        '[F]Nobody signs their [G]name',
        '',
        '# Chorus',
        '{all}[F]Hold the [G]line, hold the [C]line{/all}',
        '{bv}(hold the [G]line){/bv}',
        '[F]Morning comes in [G]time',
        '{bv}(right on [C]time){/bv}',
      ].join('\\n'),
      vocal_parts: { lead: [who('Lena')], v2: [who('Marta')], bv: [who('Sam'), me] },
    });
  }`),
  // Four of the five members have tonight's setlist on their phone (Lena P. hasn't).
  ready: dbSeed(`(db, me) => {
    const gig = db.events.find((e) => e.title === 'Rooftop Session');
    const lena = db.profiles.find((p) => String(p.full_name).startsWith('Lena')).id;
    db.live_pack_status = db.event_members
      .filter((m) => m.event_id === gig.id && m.status !== 'declined' && m.user_id !== lena && m.user_id !== me)
      .map((m, i) => ({ event_id: gig.id, user_id: m.user_id, device_id: 'device-' + i, version: 'v1', downloaded_at: new Date().toISOString() }));
  }`),
  // The quote on hold (Jazz Club Night) in New York, with the members' answers.
  hold: dbSeed(`(db) => {
    const ev = db.events.find((e) => e.title === 'Jazz Club Night');
    Object.assign(ev, { venue_name: 'The Blue Room', venue_address: null, venue_city: 'New York', venue_country: 'United States', currency: 'USD' });
    const who = (name) => db.profiles.find((p) => String(p.full_name).startsWith(name)).id;
    const at = new Date(Date.now() - 3600000).toISOString();
    db.event_hold_answers = [['Marta', 'free'], ['Sam', 'free'], ['Lena', 'busy']]
      .map(([name, answer]) => ({ event_id: ev.id, user_id: who(name), answer, answered_at: at }));
  }`),
  // Money in dollars, for the screens around a US example (admins read the currency from the pricing sheet).
  usd: dbSeed(`(db) => {
    for (const b of db.bands) Object.assign(b, { pricing_currency: 'USD', pricing_settings: { ...b.pricing_settings, currency: 'USD' } });
    for (const k of Object.keys(localStorage)) if (k.startsWith('bandwith_pricing_settings_')) localStorage.removeItem(k);
    for (const e of db.events) e.currency = 'USD';
    for (const q of db.quotes) q.currency = 'USD';
  }`),
};
// Stage mode on tonight's gig: a phone goes straight in from Home; tablet and web open the gig
// beside the calendar first, and Stage mode is its play button.
const STAGE = ['click:Go live', 'wait:1500'];
const STAGE_WIDE = [...STAGE, 'click:Open stage mode', 'wait:1500'];
const SONG_TAB = ['click:Lyrics & chords', 'wait:1200'];
const COUNT_2 = ['click:Count in the band', `until:document.querySelector('[data-testid="countin-number"]')?.textContent === '2'`, 'wait:120', 'now'];
// The leader (second tab) goes to Harbor Lights and turns Follow the tempo on (the switch is kept
// on the device, so the member's tab has it on too), the member opens the chord chart, the leader starts.
const follow = (stage) => ['seed:live', 'member', ...stage.map((s) => `lead:${s}`), 'lead:click:Next song', 'lead:wait:800', ...SONG_TAB.map((s) => `lead:${s}`),
  'lead:click:Follow the tempo', 'lead:wait:600', ...stage, ...SONG_TAB, 'click:Chord chart', 'wait:800', 'lead:clickin:[data-follow-strip]|Start',
  `until:/Chorus in 2 bars/.test(document.querySelector('[data-follow-strip]')?.innerText || '')`, 'wait:400', 'now'];
// With no signal, in Stage mode: a note of mine on Paper Boats and a note for the band, both waiting on the phone.
const offlineNotes = (openStage) => ['seed:live', 'member', 'push:event|Rooftop Session', 'offline', ...openStage, ...SONG_TAB,
  'click:Add note', 'wait:800', 'click:Got it', 'wait:800', 'click:Whole song', 'wait:800', 'fill:[role=dialog] textarea|Capo 2 on the last chorus', 'click:Save note', 'wait:1500',
  'click:Add note', 'wait:800', 'click:Whole song', 'wait:800', 'fill:[role=dialog] textarea|Count in 4 before the bridge', 'click:Suggest to the band', 'wait:1000', 'click:Send suggestion', 'wait:2500'];
// Harbor Lights' form, step 2: 6/8, a 2-bar count-in, the band in one beat early.
const SONG_FORM = ['click:Repertoire', 'wait:800', 'click:Actions for Harbor Lights', 'wait:600', 'click:Edit', 'wait:1200', 'click:Next', 'wait:1200',
  'click:Time signature 6/8', 'click:2 bars', 'click:One beat earlier', 'wait:500'];
// Tablet and web keep the song list beside the song: clicking a row lower down leaves the list scrolled
// to it, its header cut. This puts the list back at its top (the gap is more than the header is tall).
const LIST_TOP = 'top:Songs & setlists|400';
const CENTER = (css) => `js:[...document.querySelectorAll('${css}')].filter((e) => e.getBoundingClientRect().width > 0)[0].scrollIntoView({ block: 'center' })`;
const RECIPES = {
  'gig-workspace-admin': ['click:Calendar', 'click:Client A — Wedding', 'wait:1200'],
  'gig-workspace-member': ['member', 'click:Calendar', 'click:Client A — Wedding', 'wait:1200', 'scroll:Your fee'],
  'music-reader': ['click:Repertoire', 'click:Actions for Harbor Lights', 'wait:500', 'click:Chord chart', 'wait:1200', 'click:Lyrics & chords', 'wait:800'],
  'music-reader@wide': ['click:Repertoire', 'click:Actions for Harbor Lights', 'wait:500', 'click:Chord chart', 'wait:1200', 'click:Lyrics & chords', 'wait:800', LIST_TOP],
  // Weekly rehearsal (tomorrow) with focus songs, in Live mode on the current song.
  'music-rehearsal-live': ['seed:focus', 'click:Calendar', 'wait:800', "js:(() => { const cells = [...document.querySelectorAll('[aria-label]')].filter((e) => /^\\w+day, /.test(e.getAttribute('aria-label'))); const i = cells.findIndex((e) => /today/.test(e.getAttribute('aria-label'))); cells[i + 1].click(); return true; })()", 'wait:1500', 'click:Open live mode', 'wait:1500', 'click:Lyrics & chords', 'wait:1000'],
  'music-song-only': ['seed:focus', 'click:Calendar', 'wait:800', "js:(() => { const cells = [...document.querySelectorAll('[aria-label]')].filter((e) => /^\\w+day, /.test(e.getAttribute('aria-label'))); const i = cells.findIndex((e) => /today/.test(e.getAttribute('aria-label'))); cells[i + 1].click(); return true; })()", 'wait:1500', 'click:Open live mode', 'wait:1500', 'click:Lyrics & chords', 'wait:1000', 'click:Full screen', 'wait:1200'],
  // The lyrics correction on Paper Boats, with Changes selected.
  'music-suggestions': ['click:Repertoire', 'wait:800', 'click:Suggestions from members', 'wait:1200', 'click:Paper Boats Lyrics correction', 'wait:1200'],
  'music-suggestions@wide': ['click:Repertoire', 'wait:800', 'click:Suggestions from members', 'wait:1200', 'click:Paper Boats Lyrics correction', 'wait:1200', LIST_TOP],
  'music-stage': ['click:Go live', 'wait:1500'],
  // Tablet and web: Go live opens the gig beside the calendar; Stage mode is its play button.
  'music-stage@wide': ['click:Go live', 'wait:1500', 'click:Open stage mode', 'wait:1500'],
  'people-band-members': ['click:Members', 'wait:1000'],
  // Jazz Club Night: Lena P. declined, so the availability sheet offers Find a deputy.
  'people-find-deputy': ['click:Calendar', 'wait:800', 'click:Jazz Club Night', 'wait:1500', 'click:Open availability details', 'wait:1200', 'click:Find a deputy', 'wait:1500'],
  'people-invite': ['click:Members', 'wait:1000', 'click:Invite member', 'wait:800',
    "js:(() => { const i = document.querySelector('[role=dialog] input'), set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'mar'), i.dispatchEvent(new Event('input', { bubbles: true })), i.focus() })()", 'wait:1200'],
  // ── Live release: voice parts, the count-in, Follow the tempo, offline, date on hold ──
  // A member who sings the backing vocals, Highlight my part on (the first-time hint closed).
  'voice-parts-stage': ['seed:live', 'seed:voices', 'member', ...STAGE, ...SONG_TAB, 'click:Got it'],
  'voice-parts-stage@wide': ['seed:live', 'seed:voices', 'member', ...STAGE_WIDE, ...SONG_TAB, 'click:Got it'],
  'who-sings-what': ['seed:live', 'seed:voices', ...STAGE, ...SONG_TAB, 'click:Got it', 'click:Who sings what', 'wait:1000', 'click:This gig only', 'wait:800'],
  'who-sings-what@wide': ['seed:live', 'seed:voices', ...STAGE_WIDE, ...SONG_TAB, 'click:Got it', 'click:Who sings what', 'wait:1000', 'click:This gig only', 'wait:800'],
  // The chord editor on the first word of a backing line: Voice with Whole line and Backing pressed.
  'voice-picker': ['seed:voices', 'click:Repertoire', 'wait:800', 'click:Actions for Paper Boats', 'wait:600', 'click:Edit chords', 'wait:1500', 'click:(ooh,', 'wait:1000'],
  'voice-picker@wide': ['seed:voices', 'click:Repertoire', 'wait:800', 'click:Actions for Paper Boats', 'wait:600', 'click:Edit chords', 'wait:1500', 'click:(ooh,', 'wait:1000', LIST_TOP],
  'song-live-fields': [...SONG_FORM, 'top:BPM'],
  'song-live-fields@web': [...SONG_FORM, 'top:BPM', LIST_TOP],
  // The tablet's form is shorter: it starts one row lower to reach Played with a backing track.
  'song-live-fields@tablet': [...SONG_FORM, 'top:Transpose for the band|10', LIST_TOP],
  // The leader's Count in on Paper Boats (96 BPM, 4/4), caught on beat 2.
  'stage-count-in': ['seed:live', ...STAGE, ...COUNT_2],
  'stage-count-in@wide': ['seed:live', ...STAGE_WIDE, ...COUNT_2],
  'stage-follow-tempo': follow(STAGE),
  'stage-follow-tempo@wide': follow(STAGE_WIDE),
  // The "setlist ready without signal" push, tapped by a member who was never asked.
  'live-pack-consent': ['seed:live', 'member', 'push:live-pack|Rooftop Session', 'wait:800'],
  'live-offline-ready': ['seed:live', 'seed:ready', 'seed:usd', 'push:event|Rooftop Session', 'click:Offline: 4 of 5 members ready', 'wait:600', CENTER('[role=group][aria-label=Offline]')],
  // Two setlists kept (tonight's gig and tomorrow's rehearsal), then Settings › Offline & live with Automatic download on.
  'settings-offline-live': ['seed:live', 'seed:focus', 'member', 'push:event|Rooftop Session', 'click:Back', 'wait:800', 'push:event|Weekly rehearsal', 'click:Back', 'wait:800',
    'click:Settings', 'wait:1200', 'click:Settings & account', 'wait:1200', 'click:Offline & live', 'wait:1000', 'click:Automatic download', 'wait:800'],
  'stage-offline-banner': offlineNotes(['click:Open stage mode', 'wait:1500']),
  // Jazz Club Night is still a quote: the member's hold card on Home, answered; the admin's Who's free on the quote's event.
  'quote-hold-card': ['seed:hold', 'seed:live', 'seed:usd', 'member', "clickin:[data-testid=date-hold-card]|I'm free", 'wait:800', 'top:Possible gigs|100'],
  'quote-hold-answers': ['seed:hold', 'seed:live', 'seed:usd', 'push:event|Jazz Club Night', CENTER('[data-testid=date-hold-answers]')],
};

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const base = opt('--base', 'http://localhost:5185');
const devices = opt('--devices', 'phone,tablet,web').split(',');
const explore = opt('--explore', null);
// Another folder for the .webp files: look at a new capture beside the old one before replacing it.
const shotsDir = path.resolve(opt('--out', SHOTS));
const ids = explore !== null ? ['explore'] : (args[0] || '').split(',').filter(Boolean);
if (!ids.length) {
  console.error('usage: capture.mjs <shot-id>[,…] [--devices phone,tablet,web] | --explore "<steps>"');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'bw-capture-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--no-first-run', '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve(m[1]);
    });
    proc.on('exit', () => reject(new Error('Chrome exited')));
  });
  const port = new URL(wsUrl).port;
  const sockets = [];
  /** A DevTools session on one page target: its `send`. */
  const attach = async (target) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    sockets.push(ws);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    return send;
  };
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const send = await attach(targets.find((t) => t.type === 'page'));
  /** A second tab of the same browser (same site data): another phone of the band. */
  const newTab = async () => {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    return { send: await attach(target), close: () => fetch(`http://127.0.0.1:${port}/json/close/${target.id}`) };
  };
  const close = async () => {
    for (const ws of sockets) ws.close();
    const exited = new Promise((r) => proc.once('exit', r));
    proc.kill();
    // A Chrome left offline can be slow to quit: don't wait for it forever.
    if (!(await Promise.race([exited.then(() => true), sleep(5000)]))) proc.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { send, newTab, close };
}

async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

const FIND = `(scope, text) => {
  const want = text.toLowerCase();
  const els = [...scope.querySelectorAll('button, a, [role=button], [role=tab], [role=link], li, [tabindex]')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const label = (el) => (el.getAttribute('aria-label') || el.innerText || '').trim().toLowerCase().replace(/\\s+/g, ' ');
  const hit = els.find((el) => label(el) === want) || els.find((el) => label(el).startsWith(want));
  if (hit) return hit;
  // Cards without a role: the smallest visible element whose text starts with it.
  const any = [...scope.querySelectorAll('*')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && (el.innerText || '').trim().toLowerCase().replace(/\s+/g, ' ').startsWith(want);
  });
  return any.sort((a, b) => a.innerText.length - b.innerText.length)[0] || els.find((el) => label(el).includes(want));
}`;

async function step(send, s) {
  const [kind, ...rest] = s.split(':');
  const arg = rest.join(':');
  if (kind === 'wait') return sleep(Number(arg));
  if (kind === 'js') {
    const value = await evaluate(send, arg);
    if (explore !== null && value !== undefined) console.log(`js → ${JSON.stringify(value)}`);
    return value;
  }
  if (kind === 'now') return undefined;
  if (kind === 'push') {
    // What tapping a push does (src/lib/notificationRouting.ts): the app's own push-navigate event.
    const [what, title] = [arg.slice(0, arg.indexOf('|')), arg.slice(arg.indexOf('|') + 1)];
    const detail = { event: `{ screen: 'event', eventId: id }`, 'live-pack': `{ screen: 'event', eventId: id, livePack: true }`, hold: `{ screen: 'home', holdEventId: id }` }[what];
    if (!detail) throw new Error(`unknown push: ${s}`);
    const ok = await evaluate(send, `(() => {
      const id = JSON.parse(localStorage.getItem('${DB}') || '{}').events?.find((e) => e.title === ${JSON.stringify(title)})?.id;
      if (id) window.dispatchEvent(new CustomEvent('push-navigate', { detail: ${detail} }));
      return !!id; })()`);
    if (!ok) throw new Error(`no such event: ${s}`);
    return sleep(3000);
  }
  if (kind === 'offline' || kind === 'online') {
    await send('Network.emulateNetworkConditions', { offline: kind === 'offline', latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    return sleep(800);
  }
  if (kind === 'top') {
    // The label with exactly this text (in the layer on top, when there are several) goes to the top of its scroll area.
    const [text, gap = '16'] = arg.split('|');
    const ok = await evaluate(send, `(() => {
      const want = ${JSON.stringify(text.toLowerCase())};
      const hits = [...document.querySelectorAll('body *')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (el.innerText || '').trim().toLowerCase() === want;
      });
      const layer = [...document.querySelectorAll('[role=dialog]')].filter((d) => hits.some((h) => d.contains(h))).pop();
      const el = hits.filter((h) => !layer || layer.contains(h)).pop();
      if (!el) return false;
      el.scrollIntoView({ block: 'start' });
      let p = el.parentElement;
      while (p) { if (p.scrollHeight > p.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(p).overflowY)) { p.scrollTop -= (${Number(gap)}); break; } p = p.parentElement; }
      if (!p) window.scrollBy(0, -(${Number(gap)}));
      return true; })()`);
    if (!ok) throw new Error(`not found: ${s}`);
    return sleep(500);
  }
  if (kind === 'until') {
    for (let tries = 0; tries < 750; tries++) {
      if (await evaluate(send, `!!(${arg})`)) return undefined;
      await sleep(40);
    }
    throw new Error(`never true: ${s}`);
  }
  if (kind === 'fill') {
    const [sel, text] = [arg.slice(0, arg.indexOf('|')), arg.slice(arg.indexOf('|') + 1)];
    for (let tries = 0; tries < 20; tries++) {
      const ok = await evaluate(send, `(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.getBoundingClientRect().width > 0).pop();
        if (!el) return false;
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(text)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true; })()`);
      if (ok) return sleep(300);
      await sleep(300);
    }
    throw new Error(`not found: ${s}`);
  }
  if (kind === 'click' || kind === 'clickin' || kind === 'scroll') {
    const [sel, text] = kind === 'clickin' ? arg.split('|') : ['body', arg];
    for (let tries = 0; tries < 20; tries++) {
      const ok = await evaluate(send, `(() => { const el = (${FIND})(document.querySelector(${JSON.stringify(sel)}), ${JSON.stringify(text)});
        if (!el) return false;
        ${kind === 'scroll'
          ? `el.scrollIntoView({ block: 'start' }); let p = el.parentElement; while (p) { if (p.scrollHeight > p.clientHeight) { p.scrollTop -= p.clientHeight / 4; break; } p = p.parentElement; }`
          : `el.scrollIntoView({ block: 'center' }); el.click();`}
        return true; })()`);
      if (ok) return sleep(500);
      await sleep(300);
    }
    throw new Error(`not found: ${s}`);
  }
  throw new Error(`unknown step: ${s}`);
}

/**
 * The page's clock, set to 9:41 in the morning of the capture day and running from there: what a
 * screen shows no longer depends on the hour of the capture (Stage mode fades the times already
 * past, "updated 18:31"…). One offset for every tab and reload of a capture, so two phones agree.
 */
const clockScript = (offset) => `(() => {
  const Real = Date;
  class Clock extends Real {
    constructor(...args) { if (args.length) super(...args); else super(Real.now() + ${offset}); }
    static now() { return Real.now() + ${offset}; }
  }
  window.Date = Clock;
})()`;
const clocks = new Map();
async function setClock(send, offset) {
  if (clocks.has(send)) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clocks.get(send) });
  clocks.set(send, (await send('Page.addScriptToEvaluateOnNewDocument', { source: clockScript(offset) })).identifier);
}

/** The device's screen, in the dark theme (the app follows the system setting; Academy shots are dark). */
async function emulate(send, d) {
  await send('Emulation.setDeviceMetricsOverride', { width: d.width, height: d.height, deviceScaleFactor: 2, mobile: d.mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: d.mobile });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
}

/** The demo raises an urgent alert a moment after load: wait for it and close it. */
async function dismissAlert(send) {
  for (let i = 0; i < 16; i++) {
    const closed = await evaluate(send, `(() => { const b = document.querySelector('[aria-label="Dismiss alert"]'); if (b) { b.click(); return true; } return false; })()`);
    if (closed) break;
    await sleep(500);
  }
  await sleep(600);
}

async function capture({ send, newTab }, device, shotId, steps) {
  const d = DEVICES[device];
  const today = new Date();
  const clock = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 41, 0).getTime() - Date.now();
  await emulate(send, d);
  await setClock(send, clock);
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await send('Storage.clearDataForOrigin', { origin: new URL(base).origin, storageTypes: 'all' });
  await send('Page.navigate', { url: base });
  await sleep(1500);
  await evaluate(send, `(() => {
    localStorage.setItem('bw-demo-session', '1');
    for (const r of ['admin', 'member', 'deputy']) localStorage.setItem('bw-role-tour-seen:' + r, '1');
    localStorage.setItem('bw-song-view', 'chords');
  })()`);
  await send('Page.reload', {});
  await sleep(3500);
  const seeds = steps.filter((s) => s.startsWith('seed:'));
  for (const seed of seeds) {
    if (!SEEDS[seed.slice(5)]) throw new Error(`unknown seed: ${seed}`);
    if (!(await evaluate(send, SEEDS[seed.slice(5)]))) throw new Error(`seed failed: ${seed}`);
  }
  // The leader's phone: a second tab, opened while the demo user is still the admin.
  let lead = null;
  if (steps.some((s) => s.startsWith('lead:'))) {
    lead = await newTab();
    await emulate(lead.send, d);
    await setClock(lead.send, clock);
    await lead.send('Page.navigate', { url: base });
    await sleep(3500);
    await dismissAlert(lead.send);
  }
  // A member's phone: the role in the demo data, read at load (a tab already open keeps its own).
  if (steps.includes('member')) {
    await evaluate(send, dbSeed(`(db, me) => { for (const m of db.band_members) if (m.user_id === me) m.role = 'member'; }`));
    // Like a fresh install of that member's phone: nothing cached from the admin's session
    // (with the leader's tab open the cache stays: deleting a database in use would block the reload).
    if (!lead) await evaluate(send, `(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('bw:')) localStorage.removeItem(k); indexedDB.deleteDatabase('bandwith_offline_db'); })()`);
  }
  // Only the tab in front draws: each step first brings its own tab forward.
  let front = lead ? lead.send : send;
  const on = async (tab) => {
    if (front !== tab) {
      await tab('Page.bringToFront');
      await sleep(200);
    }
    return (front = tab);
  };
  await on(send);
  if (seeds.length || steps.includes('member')) {
    await send('Page.reload', {});
    await sleep(3500);
  }
  await dismissAlert(send);
  for (const s of steps) {
    if (s === 'member' || s.startsWith('seed:')) continue;
    if (s.startsWith('lead:')) await step(await on(lead.send), s.slice(5));
    else await step(await on(send), s);
  }
  await on(send);
  if (steps.at(-1) !== 'now') await sleep(800);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  if (lead) await lead.close();
  mkdirSync(OUT, { recursive: true });
  const png = path.join(OUT, `${shotId}@${device}.png`);
  writeFileSync(png, Buffer.from(data, 'base64'));
  if (shotId === 'explore') {
    const labels = await evaluate(send, `[...document.querySelectorAll('button, a, [role=button], [role=tab]')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; })
      .map((el) => (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\\s+/g, ' ')).filter(Boolean)`);
    console.log(labels.join(' | '));
    console.log(png);
    return;
  }
  mkdirSync(shotsDir, { recursive: true });
  const webp = path.join(shotsDir, `${shotId}@${device}.webp`);
  execFileSync('cwebp', ['-quiet', '-q', '82', '-resize', String(d.webp), '0', png, '-o', webp]);
  console.log(`${shotId}@${device}`);
}

const browser = await launch();
try {
  for (const device of devices) {
    for (const shotId of ids) {
      // Steps are split at ';' before a step name, so a js: step may hold semicolons.
      const steps = shotId === 'explore' ? (explore || '').split(/;(?=(?:lead:)?(?:click|clickin|scroll|top|push|wait|js|until|fill|offline|online|now|member|seed)(?::|;|$))/).filter(Boolean)
        : RECIPES[`${shotId}@${device}`] || (device !== 'phone' && RECIPES[`${shotId}@wide`]) || RECIPES[shotId];
      if (!steps) throw new Error(`no recipe for ${shotId}`);
      await capture(browser, device, shotId, steps);
    }
  }
} finally {
  await browser.close();
}
// Sockets closing behind a killed Chrome must not keep the script alive.
process.exit(process.exitCode ?? 0);
