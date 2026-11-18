import { gsap } from 'gsap';

/**
 * Try it on the People page: Leo's phone (admin) and Ivo M.'s (deputy), built
 * in HTML so every control works. Leo opens Find a deputy for Lena P. and asks
 * Ivo in the app; Ivo answers in Deputy gigs. Labels are the app's own
 * (AskDeputySheet, DeputyGigsList, migrations 084/086 for the notifications).
 */

export type Answer = 'available' | 'maybe' | 'unavailable';
export type ReqStatus = 'pending' | Answer | 'cancelled';
export interface PeopleState {
  sheet: boolean;              // Leo: the Find a deputy sheet is open
  req: ReqStatus | null;       // Ivo's request, null = never asked
  note: string;                // Ivo's message to the band
  editing: boolean;            // Ivo: Change your answer is open
  sent: '' | 'sent' | 'throttled';
}
export const initialPeople = (): PeopleState => ({ sheet: false, req: null, note: '', editing: false, sent: '' });

/** What Leo reads under Ivo's name (DEPUTY_STATUS_LABEL). */
export const LEO_STATUS: Record<ReqStatus, string> = {
  pending: 'Asked · no answer yet', available: 'Available', maybe: 'Will confirm later', unavailable: 'Can’t make it', cancelled: 'Request cancelled',
};
/** What Ivo reads on his request. */
export const IVO_STATUS: Record<ReqStatus, string> = {
  pending: 'Waiting for your answer', available: 'You said yes', maybe: 'You’ll confirm later', unavailable: 'You said you can’t', cancelled: 'Request withdrawn',
};
/** The admins' notification title (084). */
export const ADMIN_PUSH: Record<Answer, string> = { available: 'Ivo M. is available', maybe: 'Ivo M. will confirm later', unavailable: 'Ivo M. can’t make it' };

const open = (s: PeopleState) => !!s.req && s.req !== 'cancelled';
export const addressShown = (s: PeopleState) => s.req === 'available';
export const showAnswers = (s: PeopleState) => open(s) && (s.req === 'pending' || s.editing);
export const inAppLabel = (s: PeopleState) => (s.req === 'available' ? 'Recap in the app' : 'Ask in the app');
/** 1 Find a deputy · 2 Ask in the app · 3 Answer · 4 answered. */
export const stepOf = (s: PeopleState) => (!open(s) ? (s.sheet ? 2 : 1) : s.req === 'pending' ? 3 : 4);

export const find = (s: PeopleState): PeopleState => ({ ...s, sheet: true });
export const close = (s: PeopleState): PeopleState => ({ ...s, sheet: false });
/** In-app request (or recap after a yes); a second tap is throttled, like the app's 2 minutes. */
export const ask = (s: PeopleState): PeopleState =>
  s.sent ? { ...s, sent: 'throttled' } : { ...s, req: open(s) ? s.req : 'pending', note: open(s) ? s.note : '', sent: 'sent', editing: false };
export const answer = (s: PeopleState, a: Answer, note = ''): PeopleState =>
  open(s) ? { ...s, req: a, note: note.trim().slice(0, 140), editing: false, sent: '' } : s;
export const cancelRequest = (s: PeopleState): PeopleState => (open(s) ? { ...s, req: 'cancelled', editing: false, sent: '' } : s);

const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const ico = (id: string) => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const tone = (r: ReqStatus) => (r === 'available' ? 'yes' : r === 'unavailable' ? 'no' : r === 'cancelled' ? 'off' : 'wait');
const status = (r: ReqStatus, label: string) => `<p class="pdst" data-tone="${tone(r)}" role="status">${label}</p>`;
const btn = (k: string, act: string, cls: string, label: string, extra = '') =>
  `<button type="button" class="pdb ${cls}" data-k="${k}" data-act="${act}"${extra}>${label}</button>`;

const LINEUP: [string, string, string][] = [['LM', 'Leo M.', 'Bass'], ['S', 'Sara', 'Vocals'], ['N', 'Nico', 'Drums'], ['T', 'Tom', 'Guitar'], ['LP', 'Lena P.', 'Keys']];

