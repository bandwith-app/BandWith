import { FIELDS, ROLES, WHO, hiddenWhy, type Role } from '../content/roles';

/**
 * "Same gig, three views": one gig card, a switch for Admin / Member /
 * Deputy. Rows the role's phone never receives turn into a redacted bar
 * that says why (Admin only, Band only); values that differ (the fee, the
 * setlist rights) change in place. A wave runs down the card on each switch
 * so the eye catches every row that changed. The deputy's street address
 * waits for their yes, and the visitor can give it.
 * Once in view the switch plays through the three roles by itself, until
 * the visitor touches it.
 */
export function initRoles(root: HTMLElement | null, reduce: boolean) {
  if (!root) return;
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-rv-role]'));
  const seg = root.querySelector<HTMLElement>('[data-rv-seg]');
  const pill = root.querySelector<HTMLElement>('.rv__pill');
  const person = root.querySelector<HTMLElement>('[data-rv-person]');
  const line = root.querySelector<HTMLElement>('[data-rv-line]');
  const who = root.querySelector<HTMLElement>('[data-rv-who]');
  const count = root.querySelector<HTMLElement>('[data-rv-count]');
  const badge = root.querySelector<HTMLElement>('[data-rv-badge]');
  const yes = root.querySelector<HTMLButtonElement>('[data-rv-yes]');
  const card = root.querySelector<HTMLElement>('[data-rv-card]');
  const rows = new Map(Array.from(root.querySelectorAll<HTMLElement>('[data-f]')).map((el) => [el.dataset.f!, el]));
  if (!buttons.length || !card) return;

  let role: Role = 'admin';
  let accepted = false;

  const placePill = () => {
    const b = buttons.find((x) => x.dataset.rvRole === role);
    if (!pill || !b) return;
    pill.style.width = `${b.offsetWidth}px`;
    pill.style.transform = `translateX(${b.offsetLeft}px)`;
  };

  function paint(first = false) {
    root!.dataset.role = role;
    let n = 0;
    FIELDS.forEach((f) => {
      const el = rows.get(f.id);
      if (!el) return;
      const v = el.querySelector<HTMLElement>('.rr__v')!;
      const x = el.querySelector<HTMLElement>('.rr__x')!;
      const sr = el.querySelector<HTMLElement>('.rr__sr')!;
      const val = f.value[role];
      const wait = !accepted && f.later?.[role];
      const state = !val ? 'off' : wait ? 'later' : 'on';
      const text = wait || val || '';
      const before = el.dataset.state;
      const changed = before !== state || (text && v.textContent !== text);
      el.dataset.state = state;
      if (state === 'on') n++;
      x.textContent = hiddenWhy(f, role);
      sr.textContent = state === 'off' ? `Not sent to ${WHO[role].name.toLowerCase()}s` : '';
      if (text) v.textContent = text;
      if (changed && !first && !reduce) {
        el.classList.remove('is-flash');
        void el.offsetWidth;            // restart the wave on this row
        el.classList.add('is-flash');
      }
    });
    buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.rvRole === role)));
    placePill();
    if (person) person.textContent = WHO[role].person;
    if (line) line.textContent = WHO[role].line;
    if (badge) badge.textContent = `${WHO[role].name} view`;
    if (count) count.textContent = String(n);
    if (yes) yes.hidden = role !== 'deputy' || accepted;
    if (!first && !reduce && who) { who.classList.remove('is-in'); void who.offsetWidth; who.classList.add('is-in'); }
  }

  function set(r: Role) {
    if (r === role) return;
    role = r;
    if (r !== 'deputy') accepted = false;
    paint();
  }

  // Radio group: click, arrows, Home/End.
  let auto = 0;
  const stopAuto = () => { window.clearInterval(auto); auto = 0; };
  buttons.forEach((b, i) => {
    b.tabIndex = b.dataset.rvRole === role ? 0 : -1;
    b.addEventListener('click', () => { stopAuto(); set(b.dataset.rvRole as Role); buttons.forEach((x) => (x.tabIndex = x === b ? 0 : -1)); });
    b.addEventListener('keydown', (e) => {
      const k = e.key;
      let j = -1;
      if (k === 'ArrowRight' || k === 'ArrowDown') j = (i + 1) % buttons.length;
      else if (k === 'ArrowLeft' || k === 'ArrowUp') j = (i - 1 + buttons.length) % buttons.length;
      else if (k === 'Home') j = 0;
      else if (k === 'End') j = buttons.length - 1;
      if (j < 0) return;
      e.preventDefault();
      buttons[j].click();
      buttons[j].focus();
    });
  });
  yes?.addEventListener('click', () => {
    stopAuto();
    accepted = true;
    paint();
  });

  paint(true);
  window.addEventListener('resize', placePill);
  document.fonts?.ready.then(placePill);
  root.addEventListener('pointerdown', stopAuto);
  root.addEventListener('focusin', (e) => { if (e.target !== seg) stopAuto(); });

  // Plays Admin → Member → Deputy → Admin once when it first comes into view.
  if (reduce) return;
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    let k = 0;
    auto = window.setInterval(() => {
      k++;
      set(ROLES[k % ROLES.length]);
      if (k >= ROLES.length) stopAuto();
    }, 3400);
  }, { threshold: 0.55 });
  io.observe(card);
}
