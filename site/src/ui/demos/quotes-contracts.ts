import { gsap } from 'gsap';

/**
 * "Be the client": the client's quote page (left, static markup in
 * content/demos/quotes-contracts.ts) drives Leo's phone (right). Rules from
 * the Academy (client-confirmation, quote-statuses, quote-to-gig) and the app's
 * QuoteClientLink: Viewed on the first visit, Discussing on a message before an
 * answer, then Accepted or Declined; a declined quote can still be accepted;
 * the client's yes doesn't make the gig, Leo's Create gig from quote does.
 * Notification titles follow migration 099. No payments of any kind.
 */

export type QStatus = 'sent' | 'viewed' | 'discussing' | 'accepted' | 'declined';
export type QEvent = { kind: 'sent' | 'viewed' | 'accepted' | 'declined'; text: string; at: string };
export type QState = {
  status: QStatus; viewed: boolean; messages: { body: string; at: string }[];
  name: string; reason: string; answeredAt: string; gig: boolean; history: QEvent[]; minute: number;
};

const CLIENT = 'Client A';
const TITLE = 'Client A — Wedding';
const REF = 'Q-2026-0014';
const TOTAL = '€2,928.00';

const stamp = (m: number) => { const t = 18 * 60 + 40 + m; return `12 Oct, ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const tick = (s: QState) => ({ ...s, minute: s.minute + 1 });

export const initialQuote = (): QState => ({
  status: 'sent', viewed: false, messages: [], name: '', reason: '', answeredAt: '', gig: false, minute: 0,
  history: [{ kind: 'sent', text: 'Sent via WhatsApp', at: '12 Oct, 18:32' }],
});

export function viewQuote(s: QState): QState {
  if (s.viewed) return s;
  const n = tick(s);
  return { ...n, viewed: true, status: s.status === 'sent' ? 'viewed' : s.status, history: [{ kind: 'viewed', text: 'Opened by the client', at: stamp(n.minute) }, ...s.history] };
}
export function sendMessage(s: QState, body: string): QState {
  const n = tick(viewQuote(s));
  const open = n.status === 'sent' || n.status === 'viewed' || n.status === 'discussing';
  return { ...n, status: open ? 'discussing' : n.status, messages: [...n.messages, { body, at: stamp(n.minute) }] };
}
export function acceptQuote(s: QState, name: string): QState {
  if (s.status === 'accepted') return s;
  const n = tick(viewQuote(s));
  return { ...n, status: 'accepted', name, answeredAt: stamp(n.minute), history: [{ kind: 'accepted', text: `Accepted by ${name}`, at: stamp(n.minute) }, ...n.history] };
}
export function declineQuote(s: QState, reason: string): QState {
  if (s.status === 'accepted' || s.status === 'declined') return s;
  const n = tick(viewQuote(s));
  const text = reason ? `Declined: “${reason}”` : 'Declined';
  return { ...n, status: 'declined', reason, answeredAt: stamp(n.minute), history: [{ kind: 'declined', text, at: stamp(n.minute) }, ...n.history] };
}
export const createGig = (s: QState): QState => (s.status === 'accepted' ? { ...s, gig: true } : s);

/** The four steps of Client confirmation, as QuoteClientLink lights them. */
export function steps(s: QState) {
  const final = s.status === 'accepted' || s.status === 'declined';
  return [
    { label: 'Sent', done: true, current: s.status === 'sent' },
    { label: 'Viewed', done: s.viewed, current: s.status === 'viewed' },
    { label: 'Discussing', done: s.messages.length > 0, current: s.status === 'discussing' },
    { label: s.status === 'declined' ? 'Declined' : 'Accepted', done: final, current: final },
  ];
}
export const statusLabel = (s: QState) => steps(s).find((x) => x.current)?.label ?? 'Sent';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function phoneHtml(s: QState) {
  const st = steps(s);
  const stepper = st.map((x) => `<li class="qdp__step${x.done ? ' is-done' : ''}${x.current ? ' is-cur' : ''}${x.label === 'Declined' && x.done ? ' is-no' : ''}"${x.current ? ' aria-current="step"' : ''}><i></i><span>${x.label}</span></li>`).join('');
  let answer = '';
  if (s.status === 'accepted' && s.gig) {
    answer = `<div class="qdp__gig" data-qd-gig><p class="qdp__k"><span class="qdp__dot"></span>Gig · Confirmed</p><p class="qdp__gt">${TITLE}</p>` +
      `<p class="qdp__gm">Sat 21 Nov 2026 · 20:30 · Villa Necchi, Milan</p><p class="qdp__gs">On the lineup’s calendars, each musician with their own fee.</p></div>`;
  } else if (s.status === 'accepted') {
    answer = `<div class="qdp__acc"><p>Accepted by ${esc(s.name)} on ${s.answeredAt} · version 1</p><p class="qdp__dim">A recorded acceptance, not a signature: formal signing stays in Contracts.</p>` +
      `<button type="button" class="qdp__b qdp__b--white" data-qd-act="gig" data-k="gig">Create gig from quote</button></div>`;
  } else if (s.status === 'declined' && s.reason) {
    answer = `<div class="qdp__card"><p>Declined: “${esc(s.reason)}”</p></div>`;
  }
  const convo = s.messages.length
    ? `<div class="qdp__card"><p class="qdp__h3">Conversation</p>${s.messages.map((m) => `<div class="qdp__msg"><p>${esc(m.body)}</p><span>${CLIENT} · ${m.at}</span></div>`).join('')}</div>`
    : '';
  const hist = s.history.map((h) => `<li><span>${esc(h.text)}</span><time>${h.at}</time></li>`).join('');
  return `<div class="qdp__screen" data-qd-screen>` +
    `<p class="qdp__k">Quote · ${REF}</p><p class="qdp__t">${TITLE}</p><p class="qdp__gm">Sat 21 Nov · Villa Necchi · ${TOTAL}</p>` +
    `<div class="qdp__head"><p class="qdp__h2">Client confirmation</p><span class="qdp__tag" data-s="${s.status}">${statusLabel(s)}</span></div>` +
    `<ol class="qdp__steps" aria-label="Client confirmation">${stepper}</ol>` +
    answer + convo +
    `<div class="qdp__card"><p class="qdp__h3">Quote history</p><ul class="qdp__hist">${hist}</ul></div>` +
    `</div><div class="qdp__toast" data-qd-toast aria-hidden="true"></div>`;
}

export function initQuotesDemo(root: HTMLElement | null, reduce: boolean) {
  if (!root) return;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const phone = $<HTMLElement>('[data-qd-phone]');
  const page = $<HTMLElement>('[data-qd-page]');
  const log = $<HTMLElement>('[data-qd-log]');
  const echo = $<HTMLElement>('[data-qd-echo]');
  const statusBox = $<HTMLElement>('[data-qd-status]');
  const answerBox = $<HTMLElement>('[data-qd-answer]');
  const decline = $<HTMLDetailsElement>('[data-qd-decline]');
  const hello = $<HTMLElement>('[data-qd-hello]');
  const thread = $<HTMLElement>('[data-qd-thread]');
  const nameIn = $<HTMLInputElement>('[data-qd-name]');
  const check = $<HTMLInputElement>('[data-qd-check]');
  const msgIn = $<HTMLTextAreaElement>('[data-qd-msg]');
  const reasonIn = $<HTMLTextAreaElement>('[data-qd-reason]');
  if (!phone || !page) return;
  root.classList.add('is-live');
  const MSG0 = msgIn?.value ?? '';
  let s = initialQuote();
  let toastTimer = 0;

  const say = (msg: string) => {
    if (!log) return;
    const li = document.createElement('li');
    li.innerHTML = msg;
    log.prepend(li);
    while (log.children.length > 4) log.lastElementChild?.remove();
    if (!reduce) gsap.fromTo(li, { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.4 });
  };
  const err = (k: string, on: boolean) => {
    const p = $<HTMLElement>(`[data-qd-err="${k}"]`);
    if (p) p.hidden = !on;
    const field = k === 'name' ? nameIn : k === 'check' ? check : msgIn;
    field?.setAttribute('aria-invalid', String(on));
    if (on && p?.id) field?.setAttribute('aria-describedby', p.id); else field?.removeAttribute('aria-describedby');
  };

  const notify = (title: string, body: string) => {
    const t = phone.querySelector<HTMLElement>('[data-qd-toast]');
    if (echo) echo.innerHTML = `<b>Leo’s phone · ${statusLabel(s)}</b>${esc(title)}`;
    if (!t) return;
    t.innerHTML = `<p><span class="qdp__dot"></span>BandWith · now</p><b>${esc(title)}</b><span>${esc(body)}</span>`;
    window.clearTimeout(toastTimer);
    t.classList.add('is-on');
    if (!reduce) gsap.fromTo(t, { y: -30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, ease: 'power3.out' });
    toastTimer = window.setTimeout(() => {
      if (reduce) t.classList.remove('is-on');
      else gsap.to(t, { y: -30, autoAlpha: 0, duration: 0.35, onComplete: () => t.classList.remove('is-on') });
    }, 4200);
  };

  const renderPhone = (changed = false) => {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.k;
    const scroll = phone.querySelector('[data-qd-screen]')?.scrollTop ?? 0;
    const toast = phone.querySelector('[data-qd-toast]');
    phone.innerHTML = phoneHtml(s);
    if (toast) phone.querySelector('[data-qd-toast]')?.replaceWith(toast);
    const scr = phone.querySelector<HTMLElement>('[data-qd-screen]');
    if (scr) scr.scrollTop = scroll;
    if (changed && !reduce) {
      gsap.fromTo(phone.querySelectorAll('.qdp__step.is-cur i, .qdp__tag'), { scale: 0.6, transformOrigin: 'left center' }, { scale: 1, duration: 0.5, ease: 'back.out(2)' });
      const gig = phone.querySelector('[data-qd-gig]');
      if (gig) gsap.fromTo(gig, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.55 });
    }
    if (focusKey) phone.querySelector<HTMLElement>(`[data-k="${focusKey}"]`)?.focus({ preventScroll: true });
    else if (s.gig) phone.querySelector<HTMLElement>('[data-qd-gig]')?.scrollIntoView?.({ block: 'nearest' });
  };

  const renderClient = () => {
    const acc = s.status === 'accepted';
    if (hello) hello.hidden = acc;
    if (answerBox) answerBox.hidden = acc;
    if (decline) { decline.hidden = s.status === 'declined'; if (s.status === 'declined') decline.open = false; }
    if (statusBox) {
      statusBox.innerHTML = acc
        ? `<section class="qc qc--ink" role="status"><h3 class="qc__h2">Accepted. Thank you.</h3><p class="qc__p">${esc(s.name)} accepted this quote on 12 Oct 2026 at ${s.answeredAt.slice(-5)} (version 1). Velvet Static will be in touch about the next steps.</p><p class="qc__mute">This is a record of your acceptance, not a signature. Any contract is signed separately.</p></section>`
        : s.status === 'declined'
          ? `<section class="qc" role="status"><h3 class="qc__h2">You declined this quote.</h3>${s.reason ? `<p class="qc__mute">“${esc(s.reason)}”</p>` : ''}<p class="qc__p">Velvet Static has been told. Changed your mind? You can still accept it or write to them.</p></section>`
          : '';
    }
    if (thread) thread.innerHTML = s.messages.map((m) => `<div class="qc__msg">${esc(m.body)}<small>You · ${m.at}</small></div>`).join('');
  };

  const view = () => {
    if (s.viewed) return;
    s = viewQuote(s);
    renderPhone(true);
    notify(`${CLIENT} opened the quote`, `${TITLE} · ${REF}`);
    say(`Client opens the link · Leo’s quote moves to <b>Viewed</b>`);
  };

  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-qd-act]');
    if (!b) return;
    const act = b.dataset.qdAct;
    if (act === 'send') {
      const body = (msgIn?.value ?? '').trim();
      err('msg', !body);
      if (!body) { msgIn?.focus(); return; }
      view();
      s = sendMessage(s, body);
      if (msgIn) msgIn.value = '';
      renderClient(); renderPhone(true);
      notify(`${CLIENT} wrote about the quote`, `${TITLE}: “${body.slice(0, 140)}”`);
      say(s.status === 'discussing' ? 'Message sent · Leo’s quote moves to <b>Discussing</b>' : 'Message sent · it lands in Leo’s Conversation');
    } else if (act === 'accept') {
      const name = (nameIn?.value ?? '').trim();
      err('name', !name);
      err('check', !!name && !check?.checked);
      if (!name) { nameIn?.focus(); return; }
      if (!check?.checked) { check?.focus(); return; }
      view();
      s = acceptQuote(s, name);
      renderClient(); renderPhone(true);
      notify(`${CLIENT} accepted the quote`, `${TITLE} · ${TOTAL}`);
      say('Quote accepted · on Leo’s phone: <b>Accepted</b>. The gig waits for Leo’s tap');
      statusBox?.querySelector('section')?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    } else if (act === 'decline') {
      view();
      const reason = (reasonIn?.value ?? '').trim();
      s = declineQuote(s, reason);
      renderClient(); renderPhone(true);
      notify(`${CLIENT} declined the quote`, reason ? `${TITLE} · “${reason}”` : TITLE);
      say('Quote declined · on Leo’s phone: <b>Declined</b>. You can still accept it');
      page.scrollTo?.({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    } else if (act === 'gig') {
      s = createGig(s);
      renderPhone(true);
      if (echo) echo.innerHTML = '<b>Leo’s phone · Gig confirmed</b>Client A — Wedding is on the lineup’s calendars';
      say('Leo taps <b>Create gig from quote</b> · Client A — Wedding is a confirmed gig');
    }
  });
  nameIn?.addEventListener('input', () => err('name', false));
  check?.addEventListener('change', () => err('check', false));
  msgIn?.addEventListener('input', () => err('msg', false));

  $<HTMLButtonElement>('[data-qd-reset]')?.addEventListener('click', () => {
    s = initialQuote();
    if (nameIn) nameIn.value = '';
    if (check) check.checked = false;
    if (msgIn) msgIn.value = MSG0;
    if (reasonIn) reasonIn.value = '';
    if (decline) decline.open = false;
    ['name', 'check', 'msg'].forEach((k) => err(k, false));
    if (log) log.innerHTML = '';
    if (echo) echo.innerHTML = '<b>Leo’s phone · Sent</b>Waiting for the client';
    phone.querySelector<HTMLElement>('[data-qd-toast]')?.classList.remove('is-on');
    renderClient(); renderPhone();
    page.scrollTop = 0;
    say('Leo sent the quote by WhatsApp · <b>Sent</b>');
    window.setTimeout(view, reduce ? 0 : 700);
  });

  renderClient();
  renderPhone();
  if (echo) echo.innerHTML = '<b>Leo’s phone · Sent</b>Waiting for the client';
  say('Leo sent the quote by WhatsApp · <b>Sent</b>');
  // The client "arrives" when the demo comes into view: the first visit is Viewed.
  new IntersectionObserver(([e], io) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    window.setTimeout(view, reduce ? 300 : 1200);
  }, { threshold: 0.3 }).observe(root);
}