function leoHtml(s: PeopleState, copied: boolean) {
  const rows = LINEUP.map(([ini, n, inst]) => {
    const out = n === 'Lena P.';
    return `<li class="pdl__row${out ? ' is-out' : ''}"><span class="pdl__av">${ini}</span><span class="pdl__n"><b>${n}</b><em>${inst}</em></span>` +
      `<span class="pdl__st">${out ? 'Declined' : 'Confirmed'}</span>${out ? btn('find', 'find', 'pdb--white pdl__find', 'Find a deputy') : ''}</li>`;
  }).join('');
  const asked = open(s)
    ? `<p class="pds__lab">Deputies asked</p><button type="button" class="pda" data-k="asked" data-act="find"><span class="pda__n"><b>Ivo M.</b><em>for Lena P.${s.note ? ` · “${esc(s.note)}”` : ''}</em></span>${status(s.req!, LEO_STATUS[s.req!])}</button>`
    : '';
  const req = s.req;
  const ivo = `<li class="pdd__c"><p class="pdd__n"><b>Ivo M.</b><span class="pdtag">On BandWith</span></p><p class="pdd__l">Keys · usual fee €180</p>` +
    (req ? `<div class="pdd__st">${status(req, LEO_STATUS[req])}${s.note && open(s) ? `<p class="pdd__q">“${esc(s.note)}”</p>` : ''}</div>` : '') +
    btn('ask', 'ask', 'pdb--lime', `${ico('bell')}${inAppLabel(s)}`) +
    (s.sent ? `<p class="pdd__sent" role="status">${s.sent === 'sent' ? 'Sent in the app: they get a notification.' : 'Already sent a moment ago.'}</p>` : '') +
    `<p class="pdd__or">Or by message</p><div class="pdd__msg">` +
    btn('wa-ivo', 'msg', 'pdb--white', `${ico('message-circle')}WhatsApp`) + btn('sms-ivo', 'msg', 'pdb--white', `${ico('smartphone')}SMS`) + btn('em-ivo', 'msg', 'pdb--white', `${ico('mail')}Email`) + `</div>` +
    (open(s) ? `<div class="pdd__links">${btn('copy', 'copy', 'pdlink', copied ? 'Link copied' : 'Copy link')}${btn('cancel', 'cancel', 'pdlink', 'Cancel request')}</div>` : '') + `</li>`;
  const luca = `<li class="pdd__c"><p class="pdd__n"><b>Luca T.</b></p><p class="pdd__l">Bass · usual fee €180</p><div class="pdd__msg">` +
    btn('wa-luca', 'msg', 'pdb--lime', `${ico('message-circle')}WhatsApp`) + btn('sms-luca', 'msg', 'pdb--white', `${ico('smartphone')}SMS`) + btn('em-luca', 'msg', 'pdb--white', `${ico('mail')}Email`) + `</div></li>`;
  const sheet = s.sheet
    ? `<section class="pds pds--dep" aria-label="Find a deputy"><span class="pds__grab"></span>` +
      `<div class="pds__top"><div><p class="pds__over">Replacing Lena P. · Keys</p><h3 class="pds__t">Find a deputy</h3></div>` +
      `<button type="button" class="pds__x" data-k="close" data-act="close" aria-label="Close Find a deputy">${ico('x')}</button></div>` +
      `<p class="pds__p">Send a request for Client A — Wedding · Sat, 21 Nov 2026. It opens WhatsApp, Messages or Mail with the details and a link: the deputy answers in one tap, no app needed, and you get a notification. Deputies on BandWith get it in the app.</p>` +
      `<ul class="pdd" aria-label="Deputies">${ivo}${luca}</ul></section>`
    : '';
  return `<div class="pdp__screen">` +
    `<div class="pdg"><p class="pdp__kick"><span class="pdp__dot"></span>Gig · Sat 21 Nov</p><p class="pdp__title">Client A — Wedding</p><p class="pdp__sub">Villa Necchi · Milan</p></div>` +
    `<section class="pds pds--line" aria-label="Lineup · 5"${s.sheet ? ' inert' : ''}><span class="pds__grab"></span><h3 class="pds__h">Lineup · 5</h3><ul class="pdl">${rows}</ul>${asked}</section>` +
    sheet + `</div>`;
}

