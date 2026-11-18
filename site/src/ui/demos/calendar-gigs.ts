import { gsap } from 'gsap';

/**
 * Try it: create a gig in three steps as Leo (admin), then see what reaches
 * each musician. Labels and rules follow the app's gig wizard
 * (CreateEventModal, DatePicker, FreeHeat) and the Academy articles
 * create-a-gig, gig-lineup-and-fees, free-slots-and-conflicts and
 * answer-a-gig-invitation. November 2026, today is Tue 17.
 */

export interface Musician { id: string; name: string; ini: string; inst: string; fee: number; you?: boolean }
export const ROSTER: Musician[] = [
  { id: 'leo', name: 'Leo M.', ini: 'LM', inst: 'Bass', fee: 480, you: true },
  { id: 'sara', name: 'Sara', ini: 'SA', inst: 'Vocals', fee: 400 },
  { id: 'nico', name: 'Nico', ini: 'NI', inst: 'Drums', fee: 420 },
  { id: 'tom', name: 'Tom', ini: 'TO', inst: 'Guitar', fee: 420 },
  { id: 'lena', name: 'Lena P.', ini: 'LP', inst: 'Keys', fee: 180 },
];
/** A preset always includes you, then the first people of the roster. */
export const PRESETS: [label: string, n: number][] = [['Solo', 1], ['Duo', 2], ['Trio', 3], ['Full band', ROSTER.length]];
export const presetIds = (n: number) => ROSTER.slice(0, n).map((m) => m.id);

const TODAY = 17;
const OFFSET = 6; // Nov 1 2026 is a Sunday: six days of October before it (Monday first).
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const weekday = (d: number) => WD[(d - 1 + OFFSET) % 7];
/** Band events already on the calendar (they get a dot in the picker). */
export const EVENTS: Record<number, ['gig' | 'rehearsal', string]> = {
  9: ['rehearsal', 'Weekly rehearsal'], 16: ['rehearsal', 'Weekly rehearsal'], 20: ['gig', 'Rooftop Session'],
  23: ['rehearsal', 'Weekly rehearsal'], 28: ['gig', 'Tech Summit Afterparty'], 30: ['rehearsal', 'Weekly rehearsal'],
};
const ALL = ROSTER.map((m) => m.id);
const BAND_BUT_TOM = ALL.filter((id) => id !== 'tom');
/** Who is busy on a day, and with what (each musician only ever sees their own). */
export const BUSY: Record<number, Record<string, string>> = {
  18: { tom: 'Session at Studio 4 · 19:00' },
  20: Object.fromEntries(ALL.map((id) => [id, 'Rooftop Session · 21:00'])),
  21: { lena: 'Piano bar set · 21:00' },
  23: Object.fromEntries(BAND_BUT_TOM.map((id) => [id, 'Weekly rehearsal · 19:00'])),
  25: { sara: 'Choir concert · 20:00', nico: 'Drum clinic · 18:00' },
  27: { sara: 'Choir concert · 20:00' },
  28: Object.fromEntries(ALL.map((id) => [id, 'Tech Summit Afterparty · 21:00'])),
  30: Object.fromEntries(BAND_BUT_TOM.map((id) => [id, 'Weekly rehearsal · 19:00'])),
};
/** Members with nothing else on that day (counts only, from today on). */
export const freeOn = (d: number): number | null => (d < TODAY ? null : ROSTER.length - Object.keys(BUSY[d] ?? {}).length);
export const heat = (free: number, total = ROSTER.length) => (free >= total ? 4 : free / total >= 0.75 ? 3 : free / total >= 0.5 ? 2 : free > 0 ? 1 : 0);
/** "Nov 20 has a gig — Nov 21 is free." (DatePicker conflict hint). */
export function conflict(d: number) {
  const ev = EVENTS[d];
  if (!ev) return null;
  let next = d + 1;
  while (EVENTS[next]) next++;
  return { text: `Nov ${d} has a ${ev[0]}`, next: next <= 30 ? next : null, nextLabel: next <= 30 ? `Nov ${next}` : `Dec ${next - 30}` };
}

