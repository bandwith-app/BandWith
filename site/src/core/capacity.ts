/**
 * Beta capacity: how many people the free plans we run on can serve well.
 *
 * The numbers come from the public RPC `bw_capacity_status` (migration 128:
 * totals only, no personal data). A spot is one account: 300 in all, 45 of
 * them kept for people invited by a band that's already inside (and their
 * deputies). The database enforces it when an account is created; this file
 * only shows it.
 *
 * States: open (open spots left) · invites (only band invites get in) ·
 * full (nobody). Anything but open sets html.is-full: the site puts the
 * waitlist first; with invites, the doors stay open for invited people.
 *
 * Without the RPC the counter stays hidden in production. In dev it shows a
 * sample; `?capacity=open|invites|full` previews a state anywhere.
 */
export type CapState = 'open' | 'invites' | 'full';
export type Capacity = {
  cap: number;
  reserved: number;
  taken: number;
  /** Spots anyone can still take. */
  publicLeft: number;
  /** Spots left in all, for band invites once publicLeft is 0. */
  inviteLeft: number;
  state: CapState;
  sample?: boolean;
};

type Status = {
  cap: number | null;
  reserved?: number;
  taken?: number;
  public_left?: number;
  invite_left?: number;
  state?: string;
};

/** The RPC's answer as a Capacity, or null when there is no limit (or it makes no sense). */
export function fromStatus(d: Status | null | undefined): Capacity | null {
  if (!d || typeof d.cap !== 'number' || d.cap <= 0) return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  const state: CapState = d.state === 'invites' || d.state === 'full' ? d.state : 'open';
  return {
    cap: d.cap,
    reserved: Math.min(n(d.reserved), d.cap),
    taken: Math.min(n(d.taken), d.cap),
    publicLeft: n(d.public_left),
    inviteLeft: n(d.invite_left),
    state,
  };
}

const SAMPLES: Record<CapState, Status> = {
  open: { cap: 300, reserved: 45, taken: 142, public_left: 113, invite_left: 158, state: 'open' },
  invites: { cap: 300, reserved: 45, taken: 271, public_left: 0, invite_left: 29, state: 'invites' },
  full: { cap: 300, reserved: 45, taken: 300, public_left: 0, invite_left: 0, state: 'full' },
};

let pending: Promise<Capacity | null> | null = null;

export function getCapacity(): Promise<Capacity | null> {
  if (pending) return pending;
  pending = (async () => {
    const q = new URLSearchParams(location.search).get('capacity');
    const preview = q === 'open' || q === 'invites' || q === 'full' ? q : null;
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
    if (url && key && !preview && !import.meta.env.DEV) {
      try {
        const res = await fetch(`${url}/rest/v1/rpc/bw_capacity_status`, {
          method: 'POST',
          headers: { apikey: key, 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (res.ok) return fromStatus((await res.json()) as Status);
      } catch { /* offline: the counter stays hidden */ }
      return null;
    }
    if (import.meta.env.DEV || preview) {
      const c = fromStatus(SAMPLES[preview ?? 'open']);
      return c && { ...c, sample: true };
    }
    return null;
  })();
  return pending;
}

/** Spots still kept for band invites (never more than the reserve). */
export const keptForInvites = (c: Capacity) => Math.min(c.reserved, c.inviteLeft);

/** The counter's sentence. */
export function capText(c: Capacity): string {
  if (c.state === 'full') return 'Every spot is taken right now. Join the waitlist.';
  if (c.state === 'invites') {
    return `Open spots are gone. Invited by a band that’s already inside? ${c.inviteLeft} ${c.inviteLeft === 1 ? 'spot is' : 'spots are'} still kept for you.`;
  }
  return `${c.publicLeft} of ${c.cap - c.reserved} open spots left · ${keptForInvites(c)} kept for band invites`;
}

/** The LED meter: one class per cell (on = taken, res = kept for invites). */
export function meterCells(c: Capacity, n: number): string[] {
  const per = c.cap / n;
  const lit = Math.min(n, Math.ceil(c.taken / per));
  const res = c.state === 'full' ? 0 : Math.min(n - lit, Math.ceil(keptForInvites(c) / per));
  return Array.from({ length: n }, (_, i) => (i < lit ? 'on' : i >= n - res ? 'res' : ''));
}

export function meterLabel(c: Capacity): string {
  if (c.state === 'full') return `All ${c.cap} beta spots are taken`;
  return `${c.taken} of ${c.cap} beta spots taken, ${keptForInvites(c)} kept for band invites`;
}

/** Fills every capacity placeholder on the page. */
export async function renderCapacity() {
  const c = await getCapacity();
  const closed = !!c && c.state !== 'open';
  const root = document.documentElement;
  root.classList.toggle('is-full', closed);
  root.classList.toggle('is-invites', c?.state === 'invites');

  document.querySelectorAll<HTMLElement>('[data-cap-line]').forEach((el) => {
    if (!c) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.toggle('is-full', closed);
    const t = el.querySelector('[data-cap-text]') ?? el;
    t.textContent = capText(c);
  });

  document.querySelectorAll<HTMLElement>('[data-cap-meter]').forEach((el) => {
    if (!c) { el.closest<HTMLElement>('[data-cap-block]')?.setAttribute('hidden', ''); return; }
    const n = Number(el.dataset.cells ?? 40);
    el.style.setProperty('--n', String(n));
    el.classList.toggle('is-full', closed);
    el.innerHTML = meterCells(c, n).map((k) => `<i class="${k}"></i>`).join('');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', meterLabel(c));
  });

  document.querySelectorAll<HTMLElement>('[data-cap-num]').forEach((el) => {
    if (!c) return;
    const k = el.dataset.capNum;
    el.textContent = String(k === 'left' ? c.publicLeft : k === 'kept' ? keptForInvites(c) : k === 'cap' ? c.cap : c.taken);
  });

  document.querySelectorAll<HTMLElement>('[data-cap-sample]').forEach((el) => { el.hidden = !c?.sample; });
  return c;
}
