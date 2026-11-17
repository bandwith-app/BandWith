/**
 * Try every device: one schematic calendar (HTML, not screenshots) that
 * morphs between Phone, iPad, Web and the three Duo postures, as the Academy
 * describes them (device-differences, ipad-layout, duo-*, calendar-on-tablet-and-duo).
 * The blocks are placed in % of the screen per device (styles/demos/devices.css);
 * CSS transitions move them, so the same screen visibly rearranges itself.
 */

export type Dev = 'phone' | 'tablet' | 'web' | 'duoClosed' | 'duoBook' | 'duoLaptop';
type Kind = 'gig' | 'rehearsal' | 'personal' | 'quote';
type Ev = { id: string; day: number; kind: Kind; title: string; when: string; where: string; status: string; rows: [string, string][]; people?: string[] };

export const DEVICES: { id: Dev; label: string; note: string; pane: 'one' | 'two' | 'laptop' }[] = [
  { id: 'phone', label: 'Phone', pane: 'one', note: 'Phone: one screen at a time, the tab bar at the bottom.' },
  { id: 'tablet', label: 'iPad', pane: 'two', note: 'iPad: the calendar in the list column, the event you open beside it, a floating tab pill with labels.' },
  { id: 'web', label: 'Web', pane: 'two', note: 'Web: from 744 px wide, the same layout as the iPad. A narrow window gets the phone layout.' },
  { id: 'duoClosed', label: 'Duo closed', pane: 'one', note: 'Duo closed: one page. The tabs, Back, Search and your profile live in the side rail.' },
  { id: 'duoBook', label: 'Duo book', pane: 'two', note: 'Duo book: the calendar on the left page, the event you open on the right, the hinge between them.' },
  { id: 'duoLaptop', label: 'Duo laptop', pane: 'laptop', note: 'Duo laptop: the Planner. The month and its counts on top, the day’s agenda and + Gig / + Rehearsal below.' },
];

export const EVENTS: Ev[] = [
  { id: 'roof', day: 15, kind: 'gig', title: 'Rooftop session', when: 'Sun 15 Nov · 21:00', where: 'Terrazza Aurora, Milan', status: 'Confirmed', rows: [['Show', '21:00'], ['Fee', '€1,800']], people: ['Leo M.', 'Sara', 'Nico', 'Tom', 'Lena P.'] },
  { id: 'reh', day: 17, kind: 'rehearsal', title: 'Wedding set', when: 'Tue 17 Nov · 19:00–22:00', where: 'Rehearsal room', status: 'Rehearsal', rows: [['Start', '19:00'], ['End', '22:00']], people: ['Leo M.', 'Sara', 'Nico', 'Tom', 'Lena P.'] },
  { id: 'pers', day: 18, kind: 'personal', title: 'Teaching', when: 'Wed 18 Nov · 16:00', where: 'Your own gig', status: 'Personal', rows: [['Start', '16:00']] },
  { id: 'wed', day: 21, kind: 'gig', title: 'Client A — Wedding', when: 'Sat 21 Nov · 20:30', where: 'Villa Necchi, Via Mozart 14, Milan', status: 'Confirmed', rows: [['Load-in', '15:00'], ['Soundcheck', '16:30'], ['Show', '20:30'], ['Fee', '€2,400']], people: ['Leo M.', 'Sara', 'Nico', 'Tom', 'Ivo M. for Lena P.'] },
  { id: 'quote', day: 26, kind: 'quote', title: 'Client B — Gala dinner', when: 'Thu 26 Nov · 20:00', where: 'Quote sent, waiting', status: 'Quote', rows: [['Show', '20:00']] },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const KIND: Record<Kind, string> = { gig: 'Gig', rehearsal: 'Rehearsal', personal: 'Personal', quote: 'Quote' };
const DAY = (d: number) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][(d - 1) % 7]} ${d} Nov`; // 1 Nov 2026 is a Sunday
const ico = (id: string) => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const HOME = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 11 12 4l9 7M6 10v10M18 10v10M10 20v-5M14 20v-5"/></svg>';
const SEARCH = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/></svg>';
const MENU = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>';

/** The month: Monday first, 1 Nov 2026 on a Sunday, six weeks. */
function month(): string {
  const cells: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = i - 5;
    if (d < 1 || d > 30) { cells.push(`<span class="ddm__d is-out">${d < 1 ? 31 + d : d - 30}</span>`); continue; }
    const ev = EVENTS.find((e) => e.day === d);
    cells.push(ev
      ? `<button type="button" class="ddm__d" data-k="${ev.kind}" data-day="${d}" data-ev="${ev.id}" aria-label="${DAY(d)}: ${esc(ev.title)}">${d}</button>`
      : `<span class="ddm__d" data-day="${d}">${d}</span>`);
  }
  return `<div class="ddm__wk" aria-hidden="true">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div><div class="ddm__grid">${cells.join('')}</div>`;
}

const rows = () => EVENTS.map((e) =>
  `<li data-day="${e.day}"><button type="button" class="ddl__row" data-k="${e.kind}" data-ev="${e.id}"><i aria-hidden="true"></i><span><b>${esc(e.title)}</b><em>${esc(e.when)}</em></span></button></li>`).join('');

/** The detail pane: the open event, or the empty page. */
export function detailHtml(id: string | null, dev: Dev): string {
  const e = EVENTS.find((x) => x.id === id);
  if (!e) {
    return `<div class="ddx ddx--empty"><p class="ddx__kick">BandWith${dev.startsWith('duo') ? ' · Duo' : ''}</p><p class="ddx__title">Pick an event</p><p class="ddx__line">Details open on this side.</p></div>`;
  }
  return `<div class="ddx" data-k="${e.kind}">` +
    `<div class="ddx__hero"><button type="button" class="ddx__back" data-dd-back aria-label="Back to the calendar">${ico('arrow-left')}</button>` +
    `<p class="ddx__kick"><i aria-hidden="true"></i>${KIND[e.kind]} · ${esc(e.status)}</p><p class="ddx__title">${esc(e.title)}</p><p class="ddx__line">${esc(e.when)} · ${esc(e.where)}</p></div>` +
    `<div class="ddx__more">` +
    (e.kind === 'gig' ? `<p class="ddx__tabs" aria-hidden="true"><span>Overview</span><span>Setlist</span><span>Rider &amp; stage</span><span>Money</span></p>` : '') +
    `<dl class="ddx__rows">${e.rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` +
    (e.people ? `<ul class="ddx__people" aria-label="Lineup">${e.people.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '') +
    `</div></div>`;
}

