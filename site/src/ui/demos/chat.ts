/**
 * Try the band chat as Sara (a member): the event chat of Client A — Wedding
 * with its strip on top, and the Direct tab. Labels follow the app
 * (ChatDetailModal, ReceiptTicks, NewChatModal) and the Academy articles
 * send-and-reply-to-messages, message-receipts-and-online-status and
 * who-can-message-whom. Replies from the band are canned.
 */

type Who = 'sara' | 'leo' | 'nico' | 'tom';
export type Status = 'sending' | 'sent' | 'delivered' | 'read';
type Msg = { id: number; from: Who; text: string; time: string; status?: Status; re?: { from: Who; text: string } };
type Thread = 'event' | 'leo';

export const PEOPLE: Record<Who, { name: string; ini: string; admin?: boolean; role: string }> = {
  leo: { name: 'Leo M.', ini: 'LM', admin: true, role: 'Bass' },
  sara: { name: 'Sara', ini: 'S', role: 'Vocals' },
  nico: { name: 'Nico', ini: 'N', role: 'Drums' },
  tom: { name: 'Tom', ini: 'T', role: 'Guitar' },
};
const OTHERS: Who[] = ['leo', 'nico', 'tom'];
const DM_LIST: { id: string; name: string; role: string; admin?: boolean }[] = [
  { id: 'leo', name: 'Leo M.', role: 'Bass', admin: true },
  { id: 'nico', name: 'Nico', role: 'Drums' },
  { id: 'tom', name: 'Tom', role: 'Guitar' },
  { id: 'lena', name: 'Lena P.', role: 'Keys' },
];

/** Mentions are bold, as in the app; only names of people in the chat count. */
export function mentionHtml(text: string) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/@(Leo M\.|Nico|Tom)/g, '<b class="cm__at">@$1</b>');
}
/** The @ query under the caret, like the app: the text after the last @ (two words at most). */
export function mentionQuery(value: string, caret: number) {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  const q = before.slice(at + 1);
  return q.split(' ').length <= 2 ? { at, q } : null;
}
/** Who answers a message: the person mentioned, else the person replied to, else Tom or Leo. */
export function answerer(text: string, re: Who | undefined, n: number): Who {
  const m = /@(Leo M\.|Nico|Tom)/.exec(text);
  if (m) return m[1] === 'Nico' ? 'nico' : m[1] === 'Tom' ? 'tom' : 'leo';
  if (re && re !== 'sara') return re;
  return n % 2 ? 'leo' : 'tom';
}
const ANSWERS: Record<Who, string> = {
  leo: 'Thanks Sara, see you at 15:00.',
  nico: 'Got it, I’ll sort it before load-in.',
  tom: 'Noted. See you Saturday.',
  sara: '',
};

