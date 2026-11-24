import { gsap } from 'gsap';

/**
 * Fees & payouts: Client A — Wedding is over. Leo's phone shows Payouts on
 * Home and the Fee & payouts sheet (labels from the app's FeePayoutsContent
 * and PayoutsDueCard); Sara's phone shows only her own payout. Rules from the
 * Academy: payouts-due, fee-and-payouts-on-a-gig, what-members-see-of-money.
 */

export type Musician = { id: string; name: string; ini: string; role: string; fee: number };
export const BAND_FEE = 2400;
export const MUSICIANS: Musician[] = [
  { id: 'leo', name: 'Leo M.', ini: 'LM', role: 'Bass', fee: 480 },
  { id: 'sara', name: 'Sara', ini: 'SA', role: 'Vocals', fee: 400 },
  { id: 'nico', name: 'Nico', ini: 'NI', role: 'Drums', fee: 420 },
  { id: 'tom', name: 'Tom', ini: 'TO', role: 'Guitar', fee: 420 },
  { id: 'ivo', name: 'Ivo M.', ini: 'IM', role: 'Keys · Deputy', fee: 180 },
];
export type Role = 'admin' | 'member';
export type MoneyState = { paid: Record<string, boolean>; role: Role };

export const initialMoney = (): MoneyState => ({ paid: {}, role: 'admin' });
export const togglePaid = (s: MoneyState, id: string): MoneyState => ({ ...s, paid: { ...s.paid, [id]: !s.paid[id] } });
export const markAllPaid = (s: MoneyState): MoneyState => ({ ...s, paid: Object.fromEntries(MUSICIANS.map((m) => [m.id, true])) });
export const due = (s: MoneyState) => MUSICIANS.filter((m) => !s.paid[m.id]);
export const dueTotal = (s: MoneyState) => due(s).reduce((t, m) => t + m.fee, 0);
export const payoutsTotal = () => MUSICIANS.reduce((t, m) => t + m.fee, 0);
export const bandFund = () => BAND_FEE - payoutsTotal();

export const eur = (n: number) => `€${Math.round(n).toLocaleString('en-US')}`;

/**
 * The log line after a tap on a musician's switch: who, paid or back to
 * pending, and what is still due. One sentence per musician and outcome, with
 * the amount as the only moving part, so the Italian and Spanish dictionaries
 * hold it for every order of taps ("{name} paid · <b>{eur}</b> still due",
 * site/test/demo-money.test.ts).
 */
export const paidLine = (m: Musician, paid: boolean, left: number) =>
  `${m.name} ${paid ? 'paid' : 'back to pending'} · ${left ? `<b>${eur(left)}</b> still due` : '<b>everyone paid</b> · the gig leaves Payouts on Home'}`;
const badge = (paid: boolean) => `<span class="mdp__badge${paid ? ' is-paid' : ''}">${paid ? 'PAID' : 'PENDING'}</span>`;

/** What each role's phone holds, for the side panel. A member never gets the band's numbers. */
export function seesList(s: MoneyState) {
  if (s.role === 'admin') return [
    { yes: true, what: 'Band fee', v: eur(BAND_FEE) },
    { yes: true, what: 'Every musician’s fee', v: `Five fees · ${eur(payoutsTotal())}` },
    { yes: true, what: 'Band fund', v: eur(bandFund()) },
    { yes: true, what: 'Marks musicians paid', v: `${MUSICIANS.length - due(s).length} of ${MUSICIANS.length}` },
  ];
  return [
    { yes: true, what: 'Her own fee', v: eur(MUSICIANS[1].fee) },
    { yes: true, what: 'Paid or pending', v: s.paid.sara ? 'Paid' : 'Pending' },
    { yes: false, what: 'The band fee', v: 'Not on her phone' },
    { yes: false, what: 'Other people’s fees', v: 'Not on her phone' },
    { yes: false, what: 'Band fund and deposit', v: 'Not on her phone' },
    { yes: false, what: 'Marking anyone paid', v: 'Admins only' },
  ];
}

