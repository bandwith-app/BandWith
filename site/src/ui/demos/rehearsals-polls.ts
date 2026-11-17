/**
 * Try a rehearsal poll: Sara's phone (the visitor, a member) and Leo's (the
 * admin who published it), built in HTML so every control works. Labels follow
 * the app (RehearsalPollCard, RehearsalPollVoteSheet) and the Academy articles
 * vote-in-a-rehearsal-poll and lock-in-a-poll-date. A locked-in date reaches the
 * band in the bell, with no push.
 */

export const SLOTS = [
  { day: 'TUE', n: 17, app: 'Tue, Nov 17', long: 'Tue 17 Nov' },
  { day: 'WED', n: 18, app: 'Wed, Nov 18', long: 'Wed 18 Nov' },
  { day: 'THU', n: 19, app: 'Thu, Nov 19', long: 'Thu 19 Nov' },
];
export const BAND = 5;
const TIME = '19:00–22:00';
const TITLE = 'Extra rehearsal before the wedding';
const NOTE = 'Need to tighten the wedding set.';
const PLACE = 'Blackbox Studios';
type Voter = { id: string; name: string; ini: string; picks: number[]; at?: number };
/** Leo and Nico have voted when the push lands; Tom and Lena P. answer live while Sara votes. */
export const OTHERS: Voter[] = [
  { id: 'leo', name: 'Leo M.', ini: 'LM', picks: [0, 2] },
  { id: 'nico', name: 'Nico', ini: 'N', picks: [0, 1] },
  { id: 'tom', name: 'Tom', ini: 'T', picks: [2], at: 2400 },
  { id: 'lena', name: 'Lena P.', ini: 'LP', picks: [0, 2], at: 5200 },
];

/** Who can make each date, the Top pick(s), and how many answered / voted. */
export function tally(sara: number[], saraNone: boolean, arrived: string[]) {
  const voters = OTHERS.filter((v) => v.at === undefined || arrived.includes(v.id));
  const rows = SLOTS.map((_, i) => {
    const who = voters.filter((v) => v.picks.includes(i)).map((v) => ({ ini: v.ini, name: v.name, you: false }));
    if (sara.includes(i)) who.push({ ini: 'S', name: 'Sara', you: true });
    return who;
  });
  const max = Math.max(...rows.map((r) => r.length));
  const top = max > 0 ? rows.map((r, i) => (r.length === max ? i : -1)).filter((i) => i >= 0) : [];
  const voted = voters.length + (sara.length ? 1 : 0);
  return { rows, top, voted, answered: voted + (saraNone ? 1 : 0) };
}

const ico = (id: string) => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const fresh = () => ({
  stage: 'push' as 'push' | 'vote' | 'leo' | 'done',
  hold: 'sara' as 'sara' | 'leo',
  sheet: false, bell: false, details: false, opened: false,
  sara: [] as number[], saraNone: false, arrived: [] as string[],
  locking: -1, locked: -1, place: PLACE, unread: 1,
  notes: [{ t: 'Vote on Rehearsal Times', b: `New availability poll: “${TITLE}”.`, ico: 'bell' }],
});