function ivoHtml(s: PeopleState, draft: string) {
  const head = `<div class="pdv__head"><h3 class="pdv__h">Deputy gigs</h3><span class="pdv__help" aria-hidden="true">?</span></div>` +
    `<p class="pdv__line">Bands that call you as a deputy: Velvet Static</p>`;
  if (!s.req) return `<div class="pdp__screen pdp__screen--ivo">${head}<p class="pdv__empty">No requests right now. When a band asks you to play, it shows up here and you get a notification.</p></div>`;
  const rows: [string, string][] = [['Date', 'Saturday, November 21'], ['Load-in', '15:00'], ['Soundcheck', '16:30'], ['Show', '20:30'], ['Venue', 'Villa Necchi'], ['City', 'Milan']];
  if (addressShown(s)) rows.push(['Address', 'Via Mozart 14']);
  rows.push(['Role', 'Keys'], ['Fee offered', '€180']);
  const dl = rows.map(([k, v]) => `<dt>${k}</dt><dd${k === 'Address' ? ' class="is-addr"' : ''}>${v}</dd>`).join('');
  const answers = showAnswers(s)
    ? `<div class="pdr__ans"><p class="pdr__can">Can you make it?</p><label class="pdr__msg"><span>Message to the band (optional)</span>` +
      `<textarea data-pd-draft rows="2" maxlength="140" placeholder="e.g. I can bring my own amp">${esc(draft)}</textarea></label>` +
      btn('yes', 'answer', 'pdb--lime pdb--full', 'Yes', ' data-a="available"') + btn('maybe', 'answer', 'pdb--line pdb--full', 'Not sure yet', ' data-a="maybe"') +
      btn('no', 'answer', 'pdb--line pdb--full', 'No, I can’t', ' data-a="unavailable"') +
      (s.editing ? btn('ecancel', 'uncancel', 'pdlink', 'Cancel') : '') + `</div>`
    : open(s) ? `${s.note ? `<p class="pdr__q">“${esc(s.note)}”</p>` : ''}${btn('change', 'change', 'pdlink', 'Change your answer')}` : '';
  const after = addressShown(s) && !s.editing
    ? `<div class="pdr__go">${btn('maps', 'ext', 'pdb--line', `${ico('map-pin')}Open in Maps`)}${btn('cal', 'ext', 'pdb--line', `${ico('calendar')}Add to calendar`)}` +
      `${btn('gcal', 'ext', 'pdb--ghost', 'Google Calendar')}${btn('sub', 'ext', 'pdb--ghost', 'Subscribe to my gigs')}</div>`
    : '';
  const card = `<article class="pdr" aria-label="Client A — Wedding · Velvet Static"><p class="pdr__band">Velvet Static</p><p class="pdr__t">Client A — Wedding</p>` +
    `${status(s.req, IVO_STATUS[s.req])}<dl class="pdr__dl">${dl}</dl>${answers}${after}</article>`;
  return `<div class="pdp__screen pdp__screen--ivo">${head}${s.req === 'cancelled' ? '<p class="pdv__lab">Past and closed</p>' : ''}${card}</div>`;
}

const EXT: Record<string, string> = {
  maps: 'In the app, Open in Maps shows Villa Necchi, Via Mozart 14, Milan.',
  cal: 'In the app, Add to calendar saves the gig with the address.',
  gcal: 'In the app, Google Calendar opens the gig ready to save.',
  sub: 'Subscribe to my gigs adds a calendar feed of Ivo’s confirmed gigs with Velvet Static. It follows every change.',
};