function adminHtml(s: MoneyState) {
  const d = due(s);
  const total = dueTotal(s);
  const home = d.length
    ? `<p class="mdp__lab">Payouts (1)</p><div class="mdp__home"><p class="mdp__k">Client A — Wedding · Sat, Nov 21</p>` +
      `<div class="mdp__hrow"><p class="mdp__ht">Payouts due</p><p class="mdp__amt" data-md-due="home">${eur(total)}</p></div>` +
      `<p class="mdp__av">${d.map((m) => `<i>${m.ini}</i>`).join('')}<span>${d.length} musician${d.length === 1 ? '' : 's'} · paid after the show</span></p></div>`
    : `<p class="mdp__lab">Payouts (0)</p>`;
  const rows = MUSICIANS.map((m) => {
    const p = !!s.paid[m.id];
    return `<li class="mdp__row${p ? ' is-paid' : ''}"><i class="mdp__ini">${m.ini}</i><span class="mdp__nm">${m.name} · ${m.role}</span>` +
      `<span class="mdp__fee">${eur(m.fee)}</span>${badge(p)}` +
      `<button type="button" class="mdp__sw" role="switch" aria-checked="${p}" aria-label="${m.name} paid" data-k="sw-${m.id}" data-md-act="toggle" data-id="${m.id}"><svg class="ico" aria-hidden="true"><use href="#i-check"/></svg></button></li>`;
  }).join('');
  const paidCount = MUSICIANS.length - d.length;
  return `<div class="mdp__screen" data-md-screen>` +
    `<p class="mdp__k"><span class="mdp__dot"></span>Admin · Velvet Static</p><p class="mdp__h1">Action center</p>${home}` +
    `<div class="mdp__sheet"><span class="mdp__grab"></span><p class="mdp__k">Admin only</p><p class="mdp__h2">Fee &amp; payouts</p>` +
    `<p class="mdp__lab">Band fee</p><p class="mdp__big">${eur(BAND_FEE)}</p>` +
    (total > 0 ? `<p class="mdp__due"><span>PAYOUTS DUE · ${d.length}</span><b data-md-due="sheet">${eur(total)}</b></p>` : '') +
    `<p class="mdp__lab">MUSICIANS · ${paidCount} OF ${MUSICIANS.length} PAID</p><ul class="mdp__rows">${rows}</ul>` +
    `<p class="mdp__fund"><span>Band fund (${Math.round((bandFund() / BAND_FEE) * 100)}%)</span><b>${eur(bandFund())}</b></p>` +
    (d.length ? `<button type="button" class="mdp__all" data-k="all" data-md-act="all"><svg class="ico" aria-hidden="true"><use href="#i-check"/></svg>MARK ALL AS PAID</button>` : '') +
    `</div></div>`;
}

function memberHtml(s: MoneyState) {
  const sara = MUSICIANS[1];
  const paid = !!s.paid.sara;
  const home = paid ? '' :
    `<p class="mdp__lab">Your payouts (1)</p><div class="mdp__home"><p class="mdp__k">Client A — Wedding · Sat, Nov 21</p>` +
    `<p class="mdp__ht">You’re owed ${eur(sara.fee)}</p>` +
    `<button type="button" class="mdp__view" data-k="view" data-md-act="view">View payout</button></div>`;
  return `<div class="mdp__screen" data-md-screen>` +
    `<p class="mdp__k"><span class="mdp__dot mdp__dot--m"></span>Member</p><p class="mdp__h1">Velvet Static</p>${home}` +
    `<div class="mdp__sheet" data-md-own tabindex="-1"><span class="mdp__grab"></span><p class="mdp__k">Client A — Wedding</p><p class="mdp__h2">Fee &amp; payouts</p>` +
    `<div class="mdp__own"><div><p class="mdp__lab">Your assigned fee</p><p class="mdp__big">${eur(sara.fee)}</p></div>${badge(paid)}</div></div></div>`;
}

