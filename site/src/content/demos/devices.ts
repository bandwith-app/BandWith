/** Devices demo markup (script: ui/demos/devices.ts, styles: styles/demos/devices.css). */
import { DEVICES, screenHtml } from '../../ui/demos/devices';

export const markup = () =>
  `<div class="dd" data-devices-demo data-dev="phone">` +
    `<div class="dd__bar">` +
      `<div class="dd__chips" role="radiogroup" aria-label="Device">` +
        DEVICES.map((d, i) => `<button type="button" role="radio" aria-checked="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-dd-dev="${d.id}">${d.label}</button>`).join('') +
      `</div>` +
      `<button type="button" class="dd__reset" data-dd-reset><svg class="ico" aria-hidden="true"><use href="#i-refresh"/></svg>Start over</button>` +
    `</div>` +
    `<div class="dd__floor"><div class="dd__stage"><div class="dd__frame">` +
      `<div class="dd__chrome" aria-hidden="true"><i></i><i></i><i></i><span>bandwith-beryl.vercel.app</span></div>` +
      `<div class="dd__scr" aria-label="The calendar, schematic">${screenHtml()}</div>` +
    `</div></div></div>` +
    `<p class="dd__note" data-dd-note aria-live="polite">Phone: one screen at a time, the tab bar at the bottom.</p>` +
  `</div>`;
