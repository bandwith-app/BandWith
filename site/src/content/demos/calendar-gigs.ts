/** calendar-gigs demo markup (script: ui/demos/calendar-gigs.ts, styles: styles/demos/calendar-gigs.css). */
const MEMBERS: [id: string, name: string, line: string][] = [
  ['sara', 'Sara', 'Vocals · iPhone'],
  ['nico', 'Nico', 'Drums · Android'],
  ['tom', 'Tom', 'Guitar · Web app'],
  ['lena', 'Lena P.', 'Keys · iPhone'],
];

const member = ([id, name, line]: (typeof MEMBERS)[number]) =>
  `<figure class="cg__m" data-cg-member="${id}"><figcaption><b>${name}</b> ${line}</figcaption><div class="cgm"></div></figure>`;

export const markup = () =>
  `<div class="cg" data-cg-demo>` +
  `<div class="cg__bar"><p class="cg__who"><span class="tag tag--ink">Admin</span>Leo M. · Bass · books the gig</p>` +
  `<button type="button" class="cg__reset" data-cg-reset><svg class="ico" aria-hidden="true"><use href="#i-refresh"/></svg>Start over</button></div>` +
  `<div class="cg__floor"><div class="cgp" data-cg-phone></div>` +
  `<div class="cg__band"><p class="cg__bandh">Their phones<em class="cg__wait">Nothing is sent until you tap Create gig</em><em class="cg__swipe">Swipe for each phone</em></p><div class="cg__grid">${MEMBERS.map(member).join('')}</div></div></div>` +
  `<p class="cg__note" data-cg-note aria-live="polite"></p>` +
  `<ol class="cg__log mono" data-cg-log aria-live="polite" aria-label="What happened"></ol>` +
  `<noscript><p class="cg__nojs">The demo needs JavaScript. Here is step 1 of the gig wizard as it looks in the app:</p><img src="/shots/gig-wizard-step1@phone.webp" alt="Step 1 of the gig wizard on a phone" width="390" height="844" /></noscript>` +
  `</div>`;
