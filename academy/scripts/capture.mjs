#!/usr/bin/env node
/**
 * Captures Academy screenshots from the web demo with headless Chrome, over the
 * DevTools protocol (no puppeteer: Node's built-in WebSocket is enough).
 *
 *   VITE_DEMO_MODE=true npx vite --port 5185 --strictPort   # in another shell
 *   node academy/scripts/capture.mjs <shot-id>[,<shot-id>…] [--devices phone,tablet,web] [--base http://localhost:5185]
 *   node academy/scripts/capture.mjs --explore "<step>;<step>" --devices phone   # prints the buttons on screen, saves out/explore.png
 *
 * Each capture starts from empty site data: demo session on, role tours seen,
 * song view on Chords, then the late urgent alert is dismissed. The steps for a
 * shot live in RECIPES below (click by visible text or aria-label, scroll, wait).
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
 * 'wait:<ms>', 'js:<expression>', 'member' (demo user becomes a member, see demo seed).
 */
const RECIPES = {
  'gig-workspace-admin': ['click:Calendar', 'click:Client A — Wedding', 'wait:1200'],
  'gig-workspace-member': ['member', 'click:Calendar', 'click:Client A — Wedding', 'wait:1200', 'scroll:Your fee'],
  'music-reader': ['click:Repertoire', 'click:Actions for Harbor Lights', 'wait:500', 'click:Chords', 'wait:1200', 'click:Chords', 'wait:800'],
  'music-stage': ['click:Go live', 'wait:1500'],
  // Tablet and web: Go live opens the gig beside the calendar; Stage mode is its play button.
  'music-stage@wide': ['click:Go live', 'wait:1500', 'click:Open stage mode', 'wait:1500'],
  'people-band-members': ['click:Members', 'wait:1000'],
};

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const base = opt('--base', 'http://localhost:5185');
const devices = opt('--devices', 'phone,tablet,web').split(',');
const explore = opt('--explore', null);
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
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
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
  const close = async () => {
    ws.close();
    const exited = new Promise((r) => proc.once('exit', r));
    proc.kill();
    await exited;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { send, close };
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
  if (kind === 'js') return evaluate(send, arg);
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

async function capture(send, device, shotId, steps) {
  const d = DEVICES[device];
  await send('Emulation.setDeviceMetricsOverride', { width: d.width, height: d.height, deviceScaleFactor: 2, mobile: d.mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: d.mobile });
  // Academy shots use the dark theme (the app follows the system setting).
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await send('Storage.clearDataForOrigin', { origin: new URL(base).origin, storageTypes: 'all' });
  await send('Page.navigate', { url: base });
  await sleep(1500);
  const member = steps.includes('member');
  await evaluate(send, `(() => {
    localStorage.setItem('bw-demo-session', '1');
    for (const r of ['admin', 'member', 'deputy']) localStorage.setItem('bw-role-tour-seen:' + r, '1');
    localStorage.setItem('bw-song-view', 'chords');
    ${member ? "localStorage.setItem('bw-demo-role', 'member');" : ''}
  })()`);
  await send('Page.reload', {});
  await sleep(3500);
  // The demo raises an urgent alert a moment after load: wait for it and close it.
  for (let i = 0; i < 16; i++) {
    const closed = await evaluate(send, `(() => { const b = document.querySelector('[aria-label="Dismiss alert"]'); if (b) { b.click(); return true; } return false; })()`);
    if (closed) break;
    await sleep(500);
  }
  await sleep(600);
  for (const s of steps) if (s !== 'member') await step(send, s);
  await sleep(800);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
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
  const webp = path.join(SHOTS, `${shotId}@${device}.webp`);
  execFileSync('cwebp', ['-quiet', '-q', '82', '-resize', String(d.webp), '0', png, '-o', webp]);
  console.log(`${shotId}@${device}`);
}

const { send, close } = await launch();
try {
  await send('Page.enable');
  await send('Runtime.enable');
  for (const device of devices) {
    for (const shotId of ids) {
      const steps = shotId === 'explore' ? (explore || '').split(';').filter(Boolean)
        : (device !== 'phone' && RECIPES[`${shotId}@wide`]) || RECIPES[shotId];
      if (!steps) throw new Error(`no recipe for ${shotId}`);
      await capture(send, device, shotId, steps);
    }
  }
} finally {
  await close();
}
