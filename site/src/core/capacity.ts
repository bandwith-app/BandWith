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
 * Open is what the pages say as written: "Open beta", no spots count in the
 * home hero, the doors first on the Get page. Anything but open turns the
 * [data-cap-beta] labels back to "Private beta" and brings the notices back
 * (the hero's line here, the Get page's counter in pages/get.ts, and the
 * [data-cap-show] blocks: the waitlist and the lines for invited people).
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

/**
 * Whether a [data-cap-line] shows. data-cap-line="closed" (the home hero) is
 * a notice: it stays out while open spots are left, where a count next to
 * the sign-up button reads as "invite only". The other lines show in every state.
 */
export const capLineShown = (c: Capacity | null, only?: string | null): boolean =>
  !!c && (only !== 'closed' || c.state !== 'open');

/** Writes a label's words, keeping what comes before them (its LED). */
function setLabel(el: HTMLElement, text: string) {
  const words = Array.from(el.childNodes).reverse().find((n) => n.nodeType === 3 && n.textContent?.trim());
  if (words) words.textContent = text;
  else el.append(text);
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

/**
 * Whether a [data-cap-show] block is on the page: "closed" (the waitlist) when
 * open spots are gone, "invites" / "full" only in that state. They are written
 * `hidden` in the HTML, so while the beta is open (or the count is unknown)
 * nobody reads "Tonight's show is full": not a visitor, a crawler or llms-full.txt.
 */
export const capBlockShown = (c: Capacity | null, when?: string | null): boolean =>
  !!c && c.state !== 'open' && (when === 'closed' || when === c.state);

/** Fills every capacity placeholder on the page. */
export async function renderCapacity() {
  const c = await getCapacity();
  const closed = !!c && c.state !== 'open';
  const root = document.documentElement;
  root.classList.toggle('is-full', closed);
  root.classList.toggle('is-invites', c?.state === 'invites');

  document.querySelectorAll<HTMLElement>('[data-cap-show]').forEach((el) => { el.hidden = !capBlockShown(c, el.dataset.capShow); });

  // Open spots gone: the beta is private again (the label's attribute holds those words, in English).
  if (closed) {
    document.querySelectorAll<HTMLElement>('[data-cap-beta]').forEach((el) => { if (el.dataset.capBeta) setLabel(el, el.dataset.capBeta); });
  }

  document.querySelectorAll<HTMLElement>('[data-cap-line]').forEach((el) => {
    if (!c || !capLineShown(c, el.dataset.capLine)) { el.hidden = true; return; }
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
