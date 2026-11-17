import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';

/**
 * Rehearsal poll, played on one phone. The visitor is the band's sixth member:
 *   push   → the real "Vote on rehearsal times" notification lands on the member home
 *   vote   → the vote sheet (Figma "Rehearsal poll" sheet: Step Pads with 6-dot meters)
 *   admin  → the phone flips to the admin's "Details · Lock in" list (RehearsalPollCard)
 *   done   → back on the member home, the real "Rehearsal confirmed" push arrives
 * The big line on the left always says what to do next. Copy for both pushes comes
 * from 046_server_notifications_and_push / rehearsalPolls.ts.
 */

type Scene = 'push' | 'vote' | 'admin' | 'done';

const SLOTS = [
  { d: 'Tue', day: 'Tuesday', n: '15', long: 'Tue 15 Dec', app: 'Tue, Dec 15' },
  { d: 'Wed', day: 'Wednesday', n: '16', long: 'Wed 16 Dec', app: 'Wed, Dec 16' },
  { d: 'Thu', day: 'Thursday', n: '17', long: 'Thu 17 Dec', app: 'Thu, Dec 17' },
];
const TIME = '21:00–23:30';
// Four members have voted: Tuesday and Thursday tie 3–3.
const VOTERS = [
  { ini: 'MC', name: 'Marta', picks: [0, 2] },
  { ini: 'OB', name: 'Omar', picks: [0, 2] },
  { ini: 'JL', name: 'Jacopo', picks: [0, 1] },
  { ini: 'SV', name: 'Sara', picks: [2] },
];
const BAND = 6;

const PUSH = {
  poll: { title: 'Vote on rehearsal times', txt: 'New availability poll: “Extra rehearsal before Rossi wedding”.' },
  done: (s: (typeof SLOTS)[number]) => ({ title: 'Rehearsal confirmed', txt: `Locked in for ${s.long} at 21:00 (Sala Prove Bloom).` }),
};

// The app's own Check (BandWith Dot Icons), from the sprite in index.html.
const CHECK = '<svg class="ico" aria-hidden="true"><use href="#i-check"/></svg>';