/** The whole schematic screen (build time and first paint). */
export function screenHtml(): string {
  const nav = [
    ['back', ico('arrow-left'), 'Back'], ['home', HOME, 'Home'], ['cal', ico('calendar'), 'Calendar'], ['plus', ico('plus'), ''],
    ['chat', ico('message-circle'), 'Chat'], ['menu', MENU, 'Settings'], ['help', '<b>?</b>', ''], ['search', SEARCH, ''], ['me', '<b>LM</b>', ''],
  ].map(([k, i, l]) => k === 'back'
    ? `<button type="button" class="ddn__i ddn__i--back" data-dd-back aria-label="Back to the calendar">${i}</button>`
    : `<span class="ddn__i ddn__i--${k}" aria-hidden="true">${i}${l ? `<em>${l}</em>` : ''}</span>`).join('');
  return `<div class="ddb ddb--head">` +
      `<div class="ddh ddh--cal"><p class="ddh__kick"><i></i>Velvet Static · Schedule</p><p class="ddh__title">Calendar</p>` +
      `<p class="ddf" aria-hidden="true"><span class="is-on">All 5</span><span>Gigs</span><span>Rehearsals</span><span>Quotes</span></p></div>` +
      `<div class="ddh ddh--plan"><p class="ddh__title">November 2026</p><p class="ddh__counts"><b>2</b> Gigs <b>1</b> Rehearsals <b>€4,200</b> Fees <b>2</b> Free weekends</p></div>` +
    `</div>` +
    `<div class="ddb ddb--cal"><p class="ddm__t" aria-hidden="true"><span class="ddm__arr">${ico('arrow-left')}</span><span class="ddm__arr">${ico('arrow-right')}</span>November 2026</p>${month()}</div>` +
    `<div class="ddb ddb--list">` +
      `<p class="ddl__h ddl__h--up">Upcoming</p>` +
      `<p class="ddf ddf--deck" aria-hidden="true"><span class="is-on">All 5</span><span>Gigs</span><span>Rehearsals</span><span>Quotes</span></p>` +
      `<div class="ddl__day"><button type="button" data-dd-day="-1" aria-label="Previous day">${ico('chevron-left')}</button><b data-dd-dayname></b><button type="button" data-dd-day="1" aria-label="Next day">${ico('chevron-right')}</button></div>` +
      `<p class="ddl__h ddl__h--ag">Agenda</p>` +
      `<ul class="ddl">${rows()}</ul><p class="ddl__none">Nothing on this day.</p>` +
    `</div>` +
    `<div class="ddb ddb--acts" aria-hidden="true"><span class="is-gig">${ico('plus')}Gig</span><span>${ico('plus')}Rehearsal</span></div>` +
    `<div class="ddb ddb--detail" data-dd-detail>${detailHtml(null, 'phone')}</div>` +
    `<div class="ddb ddb--nav">${nav}</div>` +
    `<div class="ddb ddb--hinge" aria-hidden="true"></div>`;
}

