import { CHANNELS, channelUrl, pad2 } from '../content/features';
import { academyArticle, shot } from '../content/site';
import type { Clock } from '../motion/clock';
import { focusCrop } from './crop';

/**
 * Home channel explorer. The eleven strips are tabs: the selected strip pushes
 * its fader up and the panel shows its screen (zoomed), three things it does
 * and its Guide article. While nobody has touched it, it plays the channels
 * in order; the selected strip's meter fills on the page clock like a timer
 * (two bars per channel), then the next one comes up. Any click, key or
 * focus hands control to the visitor.
 */
const BARS = 32; // 16th-note steps per channel (two bars at 112 BPM)
const IDLE = [0.34, 0.22, 0.4, 0.18, 0.3, 0.36, 0.26, 0.2, 0.32, 0.24, 0.28];

export function initRack(root: HTMLElement | null, clock: Clock, reduce: boolean) {
  if (!root) return;
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-rx-tab]'));
  const strip = root.querySelector<HTMLElement>('.rx__strips');
  const panel = root.querySelector<HTMLElement>('#rx-panel');
  const crop = root.querySelector<HTMLElement>('[data-rx-crop]');
  const copy = root.querySelector<HTMLElement>('[data-rx-copy]');
  const out = {
    ch: root.querySelector<HTMLElement>('[data-rx-ch]'),
    name: root.querySelector<HTMLElement>('[data-rx-name]'),
    line: root.querySelector<HTMLElement>('[data-rx-line]'),
    pts: root.querySelector<HTMLElement>('[data-rx-pts]'),
    guide: root.querySelector<HTMLAnchorElement>('[data-rx-guide]'),
    page: root.querySelector<HTMLAnchorElement>('[data-rx-page]'),
  };
  if (!tabs.length || !panel) return;

  const meters = tabs.map((t) => Array.from(t.querySelectorAll<HTMLElement>('.strip__meter i')).reverse());
  const light = (i: number, lv: number) => {
    const on = Math.round(lv * meters[i].length);
    meters[i].forEach((c, k) => c.classList.toggle('on', k < on));
  };

  let cur = 0;
  let auto = !reduce;
  let started = false;

  const level = () => tabs.forEach((t, i) => {
    const lv = i === cur ? 1 : IDLE[i % IDLE.length];
    t.style.setProperty('--lv', String(lv));
    if (i !== cur || !auto) light(i, lv);
  });

  function select(i: number, focus = false) {
    cur = (i + tabs.length) % tabs.length;
    const c = CHANNELS[cur];
    tabs.forEach((t, k) => {
      const on = k === cur;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      t.classList.toggle('is-on', on);
    });
    if (focus) tabs[cur].focus();
    // Keep the selected strip in view inside the row (phones), without moving the page.
    if (strip && strip.scrollWidth > strip.clientWidth) {
      const t = tabs[cur];
      const left = t.offsetLeft - (strip.clientWidth - t.offsetWidth) / 2;
      strip.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' });
    }
    panel!.setAttribute('aria-labelledby', tabs[cur].id);
    panel!.style.setProperty('--c', tabs[cur].style.getPropertyValue('--c'));
    if (crop) focusCrop(crop, { y0: c.crop[0], y1: c.crop[1] }, shot(c.shot));
    const fill = () => {
      if (out.ch) out.ch.textContent = `CH ${pad2(c.ch)} · ${c.group}`;
      if (out.name) out.name.textContent = c.name;
      if (out.line) out.line.textContent = c.line;
      if (out.pts) {
        out.pts.replaceChildren(...c.points.map((p) => { const li = document.createElement('li'); li.textContent = p; return li; }));
      }
      if (out.guide) out.guide.href = academyArticle(c.guide);
      if (out.page) { out.page.hidden = !c.live; out.page.href = c.live ? channelUrl(c) : '#'; }
    };
    if (reduce || !copy) fill();
    else {
      copy.classList.add('is-out');
      window.setTimeout(() => { fill(); copy.classList.remove('is-out'); }, 200);
    }
    level();
  }

  const takeOver = () => {
    if (!auto) return;
    auto = false;
    root.classList.remove('is-auto');
    level();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => { takeOver(); select(i); });
    t.addEventListener('keydown', (e) => {
      const k = e.key;
      const j = k === 'ArrowRight' || k === 'ArrowDown' ? cur + 1 : k === 'ArrowLeft' || k === 'ArrowUp' ? cur - 1 : k === 'Home' ? 0 : k === 'End' ? tabs.length - 1 : null;
      if (j === null) return;
      e.preventDefault();
      takeOver();
      select(j, true);
    });
  });
  root.addEventListener('focusin', takeOver);
  strip?.addEventListener('pointerdown', takeOver);

  level();
  if (reduce) return;

  // Auto-play while on screen: the selected meter is the timer.
  root.classList.add('is-auto');
  let visible = false;
  let left = BARS;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) started = true; }, { threshold: 0.35 }).observe(root);
  clock.onStep(() => {
    if (!auto || !started || !visible || document.hidden) return;
    left--;
    light(cur, 1 - left / BARS);
    if (left <= 0) { left = BARS; select(cur + 1); light(cur, 0); }
  });
  light(cur, 0);
}
