/**
 * Product fragments drawn in HTML, for the featured panels of "The small
 * things" where no Academy capture shows the thing on its own (a FeatureUi
 * with `fragment`, see pages/types.ts). Styles: styles/feature.css, "Drawn
 * fragments" (everything in em: the panel sets the size).
 *
 * Each one is checked against the app's own screen and uses the app's labels
 * (src/lib/i18n, English source; the dictionaries hold the Italian and
 * Spanish UI's words):
 * - stage-tempo: Stage mode with Follow the tempo on, Harbor Lights at 88 BPM
 *   (academy capture stage-follow-tempo, lyrics as in music-reader). The strip
 *   is the app's "Next: {section} in {n} bars".
 * - stage-offline: the gig's "Offline: {n} of {m} members ready" card with
 *   Remind (capture live-offline-ready). The five cells above it are ours:
 *   one cell per member, the one without the setlist left empty.
 * - stage-manager: the stage manager's player (capture stage-manager) and,
 *   under it, what every phone shows: Now playing.
 *
 * - rider-brings: "Who brings what" on a gig's Rider & stage (RiderParts.tsx):
 *   a black card BAND BRINGS, a white card VENUE PROVIDES, one item per line,
 *   and the editor's "The venue agreed to this", ticked.
 *
 * A fragment is a picture of the app, not a control: it is rendered as
 * role="img" with `alt`, like a capture.
 */
export type Fragment = { alt: string; html: string };

const ico = (id: string) => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;
/** Song lyrics and chord names stay as the band wrote them, in every language. */
const keep = (s: string) => `<span data-i18n-skip>${s}</span>`;

const MEMBERS = ['Leo', 'Sara', 'Nico', 'Tom'];

export const FRAGMENTS: Record<string, Fragment> = {
  'stage-tempo': {
    alt: 'Stage mode following the tempo: the bar being played is lit, and a strip says the chorus comes in 2 bars',
    html:
      `<div class="frag fr-card fr-tempo">` +
        `<p class="fr-m fr-tempo__top"><span>Harbor Lights · Verse 2</span><span>88 BPM</span></p>` +
        `<div class="fr-bars" data-i18n-skip><span>A</span><span class="is-on">E</span><span>F♯m</span><span>D</span></div>` +
        `<p class="fr-lyr"><span class="is-on" data-i18n-skip>Salt and silver on the shore</span>${keep('Nobody waits here anymore')}</p>` +
        `<p class="fr-m fr-tempo__sec">Chorus</p>` +
        `<p class="fr-lyr">${keep('Sing it slow, sing it clear')}</p>` +
        `<p class="fr-m fr-next"><i class="fr-dot"></i><span>Next: Chorus in 2 bars</span></p>` +
      `</div>`,
  },
  'stage-offline': {
    alt: 'On the gig: four of five members have the setlist on their phone for no signal, and Remind next to the one who doesn’t',
    html:
      `<ul class="fr-roster">${MEMBERS.map((m) => `<li><i></i><span data-i18n-skip>${m}</span></li>`).join('')}<li class="is-out"><i></i><span data-i18n-skip>Lena</span></li></ul>` +
      `<div class="frag fr-card fr-off">` +
        `<div class="fr-off__row">${ico('wifi')}<div><b>Offline: 4 of 5 members ready</b><small>Who has the setlist on their phone for no signal.</small></div></div>` +
        `<div class="fr-off__who"><span>Lena P.</span><span class="fr-pill">${ico('bell')}<span>Remind</span></span></div>` +
      `</div>`,
  },
  'stage-manager': {
    alt: 'The stage manager’s player: audio ready for 10 of 10 songs, September playing, and Now playing on three phones',
    html:
      `<div class="frag fr-card fr-mgr">` +
        `<div class="fr-mgr__top">${ico('music')}<div><span class="fr-m">Stage manager</span><b>Audio ready 10/10</b></div><span class="fr-pill fr-pill--sm"><span>Turn off</span></span></div>` +
        `<p class="fr-mgr__song"><span data-i18n-skip>September</span><span>0:01 / 3:20</span></p>` +
        `<div class="fr-mgr__line"><i></i></div>` +
        `<div class="fr-mgr__btns"><span class="fr-pill fr-pill--lime"><i class="fr-pause"></i><span>Pause</span></span><span class="fr-pill fr-pill--dark"><i class="fr-stop"></i><span>Stop</span></span></div>` +
      `</div>` +
      `<div class="frag fr-fan">${[0, 1, 2].map(() => `<div class="fr-mini"><span class="fr-m"><i class="fr-dot"></i><span>Now playing</span></span><b data-i18n-skip>September</b></div>`).join('')}</div>`,
  },
  'rider-brings': {
    alt: 'Who brings what on a gig: the band brings two amps and a keyboard, the venue provides the PA, four wedges and a drum riser, and the venue agreed',
    html:
      `<div class="frag fr-brings">` +
        `<div class="fr-brings__card"><p class="fr-m">BAND BRINGS</p><ul><li>Guitar amp</li><li>Bass amp</li><li>Keyboard and stand</li></ul></div>` +
        `<div class="fr-brings__card fr-brings__card--venue"><p class="fr-m">VENUE PROVIDES</p><ul><li>PA and mixer</li><li>4 wedges</li><li>Drum riser</li></ul></div>` +
      `</div>` +
      `<p class="frag fr-agreed"><i class="fr-tick">${ico('check')}</i><span>The venue agreed to this</span></p>`,
  },
};