export function initDevicesDemo(root: HTMLElement | null, reduce: boolean) {
  if (!root) return;
  const detail = root.querySelector<HTMLElement>('[data-dd-detail]');
  const note = root.querySelector<HTMLElement>('[data-dd-note]');
  const chips = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-dd-dev]'));
  const dayName = root.querySelector<HTMLElement>('[data-dd-dayname]');
  if (!detail) return;
  root.classList.add('is-live');
  root.classList.toggle('is-still', reduce);

  let dev: Dev = 'phone';
  let open: string | null = null;
  let day = 21;
  const pane = () => DEVICES.find((d) => d.id === dev)!.pane;

  const render = (fill = false) => {
    root.dataset.dev = dev;
    root.classList.toggle('is-open', !!open);
    chips.forEach((c) => {
      const on = c.dataset.ddDev === dev;
      c.setAttribute('aria-checked', String(on));
      c.tabIndex = on ? 0 : -1;
    });
    if (fill) {
      detail.innerHTML = detailHtml(open, dev);
      if (!reduce && pane() === 'two') detail.firstElementChild?.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    }
    // In single-pane layouts a closed detail is out of reach for keyboards and readers.
    detail.inert = !open && pane() !== 'two';
    root.querySelectorAll<HTMLElement>('[data-ev]').forEach((b) => {
      b.classList.toggle('is-sel', b.dataset.ev === open);
      if (b.classList.contains('ddl__row')) b.setAttribute('aria-pressed', String(b.dataset.ev === open));
    });
    root.querySelectorAll<HTMLElement>('.ddm__d[data-day]').forEach((c) => c.classList.toggle('is-day', Number(c.dataset.day) === day));
    root.querySelectorAll<HTMLElement>('.ddl li').forEach((li) => li.classList.toggle('is-today', Number(li.dataset.day) === day));
    root.classList.toggle('is-empty-day', !EVENTS.some((e) => e.day === day));
    if (dayName) dayName.textContent = DAY(day);
    const list = root.querySelector<HTMLElement>('.ddl');
    if (list && dev === 'duoLaptop') list.scrollTop = 0;
  };

  const say = (msg: string) => { if (note) note.textContent = msg; };

  const openEvent = (id: string) => {
    const e = EVENTS.find((x) => x.id === id)!;
    open = id;
    day = e.day;
    render(true);
    const p = pane();
    say(p === 'two'
      ? `${e.title} opens ${dev === 'duoBook' ? 'on the right page' : 'beside the calendar'}; it stays outlined in the list.`
      : p === 'laptop'
        ? `${e.title}: the event on the top half, its details on the bottom half. Back is in the rail.`
        : `${e.title} takes the screen. ${dev === 'duoClosed' ? 'Back is in the side rail.' : 'Back returns to the calendar.'}`);
    if (p !== 'two') detail.querySelector<HTMLElement>('[data-dd-back]')?.focus({ preventScroll: true });
  };

  const closeEvent = () => {
    const was = open;
    open = null;
    render(true);
    say('Back to the calendar.');
    root.querySelector<HTMLElement>(`.ddl__row[data-ev="${was}"]`)?.focus({ preventScroll: true });
  };

  const setDev = (d: Dev, focus = false) => {
    if (d === dev) return;
    dev = d;
    render(true);
    if (!reduce) root.querySelectorAll('.ddb--nav > *, .ddb--head .ddh, .ddm__grid').forEach((el) => el.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 520, easing: 'ease-out' }));
    if (focus) root.querySelector<HTMLElement>(`[data-dd-dev="${d}"]`)?.focus();
    say(DEVICES.find((x) => x.id === d)!.note);
  };

  root.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || !root.contains(b)) return;
    if (b.dataset.ddDev) return setDev(b.dataset.ddDev as Dev);
    if (b.hasAttribute('data-dd-reset')) { dev = 'phone'; open = null; day = 21; render(true); say('Back to the start: the phone, the calendar on screen.'); return; }
    if (b.hasAttribute('data-dd-back')) return closeEvent();
    if (b.dataset.ddDay) {
      day = Math.min(30, Math.max(1, day + Number(b.dataset.ddDay)));
      render();
      const e = EVENTS.find((x) => x.day === day);
      say(`${DAY(day)}: ${e ? e.title : 'Nothing on this day.'}`);
      return;
    }
    const id = b.dataset.ev;
    if (!id) return;
    // The Planner's month picks the day; its agenda opens the event.
    if (dev === 'duoLaptop' && b.classList.contains('ddm__d')) {
      day = Number(b.dataset.day);
      render();
      say(`${DAY(day)} in the agenda below: ${EVENTS.find((x) => x.id === id)!.title}.`);
      return;
    }
    openEvent(id);
  });

  root.querySelector('[role="radiogroup"]')?.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    const i = DEVICES.findIndex((d) => d.id === dev);
    const to = k === 'ArrowRight' || k === 'ArrowDown' ? i + 1 : k === 'ArrowLeft' || k === 'ArrowUp' ? i - 1 : k === 'Home' ? 0 : k === 'End' ? DEVICES.length - 1 : null;
    if (to == null) return;
    e.preventDefault();
    setDev(DEVICES[(to + DEVICES.length) % DEVICES.length].id, true);
  });
  root.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape' && open) closeEvent(); });

  render(true);
}