export function initMoneyDemo(root: HTMLElement | null, reduce: boolean) {
  if (!root) return;
  const phone = root.querySelector<HTMLElement>('[data-md-phone]');
  const sees = root.querySelector<HTMLElement>('[data-md-sees]');
  const log = root.querySelector<HTMLElement>('[data-md-log]');
  const radios = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-md-role]'));
  if (!phone) return;
  root.classList.add('is-live');
  let s = initialMoney();

  const say = (msg: string) => {
    if (!log) return;
    const li = document.createElement('li');
    li.innerHTML = msg;
    log.prepend(li);
    while (log.children.length > 4) log.lastElementChild?.remove();
    if (!reduce) gsap.fromTo(li, { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.4 });
  };

  const render = (from?: number) => {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.k;
    const scroll = phone.querySelector('[data-md-screen]')?.scrollTop ?? 0;
    phone.innerHTML = s.role === 'admin' ? adminHtml(s) : memberHtml(s);
    phone.dataset.role = s.role;
    const scr = phone.querySelector<HTMLElement>('[data-md-screen]');
    if (scr) scr.scrollTop = scroll;
    // Payouts due counts down (or up) from the amount before the tap.
    const to = dueTotal(s);
    if (from !== undefined && from !== to && !reduce) {
      const els = phone.querySelectorAll<HTMLElement>('[data-md-due]');
      const o = { v: from };
      gsap.to(o, { v: to, duration: 0.6, ease: 'power2.out', onUpdate: () => els.forEach((el) => { el.textContent = eur(o.v); }) });
    }
    if (sees) {
      sees.innerHTML = `<p class="md__lab mono">On ${s.role === 'admin' ? 'Leo’s' : 'Sara’s'} phone</p><ul>` +
        seesList(s).map((x) => `<li class="${x.yes ? 'is-yes' : 'is-no'}"><svg class="ico" aria-hidden="true"><use href="#i-${x.yes ? 'check' : 'eye-off'}"/></svg><span>${x.what}</span><b>${x.v}</b></li>`).join('') + `</ul>`;
    }
    radios.forEach((r) => { const on = r.dataset.mdRole === s.role; r.setAttribute('aria-checked', String(on)); r.tabIndex = on ? 0 : -1; });
    if (focusKey) phone.querySelector<HTMLElement>(`[data-k="${focusKey}"]`)?.focus({ preventScroll: true });
  };

  const setRole = (role: Role, focus = false) => {
    if (role === s.role) return;
    s = { ...s, role };
    if (reduce) render();
    else gsap.timeline()
      .to(phone, { autoAlpha: 0, y: 14, scale: 0.97, duration: 0.2, ease: 'power2.in' })
      .add(() => render())
      .to(phone, { autoAlpha: 1, y: 0, scale: 1, duration: 0.45, ease: 'power3.out' });
    if (focus) radios.find((r) => r.dataset.mdRole === role)?.focus();
    say(role === 'member'
      ? `Sara’s phone · her own fee, <b>${eur(MUSICIANS[1].fee)} · ${s.paid.sara ? 'PAID' : 'PENDING'}</b>. No band fee, no one else’s fee`
      : `Leo’s phone · <b>${eur(dueTotal(s))}</b> still to pay out`);
  };

  radios.forEach((r) => {
    r.addEventListener('click', () => setRole(r.dataset.mdRole as Role));
    r.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      setRole(s.role === 'admin' ? 'member' : 'admin', true);
    });
  });

  phone.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-md-act]');
    if (!b) return;
    const before = dueTotal(s);
    if (b.dataset.mdAct === 'toggle') {
      const m = MUSICIANS.find((x) => x.id === b.dataset.id)!;
      s = togglePaid(s, m.id);
      render(before);
      const left = dueTotal(s);
      say(paidLine(m, !!s.paid[m.id], left));
    } else if (b.dataset.mdAct === 'all') {
      s = markAllPaid(s);
      render(before);
      root.querySelector<HTMLElement>('[data-md-role="member"]')?.focus({ preventScroll: true });
      say('MARK ALL AS PAID · <b>everyone paid</b> · the gig leaves Payouts on Home');
    } else if (b.dataset.mdAct === 'view') {
      const own = phone.querySelector<HTMLElement>('[data-md-own]');
      own?.focus({ preventScroll: true });
      own?.scrollIntoView?.({ block: 'nearest' });
      if (own && !reduce) gsap.fromTo(own, { boxShadow: '0 0 0 0 rgba(213,251,70,.8)' }, { boxShadow: '0 0 0 12px rgba(213,251,70,0)', duration: 0.7 });
    }
  });

  root.querySelector<HTMLButtonElement>('[data-md-reset]')?.addEventListener('click', () => {
    s = initialMoney();
    if (log) log.innerHTML = '';
    render();
    say(`The show is over · <b>${eur(dueTotal(s))}</b> to pay out to five musicians`);
  });

  render();
  say(`The show is over · <b>${eur(dueTotal(s))}</b> to pay out to five musicians`);
}
