/**
 * Beta capacity: how many people the free plans we run on can serve well.
 * The numbers come from the public RPC `bw_capacity_status` (totals only, no
 * personal data). Until that exists the counter stays hidden in production;
 * in dev it shows a sample, and `?capacity=full` previews the full state.
 */
export type Capacity = {
  cap: number;
  taken: number;
  todayLeft: number;
  state: 'open' | 'full';
  sample?: boolean;
};

let pending: Promise<Capacity | null> | null = null;

export function getCapacity(): Promise<Capacity | null> {
  if (pending) return pending;
  pending = (async () => {
    const q = new URLSearchParams(location.search).get('capacity');
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
    if (url && key && !q) {
      try {
        const res = await fetch(`${url}/rest/v1/rpc/bw_capacity_status`, {
          method: 'POST',
          headers: { apikey: key, 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (res.ok) {
          const d = (await res.json()) as { cap: number; taken: number; today_left: number; state: 'open' | 'full' };
          return { cap: d.cap, taken: d.taken, todayLeft: d.today_left, state: d.state };
        }
      } catch { /* offline or not deployed yet */ }
      return null;
    }
    if (import.meta.env.DEV || q) {
      return q === 'full'
        ? { cap: 400, taken: 400, todayLeft: 0, state: 'full', sample: true }
        : { cap: 400, taken: 142, todayLeft: 18, state: 'open', sample: true };
    }
    return null;
  })();
  return pending;
}

export const spotsLeft = (c: Capacity) => Math.max(0, c.cap - c.taken);

/** Short line for chips and pills. */
export function capLine(c: Capacity) {
  if (c.state === 'full') return 'Full right now · join the waitlist';
  return `${spotsLeft(c)} spots left · ${c.todayLeft} today`;
}

/** Fills every capacity placeholder on the page. */
export async function renderCapacity() {
  const c = await getCapacity();
  const full = c?.state === 'full';
  document.documentElement.classList.toggle('is-full', !!full);

  document.querySelectorAll<HTMLElement>('[data-cap-line]').forEach((el) => {
    if (!c) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.toggle('is-full', full);
    const t = el.querySelector('[data-cap-text]') ?? el;
    t.textContent = full ? 'Every spot is taken right now. Join the waitlist.' : `${spotsLeft(c)} of ${c.cap} spots left · ${c.todayLeft} open today`;
  });

  document.querySelectorAll<HTMLElement>('[data-cap-meter]').forEach((el) => {
    if (!c) { el.closest<HTMLElement>('[data-cap-block]')?.setAttribute('hidden', ''); return; }
    const n = Number(el.dataset.cells ?? 40);
    const per = c.cap / n;
    const lit = Math.ceil(c.taken / per);
    const today = full ? 0 : Math.min(n - lit, Math.ceil(c.todayLeft / per));
    el.style.setProperty('--n', String(n));
    el.classList.toggle('is-full', full);
    el.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < lit ? 'on' : i < lit + today ? 'today' : ''}"></i>`).join('');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', full ? `All ${c.cap} beta spots are taken` : `${c.taken} of ${c.cap} beta spots taken, ${c.todayLeft} open today`);
  });

  document.querySelectorAll<HTMLElement>('[data-cap-num]').forEach((el) => {
    if (!c) return;
    const k = el.dataset.capNum as 'taken' | 'cap' | 'left' | 'today';
    el.textContent = String(k === 'left' ? spotsLeft(c) : k === 'today' ? c.todayLeft : c[k]);
  });

  document.querySelectorAll<HTMLElement>('[data-cap-sample]').forEach((el) => { el.hidden = !c?.sample; });
  return c;
}