type Answer = 'pending' | 'in' | 'out';
interface S { step: 1 | 2 | 3; reached: number; picked: string[]; fees: Record<string, number>; tbd: boolean; day: number | null; created: boolean; answers: Record<string, Answer> }
const initial = (): S => ({ step: 1, reached: 1, picked: presetIds(ROSTER.length), fees: Object.fromEntries(ROSTER.map((m) => [m.id, m.fee])), tbd: false, day: null, created: false, answers: {} });

const TITLE = 'Client A — Wedding';
/** Extra band fee / services on top of the musicians' fees: Full band €1,900 + €500 = band fee €2,400. */
const EXTRA = 500;
const euro = (n: number) => `€${n.toLocaleString('en-GB')}`;
const STEP_NAMES = ['Event & lineup', 'Date & venue', 'Review & confirm'];

export function initCalendarGigsDemo(root: HTMLElement | null, reduce: boolean) {
  if (!root) return;
  const phone = root.querySelector<HTMLElement>('[data-cg-phone]');
  const log = root.querySelector<HTMLElement>('[data-cg-log]');
  const note = root.querySelector<HTMLElement>('[data-cg-note]');
  const cards = new Map(Array.from(root.querySelectorAll<HTMLElement>('[data-cg-member]')).map((el) => [el.dataset.cgMember!, el.querySelector<HTMLElement>('.cgm')!]));
  if (!phone) return;
  root.classList.add('is-live');
  let s = initial();
  let minute = 0;

  const say = (msg: string) => {
    if (!log) return;
    const li = document.createElement('li');
    const t = 10 * 60 + 12 + minute++;
    li.innerHTML = `<time>${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}</time><span>${msg}</span>`;
    log.prepend(li);
    while (log.children.length > 4) log.lastElementChild?.remove();
    if (!reduce) gsap.fromTo(li, { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.4 });
  };
  const lineup = () => ROSTER.filter((m) => s.picked.includes(m.id));
  const total = () => (s.tbd ? 0 : lineup().reduce((a, m) => a + (s.fees[m.id] || 0), 0));
  const bandFee = () => total() + EXTRA;
  const dateLong = (d: number) => `${weekday(d)} ${d} Nov 2026`;
  const presetOn = (n: number) => s.picked.length === n && presetIds(n).every((id) => s.picked.includes(id));

  /* ── Leo's phone ─────────────────────────────────────────────── */
  const head = () =>
    `<div class="cgp__top"><p class="cgp__h">New gig</p>` +
    `<div class="cgp__seg" role="group" aria-label="Wizard steps">${STEP_NAMES.map((n, i) => `<button type="button" data-k="seg${i}" data-act="seg" data-i="${i + 1}" aria-label="Step ${i + 1}: ${n}"${s.step === i + 1 ? ' aria-current="step"' : ''}${i + 1 > s.reached ? ' disabled' : ''} class="${i + 1 <= s.step ? 'is-on' : ''}"></button>`).join('')}</div>` +
    `<p class="cgp__step"><span>Step ${s.step} of 3</span><span>${STEP_NAMES[s.step - 1]}</span></p></div>`;

  const step1 = () => {
    const rows = ROSTER.map((m) => {
      const on = s.picked.includes(m.id);
      return `<li class="cgr${on ? ' is-on' : ''}"><button type="button" class="cgr__tick" role="checkbox" aria-checked="${on}" data-k="t-${m.id}" data-act="tick" data-m="${m.id}" aria-label="${m.name}${m.you ? ' (you)' : ''}"><svg class="ico" aria-hidden="true"><use href="#i-check"/></svg></button>` +
        `<span class="cgr__av" aria-hidden="true">${m.ini}</span><span class="cgr__n"><b>${m.name}</b><em>${m.you ? `You · ${m.inst}` : m.inst}</em></span>` +
        (s.tbd ? `<span class="cgr__tbd">TBD</span>` : `<label class="cgr__fee"><span aria-hidden="true">€</span><input data-k="f-${m.id}" data-fee="${m.id}" inputmode="numeric" maxlength="5" value="${s.fees[m.id] || ''}" aria-label="Fee for ${m.name}" ${on ? '' : 'disabled'} /></label>`) +
        `</li>`;
    }).join('');
    return `<p class="cgp__lbl">Event type</p><p class="cgp__type"><b>Wedding</b>${TITLE}</p>` +
      `<p class="cgp__lbl">Lineup preset</p><div class="cgp__pre" role="group" aria-label="Lineup preset">${PRESETS.map(([l, n]) => `<button type="button" data-k="p-${n}" data-act="preset" data-i="${n}" aria-pressed="${presetOn(n)}">${l}</button>`).join('')}</div>` +
      `<div class="cgp__roster"><p class="cgp__rh"><span>Roster · ${s.picked.length} of ${ROSTER.length}</span><em data-cg-total>${s.tbd ? 'Fee TBD' : `${euro(total())} est. total`}</em></p><ul>${rows}</ul></div>` +
      `<button type="button" class="cgp__sw" role="switch" aria-checked="${s.tbd}" data-k="tbd" data-act="tbd"><span class="cgp__swi" aria-hidden="true"><i></i></span>Fee to be discussed (TBD)</button>`;
  };

  const dayCell = (d: number) => {
    const free = freeOn(d);
    const ev = EVENTS[d];
    const sel = s.day === d;
    const tab = (s.day ?? TODAY) === d ? 0 : -1;
    const label = `${weekday(d)} ${d} November${ev ? `, has a ${ev[0]}` : ''}${free != null ? `, ${free} of ${ROSTER.length} free` : ''}`;
    return `<button type="button" class="cgd${sel ? ' is-sel' : ''}${d === TODAY ? ' is-today' : ''}${d < TODAY ? ' is-past' : ''}" data-heat="${free != null ? heat(free) : ''}" data-day="${d}" data-k="d${d}" data-act="day" tabindex="${tab}" aria-pressed="${sel}" aria-label="${label}"${d === TODAY ? ' aria-current="date"' : ''}>` +
      `<span>${d}</span>${free != null ? `<small aria-hidden="true">${free}/${ROSTER.length}</small>` : ''}${ev ? `<i class="cgd__dot" data-kind="${ev[0]}" aria-hidden="true"></i>` : ''}</button>`;
  };
  const monthGrid = (cell: (d: number) => string) => {
    const pad = (n: number, from: number) => Array.from({ length: n }, (_, i) => `<span class="cgd cgd--out" aria-hidden="true">${from + i}</span>`).join('');
    return `<div class="cgm__wd" aria-hidden="true">${WD.map((w) => `<span>${w[0]}</span>`).join('')}</div>` +
      `<div class="cgm__grid">${pad(OFFSET, 26)}${Array.from({ length: 30 }, (_, i) => cell(i + 1)).join('')}${pad(6, 1)}</div>`;
  };

  const step2 = () => {
    const free = s.day ? freeOn(s.day) : null;
    const c = s.day ? conflict(s.day) : null;
    const status = free == null ? '' : `<p class="cgp__free" data-heat="${heat(free)}" role="status"><i aria-hidden="true"></i>${free >= ROSTER.length ? `${free} of ${ROSTER.length} free · no conflicts` : `${free} of ${ROSTER.length} free`}</p>`;
    const warn = c ? `<p class="cgp__warn" role="status"><svg class="ico" aria-hidden="true"><use href="#i-zap"/></svg><span>${c.text}${c.next ? ` — <button type="button" data-k="nf" data-act="day" data-day="${c.next}">${c.nextLabel}</button> is free.` : ` — ${c.nextLabel} is free.`}</span></p>` : '';
    return `<p class="cgp__lbl">Venue / location</p><p class="cgp__venue"><svg class="ico" aria-hidden="true"><use href="#i-map-pin"/></svg><span><b>Villa Necchi</b>Via Mozart 14, Milan</span></p>` +
      `<p class="cgp__lbl">Event date</p><div class="cgp__short" role="group" aria-label="Shortcuts">` +
      [['Today', TODAY], ['Tomorrow', TODAY + 1], ['Weekend', 21]].map(([l, d]) => `<button type="button" data-k="sc-${l}" data-act="day" data-day="${d}">${l}</button>`).join('') + `</div>` +
      `<div class="cgm cgm--pick" role="group" aria-label="November 2026"><p class="cgm__h">November 2026</p>${monthGrid(dayCell)}` +
      `<p class="cgm__leg"><span>Free in band calendars · ${ROSTER.length} members</span><span class="cgm__scale" aria-hidden="true">${[0, 1, 2, 3, 4].map((l) => `<i data-heat="${l}"></i>`).join('')}</span></p></div>` +
      status + warn +
      `<p class="cgp__times"><span><em>Load-in</em>15:00</span><span><em>Soundcheck</em>16:30</span><span><em>Start</em>20:30</span><span><em>End</em>00:30</span></p>`;
  };

  const step3 = () => {
    const d = s.day!;
    const rows = lineup().map((m) => `<li><span>${m.name}${m.you ? ' · you' : ''}</span><b>${s.tbd ? 'TBD' : euro(s.fees[m.id] || 0)}</b></li>`).join('');
    return `<div class="cgp__sum"><p class="cgp__kick"><span class="cgp__dot"></span>Gig · ${s.tbd ? 'To be discussed' : 'Wedding'}</p><p class="cgp__title">${TITLE}</p>` +
      `<p class="cgp__meta">${dateLong(d)} · 20:30–00:30</p><p class="cgp__meta">Load-in 15:00 · Soundcheck 16:30</p><p class="cgp__meta">Villa Necchi · Via Mozart 14, Milan</p>` +
      `<ul class="cgp__fees">${rows}${s.tbd ? '' : `<li><span>Extra band fee / services</span><b>${euro(EXTRA)}</b></li>`}</ul><p class="cgp__band"><span>Band fee</span><b>${s.tbd ? 'To be discussed' : euro(bandFee())}</b></p></div>` +
      `<p class="cgp__edits"><button type="button" data-k="el" data-act="seg" data-i="1">Edit lineup</button><button type="button" data-k="ed" data-act="seg" data-i="2">Edit date &amp; venue</button></p>`;
  };

  const done = () => {
    const d = s.day!;
    const cell = (x: number) => {
      const ev = x === d ? 'gig' : EVENTS[x]?.[0];
      return `<span class="cgd cgd--cal${x === TODAY ? ' is-today' : ''}${x === d ? ' is-new' : ''}"${ev ? ` data-kind="${ev}"` : ''}>${x}</span>`;
    };
    const team = lineup().filter((m) => (m.you ? 'in' : s.answers[m.id]) !== 'out');
    const yes = team.filter((m) => m.you || s.answers[m.id] === 'in').length;
    return `<p class="cgp__kick"><span class="cgp__dot cgp__dot--pink"></span>Velvet Static · Schedule</p><p class="cgp__h cgp__h--cal">Calendar</p>` +
      `<div class="cgm" aria-label="November 2026: ${dateLong(d)} is now a gig" role="img"><p class="cgm__h">November 2026</p>${monthGrid(cell)}` +
      `<p class="cgm__leg cgm__leg--kinds"><span data-kind="gig">gig</span><span data-kind="rehearsal">rehearsal</span></p></div>` +
      `<div class="cgp__card"><p class="cgp__kick"><span class="cgp__dot"></span>Gig · Confirmed</p><p class="cgp__title">${TITLE}</p><p class="cgp__meta">${weekday(d)} ${d} Nov · 20:30 · Villa Necchi</p>` +
      `<p class="cgp__meters"><span><em>Lineup</em>${yes} of ${team.length} confirmed</span><span><em>Fee</em>${s.tbd ? 'To be discussed' : euro(bandFee())}</span></p></div>`;
  };

  const foot = () => {
    if (s.created) return '';
    const back = s.step > 1 ? `<button type="button" class="cgp__b" data-k="back" data-act="back">Back</button>` : `<span></span>`;
    const ok = s.step === 1 ? s.picked.length > 0 : s.step === 2 ? s.day != null : true;
    const next = s.step < 3
      ? `<button type="button" class="cgp__b cgp__b--go" data-k="next" data-act="next" ${ok ? '' : 'disabled'}>Next<svg class="ico" aria-hidden="true"><use href="#i-arrow-up-right"/></svg></button>`
      : `<button type="button" class="cgp__b cgp__b--go" data-k="create" data-act="create">Create gig</button>`;
    return `<div class="cgp__foot">${back}${next}</div>`;
  };

  /* ── The musicians' phones ───────────────────────────────────── */
  const memberHtml = (m: Musician) => {
    if (!s.created) return `<p class="cgm__wait"><svg class="ico" aria-hidden="true"><use href="#i-bell"/></svg>No notification yet</p>`;
    if (!s.picked.includes(m.id)) return `<p class="cgm__wait">Not on this gig · nothing sent</p>`;
    const d = s.day!;
    const a = s.answers[m.id] ?? 'pending';
    const fee = s.fees[m.id] || 0;
    const clash = BUSY[d]?.[m.id];
    const feeRow = s.tbd ? `<p class="cgi__kv"><span>Fee</span><b>to be discussed</b></p>` : fee > 0 ? `<p class="cgi__kv"><span>Allocated fee</span><b class="cgi__fee">${euro(fee)}</b></p>` : '';
    const answer = a === 'pending'
      ? `<div class="cgi__acts"><button type="button" class="cgi__b cgi__b--yes" data-k="a-${m.id}" data-act="accept" data-m="${m.id}">Accept event</button><button type="button" class="cgi__b" data-k="x-${m.id}" data-act="decline" data-m="${m.id}">Decline</button></div>`
      : `<p class="cgi__done" data-a="${a}">${a === 'in' ? 'You’re confirmed' : 'You dropped out of this event.'}</p>`;
    return `<div class="cgi"><p class="cgi__tag"><span class="cgp__dot"></span>Gig invitation</p><p class="cgi__t">${TITLE}</p>` +
      `<p class="cgi__kv"><span>Date</span><b>${weekday(d)} ${d} Nov</b></p><p class="cgi__kv"><span>Timings</span><b>Load-in 15:00 · Show 20:30</b></p><p class="cgi__kv"><span>Venue</span><b>Villa Necchi</b></p>${feeRow}` +
      `<p class="cgi__clash${clash ? ' is-on' : ''}">${clash ? `<b>Schedule conflict</b>${clash}` : 'No schedule conflicts in your calendar'}</p>${answer}</div>`;
  };

  const render = (anim?: 'step' | 'create') => {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.k;
    const body = s.created ? done() : s.step === 1 ? step1() : s.step === 2 ? step2() : step3();
    phone.innerHTML = `<div class="cgp__screen">${s.created ? '' : head()}<div class="cgp__body">${body}</div>${foot()}</div>`;
    ROSTER.filter((m) => !m.you).forEach((m) => { const c = cards.get(m.id); if (c) { c.innerHTML = memberHtml(m); c.classList.toggle('is-in', s.created && s.picked.includes(m.id)); } });
    root.classList.toggle('is-created', s.created);
    if (note) note.textContent = s.created
      ? 'Each invitation carries only that musician’s own fee, or to be discussed. Accept or decline on their phones.'
      : s.step === 2 ? 'Every day counts the members with nothing else on it, in any of their calendars: counts only, never who or why.' : '';
    if (focusKey) root.querySelector<HTMLElement>(`[data-k="${focusKey}"]:not([disabled])`)?.focus({ preventScroll: true });
    if (reduce || !anim) return;
    if (anim === 'step') gsap.fromTo(phone.querySelector('.cgp__body'), { autoAlpha: 0, x: 18 }, { autoAlpha: 1, x: 0, duration: 0.45, ease: 'power3.out' });
    if (anim === 'create') {
      gsap.fromTo(phone.querySelector('.is-new'), { scale: 0.4 }, { scale: 1, duration: 0.6, ease: 'back.out(2.4)', delay: 0.2 });
      gsap.fromTo(Array.from(root.querySelectorAll('.cg__m.is-in .cgi')), { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.09, delay: 0.35, ease: 'power3.out' });
    }
  };

  const go = (step: number) => { s = { ...s, step: step as S['step'], reached: Math.max(s.reached, step) }; render('step'); phone.querySelector<HTMLElement>('.cgp__body button, .cgp__body input')?.focus({ preventScroll: true }); };

  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b || (b as HTMLButtonElement).disabled) return;
    const id = b.dataset.m ?? '';
    const m = ROSTER.find((x) => x.id === id);
    switch (b.dataset.act) {
      case 'seg': return go(Number(b.dataset.i));
      case 'next': return go(s.step + 1);
      case 'back': return go(s.step - 1);
      case 'preset': {
        const n = Number(b.dataset.i);
        s = { ...s, picked: presetIds(n) };
        say(`Lineup preset <b>${PRESETS.find((p) => p[1] === n)![0]}</b> · ${lineup().map((x) => x.name).join(', ')}`);
        break;
      }
      case 'tick': s = { ...s, picked: s.picked.includes(id) ? s.picked.filter((x) => x !== id) : ROSTER.map((x) => x.id).filter((x) => x === id || s.picked.includes(x)) }; break;
      case 'tbd':
        s = { ...s, tbd: !s.tbd };
        say(s.tbd ? 'Fee to be discussed · the date is confirmed now, the money later' : `Fees back on · ${euro(total())} est. total`);
        break;
      case 'day': {
        const d = Number(b.dataset.day);
        s = { ...s, day: d };
        const c = conflict(d);
        say(c ? `${c.text} · pick ${c.nextLabel} instead` : `<b>${dateLong(d)}</b> · ${freeOn(d)} of ${ROSTER.length} free`);
        render();
        phone.querySelector<HTMLElement>(`[data-day="${d}"].cgd`)?.focus({ preventScroll: true });
        return;
      }
      case 'create': {
        s = { ...s, created: true };
        const others = lineup().filter((x) => !x.you).length;
        say(`Gig created · <b>${dateLong(s.day!)}</b> on everyone’s calendar`);
        if (others) say(`Inbox · “${TITLE}” is pending. Waiting for ${others} member${others > 1 ? 's' : ''} to confirm.`);
        render('create');
        return;
      }
      case 'accept': case 'decline': {
        const yes = b.dataset.act === 'accept';
        s = { ...s, answers: { ...s.answers, [id]: yes ? 'in' : 'out' } };
        say(yes ? `Gig confirmed by ${m?.name} · Leo is told` : `${m?.name} dropped out · every admin hears a replacement is needed`);
        render();
        cards.get(id)?.querySelector<HTMLElement>('.cgi__done')?.setAttribute('tabindex', '-1');
        return;
      }
    }
    render();
  });

  // Fees are typed in place: no re-render, so the caret stays.
  root.addEventListener('input', (e) => {
    const inp = e.target as HTMLInputElement;
    if (!inp.dataset.fee) return;
    inp.value = inp.value.replace(/\D/g, '').slice(0, 5);
    s = { ...s, fees: { ...s.fees, [inp.dataset.fee]: Number(inp.value) || 0 } };
    const t = root.querySelector('[data-cg-total]');
    if (t) t.textContent = `${euro(total())} est. total`;
  });

  // Arrow keys move through the days of the month (one tab stop).
  root.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (!el.matches('button.cgd[data-day]')) return;
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key];
    if (!step) return;
    e.preventDefault();
    const d = Math.min(30, Math.max(1, Number(el.dataset.day) + step));
    const next = phone.querySelector<HTMLElement>(`button.cgd[data-day="${d}"]`);
    if (!next) return;
    phone.querySelectorAll<HTMLElement>('button.cgd').forEach((x) => (x.tabIndex = -1));
    next.tabIndex = 0;
    next.focus();
  });

  root.querySelector('[data-cg-reset]')?.addEventListener('click', () => {
    s = initial();
    minute = 0;
    if (log) log.innerHTML = '';
    render('step');
    say('New gig · Full band picked, each fee from the roster');
  });

  render();
  say('New gig · Full band picked, each fee from the roster');
}
