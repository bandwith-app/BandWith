/** Songs demo markup (script: ui/demos/songs.ts, styles: styles/demos/songs.css). */
import { SONG, VIEWS, PLAYERS, songBody } from '../../ui/demos/songs';

const ico = (id: string) => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const firstLines = SONG.text.split('\n').slice(0, 3).join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;');

export const markup = () =>
  `<div class="sg" data-songs-demo>` +
    `<div class="sg__bar"><p class="sg__who"><span class="tag tag--ink">You</span>Tom · Guitar · your screen</p>` +
    `<button type="button" class="sg__reset" data-sg-reset>${ico('refresh')}Start over</button></div>` +
    `<div class="sg__floor">` +
      `<div class="sgp" aria-label="Your screen: the song reader">` +
        `<div class="sgr__top"><p class="sgr__kick" data-sg-kick>Chords · Velvet Static</p><p class="sgr__title">${SONG.title}</p></div>` +
        `<div class="sgr__tabs" role="tablist" aria-label="View">` +
          VIEWS.map((v) => `<button type="button" role="tab" id="sg-tab-${v.id}" aria-controls="sg-body" aria-selected="${v.id === 'chords'}" tabindex="${v.id === 'chords' ? 0 : -1}" data-sg-view="${v.id}">${v.label}</button>`).join('') +
        `</div>` +
        `<div class="sgr__key" role="group" aria-label="Transpose">` +
          `<button type="button" class="sgr__round" data-sg-step="-1" aria-label="Transpose down a semitone">${ico('minus')}</button>` +
          `<button type="button" class="sgr__k" data-sg-key disabled aria-label="Original key, G"><b>G</b><i>0</i></button>` +
          `<button type="button" class="sgr__round" data-sg-step="1" aria-label="Transpose up a semitone">${ico('plus')}</button>` +
        `</div>` +
        `<div class="sgr__body" id="sg-body" role="tabpanel" aria-labelledby="sg-tab-chords" data-sg-body>${songBody('chords', 0)}</div>` +
      `</div>` +
      `<aside class="sgb" aria-label="The band’s copy">` +
        `<p class="sgb__kick"><span class="sgb__dot"></span>The band’s copy</p>` +
        `<p class="sgb__title">${SONG.title}</p>` +
        `<dl class="sgb__facts"><div><dt>Key</dt><dd>${SONG.key}</dd></div><div><dt>BPM</dt><dd>${SONG.bpm}</dd></div><div><dt>Length</dt><dd>${SONG.dur}</dd></div></dl>` +
        `<p class="sgb__h">As it’s written</p>` +
        `<pre class="sgb__code"><code>${firstLines}</code></pre>` +
        `<p class="sgb__h">On each screen</p>` +
        `<ul class="sgb__players">` +
          `<li class="is-you"><span><b>Tom</b> Guitar · Chords</span><span class="sgb__key" data-sg-mine><b>${SONG.key}</b></span></li>` +
          PLAYERS.map((p) => `<li><span><b>${p.name}</b> ${p.inst} · ${p.view}</span><span class="sgb__key"><b>${SONG.key}</b></span></li>`).join('') +
        `</ul>` +
        `<p class="sgb__rule">Only your screen moves, and this device keeps your key for this song. To change the key for everyone, an admin uses Transpose for the band in the song form.</p>` +
      `</aside>` +
    `</div>` +
    `<p class="sg__note" data-sg-note aria-live="polite"></p>` +
  `</div>`;
