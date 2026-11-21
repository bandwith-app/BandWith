/**
 * The waitlist form (Get page, shown when the open spots are gone). It calls
 * the public RPC `bw_join_waitlist` (migration 128): one row per email, the
 * answer says the place in line. The doors themselves are plain links
 * (TestFlight, the APK, the web app): no form, no email round trip.
 *
 * Without Supabase settings: in dev the form simulates a reply so every state
 * can be seen; in production it stays closed and sends nothing.
 */

import { LANG } from '../i18n/runtime';

type Reply = { ok: boolean; position?: number; already?: boolean; error?: string };

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const LIVE = !!(URL_ && KEY) && !import.meta.env.DEV;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function join(email: string): Promise<Reply> {
  if (!LIVE) {
    await new Promise((r) => setTimeout(r, 700));
    return { ok: true, position: 37 };
  }
  try {
    const res = await fetch(`${URL_}/rest/v1/rpc/bw_join_waitlist`, {
      method: 'POST',
      headers: { apikey: KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_email: email, p_platform: '', p_locale: LANG !== 'en' ? LANG : (navigator.language ?? ''), p_source: 'site' }),
    });
    if (!res.ok) return { ok: false, error: res.status === 429 ? 'busy' : 'default' };
    return (await res.json()) as Reply;
  } catch {
    return { ok: false, error: 'offline' };
  }
}

export function doneText(email: string, r: Reply): string {
  const place = r.position ? `#${r.position} ` : '';
  return r.already
    ? `<b>You’re already ${place}in line.</b> We’ll write to <strong>${esc(email)}</strong> as soon as there’s room.`
    : `<b>You’re ${place}in line.</b> We’ll write to <strong>${esc(email)}</strong> as soon as there’s room. One email, nothing else.`;
}

const ERRORS: Record<string, string> = {
  offline: 'We couldn’t reach the server. Check your connection and try again.',
  invalid_email: 'That doesn’t look like an email address.',
  busy: 'Too many requests right now. Try again in a minute.',
  default: 'Something went wrong on our side. Please try again in a minute.',
};

function fieldError(input: HTMLInputElement) {
  const v = input.validity;
  if (v.valueMissing) return 'Enter your email.';
  if (v.typeMismatch) return 'That doesn’t look like an email address.';
  return '';
}

export function initForms(root: ParentNode = document) {
  const closed = !LIVE && !import.meta.env.DEV;

  root.querySelectorAll<HTMLFormElement>('[data-beta-form="waitlist"]').forEach((form) => {
    const status = form.querySelector<HTMLElement>('[data-form-status]');
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const input = form.querySelector<HTMLInputElement>('input[name="email"]');
    if (!input) return;

    if (closed) {
      form.classList.add('is-closed');
      input.disabled = true;
      if (submit) submit.disabled = true;
      if (status) status.textContent = 'The waitlist opens in a few days. Nothing is sent from this form yet.';
      return;
    }

    const show = (msg: string) => {
      const err = form.querySelector<HTMLElement>('[data-err-for="email"]');
      input.setAttribute('aria-invalid', String(!!msg));
      if (err) err.textContent = msg;
    };
    input.addEventListener('blur', () => { if (input.value) show(fieldError(input)); });
    input.addEventListener('input', () => { if (input.getAttribute('aria-invalid') === 'true') show(fieldError(input)); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = fieldError(input);
      show(msg);
      if (msg) { input.focus(); return; }
      if ((form.querySelector<HTMLInputElement>('[data-hp]')?.value ?? '') !== '') return; // bots

      const email = input.value.trim();
      form.classList.add('is-busy');
      if (submit) submit.disabled = true;
      if (status) status.textContent = 'Sending…';
      const r = await join(email);
      form.classList.remove('is-busy');
      if (submit) submit.disabled = false;
      if (r.ok) {
        form.classList.add('is-done');
        const done = form.querySelector<HTMLElement>('[data-form-done]');
        if (done) {
          done.innerHTML = doneText(email, r);
          done.hidden = false;
          done.focus();
        }
        if (status) status.textContent = '';
      } else if (r.error === 'invalid_email') {
        show(ERRORS.invalid_email);
        if (status) status.textContent = '';
        input.focus();
      } else if (status) {
        status.textContent = ERRORS[r.error ?? ''] ?? ERRORS.default;
      }
    });
  });
}
