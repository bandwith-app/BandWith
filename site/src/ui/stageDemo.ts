import { gsap } from 'gsap';
import {
  SETLIST, initialState, leaderGo, leaderStep, toggleStrike, setOnline, toggleClick,
  memberStep, memberFollow, memberStatus, leaderStatus, clickOn, inSync, reachable,
  type StageState, type Member,
} from './stageModel';

/**
 * Try Stage mode: the leader's phone and three band phones, built in HTML
 * (not screenshots) so every control works. Rules live in stageModel.ts.
 * The click is visual only, like in the app: a glow around the screen edge,
 * brighter on beat one. No sound.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const n2 = (i: number) => String(i + 1).padStart(2, '0');

function leaderHtml(s: StageState) {
  const st = leaderStatus(s);
  const song = SETLIST[s.leaderSong];
  const rows = SETLIST.map((x, i) => {
    const cur = i === s.leaderSong;
    const struck = s.struck.includes(i);
    return `<li class="sdl__row${cur ? ' is-cur' : ''}${struck ? ' is-struck' : ''}">` +
      `<button type="button" class="sdl__go" data-k="go-${i}" data-act="go" data-i="${i}" aria-label="Go to ${esc(x.title)}"${cur ? ' aria-current="true"' : ''}>` +
      `<b>${n2(i)}</b><span class="sdl__t">${esc(x.title)}</span><em>${x.key}</em><i>${x.dur}</i></button>` +
      (cur ? '<span class="sdl__x" aria-hidden="true"></span>' :
        `<button type="button" class="sdl__x" data-k="x-${i}" data-act="strike" data-i="${i}" aria-label="${struck ? 'Bring back' : 'Strike'} ${esc(x.title)}${struck ? '' : ' off tonight'}">${struck ? '+' : '−'}</button>`) +
      `</li>`;
  }).join('');
  return `<div class="sdp__screen">` +
    `<p class="sdp__kick"><span class="sdp__dot"></span>Stage mode · Nov 15</p>` +
    `<p class="sdp__gig">Rooftop session</p><p class="sdp__venue">Terrazza Aurora · Milano</p>` +
    `<div class="sdl__head"><span>Setlist <em>${SETLIST.length} songs</em></span><span class="sdp__st" data-tone="${st.tone}">${st.label}</span></div>` +
    `<ol class="sdl">${rows}</ol>` +
    `<div class="sdp__bar">` +
    `<button type="button" class="sdp__b" data-k="prev" data-act="prev">Prev</button>` +
    `<button type="button" class="sdp__b sdp__click${s.click ? ' is-on' : ''}" data-k="click" data-act="click" aria-pressed="${s.click}" ${s.online ? '' : 'disabled'} aria-label="${s.click ? 'Stop the click' : 'Start the click'}, ${song.bpm} BPM"><b>${song.bpm}</b>Click</button>` +
    `<button type="button" class="sdp__b sdp__b--next" data-k="next" data-act="next">Next</button>` +
    `</div></div>`;
}

function memberHtml(s: StageState, m: Member) {
  const st = memberStatus(s, m);
  const song = SETLIST[m.song];
  const next = SETLIST.findIndex((_, i) => i > m.song && !s.struck.includes(i));
  const follow = !m.following && reachable(s, m);
  return `<div class="sdp__screen">` +
    `<p class="sdp__kick"><span class="sdp__dot"></span>Stage mode</p>` +
    `<button type="button" class="sdm__follow" data-tone="${st.tone}" data-k="f-${m.id}" data-act="follow" data-m="${m.id}" ${follow ? '' : 'disabled'}>${st.label}</button>` +
    `<p class="sdm__n">Song ${m.song + 1} of ${SETLIST.length}</p>` +
    `<p class="sdm__title">${esc(song.title)}</p>` +
    `<p class="sdm__meta"><b>${song.key}</b><span>${song.bpm} BPM</span><span>${song.dur}</span></p>` +
    `<p class="sdm__next">${next >= 0 ? `Next · ${esc(SETLIST[next].title)}` : 'Last song'}</p>` +
    `<div class="sdp__bar sdp__bar--sm">` +
    `<button type="button" class="sdp__b" data-k="mp-${m.id}" data-act="mprev" data-m="${m.id}" aria-label="${m.name}: previous song">Prev</button>` +
    `<button type="button" class="sdp__b" data-k="mn-${m.id}" data-act="mnext" data-m="${m.id}" aria-label="${m.name}: next song">Next</button>` +
    `</div></div>`;
}

export function initStageDemo(root: HTMLElement | null, reduce: boolean) {
  if (!root) return;
  const leader = root.querySelector<HTMLElement>('[data-sd-leader]');
  const wifi = root.querySelector<HTMLButtonElement>('[data-sd-wifi]');
  const reset = root.querySelector<HTMLButtonElement>('[data-sd-reset]');
  const log = root.querySelector<HTMLElement>('[data-sd-log]');
  const note = root.querySelector<HTMLElement>('[data-sd-note]');
  const memberEls = new Map(Array.from(root.querySelectorAll<HTMLElement>('[data-sd-member]')).map((el) => [el.dataset.sdMember!, el]));
  if (!leader) return;
  root.classList.add('is-live');

  let s = initialState();
  let minute = 0;
  let touched = false;

  const say = (msg: string) => {
    if (!log) return;
    const li = document.createElement('li');
    const t = 21 * 60 + 4 + minute++;
    li.innerHTML = `<time>${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}</time>${msg}`;
    log.prepend(li);
    while (log.children.length > 4) log.lastElementChild?.remove();
    if (!reduce) gsap.fromTo(li, { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.4 });
  };

  const phones = () => [leader, ...memberEls.values()].map((el) => el.querySelector<HTMLElement>('.sdp') ?? el);

  const render = () => {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.k;
    const lp = leader.querySelector<HTMLElement>('.sdp')!;
    const keepScroll = lp.querySelector('.sdl')?.scrollTop ?? 0;
    lp.innerHTML = leaderHtml(s);
    const list = lp.querySelector<HTMLElement>('.sdl');
    if (list) {
      list.scrollTop = keepScroll;
      const cur = list.querySelector<HTMLElement>('.is-cur');
      if (cur && (cur.offsetTop < list.scrollTop || cur.offsetTop + cur.offsetHeight > list.scrollTop + list.clientHeight)) list.scrollTop = cur.offsetTop - list.clientHeight / 3;
    }
    s.members.forEach((m) => {
      const host = memberEls.get(m.id)?.querySelector<HTMLElement>('.sdp');
      if (!host) return;
      const was = host.dataset.song;
      host.innerHTML = memberHtml(s, m);
      host.dataset.song = String(m.song);
      host.classList.toggle('is-off', !reachable(s, m));
      if (!reduce && was !== undefined && was !== String(m.song)) {
        gsap.fromTo(host.querySelector('.sdm__title'), { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power3.out', delay: 0.04 + Math.random() * 0.05 });
      }
    });
    if (wifi) { wifi.setAttribute('aria-checked', String(s.online)); wifi.classList.toggle('is-off', !s.online); }
    if (note) note.textContent = s.online ? '' : 'No internet: the phone apps keep following over Bluetooth. The web app has no Bluetooth, and the band’s click needs the internet.';
    root.classList.toggle('is-click', clickOn(s));
    if (focusKey) root.querySelector<HTMLElement>(`[data-k="${focusKey}"]:not([disabled])`)?.focus({ preventScroll: true });
    restartBeat();
  };

  /* ── Click: a glow around every online screen, brighter on beat one ── */
  let beatTimer = 0;
  let beat = 0;
  function restartBeat() {
    window.clearInterval(beatTimer);
    phones().forEach((p) => p.classList.remove('beat', 'beat1'));
    if (!clickOn(s)) return;
    const visible = phones().filter((p) => !p.classList.contains('is-off'));
    if (reduce) { visible.forEach((p) => p.classList.add('beat')); return; }
    beat = 0;
    const tick = () => {
      const one = beat % 4 === 0;
      visible.forEach((p) => {
        p.classList.remove('beat', 'beat1');
        void p.offsetWidth; // restart the CSS flash
        p.classList.add(one ? 'beat1' : 'beat');
      });
      beat++;
    };
    tick();
    beatTimer = window.setInterval(tick, 60000 / SETLIST[s.leaderSong].bpm);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) window.clearInterval(beatTimer); else restartBeat(); });

  const name = (id: string) => s.members.find((m) => m.id === id)?.name ?? '';
  const syncLine = () => `${inSync(s)} of ${s.members.length} phones on it`;

  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b || (b as HTMLButtonElement).disabled) return;
    touched = true;
    root.classList.remove('is-hint');
    const i = Number(b.dataset.i);
    const id = b.dataset.m ?? '';
    const before = s;
    switch (b.dataset.act) {
      case 'go': s = leaderGo(s, i); break;
      case 'prev': s = leaderStep(s, -1); break;
      case 'next': s = leaderStep(s, 1); break;
      case 'strike': s = toggleStrike(s, i); break;
      case 'click': s = toggleClick(s); break;
      case 'mprev': s = memberStep(s, id, -1); break;
      case 'mnext': s = memberStep(s, id, 1); break;
      case 'follow': s = memberFollow(s, id); break;
    }
    if (s === before) return;
    const act = b.dataset.act;
    if (act === 'go' || act === 'prev' || act === 'next') say(`Leo → <b>${n2(s.leaderSong)} ${esc(SETLIST[s.leaderSong].title)}</b> · ${syncLine()}`);
    else if (act === 'strike') say(s.struck.includes(i) ? `${esc(SETLIST[i].title)} struck off tonight · Prev / Next skip it` : `${esc(SETLIST[i].title)} is back in the set`);
    else if (act === 'click') say(s.click ? `Click on · ${SETLIST[s.leaderSong].bpm} BPM on every online phone` : 'Click off');
    else if (act === 'follow') say(`${name(id)} follows the leader again`);
    else say(`${name(id)} looks ahead alone · stops following`);
    render();
  });

  wifi?.addEventListener('click', () => {
    touched = true;
    s = setOnline(s, !s.online);
    say(s.online ? `Venue Wi‑Fi back · everyone catches up · ${syncLine()}` : 'Venue Wi‑Fi down · Bluetooth takes over');
    render();
  });
  reset?.addEventListener('click', () => {
    s = initialState();
    minute = 0;
    if (log) log.innerHTML = '';
    render();
    say('Doors open · everyone follows Leo');
  });

  render();
  say('Doors open · everyone follows Leo');

  // A hint on Next until someone plays with it.
  if (!reduce) {
    new IntersectionObserver(([e], io) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      window.setTimeout(() => { if (!touched) root.classList.add('is-hint'); }, 1600);
    }, { threshold: 0.5 }).observe(root);
  }
}
