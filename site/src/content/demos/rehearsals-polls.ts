/** rehearsals-polls demo markup (script: ui/demos/rehearsals-polls.ts, styles: styles/demos/rehearsals-polls.css). */
const phone = (who: 'sara' | 'leo', cap: string) =>
  `<figure class="rp__m" data-rp-phone="${who}">` +
    `<div class="rpp">` +
      `<div class="rpp__home" data-rp-home></div>` +
      (who === 'sara'
        ? `<button type="button" class="rpp__push" data-rp-push data-k="push" aria-label="Open notification: Vote on Rehearsal Times">` +
            `<img src="/brand/app-icon.png" alt="" width="38" height="38" />` +
            `<span class="rpp__pushtx"><span class="rpp__pushmeta"><span>BandWith</span><em>now</em></span>` +
            `<b>Vote on Rehearsal Times</b><span>New availability poll: “Extra rehearsal before the wedding”.</span></span>` +
          `</button>` +
          `<div class="rpp__scrim" data-rp-scrim></div>` +
          `<div class="rpp__sheet" data-rp-sheet role="dialog" aria-label="Rehearsal availability"></div>` +
          `<div class="rpp__sheet rpp__sheet--bell" data-rp-bell role="dialog" aria-label="Notifications"></div>`
        : '') +
    `</div>` +
    `<figcaption>${cap}</figcaption>` +
  `</figure>`;

export const markup = () =>
  `<div class="rp" data-rp-demo>` +
    `<div class="rp__bar">` +
      `<div class="rp__hold" role="radiogroup" aria-label="Whose phone you hold">` +
        `<button type="button" role="radio" aria-checked="true" data-rp-hold="sara"><span class="rp__hold-k">You</span>Sara · Vocals</button>` +
        `<button type="button" role="radio" aria-checked="false" tabindex="-1" data-rp-hold="leo"><span class="rp__hold-k">Admin</span>Leo M. · Bass</button>` +
      `</div>` +
      `<button type="button" class="rp__reset" data-rp-reset><svg class="ico" aria-hidden="true"><use href="#i-refresh"/></svg>Start over</button>` +
    `</div>` +
    `<div class="rp__floor" data-rp-floor data-hold="sara">` +
      phone('sara', '<b>Sara</b> Member · your phone') +
      `<div class="rp__link" data-rp-link aria-hidden="true"><span class="rp__wire"><i></i></span><b>Votes<br />update<br />live</b><span class="rp__wire"><i></i></span></div>` +
      phone('leo', '<b>Leo M.</b> Admin · published the poll') +
    `</div>` +
    `<p class="rp__note" data-rp-note></p>` +
    `<ol class="rp__log mono" data-rp-log aria-live="polite" aria-label="What happened"></ol>` +
    `<noscript><p class="rp__nojs">The demo needs JavaScript. Here is a poll as it looks in the app:</p><img src="/shots/shot-poll-card@phone.webp" alt="An active availability poll on a phone" width="390" height="844" /></noscript>` +
  `</div>`;
