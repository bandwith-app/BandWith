/**
 * The band's plan and limits on the device (paid plans P1). Same pattern as
 * `flags.ts`: memory, then the device, then `bw_band_entitlements`, asked
 * again at most every 10 minutes, on resume, and right after the server
 * refused something because of a limit (`invalidatePlan`).
 *
 * Unknown (offline, first launch, not a member) is null: the app then never
 * blocks anything; the server decides (P2).
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { onAppResume } from '@/lib/appResume';
import { parseEntitlements, type Entitlements } from '@/lib/plans';

const TTL_MS = 10 * 60_000;
const storeKey = (bandId: string) => `bw-plan:${bandId}`;
const cache = new Map<string, { at: number; ent: Entitlements }>();
const inflight = new Map<string, Promise<Entitlements | null>>();
const listeners = new Set<(bandId: string, ent: Entitlements | null) => void>();

const readStored = (bandId: string): Entitlements | null => {
  try {
    return parseEntitlements(JSON.parse(localStorage.getItem(storeKey(bandId)) || 'null'));
  } catch {
    return null;
  }
};

/** The newest known plan for a band (memory, then the device), without asking the server. */
export const knownPlan = (bandId: string | null | undefined): Entitlements | null =>
  !bandId ? null : cache.get(bandId)?.ent ?? readStored(bandId);

const toServerShape = (e: Entitlements) => ({
  enforced: e.enforced,
  plan: e.plan,
  source: e.source,
  status: e.status,
  trial_ends_at: e.trialEndsAt,
  grant_until: e.grantUntil,
  is_payer: e.isPayer,
  is_admin: e.isAdmin,
  limits: e.limits,
  usage: e.usage,
  checkout: e.checkout,
  notice: e.notice,
});

export async function fetchBandPlan(bandId: string, force = false): Promise<Entitlements | null> {
  const hit = cache.get(bandId);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.ent;
  const running = inflight.get(bandId);
  if (running) return running;
  const p = (async () => {
    try {
      const { data, error } = await supabase.rpc('bw_band_entitlements', { p_band_id: bandId });
      const ent = error ? null : parseEntitlements(data);
      if (!ent) return knownPlan(bandId);
      cache.set(bandId, { at: Date.now(), ent });
      try {
        localStorage.setItem(storeKey(bandId), JSON.stringify(toServerShape(ent)));
      } catch {
        /* storage blocked: memory only */
      }
      listeners.forEach((l) => l(bandId, ent));
      return ent;
    } catch {
      return knownPlan(bandId);
    } finally {
      inflight.delete(bandId);
    }
  })();
  inflight.set(bandId, p);
  return p;
}

/** Ask the server again now (after a `BW_PLAN_LIMIT` refusal, or a purchase). */
export function invalidatePlan(bandId: string | null | undefined): Promise<Entitlements | null> {
  if (!bandId) return Promise.resolve(null);
  cache.delete(bandId);
  return fetchBandPlan(bandId, true);
}

/** The band's plan: the known one at once, refreshed from the server. */
export function usePlan(bandId: string | null | undefined): Entitlements | null {
  const [ent, setEnt] = useState<Entitlements | null>(() => knownPlan(bandId));
  useEffect(() => {
    setEnt(knownPlan(bandId));
    if (!bandId) return;
    let alive = true;
    const load = () =>
      void fetchBandPlan(bandId).then((e) => {
        if (alive) setEnt(e);
      });
    load();
    const onChange = (id: string, e: Entitlements | null) => {
      if (alive && id === bandId) setEnt(e);
    };
    listeners.add(onChange);
    const offResume = onAppResume(load);
    return () => {
      alive = false;
      listeners.delete(onChange);
      offResume();
    };
  }, [bandId]);
  return ent;
}

/** Test helper. */
export const __resetPlanCache = () => {
  cache.clear();
  inflight.clear();
};