export function initPeopleDemo(root: HTMLElement | null, reduce: boolean) {
  const leo = root?.querySelector<HTMLElement>('[data-pd-phone="leo"]');
  const ivo = root?.querySelector<HTMLElement>('[data-pd-phone="ivo"]');
  if (!root || !leo || !ivo) return;
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const note = q('[data-pd-note]'), log = q('[data-pd-log]'), addr = q('[data-pd-addr]');
  const wire = q('[data-pd-wire]'), wireLabel = q('[data-pd-wire-label]'), wireText = q('[data-pd-wire-text]');
  const jump = q<HTMLButtonElement>('[data-pd-jump]'), jumpLabel = q('[data-pd-jump-label]');
  const stacked = window.matchMedia('(max-width: 639px)');
  root.classList.add('is-live');

  let s = initialPeople();
  let draft = '';
  let copied = false;
  let minute = 0;
  let jumpTo: HTMLElement | null = null;
  const timers: number[] = [];
  const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));

  const say = (msg: string) => {
    if (!log) return;
    const li = document.createElement('li');
    const t = 10 * 60 + 12 + minute++;
    li.innerHTML = `<time>${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}</time><span>${msg}</span>`;
    log.prepend(li);
    while (log.children.length > 4) log.lastElementChild?.remove();
    if (!reduce) gsap.fromTo(li, { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.4 });
  };

  /** A notification banner on top of one phone's screen. */
  const push = (phone: HTMLElement, title: string, body: string) => {
    phone.querySelector('.pdpush')?.remove();
    const el = document.createElement('div');
    el.className = 'pdpush';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `<span class="pdpush__ic">${ico('bell')}</span><span class="pdpush__tx"><em>BandWith · now</em><b>${esc(title)}</b><span>${esc(body)}</span></span>`;
    phone.append(el);
    if (!reduce) gsap.fromTo(el, { yPercent: -130, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.5, ease: 'power3.out' });
    later(() => (reduce ? el.remove() : gsap.to(el, { yPercent: -130, autoAlpha: 0, duration: 0.4, onComplete: () => el.remove() })), 4200);
  };

  /** The wire between the phones: what just travelled, and which way. */
  const send = (label: string, text: string, toIvo: boolean, to: HTMLElement, jumpText: string) => {
    if (wireLabel) wireLabel.textContent = label;
    if (wireText) wireText.textContent = text;
    if (wireText && !reduce) gsap.fromTo(wireText, { autoAlpha: 0, x: toIvo ? -16 : 16 }, { autoAlpha: 1, x: 0, duration: 0.5, delay: 0.25 });
    wire?.setAttribute('data-dir', toIvo ? 'ivo' : 'leo');
    const dot = wire?.querySelector('i');
    if (dot && !reduce) gsap.fromTo(dot, { '--p': toIvo ? 0 : 1, autoAlpha: 1 }, { '--p': toIvo ? 1 : 0, duration: 0.6, ease: 'power2.inOut', onComplete: () => { gsap.set(dot, { autoAlpha: 0 }); } });
    // Stacked phones: point to the phone that changed when it is out of sight.
    const r = to.getBoundingClientRect();
    if (jump && jumpLabel && stacked.matches && (r.top > innerHeight * 0.6 || r.bottom < innerHeight * 0.4)) {
      jumpTo = to;
      jumpLabel.textContent = `${jumpText} ${r.top > 0 ? '↓' : '↑'}`;
      jump.hidden = false;
    }
  };

  /** Scroll a phone's own screen (not the page) to an element. */
  const reveal = (phone: HTMLElement, sel: string) => {
    const el = phone.querySelector<HTMLElement>(sel);
    const box = el?.closest<HTMLElement>('.pds, .pdp__screen--ivo');
    if (!el || !box) return;
    const top = box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight * 0.22;
    box.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
  };

  const render = () => {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.k;
    const keep = [leo.querySelector('.pds--dep'), ivo.querySelector('.pdp__screen--ivo')].map((x) => x?.scrollTop ?? 0);
    leo.querySelector('.pdp__screen')?.remove();
    ivo.querySelector('.pdp__screen')?.remove();
    leo.insertAdjacentHTML('afterbegin', leoHtml(s, copied));
    ivo.insertAdjacentHTML('afterbegin', ivoHtml(s, draft));
    const dep = leo.querySelector('.pds--dep'), scr = ivo.querySelector('.pdp__screen--ivo');
    if (dep) dep.scrollTop = keep[0];
    if (scr) scr.scrollTop = keep[1];
    const step = stepOf(s);
    root.querySelectorAll<HTMLElement>('[data-pd-step]').forEach((li) => {
      const n = Number(li.dataset.pdStep);
      li.classList.toggle('is-done', n < step);
      li.classList.toggle('is-cur', n === step);
    });
    const next = step === 1 ? 'find' : step === 2 ? 'ask' : step === 3 ? 'yes' : '';
    if (next) root.querySelector(`[data-k="${next}"]`)?.classList.add('is-next');
    if (addr) {
      addr.classList.toggle('is-open', addressShown(s));
      addr.innerHTML = addressShown(s) ? `${ico('map-pin')}Street address · Via Mozart 14, sent with his yes` : `${ico('lock')}Street address · hidden until he says yes`;
    }
    if (focusKey) root.querySelector<HTMLElement>(`[data-k="${focusKey}"]:not([disabled])`)?.focus({ preventScroll: true });
  };

  const reset = () => {
    timers.splice(0).forEach((t) => window.clearTimeout(t));
    root.querySelectorAll('.pdpush').forEach((x) => x.remove());
    s = initialPeople(); draft = ''; copied = false; minute = 0;
    if (log) log.innerHTML = '';
    if (note) note.textContent = '';
    if (wireLabel) wireLabel.textContent = 'Lena P. declined';
    if (wireText) wireText.textContent = 'Keys missing on Client A — Wedding';
    wire?.removeAttribute('data-dir');
    if (jump) jump.hidden = true;
    render();
    say('Lena P. declined <b>Client A — Wedding</b> · keys missing');
  };

  root.addEventListener('input', (e) => {
    const t = e.target as HTMLTextAreaElement;
    if (t.matches('[data-pd-draft]')) draft = t.value;
  });

  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b || !root.contains(b)) return;
    const act = b.dataset.act;
    let msg = '';
    b.closest('.pdp')?.querySelector('.pdpush')?.remove();
    if (act === 'find') {
      s = find(s); render();
      if (!reduce) gsap.fromTo(leo.querySelector('.pds--dep'), { yPercent: 100 }, { yPercent: 0, duration: 0.55, ease: 'power3.out' });
      msg = 'Deputies who play keys come first. Ivo M. is on BandWith, so Leo can ask him in the app.';
      leo.querySelector<HTMLElement>('[data-k="close"]')?.focus({ preventScroll: true });
    } else if (act === 'close') {
      s = close(s); render();
      leo.querySelector<HTMLElement>(open(s) ? '[data-k="asked"]' : '[data-k="find"]')?.focus({ preventScroll: true });
      if (open(s)) reveal(leo, '.pda');
      if (open(s)) msg = 'Closed. Under Deputies asked, the lineup keeps Ivo’s answer for Lena P.’s place.';
    } else if (act === 'ask') {
      const recap = s.req === 'available';
      const before = s.sent;
      s = ask(s); render();
      if (before) { msg = 'Already sent a moment ago: the same request goes out at most once every 2 minutes.'; }
      else if (recap) {
        push(ivo, 'You’re confirmed: Client A — Wedding', 'Client A — Wedding · Sat 21 Nov · Villa Necchi, Milan');
        send('Recap in the app →', '“You’re confirmed: Client A — Wedding”', true, ivo, 'Ivo’s phone: the recap');
        say('Leo sent Ivo the recap in the app'); msg = 'Ivo gets “You’re confirmed: Client A — Wedding”.';
      } else {
        push(ivo, 'Velvet Static: can you play?', 'Client A — Wedding · Sat 21 Nov · Villa Necchi, Milan');
        send('Request in the app →', '“Velvet Static: can you play?”', true, ivo, 'Ivo’s phone: new request');
        say('Leo asked <b>Ivo M.</b> in the app · <b>Asked · no answer yet</b>');
        msg = 'Ivo gets a notification. His request shows the date, times, venue, city, role and fee offered. No street address yet: it comes with a yes.';
        later(() => reveal(ivo, '.pdr__can'), reduce ? 0 : 900);
      }
    } else if (act === 'answer') {
      const a = b.dataset.a as Answer;
      s = answer(s, a, draft); draft = s.note; render();
      ivo.querySelector<HTMLElement>('[data-k="change"]')?.focus({ preventScroll: true });
      const body = `Client A — Wedding · Sat 21 Nov${s.note ? ` · "${s.note}"` : ''}`;
      push(leo, ADMIN_PUSH[a], body);
      send(`← ${a === 'available' ? 'Yes' : a === 'maybe' ? 'Not sure yet' : 'No, I can’t'}`, `“${ADMIN_PUSH[a]}”`, false, leo, `Leo’s phone: ${LEO_STATUS[a]}`);
      say(`Ivo answered · Leo reads <b>${LEO_STATUS[a]}</b>`);
      if (a === 'available') {
        msg = 'Leo gets “Ivo M. is available”. Ivo now sees the street address, Via Mozart 14, with Open in Maps.';
        const dd = ivo.querySelector('.is-addr');
        reveal(ivo, '.is-addr');
        if (dd && !reduce) gsap.fromTo(dd, { backgroundColor: 'rgba(213,251,70,.55)' }, { backgroundColor: 'rgba(213,251,70,0)', duration: 1.6, delay: 0.3 });
      } else if (a === 'maybe') msg = 'Leo gets “Ivo M. will confirm later”. The street address stays hidden until a yes.';
      else msg = 'Leo gets “Ivo M. can’t make it” and can ask the next deputy. Ivo can change his answer until the gig.';
      if (!s.sheet) reveal(leo, '.pda');
      else later(() => reveal(leo, '.pdd__st'), 0);
    } else if (act === 'change') {
      s = { ...s, editing: true }; draft = s.note; render();
      ivo.querySelector<HTMLElement>('[data-k="yes"]')?.focus({ preventScroll: true });
      reveal(ivo, '.pdr__can');
    } else if (act === 'uncancel') {
      s = { ...s, editing: false }; render();
      ivo.querySelector<HTMLElement>('[data-k="change"]')?.focus({ preventScroll: true });
    } else if (act === 'cancel') {
      s = cancelRequest(s); render();
      push(ivo, 'Velvet Static no longer needs you', 'Client A — Wedding · Sat 21 Nov: the request was withdrawn.');
      send('Request withdrawn →', '“Velvet Static no longer needs you”', true, ivo, 'Ivo’s phone: withdrawn');
      say('Leo cancelled the request · Ivo reads <b>Request withdrawn</b>');
      msg = 'Ivo gets “Velvet Static no longer needs you”. Leo can ask again.';
      leo.querySelector<HTMLElement>('[data-k="ask"]')?.focus({ preventScroll: true });
    } else if (act === 'copy') {
      copied = true; render();
      later(() => { copied = false; render(); }, 2000);
      msg = 'In the app this copies Ivo’s reply link. The link is the key: anyone who has it can answer.';
    } else if (act === 'msg') {
      msg = `${b.textContent?.trim()} opens on Leo’s phone with the gig details and a reply link. The deputy answers on a web page in one tap, no account needed. Here, try Ask in the app.`;
    } else if (act === 'ext') msg = EXT[b.dataset.k ?? ''] ?? '';
    if (note) note.textContent = msg;
  });

  jump?.addEventListener('click', () => {
    jumpTo?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    jump.hidden = true;
  });
  const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.target === jumpTo && x.intersectionRatio > 0.5 && jump) jump.hidden = true; }), { threshold: [0, 0.5, 1] });
  io.observe(leo); io.observe(ivo);
  new IntersectionObserver(([x]) => { if (!x.isIntersecting && jump) jump.hidden = true; }).observe(root);

  q('[data-pd-reset]')?.addEventListener('click', reset);
  reset();
}
