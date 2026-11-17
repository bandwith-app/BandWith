// core/boot first: its base CSS must come before the page's own styles.
import { boot, finish } from '../core/boot';
import '../styles/feature.css';
import '../styles/stage.css';
import { gsap } from 'gsap';
import { initStageDemo } from '../ui/stageDemo';
import { initDevices } from '../ui/devices';
import { initFlow } from '../ui/flow';

const ctx = boot();
const { reduce } = ctx;

if (!reduce) {
  gsap.timeline({ delay: 0.2 })
    .fromTo('.fhero__ch', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.7 })
    .fromTo('.fhero__title .line > span', { yPercent: 110 }, { yPercent: 0, duration: 1.2, ease: 'expo.out', stagger: 0.12 }, '-=0.4')
    .fromTo('.fhero [data-fh]:not(.fhero__ch)', { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, stagger: 0.08 }, '-=0.8')
    .fromTo('[data-fh-phone]', { autoAlpha: 0, y: 80 }, { autoAlpha: 1, y: 0, duration: 1.4, ease: 'expo.out' }, 0.5);
  gsap.to('.fhero__photo img', { yPercent: 8, scale: 1.06, ease: 'none', scrollTrigger: { trigger: '.fhero', start: 'top top', end: 'bottom top', scrub: true } });
}

initFlow(document.querySelector('[data-flow]'));
initStageDemo(document.querySelector('[data-stage-demo]'), reduce);
initDevices(document.querySelector('[data-devices]'), reduce);

finish(ctx);