const ico = (id: string) => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const ticks = (s: Status) => s === 'sending' ? ico('clock') : s === 'sent' ? ico('check') : `<span class="cm__dbl">${ico('check')}${ico('check')}</span>`;
const LABEL: Record<Status, string> = { sending: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Read' };

const start = () => ({
  tab: 'event' as 'event' | 'direct',
  dm: null as string | null,
  tomOnline: false,
  replyTo: null as Msg | null,
  threads: {
    event: [
      { id: 1, from: 'leo', time: '14:02', text: 'Load-in is 15:00 at Villa Necchi. Use the service entrance on Via Mozart.' },
      { id: 2, from: 'nico', time: '14:09', text: 'I’ll bring the small kit, the stage is tight.' },
      { id: 3, from: 'tom', time: '14:12', text: 'Does anyone have a spare DI box?' },
    ] as Msg[],
    leo: [] as Msg[],
  },
  last: null as Status | null,
  done: new Set<string>(),
  sent: 0,
});

export function initChatDemo(root: HTMLElement | null, reduce: boolean) {
  if (!root) return;
  const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const phone = q('[data-cd-phone]');
  const head = q('[data-cd-head]');
  const thread = q('[data-cd-thread]');
  const replyEl = q('[data-cd-reply]');
  const menEl = q('[data-cd-mentions]');
  const input = q<HTMLInputElement>('[data-cd-input]');
  const send = q<HTMLButtonElement>('[data-cd-send]');
  const lock = q('[data-cd-lock]');
  const row = q('.cdp__row');
  const people = q('[data-cd-people]');
  const log = q('[data-cd-log]');
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-cd-tab]'));
  if (!head || !input) return;
  root.classList.add('is-live');
  root.classList.toggle('is-reduce', reduce);

  let s = start();
  let timers: number[] = [];
  let shown = new Set<number>();
  let nextId = 10;
  let minute = 20;
  let view = '';
  let men: { at: number; q: string; list: Who[] } | null = null;
  const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, reduce ? Math.min(ms, 400) : ms));
  const clock = () => `14:${String(minute).padStart(2, '0')}`;
  const now = () => { const c = clock(); minute++; return c; };
  const say = (msg: string) => {
    const li = document.createElement('li');
    li.innerHTML = `<time>${clock()}</time><span>${msg}</span>`;
    log.prepend(li);
    while (log.children.length > 4) log.lastElementChild?.remove();
  };
  const thr = (): Thread | null => (s.tab === 'event' ? 'event' : s.dm === 'leo' ? 'leo' : null);
  const step = (k: string) => { s.done.add(k); paintSide(); };

  /* ── Header, strip, thread ── */
  function paintHead() {
    const online = 3 + (s.tomOnline ? 1 : 0);
    if (s.tab === 'event') {
      head.innerHTML = `<div class="cdp__top"><span class="cdp__back" aria-hidden="true">${ico('arrow-left')}</span><span class="cdp__av cdp__av--lime">${ico('music')}</span>` +
        `<span class="cdp__name"><b>Client A — Wedding</b><span>4 members · ${online} online</span></span></div>` +
        `<div class="cdp__strip"><span class="cdp__av cdp__av--lime">${ico('music')}</span><span><b>Sat 21 Nov · Load-in 15:00</b><span>Villa Necchi, Milan</span></span>${ico('arrow-up-right')}</div>`;
    } else if (!s.dm) {
      head.innerHTML = `<p class="cdp__over">Messages</p><p class="cdp__big">Direct</p>`;
    } else {
      const p = DM_LIST.find((x) => x.id === s.dm)!;
      head.innerHTML = `<div class="cdp__top"><button type="button" class="cdp__back" data-act="back" data-k="back" aria-label="Back">${ico('arrow-left')}</button>` +
        `<span class="cdp__av">${p.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</span><span class="cdp__name"><b>${p.name}</b><span><i class="cdp__on"></i>Online</span></span></div>`;
    }
  }
  function msgHtml(m: Msg, group: boolean) {
    const me = m.from === 'sara';
    const p = PEOPLE[m.from];
    const isNew = !shown.has(m.id) && !reduce;
    const re = m.re ? `<span class="cm__re"><b>${PEOPLE[m.re.from].name}</b><span>${mentionHtml(m.re.text)}</span></span>` : '';
    const rb = `<button type="button" class="cm__rb" data-act="reply" data-id="${m.id}" data-k="r${m.id}" aria-label="Reply to message">${ico('arrow-left')}</button>`;
    return `<div class="cm${me ? ' cm--me' : ''}${isNew ? ' is-new' : ''}" data-id="${me ? '' : m.id}">${me ? rb : ''}<div class="cm__col">` +
      (!me && group ? `<p class="cm__who">${p.name}${p.admin ? ' · Admin' : ''}</p>` : '') +
      `<div class="cm__bub">${re}<p>${mentionHtml(m.text)}</p></div>` +
      `<p class="cm__meta">${m.time}${me && m.status ? `<span class="cm__tk cm__tk--${m.status}" role="img" aria-label="${LABEL[m.status]}">${ticks(m.status)}</span>` : ''}</p>` +
      `</div>${me ? '' : rb}</div>`;
  }
  function paintThread() {
    const t = thr();
    const keep = thread.scrollTop;
    const hasNew = !!t && s.threads[t].some((m) => !shown.has(m.id));
    if (s.tab === 'direct' && !s.dm) {
      thread.innerHTML = `<p class="cdp__note">Direct messages are limited to band admins.</p>` +
        `<p class="cdp__sec">Admins</p>` + DM_LIST.filter((p) => p.admin).map(dmRow).join('') +
        `<p class="cdp__sec">Members</p>` + DM_LIST.filter((p) => !p.admin).map(dmRow).join('');
    } else if (!t || !s.threads[t].length) {
      thread.innerHTML = `<div class="cdp__empty"><b>No messages yet</b><span>Start the conversation</span></div>`;
    } else {
      thread.innerHTML = `<p class="cdp__day"><span>Today</span></p>` + s.threads[t].map((m) => msgHtml(m, t === 'event')).join('');
      s.threads[t].forEach((m) => shown.add(m.id));
    }
    const v = `${s.tab}:${s.dm}`;
    thread.scrollTop = v === view ? keep : thread.scrollHeight;
    view = v;
    if (hasNew) thread.scrollTop = thread.scrollHeight; // the new bubble itself animates in
  }
  function dmRow(p: (typeof DM_LIST)[number]) {
    return `<button type="button" class="cdp__dm" data-act="dm" data-dm="${p.id}" data-k="dm-${p.id}"><span class="cdp__av">${p.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</span>` +
      `<span class="cdp__name"><b>${p.name}${p.admin ? ' · Admin' : ''}</b><span>${p.role}</span></span>${ico(p.admin ? 'arrow-right' : 'lock')}</button>`;
  }
  function paintCompose() {
    const t = thr();
    const blocked = s.tab === 'direct' && !!s.dm && s.dm !== 'leo';
    const hidden = s.tab === 'direct' && !s.dm;
    lock.hidden = !blocked;
    row.hidden = blocked || hidden;
    replyEl.innerHTML = s.replyTo && t
      ? `<span class="cdp__rl"></span><span class="cdp__rt"><b>Replying to ${PEOPLE[s.replyTo.from].name}</b><span>${mentionHtml(s.replyTo.text)}</span></span>` +
        `<button type="button" class="cdp__rx" data-act="cancel" data-k="cancel" aria-label="Cancel reply">${ico('x')}</button>`
      : '';
    replyEl.classList.toggle('is-on', !!(s.replyTo && t));
    input.placeholder = s.replyTo ? 'Write a reply…' : 'Write a message…';
    send.disabled = !input.value.trim();
    menEl.innerHTML = men && men.list.length
      ? men.list.map((w, i) => `<button type="button" role="option" aria-selected="${i === 0}" class="cdp__mn" data-act="mention" data-who="${w}"><span class="cdp__av">${PEOPLE[w].ini}</span>${PEOPLE[w].name}</button>`).join('')
      : '';
    menEl.classList.toggle('is-on', !!(men && men.list.length));
  }
  function paintSide() {
    const t = thr();
    const mine = t ? [...s.threads[t]].reverse().find((m) => m.from === 'sara') : undefined;
    root!.querySelectorAll<HTMLElement>('[data-cd-mark]').forEach((li) => li.classList.toggle('is-on', mine?.status === li.dataset.cdMark));
    root!.querySelectorAll<HTMLElement>('[data-cd-step]').forEach((li) => li.classList.toggle('is-done', s.done.has(li.dataset.cdStep!)));
    const inChat: Who[] = t === 'event' ? ['leo', 'sara', 'nico', 'tom'] : t === 'leo' ? ['leo', 'sara'] : [];
    (people.previousElementSibling as HTMLElement).hidden = !inChat.length;
    people.innerHTML = inChat.map((w) => {
      const on = w !== 'tom' || s.tomOnline;
      return `<li class="${on ? 'is-on' : ''}"><i></i>${PEOPLE[w].name}${w === 'sara' ? ' (you)' : PEOPLE[w].admin ? ' · Admin' : ''}<em>${on ? 'Online' : 'Offline'}</em></li>`;
    }).join('');
  }
  function paint() {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.k;
    paintHead(); paintThread(); paintCompose(); paintSide();
    phone.setAttribute('aria-labelledby', `cd-tab-${s.tab}`);
    tabs.forEach((b) => { const on = b.dataset.cdTab === s.tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    if (focusKey) root!.querySelector<HTMLElement>(`[data-k="${focusKey}"]`)?.focus({ preventScroll: true });
  }

  /* ── Sending: the ticks walk through the app's states ── */
  function setStatus(t: Thread, id: number, st: Status) {
    const m = s.threads[t].find((x) => x.id === id);
    if (!m) return;
    m.status = st;
    paintThread(); paintSide();
  }
  function sendNow() {
    const t = thr();
    const text = input.value.trim();
    if (!t || !text) return;
    const re = s.replyTo ? { from: s.replyTo.from, text: s.replyTo.text } : undefined;
    const m: Msg = { id: nextId++, from: 'sara', text, time: now(), status: 'sending', re };
    s.threads[t].push(m);
    s.sent++;
    input.value = ''; s.replyTo = null; men = null;
    step('send');
    if (re?.from === 'leo') step('reply');
    if (/@Nico/.test(text)) step('mention');
    const group = t === 'event';
    const slow = group && !s.tomOnline;
    paint();
    say(`Sara sends${re ? ` a reply to ${PEOPLE[re.from].name}` : ''} · <b>Sending</b>, the clock`);
    later(600, () => { setStatus(t, m.id, 'sent'); say(`<b>Sent</b>, one tick · saved on the server · ${group ? 'Leo M., Nico and Tom get' : 'Leo M. gets'} a push`); });
    if (slow) {
      later(1700, () => say('Leo M. and Nico have it · Tom is offline, so the ticks wait for him'));
      later(3400, () => { s.tomOnline = true; paintHead(); setStatus(t, m.id, 'delivered'); say('Tom comes online · <b>Delivered</b>, two grey ticks'); });
      later(4700, () => say('Leo M. and Nico read it · still grey until Tom does'));
      later(6000, () => { setStatus(t, m.id, 'read'); say('Tom reads it · <b>Read</b>, two coloured ticks'); });
    } else {
      later(1500, () => { setStatus(t, m.id, 'delivered'); say(`<b>Delivered</b>, two grey ticks · it reached ${group ? 'everyone’s' : 'Leo’s'} phone`); });
      later(2900, () => { setStatus(t, m.id, 'read'); say(`<b>Read</b>, two coloured ticks · ${group ? 'everyone' : 'Leo M.'} opened the chat`); });
    }
    const who = group ? answerer(text, re?.from, s.sent) : 'leo';
    later(slow ? 7300 : 4100, () => {
      s.threads[t].push({ id: nextId++, from: who, time: now(), text: group ? ANSWERS[who] : 'Sure. Message me here if anything changes.' });
      paintThread();
      say(`${PEOPLE[who].name} answers`);
    });
  }

  /* ── Events ── */
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b) return;
    const t = thr();
    switch (b.dataset.act) {
      case 'reply': {
        const m = t && s.threads[t].find((x) => x.id === Number(b.dataset.id));
        if (m) startReply(m);
        return;
      }
      case 'cancel': s.replyTo = null; paintCompose(); input.focus(); return;
      case 'mention': pick(b.dataset.who as Who); return;
      case 'dm': s.dm = b.dataset.dm!; s.replyTo = null; if (s.dm === 'nico') { step('direct'); say('Sara opens a direct chat with Nico · a member · the composer is replaced by a lock'); } paint(); (s.dm === 'leo' ? input : head.querySelector<HTMLElement>('[data-act="back"]'))?.focus(); return;
      case 'back': s.dm = null; paint(); thread.querySelector<HTMLElement>('[data-act="dm"]')?.focus(); return;
    }
  });
  function startReply(m: Msg) {
    s.replyTo = m;
    paintCompose();
    input.focus({ preventScroll: true });
  }
  function pick(w: Who) {
    if (!men) return;
    const v = input.value;
    input.value = `${v.slice(0, men.at)}@${PEOPLE[w].name} ${v.slice(men.at + 1 + men.q.length)}`;
    const caret = men.at + PEOPLE[w].name.length + 2;
    men = null;
    paintCompose();
    input.focus();
    input.setSelectionRange(caret, caret);
  }
  input.addEventListener('input', () => {
    const mq = mentionQuery(input.value, input.selectionStart ?? input.value.length);
    men = mq && s.tab === 'event' ? { ...mq, list: OTHERS.filter((w) => PEOPLE[w].name.toLowerCase().includes(mq.q.toLowerCase())) } : null;
    paintCompose();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (men) { men = null; paintCompose(); } else if (s.replyTo) { s.replyTo = null; paintCompose(); } return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (men && men.list.length) pick(men.list[0]); else sendNow();
  });
  send.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the keyboard up, like the app
  send.addEventListener('click', sendNow);

  // Stay pinned to the newest message when the phone changes size (rotation, the reply bar).
  let stick = true;
  thread.addEventListener('scroll', () => { stick = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 24; }, { passive: true });
  new ResizeObserver(() => { if (stick) thread.scrollTop = thread.scrollHeight; }).observe(thread);

  // Swipe a message to the right to reply, as on a phone.
  let drag: { el: HTMLElement; x: number; id: number } | null = null;
  thread.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.cm[data-id]');
    if (!el || !el.dataset.id || (e.target as HTMLElement).closest('button')) return;
    drag = { el, x: e.clientX, id: Number(el.dataset.id) };
  });
  thread.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = Math.max(0, Math.min(72, e.clientX - drag.x));
    drag.el.style.transform = `translateX(${dx}px)`;
    drag.el.classList.toggle('is-swipe', dx > 48);
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag) return;
    const { el, id, x } = drag;
    drag = null;
    el.style.transform = '';
    el.classList.remove('is-swipe');
    const t = thr();
    const m = t && s.threads[t].find((m2) => m2.id === id);
    if (m && e.clientX - x > 48) startReply(m);
  };
  thread.addEventListener('pointerup', endDrag);
  thread.addEventListener('pointercancel', endDrag);

  tabs.forEach((b, k) => {
    const go = (tab: 'event' | 'direct') => { if (s.tab === tab) return; s.tab = tab; s.dm = null; s.replyTo = null; men = null; input.value = ''; paint(); };
    b.addEventListener('click', () => go(b.dataset.cdTab as 'event' | 'direct'));
    b.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const n = tabs[e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (k + (e.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length];
      go(n.dataset.cdTab as 'event' | 'direct');
      n.focus();
    });
  });
  root.querySelector('[data-cd-reset]')?.addEventListener('click', () => {
    timers.forEach(clearTimeout); timers = [];
    s = start(); shown = new Set(); minute = 20; men = null; input.value = '';
    log.innerHTML = '';
    paint();
    say('Sara opens the chat of Client A — Wedding · Tom is offline');
  });

  shown = new Set(s.threads.event.map((m) => m.id));
  paint();
  say('Sara opens the chat of Client A — Wedding · Tom is offline');
}
