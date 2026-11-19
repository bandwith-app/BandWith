/**
 * The Pro trial and the end of a trial or grant (paid plans P5, migration 164).
 * The server decides everything: who may start a trial (an admin, once per
 * account, a band that never had a plan, `plans_trial` on) and for how long
 * (`plan_settings.trial_days`). No card.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { t } from '@/lib/i18n';
import { parseEntitlements, type Entitlements } from '@/lib/plans';

export interface TrialOffer {
  plan: 'pro';
  days: number;
}

export function parseTrialOffer(v: unknown): TrialOffer | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as { plan?: unknown; days?: unknown };
  return o.plan === 'pro' && typeof o.days === 'number' && Number.isInteger(o.days) && o.days > 0 ? { plan: 'pro', days: o.days } : null;
}

/** The trial the signed-in admin may start on this band now, or null (also on any error). */
export async function fetchTrialOffer(bandId: string | null | undefined): Promise<TrialOffer | null> {
  if (!bandId) return null;
  try {
    const { data, error } = await supabase.rpc('bw_trial_offer', { p_band_id: bandId });
    return error ? null : parseTrialOffer(data);
  } catch {
    return null;
  }
}

/** Why the server refused, in words. */
export function trialRefusal(error: unknown): string {
  const msg = error && typeof error === 'object' ? String((error as { message?: unknown }).message ?? '') : '';
  const why = /BW_TRIAL:([a-z_]+)/.exec(msg)?.[1];
  switch (why) {
    case 'used':
      return t('Your account already used its trial.');
    case 'band_had_plan':
      return t('This band already had a plan, so it has no trial.');
    case 'off':
      return t('Trials are not open yet.');
    case 'not_admin':
      return t('Only band admins can do this.');
    default:
      return t('Could not start the trial. Try again.');
  }
}

export async function startTrial(bandId: string): Promise<{ ent: Entitlements | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('bw_start_trial', { p_band_id: bandId });
    if (error) return { ent: null, error: trialRefusal(error) };
    return { ent: parseEntitlements(data), error: null };
  } catch (e) {
    return { ent: null, error: trialRefusal(e) };
  }
}

const WARN_DAYS = 7;

/** A trial or a grant that ends within a week: the admins' warning (§6). */
export function planEnding(ent: Entitlements | null | undefined, now: Date): { kind: 'trial' | 'grant'; date: string } | null {
  if (!ent?.enforced || !ent.isAdmin) return null;
  const pick =
    ent.source === 'trial' && ent.status === 'trialing'
      ? { kind: 'trial' as const, date: ent.trialEndsAt }
      : ent.source === 'grant' && ent.status === 'active'
        ? { kind: 'grant' as const, date: ent.grantUntil }
        : null;
  if (!pick?.date) return null;
  const left = Date.parse(pick.date) - now.getTime();
  return left > 0 && left <= WARN_DAYS * 86_400_000 ? { kind: pick.kind, date: pick.date } : null;
}

/** The offer for this band, refreshed when the band or `key` changes (null while loading or none). */
export function useTrialOffer(bandId: string | null | undefined, enabled = true, key: unknown = null): TrialOffer | null {
  const [offer, setOffer] = useState<TrialOffer | null>(null);
  useEffect(() => {
    let alive = true;
    setOffer(null);
    if (!enabled || !bandId) return;
    void fetchTrialOffer(bandId).then((o) => alive && setOffer(o));
    return () => {
      alive = false;
    };
  }, [bandId, enabled, key]);
  return offer;
}
