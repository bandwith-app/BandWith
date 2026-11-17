import { GIG, ROLES, SECTIONS, WHO, countFor, FIELDS } from './roles';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * "Same gig, three views" (home): the gig card as the admin sees it, plus the
 * role switch. ui/roles.ts swaps it to the member and deputy views.
 */
export function rolesCard() {
  let i = 0;
  const seg = ROLES.map((r) =>
    `<button type="button" role="radio" aria-checked="${r === 'admin'}" data-rv-role="${r}">${WHO[r].name}</button>`,
  ).join('');
  const sections = SECTIONS.map((sec) =>
    `<section class="rv__sec"><h3 class="rv__st">${esc(sec.title)}</h3><dl class="rv__dl">` +
    sec.fields.map((f) =>
      `<div class="rr" data-f="${f.id}" data-state="on" style="--i:${i++}"><dt>${esc(f.label)}</dt>` +
      `<dd><span class="rr__v">${esc(f.value.admin ?? '')}</span><span class="rr__x" aria-hidden="true"></span><span class="sr-only rr__sr"></span></dd></div>`,
    ).join('') +
    `</dl></section>`,
  ).join('');
  return (
    `<div class="rv__side">` +
      `<p class="label rv__ask" id="rv-ask">See the same gig as</p>` +
      `<div class="rv__seg" role="radiogroup" aria-labelledby="rv-ask" data-rv-seg><span class="rv__pill" aria-hidden="true"></span>${seg}</div>` +
      `<div class="rv__who" data-rv-who><p class="rv__person" data-rv-person>${esc(WHO.admin.person)}</p><p class="rv__line" data-rv-line>${esc(WHO.admin.line)}</p></div>` +
      `<p class="rv__count" aria-live="polite"><b data-rv-count>${countFor('admin')}</b><span>of ${FIELDS.length} details<br />reach this phone</span></p>` +
      `<button type="button" class="btn btn--ink rv__yes" data-rv-yes hidden>Say yes as Ivo <svg class="ico btn__arrow" aria-hidden="true"><use href="#i-check"/></svg></button>` +
    `</div>` +
    `<article class="rv__card" data-rv-card aria-label="The gig as the selected role sees it">` +
      `<header class="rv__head"><p class="rv__kick mono">${esc(GIG.kicker)}</p><span class="rv__badge mono" data-rv-badge>Admin view</span>` +
      `<p class="rv__title">${esc(GIG.title)}</p><p class="rv__when mono">${esc(GIG.when)}</p></header>` +
      sections +
    `</article>`
  );
}
