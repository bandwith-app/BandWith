/** stage-plot-rider demo markup (script: ui/demos/stage-plot-rider.ts, styles: styles/demos/stage-plot-rider.css). */
const MUSICIANS: [key: string, label: string][] = [
  ['vocals', 'Vocals'], ['guitar', 'Guitar'], ['bass', 'Bass'], ['keys', 'Keys'],
  ['drums', 'Drums'], ['percussion', 'Percussion'], ['sax', 'Sax'], ['trumpet', 'Trumpet'],
];
const GEAR: [kind: string, label: string][] = [['player', 'Other musician'], ['wedge', 'Wedge'], ['speaker', 'Speaker'], ['di', 'DI box']];

const chip = (attr: string, label: string) =>
  `<button type="button" class="sp__chip" ${attr}><svg class="ico" aria-hidden="true"><use href="#i-plus"/></svg>${label}</button>`;

export const markup = () =>
  `<div class="sp" data-sp-demo>` +
  `<div class="sp__bar"><p class="sp__who"><span class="tag tag--ink">Admin</span>Client A — Wedding · Rider &amp; stage</p>` +
  `<button type="button" class="sp__reset" data-sp-reset><svg class="ico" aria-hidden="true"><use href="#i-refresh"/></svg>Start over</button></div>` +
  `<div class="sp__floor">` +
  `<section class="sp__ed" aria-label="Stage plot"><p class="sp__h"><span>Stage plot</span><em>Full band · 6 × 4 m</em></p>` +
  `<div class="sp__stage" data-sp-stage tabindex="-1" role="group" aria-label="Stage plot: the back of the stage at the top, the audience at the bottom"></div>` +
  `<p class="sp__aud">Audience · stage 6 × 4 m</p>` +
  `<div class="sp__chips" role="group" aria-label="Add a musician">${MUSICIANS.map(([k, l]) => chip(`data-sp-add="${k}"`, l)).join('')}</div>` +
  `<div class="sp__chips sp__chips--gear" role="group" aria-label="Add gear">${GEAR.map(([k, l]) => chip(`data-sp-gear="${k}"`, l)).join('')}</div>` +
  `<div class="sp__sel" data-sp-sel></div><p class="sp__note" data-sp-note aria-live="polite"></p></section>` +
  `<div class="sp__side"><section class="sp__inputs" aria-label="Input list"><p class="sp__h"><span>Input list</span><em data-sp-count></em></p>` +
  `<table class="sp__tbl"><thead><tr><th scope="col">Ch</th><th scope="col">Source</th><th scope="col">Mic / DI</th></tr></thead><tbody data-sp-rows></tbody></table></section>` +
  `<section class="sp__rider" data-sp-rider aria-label="Technical rider"></section></div></div>` +
  `<div class="sp__venue" data-sp-venue hidden></div>` +
  `<noscript><p class="sp__nojs">The demo needs JavaScript. Here is a gig, with its rider and show readiness, as it looks in the app:</p><img src="/shots/gig-workspace-admin@phone.webp" alt="A gig on a phone" width="390" height="844" /></noscript>` +
  `</div>`;