export function initRehearsalsPollsDemo(root: HTMLElement | null, reduce: boolean) {
  if (!root) return;
  const floor = root.querySelector<HTMLElement>('[data-rp-floor]');
  const saraEl = root.querySelector<HTMLElement>('[data-rp-phone="sara"]');
  const leoEl = root.querySelector<HTMLElement>('[data-rp-phone="leo"]');
  if (!floor || !saraEl || !leoEl) return;
  const saraHome = saraEl.querySelector<HTMLElement>('[data-rp-home]')!;
  const leoHome = leoEl.querySelector<HTMLElement>('[data-rp-home]')!;
  const sheet = saraEl.querySelector<HTMLElement>('[data-rp-sheet]')!;
  const bell = saraEl.querySelector<HTMLElement>('[data-rp-bell]')!;
  const push = saraEl.querySelector<HTMLButtonElement>('[data-rp-push]')!;
  const scrim = saraEl.querySelector<HTMLElement>('[data-rp-scrim]')!;
  const holds = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-rp-hold]'));
  const note = root.querySelector<HTMLElement>('[data-rp-note]');
  const link = root.querySelector<HTMLElement>('[data-rp-link]');
  let lastSig = '';
  const log = root.querySelector<HTMLElement>('[data-rp-log]');
  root.classList.add('is-live');
  root.classList.toggle('is-reduce', reduce);

  let s = fresh();
  let timers: number[] = [];
  let minute = 0;
  let kb = false;
  const seen = new Map<string, number>(); // meter dots already drawn, per phone and date
  const freshOnce = new Set<string>(); // blocks that should animate in on this render only
  root.addEventListener('pointerdown', () => (kb = false));
  root.addEventListener('keydown', () => (kb = true));

  const say = (msg: string) => {
    if (!log) return;
    const li = document.createElement('li');
    const t = 18 * 60 + 2 + minute++;
    li.innerHTML = `<time>${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}</time><span>${msg}</span>`;
    log.prepend(li);
    while (log.children.length > 4) log.lastElementChild?.remove();
  };
  const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
  const listJoin = (a: string[]) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

  /* ── Pieces of the app UI ── */
  function pads(who: string, picks: number[], rows: { length: number }[], live: boolean) {
    return `<div class="rpads">${SLOTS.map((x, i) => {
      const on = picks.includes(i);
      const key = `${who}${i}`;
      const was = seen.get(key) ?? rows[i].length;
      seen.set(key, rows[i].length);
      const dots = Array.from({ length: BAND }, (_, k) => `<i class="${k < rows[i].length ? 'on' : ''}${k >= was && k < rows[i].length && !reduce ? ' is-new' : ''}"></i>`).join('');
      const inner = `<span class="rpad__top"><span>${x.day}</span><i class="rpad__led"></i></span><b class="rpad__n">${x.n}</b><span class="rpad__t">${TIME}</span><span class="rpad__meter">${dots}</span>`;
      const label = `${x.long}, ${TIME}: ${rows[i].length} of ${BAND} available`;
      return live
        ? `<button type="button" class="rpad" data-act="vote" data-i="${i}" data-k="${who}-pad${i}" aria-pressed="${on}" aria-label="${label}">${inner}</button>`
        : `<span class="rpad${on ? ' is-on' : ''}" role="img" aria-label="${label}${on ? ', Leo can make it' : ''}">${inner}</span>`;
    }).join('')}</div>`;
  }
  function options(admin: boolean) {
    const t = tally(s.sara, s.saraNone, s.arrived);
    const items = SLOTS.map((x, i) => {
      if (!admin && !t.rows[i].length) return '';
      const top = t.top.includes(i);
      const who = t.rows[i].map((v) => `<i class="${v.you && !admin ? 'you' : ''}" title="${v.name}">${v.you && !admin ? 'You' : v.ini}</i>`).join('');
      const fix = admin && s.locking === i && s.locked < 0
        ? `<div class="rpo__fix${freshOnce.has('fix') ? ' is-fresh' : ''}"><label class="rfield"><span>Rehearsal location</span><span class="rfield__in">${ico('map-pin')}<input type="text" data-k="place" data-place value="${s.place.replace(/"/g, '&quot;')}" placeholder="Location / practice studio" /></span></label>` +
          `<button type="button" class="rbtn rbtn--lime" data-act="confirm" data-k="confirm">${ico('check')}Confirm &amp; create event</button></div>`
        : '';
      return `<li class="rpo${top ? ' is-top' : ''}" data-opt="${i}"><div class="rpo__row"><span class="rpo__tx"><span class="rpo__d">${x.app}${top ? '<em class="rtag rtag--lime">Top pick</em>' : ''}</span>` +
        `<span class="rpo__s">19:00 – 22:00 · ${t.rows[i].length}/${BAND} available</span></span>` +
        (admin ? `<button type="button" class="rpill${top ? ' rpill--lime' : ''}" data-act="lock" data-i="${i}" data-k="lock${i}" aria-expanded="${s.locking === i}" aria-label="Lock in ${x.long}">Lock in</button>` : '') +
        `</div>${who ? `<span class="rpo__who">${who}</span>` : ''}${fix}</li>`;
    }).join('');
    const none = admin && s.saraNone ? '<p class="rpo__none">No date works for Sara</p>' : '';
    return items ? `<ul class="rpos">${items}</ul>${none}` : none;
  }
  function top(role: string, unread: number, live: boolean) {
    const badge = unread ? `<em>${unread}</em>` : '';
    const b = live
      ? `<button type="button" class="rpp__bell" data-act="bell" data-k="bell" aria-label="Notifications${unread ? `, ${unread} unread` : ''}">${ico('bell')}${badge}</button>`
      : `<span class="rpp__bell" aria-hidden="true">${ico('bell')}</span>`;
    return `<div class="rpp__top"><p class="rpp__band"><span><i></i>${role}</span>Velvet Static</p>${b}</div>`;
  }
  function confirmed(admin: boolean) {
    const x = SLOTS[s.locked];
    return `<article class="rpc rpc--ok${freshOnce.has('ok') ? ' is-fresh' : ''}"><p class="rpc__k"><span><i class="rpc__dot rpc__dot--blue"></i>Rehearsal · Confirmed</span>${admin ? '<em class="rtag rtag--lime">Going</em>' : ''}</p>` +
      `<h3 class="rpc__t">${TITLE}</h3><p class="rpc__when">${ico('calendar')}${x.app} · 19:00 – 22:00</p><p class="rpc__when">${ico('map-pin')}${s.place || 'Band Practice Space'}</p>` +
      `<p class="rpc__s">${admin ? 'Created from the poll: the room cost and focus songs came along. The poll is closed.' : 'Answer GOING or CAN’T on the rehearsal page.'}</p></article>`;
  }
  function card(admin: boolean) {
    const t = tally(s.sara, s.saraNone, s.arrived);
    const badge = admin ? 'Voted' : s.sara.length ? 'Voted' : s.saraNone ? 'None work' : 'Vote now';
    const picks = admin ? OTHERS[0].picks : s.sara;
    return `<p class="rpp__sec">Rehearsal scheduling (1)</p><article class="rpc"><p class="rpc__k"><span><i class="rpc__dot"></i>Poll · Active</span><em class="rtag rtag--lime">${badge}</em></p>` +
      `<h3 class="rpc__t">${TITLE}</h3><p class="rpc__s">${NOTE} — ${t.answered} of ${BAND} answered</p>` +
      pads(admin ? 'leo' : 'card', picks, t.rows, !admin) +
      (admin ? `<button type="button" class="rpc__more" data-act="details" data-k="details" aria-expanded="${s.details}">${s.details ? 'Hide details' : 'Details · Lock in'}${ico('chevron-down')}</button>` +
        (s.details ? `<div class="rpc__list${freshOnce.has('list') ? ' is-fresh' : ''}"><p class="rpc__lab">Your availability</p>${options(true)}</div>` : '') : '') +
      `</article>`;
  }
  function voteSheet() {
    const t = tally(s.sara, s.saraNone, s.arrived);
    const tag = s.sara.length ? 'Voted' : s.saraNone ? 'None work' : 'Active';
    const resp = t.rows.some((r) => r.length) ? `<p class="rps__lab">Responses</p>${options(false)}` : '';
    return `<div class="rps__body"><p class="rps__k"><i class="rpc__dot"></i>Rehearsal poll · Active</p>` +
      `<button type="button" class="rps__x" data-act="close" data-k="close" aria-label="Close">${ico('x')}</button>` +
      `<h3 class="rps__t">${TITLE}</h3><p class="rps__meta"><em class="rtag rtag--lime">${tag}</em>Vote by Mon 16 Nov, 18:00 · ${t.voted} of ${BAND} voted</p>` +
      `<p class="rps__note">${NOTE}</p><p class="rps__place">${ico('map-pin')}${PLACE} · €12 each</p>` +
      `<p class="rps__lab">Select the dates that work for you</p>${pads('sheet', s.sara, t.rows, true)}${resp}</div>` +
      `<div class="rps__cta"><button type="button" class="rbtn rbtn--ghost" data-act="none" data-k="none">None work</button><button type="button" class="rbtn rbtn--lime" data-act="done" data-k="done">Done</button></div>`;
  }
  function bellSheet() {
    return `<div class="rps__body"><p class="rps__k">${ico('bell')}Notifications</p><button type="button" class="rps__x" data-act="bell" data-k="bellx" aria-label="Close notifications">${ico('x')}</button>` +
      `<ul class="rpn">${s.notes.map((n, i) => `<li class="${i === 0 && s.notes.length > 1 ? 'is-new' : ''}"><span class="rpn__ico">${ico(n.ico)}</span><span><b>${n.t}</b><span>${n.b}</span></span></li>`).join('')}</ul>` +
      `<p class="rpn__foot">${s.notes.length > 1 ? 'In the bell only: a locked-in date sends no push.' : ''}</p></div>`;
  }

  function reveal(home: HTMLElement, sel: string) {
    const el = home.querySelector<HTMLElement>(sel);
    if (!el) return;
    const top = el.offsetTop - 12;
    const bottom = el.offsetTop + el.offsetHeight + 12;
    if (top < home.scrollTop || bottom > home.scrollTop + home.clientHeight) {
      home.scrollTo({ top: Math.max(0, Math.min(top, bottom - home.clientHeight)), behavior: reduce ? 'auto' : 'smooth' });
    }
  }

  function render(scrollTo?: string) {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.k;
    const keep = [saraHome.scrollTop, leoHome.scrollTop, sheet.querySelector('.rps__body')?.scrollTop ?? 0];
    saraHome.innerHTML = top('Member', s.unread, true) + (s.locked >= 0 ? confirmed(false) : card(false));
    leoHome.innerHTML = top('Admin', 0, false) + (s.locked >= 0 ? confirmed(true) : card(true));
    sheet.innerHTML = voteSheet();
    bell.innerHTML = bellSheet();
    saraHome.scrollTop = keep[0]; leoHome.scrollTop = keep[1];
    const body = sheet.querySelector<HTMLElement>('.rps__body');
    if (body) body.scrollTop = keep[2];
    freshOnce.clear();

    saraEl!.classList.toggle('is-push', s.stage === 'push');
    sheet.classList.toggle('is-open', s.sheet);
    bell.classList.toggle('is-open', s.bell);
    scrim.classList.toggle('is-on', s.sheet || s.bell);
    push.tabIndex = s.stage === 'push' ? 0 : -1;
    push.setAttribute('aria-hidden', String(s.stage !== 'push'));
    saraHome.toggleAttribute('inert', s.sheet || s.bell);
    sheet.toggleAttribute('inert', !s.sheet);
    bell.toggleAttribute('inert', !s.bell);

    paintHold();
    // The wire between the phones flashes whenever the counts change.
    const sig = tally(s.sara, s.saraNone, s.arrived).rows.map((r) => r.length).join() + s.locked;
    if (link && sig !== lastSig && lastSig && !reduce) { link.classList.remove('is-ping'); void link.offsetWidth; link.classList.add('is-ping'); }
    lastSig = sig;
    if (scrollTo) reveal(leoHome, scrollTo);
    if (note) note.textContent = guide();
    if (focusKey) root!.querySelector<HTMLElement>(`[data-k="${focusKey}"]`)?.focus({ preventScroll: true });
  }

  function guide() {
    const t = tally(s.sara, s.saraNone, s.arrived);
    const tops = listJoin(t.top.map((i) => SLOTS[i].long));
    if (s.stage === 'push') return 'A push just landed on Sara’s phone. Tap it to vote.';
    if (s.stage === 'vote') return s.sara.length
      ? `Top pick so far: ${tops}. Tap Done when you’re set, or change your dates.`
      : 'Tap the dates you can make. Tap one again to take it back, or None work if nothing fits.';
    if (s.stage === 'leo') return s.locking >= 0
      ? 'Check the place, then Confirm & create event.'
      : `Now you hold Leo’s phone. Tap Lock in next to the Top pick${t.top.length > 1 ? ` (${tops} are tied: his call)` : ''}.`;
    return 'Locked in. The band finds it in the bell: no push for this one.';
  }

  function paintHold() {
    floor!.dataset.hold = s.hold;
    holds.forEach((b) => {
      const on = b.dataset.rpHold === s.hold;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }
  // Only the hold changes here: a re-render under a pointerdown would swallow the click.
  function hold(who: 'sara' | 'leo', focus = false) {
    if (s.hold === who) return;
    s.hold = who;
    paintHold();
    if (focus) holds.find((b) => b.dataset.rpHold === who)?.focus();
  }

  function toLeo() {
    s.stage = 'leo';
    s.details = true;
    freshOnce.add('list');
    s.hold = 'leo';
    render('.rpo.is-top');
    if (kb) leoHome.querySelector<HTMLElement>('.rpill--lime')?.focus({ preventScroll: true });
  }

  function act(a: string, i: number) {
    const t0 = tally(s.sara, s.saraNone, s.arrived);
    switch (a) {
      case 'push':
        s.stage = 'vote'; s.sheet = true; s.unread = 0; s.hold = 'sara';
        say('Sara opens the push · the vote sheet: Rehearsal availability');
        if (!s.opened) {
          s.opened = true;
          OTHERS.filter((v) => v.at).forEach((v) => later(v.at!, () => {
            if (s.locked >= 0) return;
            s.arrived.push(v.id);
            say(`${v.name} voted · ${listJoin(v.picks.map((p) => SLOTS[p].long))} · live on both phones`);
            render();
          }));
        }
        render();
        if (kb) window.setTimeout(() => sheet.querySelector<HTMLElement>('.rpad')?.focus({ preventScroll: true }), reduce ? 0 : 400);
        return;
      case 'vote': {
        if (s.stage === 'push') s.stage = 'vote';
        const had = s.sara.includes(i);
        s.sara = had ? s.sara.filter((x) => x !== i) : [...s.sara, i].sort();
        s.saraNone = false;
        const n = tally(s.sara, false, s.arrived).rows[i].length;
        say(had ? `Sara takes back ${SLOTS[i].long} · ${n}/${BAND}` : `Sara can make ${SLOTS[i].long} · ${n}/${BAND} available`);
        break;
      }
      case 'none':
        s.sara = []; s.saraNone = true; s.sheet = false;
        say('Sara · None work · her votes are cleared, Leo sees “No date works for Sara”');
        render(); later(reduce ? 0 : 550, toLeo); return;
      case 'done': case 'close':
        s.sheet = false;
        say(s.sara.length ? `Sara is done · ${listJoin(s.sara.map((x) => SLOTS[x].long))}` : 'Sara closes the sheet without voting');
        render(); later(reduce ? 0 : 550, toLeo); return;
      case 'bell':
        s.bell = !s.bell; s.unread = 0; break;
      case 'details':
        s.details = !s.details; if (s.details) freshOnce.add('list'); break;
      case 'lock':
        s.locking = s.locking === i ? -1 : i;
        if (s.locking >= 0) { freshOnce.add('fix'); say(`Leo taps Lock in on ${SLOTS[i].long}${t0.top.includes(i) ? ' · the Top pick' : ''}`); }
        if (s.stage !== 'done') s.stage = 'leo';
        render('.rpo__fix');
        if (kb) leoHome.querySelector<HTMLElement>('[data-place]')?.focus({ preventScroll: true });
        return;
      case 'confirm': {
        s.locked = s.locking; s.locking = -1; s.stage = 'done';
        timers.forEach(clearTimeout); timers = [];
        const x = SLOTS[s.locked];
        const where = s.place.trim() || 'Band Practice Space';
        s.place = where;
        s.notes = [{ t: 'Rehearsal Confirmed', b: `Rehearsal locked in for ${x.long} at 19:00 (${where}).`, ico: 'calendar' }, ...s.notes];
        s.unread = 1;
        freshOnce.add('ok');
        say(`Rehearsal confirmed · ${x.long}, 19:00 · ${where} · the poll closes`);
        render();
        later(reduce ? 0 : 900, () => {
          s.hold = 'sara'; s.bell = true; s.unread = 0;
          say('Sara’s bell: Rehearsal Confirmed · no push');
          render();
          if (kb) bell.querySelector<HTMLElement>('.rps__x')?.focus({ preventScroll: true });
        });
        return;
      }
    }
    render();
  }

  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b || !root.contains(b)) return;
    act(b.dataset.act!, Number(b.dataset.i));
  });
  push.addEventListener('click', () => act('push', 0));
  root.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.matches('[data-place]')) s.place = el.value;
  });
  root.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (e.key === 'Enter' && el.matches('[data-place]')) { e.preventDefault(); act('confirm', 0); }
    if (e.key === 'Escape' && (s.sheet || s.bell)) act(s.sheet ? 'close' : 'bell', 0);
  });
  // Touching the other phone picks it up.
  [saraEl, leoEl].forEach((el) => el.addEventListener('pointerdown', () => hold(el === saraEl ? 'sara' : 'leo')));
  holds.forEach((b, k) => {
    b.addEventListener('click', () => hold(b.dataset.rpHold as 'sara' | 'leo'));
    b.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? holds.length - 1 : (k + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + holds.length) % holds.length;
      hold(holds[next].dataset.rpHold as 'sara' | 'leo', true);
    });
  });
  root.querySelector('[data-rp-reset]')?.addEventListener('click', () => {
    timers.forEach(clearTimeout); timers = [];
    s = fresh(); minute = 0; seen.clear();
    if (log) log.innerHTML = '';
    render();
    saraHome.scrollTop = 0; leoHome.scrollTop = 0;
    say('Leo M. publishes a poll · everyone asked to vote gets a push');
  });

  render();
  say('Leo M. publishes a poll · everyone asked to vote gets a push');
}
