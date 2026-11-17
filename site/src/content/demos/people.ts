/**
 * People demo markup (script: ui/demos/people.ts, styles: styles/demos/people.css).
 * Two phones: Leo (admin) finds a deputy for Lena P.; Ivo M. (deputy) answers in
 * Deputy gigs. Labels follow AskDeputySheet, DeputyGigsList and the Academy
 * articles find-a-deputy, ask-a-deputy, deputy-gigs and deputy-notifications.
 */
const ico = (id: string) => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;

export const markup = () =>
  `<div class="pd" data-people-demo>` +
    `<div class="pd__bar">` +
      `<ol class="pd__steps" aria-label="Steps">` +
        `<li data-pd-step="1"><b>01</b>Find a deputy</li>` +
        `<li data-pd-step="2"><b>02</b>Ask in the app</li>` +
        `<li data-pd-step="3"><b>03</b>Answer as Ivo</li>` +
      `</ol>` +
      `<button type="button" class="pd__reset" data-pd-reset>${ico('refresh')}Start over</button>` +
    `</div>` +
    `<div class="pd__floor">` +
      `<div class="pd__side" data-pd-side="leo">` +
        `<p class="pd__who"><span class="tag tag--ink">Admin</span>Leo M. · Bass · Velvet Static</p>` +
        `<div class="pdp" data-pd-phone="leo" role="group" aria-label="Leo’s phone"></div>` +
        `<p class="pd__legend">${ico('lock')}Only admins see the deputies and their requests</p>` +
      `</div>` +
      `<div class="pd__wire" data-pd-wire aria-hidden="true"><span class="pd__line"><i></i></span><b data-pd-wire-label>Lena P. declined</b><span class="pd__wtext" data-pd-wire-text>Keys missing on Client A — Wedding</span></div>` +
      `<div class="pd__side" data-pd-side="ivo">` +
        `<p class="pd__who"><span class="tag">Deputy</span>Ivo M. · Keys · On BandWith</p>` +
        `<div class="pdp" data-pd-phone="ivo" role="group" aria-label="Ivo’s phone"></div>` +
        `<p class="pd__legend" data-pd-addr>${ico('lock')}Street address · hidden until he says yes</p>` +
      `</div>` +
    `</div>` +
    `<p class="pd__note" data-pd-note aria-live="polite"></p>` +
    `<ol class="pd__log mono" data-pd-log aria-live="polite" aria-label="What happened"></ol>` +
    `<button type="button" class="pd__jump" data-pd-jump hidden><span data-pd-jump-label></span></button>` +
    `<noscript><p class="pd__nojs">The demo needs JavaScript. Here is Find a deputy as it looks in the app:</p>` +
      `<img src="/shots/people-find-deputy@phone.webp" alt="Find a deputy on a phone: replacing Lena P. on keys" width="390" height="844" /></noscript>` +
  `</div>`;
