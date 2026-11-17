/**
 * Get page forms: Android (APK link), iPhone & iPad (TestFlight invite) and
 * the waitlist. They post to the `beta` edge function once it exists
 * (VITE_BETA_ENDPOINT). Until then: in dev they simulate a reply so every
 * state can be seen; in production they stay closed and send nothing.
 */

type Reply = { ok: boolean; position?: number; error?: string };

const ENDPOINT = import.meta.env.VITE_BETA_ENDPOINT as string | undefined;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function send(kind: string, data: Record<string, string>): Promise<Reply> {
  if (!ENDPOINT) {
    await new Promise((r) => setTimeout(r, 700));
    return { ok: true, position: kind === 'waitlist' ? 37 : undefined };
  }
  try {
    const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, ...data }) });
    const body = (await res.json().catch(() => ({}))) as Reply;
    return res.ok ? { ...body, ok: true } : { ok: false, error: body.error };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

const DONE: Record<string, (email: string, r: Reply) => string> = {
  android: (e) => `<b>Check your inbox.</b> We sent a link to <strong>${esc(e)}</strong>. Open it to confirm, and the next email brings the APK.`,
  ios: (e) => `<b>Check your inbox.</b> We sent a link to <strong>${esc(e)}</strong>. Once you confirm, Apple emails your TestFlight invite.`,
  waitlist: (e, r) => `<b>You’re ${r.position ? `#${r.position} ` : ''}in line.</b> We’ll write to <strong>${esc(e)}</strong> as soon as a spot opens. You’ll have 72 hours to take it.`,
};

const ERRORS: Record<string, string> = {
  offline: 'We couldn’t reach the server. Check your connection and try again.',
  full: 'Every spot just went. Join the waitlist below and we’ll write when one opens.',
  default: 'Something went wrong on our side. Please try again in a minute.',
};

function fieldError(input: HTMLInputElement) {
  const v = input.validity;
  if (v.valueMissing) return input.type === 'email' ? 'Enter your email.' : `Enter your ${input.dataset.what ?? 'name'}.`;
  if (v.typeMismatch) return 'That doesn’t look like an email address.';
  return '';
}

export function initForms(root: ParentNode = document) {
  const forms = Array.from(root.querySelectorAll<HTMLFormElement>('[data-beta-form]'));
  const closed = !ENDPOINT && !import.meta.env.DEV;

  forms.forEach((form) => {
    const kind = form.dataset.betaForm ?? 'android';
    const status = form.querySelector<HTMLElement>('[data-form-status]');
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input:not([data-hp])'));

    if (closed) {
      form.classList.add('is-closed');
      inputs.forEach((i) => (i.disabled = true));
      if (submit) submit.disabled = true;
      if (status) status.textContent = 'Requests open in a few days. Nothing is sent from this form yet.';
      return;
    }

    const show = (input: HTMLInputElement, msg: string) => {
      const err = form.querySelector<HTMLElement>(`[data-err-for="${input.name}"]`);
      input.setAttribute('aria-invalid', String(!!msg));
      if (err) err.textContent = msg;
    };
    inputs.forEach((i) => {
      i.addEventListener('blur', () => { if (i.value) show(i, fieldError(i)); });
      i.addEventListener('input', () => { if (i.getAttribute('aria-invalid') === 'true') show(i, fieldError(i)); });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (document.documentElement.classList.contains('is-full') && kind !== 'waitlist') return;
      let first: HTMLInputElement | null = null;
      inputs.forEach((i) => {
        const msg = fieldError(i);
        show(i, msg);
        if (msg && !first) first = i;
      });
      if (first) { (first as HTMLInputElement).focus(); return; }
      if ((form.querySelector<HTMLInputElement>('[data-hp]')?.value ?? '') !== '') return; // bots

      const data: Record<string, string> = { platform: kind };
      inputs.forEach((i) => (data[i.name] = i.value.trim()));
      form.classList.add('is-busy');
      if (submit) submit.disabled = true;
      if (status) status.textContent = 'Sending…';
      const r = await send(kind, data);
      form.classList.remove('is-busy');
      if (submit) submit.disabled = false;
      if (r.ok) {
        form.classList.add('is-done');
        const done = form.querySelector<HTMLElement>('[data-form-done]');
        if (done) {
          done.innerHTML = DONE[kind]?.(data.email ?? '', r) ?? '';
          done.hidden = false;
          done.focus();
        }
        if (status) status.textContent = '';
      } else if (status) {
        status.textContent = ERRORS[r.error ?? ''] ?? ERRORS.default;
      }
    });
  });
}