export function initPollDemo(root: HTMLElement | null, reduce: boolean) {
  if (!root) return;
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const phone = $('[data-pphone]');
  const device = $('[data-pdevice]');
  const push = $<HTMLButtonElement>('[data-push]');
  const pushTitle = $('[data-push-title]');
  const pushTxt = $('[data-push-txt]');
  const padsEl = $('[data-pads]');
  const doneBtn = $<HTMLButtonElement>('[data-done]');
  const noneBtn = $<HTMLButtonElement>('[data-none]');
  const votedEl = $('[data-voted]');
  const optsEl = $('[data-opts]');
  const adminMeta = $('[data-admin-meta]');
  const big = $('[data-say-big]');
  const hint = $('[data-say-hint]');
  const again = $<HTMLButtonElement>('[data-again]');
  const role = $('[data-role]');
  const steps = Array.from(root.querySelectorAll<HTMLElement>('[data-pstep]'));

  const mine = new Set<number>();
  let scene: Scene = 'push';
  let locked = -1;
  let kb = false; // move focus for keyboard users only; pointer users keep their place
  const focus = (el: HTMLElement | null | undefined, delay: number) => { if (kb && el) window.setTimeout(() => el.focus({ preventScroll: true }), reduce ? 0 : delay); };
  root.addEventListener('pointerdown', () => (kb = false));
  root.addEventListener('keydown', () => (kb = true));

  /* ── Copy: the big line rolls in like the tour titles ── */
  let split: SplitText | null = null;
  function say(line: string, sub: string) {
    hint.textContent = sub;
    if (big.textContent === line) return;
    split?.revert();
    big.textContent = line;
    if (reduce) return;
    split = SplitText.create(big, { type: 'lines', mask: 'lines' });
    gsap.fromTo(split.lines, { yPercent: 105 }, { yPercent: 0, duration: 0.9, ease: 'expo.out', stagger: 0.06 });
    gsap.fromTo(hint, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.7, ease: 'expo.out', delay: 0.15 });
  }

  /* ── Vote sheet ── */
  const pads = SLOTS.map((s, c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ppad';
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML =
      `<span class="ppad__top"><span>${s.d}</span><i class="ppad__dot"></i></span>` +
      `<b class="ppad__n">${s.n}</b><span class="ppad__t">${TIME}</span>` +
      `<span class="ppad__meter">${'<i></i>'.repeat(BAND)}</span>`;
    b.addEventListener('click', () => {
      if (scene !== 'vote') return;
      if (mine.has(c)) mine.delete(c); else mine.add(c);
      paintVote(c);
    });
    padsEl.appendChild(b);
    return b;
  });

  const tally = () => SLOTS.map((_, c) => {
    const others = VOTERS.filter((v) => v.picks.includes(c));
    const me = mine.has(c) ? 1 : 0;
    return { others, me, total: others.length + me };
  });
  const leaders = (t: ReturnType<typeof tally>) => {
    const max = Math.max(...t.map((x) => x.total));
    return { max, tied: t.map((x, i) => (x.total === max ? i : -1)).filter((i) => i >= 0) };
  };

  function paintVote(changed = -1) {
    const t = tally();
    pads.forEach((b, c) => {
      const on = mine.has(c);
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', `${SLOTS[c].long}, ${TIME}: ${t[c].total} of ${BAND} available${on ? ', including you' : ''}`);
      b.querySelectorAll('.ppad__meter i').forEach((d, k) => {
        d.classList.toggle('on', k < t[c].total);
        const me = on && k === t[c].total - 1;
        d.classList.toggle('me', me);
        if (me && c === changed && !reduce) gsap.fromTo(d, { scale: 0 }, { scale: 1, duration: 0.5, ease: 'back.out(3)' });
      });
    });
    doneBtn.disabled = mine.size === 0;
    if (scene !== 'vote') return;
    follow(300);
    const { max, tied } = leaders(t);
    if (mine.size === 0) say('Tap the dates you can make.', 'Four bandmates already voted and Tuesday and Thursday are tied 3–3. Your vote decides.');
    else if (tied.length > 1) say('Tap the dates you can make.', `Still tied: ${tied.map((i) => SLOTS[i].day).join(' and ')}. Hit Done anyway, or change your picks.`);
    else say('Tap the dates you can make.', `${SLOTS[tied[0]].day} leads ${max} to ${max - 1}. Hit Done to send it.`);
  }

  /* ── Admin list ── */
  function paintAdmin() {
    const t = tally();
    const { max } = leaders(t);
    adminMeta.textContent = `Select your available options — 5 of ${BAND} voted`;
    optsEl.innerHTML = t.map((x, c) => {
      const top = x.total === max;
      const avatars = x.others.map((v) => `<i title="${v.name}">${v.ini}</i>`).join('') + (x.me ? '<i class="you" title="You">You</i>' : '');
      const isLocked = locked === c;
      return `<li class="popt${isLocked ? ' is-locked' : ''}">` +
        `<div class="popt__row"><span class="popt__txt"><span class="popt__d">${SLOTS[c].app}${top ? '<em class="ptag">Top pick</em>' : ''}</span>` +
        `<span class="popt__t">21:00 – 23:30 · ${x.total}/${BAND} available</span></span>` +
        `<button class="ppill${top ? ' ppill--lime' : ''}" type="button" data-lockin="${c}"${locked >= 0 ? ' disabled' : ''}>${isLocked ? `${CHECK}Locked` : 'Lock in'}</button></div>` +
        `<span class="popt__who">${avatars}</span></li>`;
    }).join('');
    optsEl.querySelectorAll<HTMLButtonElement>('[data-lockin]').forEach((b) => b.addEventListener('click', () => lockIn(Number(b.dataset.lockin))));
    follow(300);
  }

  /* ── Scenes ── */
  function setSteps(active: number) {
    steps.forEach((s, k) => {
      s.classList.toggle('is-on', k === active);
      s.classList.toggle('is-done', k < active || active > 2);
    });
  }
  function setRole(admin: boolean) {
    role.firstElementChild!.textContent = admin ? 'Admin view' : 'Member view';
    role.classList.toggle('is-admin', admin);
  }
  function go(next: Scene) {
    scene = next;
    if (next !== 'push') landed = true;
    phone.dataset.scene = next;
    push.tabIndex = next === 'push' ? 0 : -1;
    pads.forEach((b) => (b.tabIndex = next === 'vote' ? 0 : -1));
    noneBtn.tabIndex = doneBtn.tabIndex = next === 'vote' ? 0 : -1;
    again.hidden = next !== 'done';
    follow();
  }

  /* ── Coach mark: one lime callout outside the phone that says what to tap next ── */
  const pin = $('[data-poll-pin]');
  const coach = $('[data-coach]');
  const card = $('[data-coach-card]');
  const cLine = $('[data-coach-line]');
  const cDot = $('[data-coach-dot]');
  const cStep = $('[data-coach-step]');
  const cKind = $('[data-coach-kind]');
  const cTxt = $('[data-coach-txt]');
  const tap = $('[data-tap]');
  const voteSheet = $('[data-sheet="vote"]');
  const adminSheet = $('[data-sheet="admin"]');
  const wide = matchMedia('(min-width: 1081px)');

  type Cue = { el: HTMLElement; step: string; kind: string; txt: string; tap: boolean };
  function cue(): Cue {
    if (scene === 'vote') return mine.size
      ? { el: doneBtn, step: '2/3', kind: 'Your move', txt: 'Hit Done to send it', tap: true }
      : { el: padsEl, step: '2/3', kind: 'Your move', txt: 'Tap the dates you can make', tap: false };
    if (scene === 'admin') {
      if (locked >= 0) return { el: optsEl.querySelector<HTMLElement>('.popt.is-locked') ?? optsEl, step: '3/3', kind: 'Admin', txt: 'Sending it to the band', tap: false };
      const pill = optsEl.querySelector<HTMLElement>('.ppill--lime') ?? optsEl;
      return { el: pill, step: '3/3', kind: 'Now you’re the admin', txt: 'Lock in the top pick', tap: true };
    }
    if (scene === 'done') return { el: push, step: '✓', kind: 'Locked in', txt: 'Everyone got this push', tap: false };
    return { el: push, step: '1/3', kind: 'Your move', txt: 'Tap the notification', tap: true };
  }

  let shown = '';
  let landed = reduce; // the first push hasn't arrived yet: nothing to point at
  function place() {
    const c = cue();
    coach.classList.toggle('is-wait', !landed);
    if (c.txt !== shown) {
      shown = c.txt;
      if (c.step === '✓') cStep.innerHTML = `${CHECK}<span class="sr-only">Done</span>`; else cStep.textContent = c.step;
      cKind.textContent = c.kind;
      cTxt.textContent = c.txt;
      if (!reduce) gsap.fromTo(card, { autoAlpha: 0, scale: 0.92 }, { autoAlpha: 1, scale: 1, duration: 0.6, ease: 'back.out(2)', delay: 0.1 });
    }
    const pr = pin.getBoundingClientRect();
    const tr = c.el.getBoundingClientRect();
    const dr = device.getBoundingClientRect();
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const tx = tr.left + tr.width / 2 - pr.left;
    const ty = tr.top + tr.height / 2 - pr.top;
    if (wide.matches) {
      // Desktop: the card hangs off the phone's right edge, level with the target.
      const x1 = Math.min(tr.right, dr.right - 12) - pr.left;
      const cx = dr.right - pr.left + 44;
      const cy = Math.max(12, Math.min(pr.height - ch - 12, ty - ch / 2));
      Object.assign(card.style, { left: `${cx}px`, top: `${cy}px` });
      Object.assign(cLine.style, { left: `${x1}px`, top: `${ty}px`, width: `${cx - x1}px`, height: '0px' });
      Object.assign(cDot.style, { left: `${x1}px`, top: `${ty}px` });
      coach.classList.remove('is-v', 'is-bare');
    } else {
      // Phones: no room at the side, so the card floats over the screen. Sheets fill the bottom,
      // so in those scenes it sits above the sheet; otherwise just under the target.
      const sheet = scene === 'vote' ? voteSheet : scene === 'admin' ? adminSheet : null;
      const cx = Math.max(16, Math.min(pr.width - cw - 16, tx - cw / 2));
      let cy: number; let l1: number; let l2: number;
      if (sheet) {
        cy = sheet.getBoundingClientRect().top - pr.top - 18 - ch;
        l1 = cy + ch; l2 = tr.top - pr.top;
      } else {
        cy = tr.bottom - pr.top + 26;
        l1 = tr.bottom - pr.top; l2 = cy;
      }
      Object.assign(card.style, { left: `${cx}px`, top: `${cy}px` });
      Object.assign(cLine.style, { left: `${tx}px`, top: `${Math.min(l1, l2)}px`, height: `${Math.abs(l2 - l1)}px`, width: '0px' });
      const dotY = sheet ? tr.top - pr.top : tr.bottom - pr.top;
      Object.assign(cDot.style, { left: `${tx}px`, top: `${dotY}px` });
      coach.classList.add('is-v');
      // Over a sheet the line would cross its title: the card alone says it.
      coach.classList.toggle('is-bare', !!sheet);
    }
    // Tap ripple, drawn inside the phone at the target's centre (screen px, before scaling).
    const ph = phone.getBoundingClientRect();
    const k = ph.width / phone.offsetWidth || 1;
    tap.style.left = `${(tr.left + tr.width / 2 - ph.left) / k}px`;
    tap.style.top = `${(tr.top + tr.height / 2 - ph.top) / k}px`;
    tap.classList.toggle('is-on', c.tap && landed);
  }
  // Sheets slide and the phone flips after a change: keep the coach glued to its target meanwhile.
  // A shorter call never cuts a longer one short: the window only grows.
  let raf = 0;
  let until = 0;
  function follow(ms = 1200) {
    until = Math.max(until, performance.now() + ms);
    if (raf) return;
    const loop = () => { place(); raf = performance.now() < until ? requestAnimationFrame(loop) : 0; };
    raf = requestAnimationFrame(loop);
  }
  new ResizeObserver(() => follow(300)).observe(pin);

  // Flip the phone like the Roles deck: edge-on, swap, back.
  function flip(swap: () => void) {
    if (reduce) { swap(); return; }
    gsap.timeline()
      .to(device, { rotationY: 90, duration: 0.3, ease: 'power2.in' })
      .add(swap)
      .fromTo(device, { rotationY: -90 }, { rotationY: 0, duration: 0.6, ease: 'back.out(1.5)' });
  }
  function dropPush() {
    landed = true;
    if (reduce) return;
    // Clear the inline styles afterwards so the scene CSS can hide the banner again.
    gsap.fromTo(push, { yPercent: -140, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.9, ease: 'expo.out', clearProps: 'transform,opacity,visibility' });
    follow(1000);
  }

  function start() {
    mine.clear();
    locked = -1;
    go('push');
    setSteps(0);
    setRole(false);
    pushTitle.textContent = PUSH.poll.title;
    pushTxt.textContent = PUSH.poll.txt;
    push.setAttribute('aria-label', `Open notification: ${PUSH.poll.title}`);
    push.disabled = false;
    votedEl.textContent = `4 of ${BAND} voted`;
    paintVote();
    say('A poll just landed.', 'Tap the notification on the phone. You’re the sixth member of the band.');
  }

  push.addEventListener('click', () => {
    if (scene !== 'push') return;
    go('vote');
    setSteps(1);
    paintVote();
    focus(pads[0], 500);
  });

  noneBtn.addEventListener('click', () => {
    mine.clear();
    paintVote();
    say('Tap the dates you can make.', 'Noted: the admin is told none work and can propose new slots. Pick a date to carry on.');
  });

  doneBtn.addEventListener('click', () => {
    if (!mine.size) return;
    doneBtn.innerHTML = `${CHECK}Sent`;
    votedEl.textContent = `5 of ${BAND} voted`;
    scene = 'admin'; // block further taps while the flip runs
    window.setTimeout(() => {
      flip(() => {
        go('admin');
        setSteps(2);
        setRole(true);
        paintAdmin();
        doneBtn.innerHTML = `${CHECK}Done`;
      });
      const { tied } = leaders(tally());
      say('Now you’re the admin.', tied.length > 1
        ? 'Your answer is in with everyone else’s. It’s a tie, so it’s your call: lock in either one.'
        : 'Your answer is in with everyone else’s. Lock in the top pick.');
      focus(optsEl.querySelector<HTMLButtonElement>('.ppill--lime'), 900);
    }, reduce ? 0 : 450);
  });

  function lockIn(c: number) {
    if (scene !== 'admin' || locked >= 0) return;
    locked = c;
    paintAdmin();
    window.setTimeout(() => {
      flip(() => {
        go('done');
        setSteps(3);
        setRole(false);
        const p = PUSH.done(SLOTS[c]);
        pushTitle.textContent = p.title;
        pushTxt.textContent = p.txt;
        push.setAttribute('aria-label', `${p.title}. ${p.txt}`);
        push.disabled = true;
        dropPush();
      });
      say('Locked in.', `${SLOTS[c].long} is now in all six calendars, with RSVP and the room. Everyone got the push. Zero threads.`);
      focus(again, 1000);
    }, reduce ? 0 : 650);
  }

  again.addEventListener('click', () => {
    start();
    dropPush();
    focus(push, 0);
  });

  start();

  /* ── Scroll: from the overview into play mode ──
     The section pins. The first stretch of scroll shrinks the copy and brings the phone to the
     centre, larger; past that the scene holds so the visitor can play. Coach + tap ripple +
     spotlight switch on with focus. Short screens and reduced motion skip the zoom (always focused). */
  const trackEl = $('[data-poll-track]');
  const copy = $('[data-poll-copy]');
  const stage = $('[data-poll-stage]');
  const navEl = document.querySelector<HTMLElement>('[data-nav]');
  function setFocus(on: boolean) {
    if (root!.classList.contains('is-focus') === on) return;
    root!.classList.toggle('is-focus', on);
    follow(500);
  }
  gsap.matchMedia().add({ pinned: '(min-height: 560px) and (prefers-reduced-motion: no-preference)', isWide: '(min-width: 1081px)' }, (ctx) => {
    const { pinned, isWide } = ctx.conditions as { pinned: boolean; isWide: boolean };
    root!.classList.toggle('is-pinned', pinned);
    if (!pinned) { setFocus(true); return; }
    setFocus(false);
    // The stage's untransformed box inside the pin (offsets ignore transforms).
    const box = () => {
      let x = 0; let y = 0;
      for (let n: HTMLElement | null = stage; n && n !== pin; n = n.offsetParent as HTMLElement | null) { x += n.offsetLeft; y += n.offsetTop; }
      return { x, y, w: stage.offsetWidth, h: stage.offsetHeight };
    };
    const top = () => (navEl ? navEl.getBoundingClientRect().bottom : 80) + 16;
    // Grow until the stage fills the height under the nav, or the phone fills ~88% of the width.
    const fit = () => { const b = box(); return Math.min((pin.clientHeight - top() - 24) / b.h, (pin.clientWidth * 0.88) / device.offsetWidth, 1.4); };
    const tl = gsap.timeline({
      defaults: { ease: 'power2.inOut' },
      scrollTrigger: {
        trigger: trackEl, start: 'top top', end: 'bottom bottom', scrub: true, invalidateOnRefresh: true,
        onUpdate: (st) => { setFocus(st.progress > 0.34); if (root!.classList.contains('is-focus')) place(); },
      },
    });
    tl.to(stage, {
      x: () => { const b = box(); return pin.clientWidth / 2 - (b.x + b.w / 2); },
      y: () => { const b = box(); const t = top(); return t + (pin.clientHeight - t - 24) / 2 - (b.y + b.h / 2); },
      scale: fit, duration: 0.4,
    }, 0)
      .to(copy, isWide ? { scale: 0.62, transformOrigin: '0% 50%', duration: 0.4 } : { y: -90, autoAlpha: 0, duration: 0.26 }, 0)
      // The scaffolding (label, intro, step chips) steps back; the coach card takes over the steps.
      .to(copy.querySelectorAll('.label, .poll__kicker, .poll__steps'), { autoAlpha: 0, duration: 0.2 }, 0)
      .to({}, { duration: 0.6 });
    return () => root!.classList.remove('is-pinned', 'is-focus');
  });

  // The first notification lands when the phone scrolls into view.
  if (reduce) return;
  gsap.set(push, { autoAlpha: 0 });
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    window.setTimeout(dropPush, 500);
  }, { threshold: 0.55 });
  io.observe(device);
}
