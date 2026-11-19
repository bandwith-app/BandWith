import React, { useEffect, useRef, useState } from 'react';
import { BwSheet, PillButton } from '@/app/components/bw';
import { confirmStorageLimit, onPlanLimit, type PlanLimitHit } from '@/lib/planLimit';
import { invalidatePlan } from '@/lib/usePlan';
import { startTrial, useTrialOffer } from '@/lib/trial';
import { limitFor, type Entitlements, type LimitKey } from '@/lib/plans';
import { planName } from '@/lib/planText';
import { useT } from '@/lib/i18n';

/** Stage / Live mode is on screen: a prompt never interrupts it (§5.2). */
const inLiveMode = () => !!document.querySelector('.bw-stage');

interface Shown {
  hit: PlanLimitHit;
  bandId: string | null;
  ent: Entitlements | null;
}

/**
 * The limit prompt (paid plans P3b, §5.2): one sheet for the whole app,
 * opened by `bw:plan-limit` (a server refusal seen by `planAwareFetch`, or
 * the demo). Admins get the limit, what is already there and the way to
 * their plan; members are told to ask their band admin, never prices or
 * buttons to buy. Nothing here blocks reading, and it never opens over
 * Stage / Live mode. No prices and no web link: the plan screen has those
 * rules (and none on iOS).
 */
export const PlanLimitSheet: React.FC<{ bandId: string | null; onOpenPlan: () => void }> = ({ bandId, onOpenPlan }) => {
  const t = useT();
  const [shown, setShown] = useState<Shown | null>(null);
  const current = useRef(bandId);
  current.current = bandId;

  useEffect(
    () =>
      onPlanLimit((hit) => {
        if (inLiveMode()) return;
        const band = hit.bandId ?? current.current ?? null;
        // Fresh numbers: the refusal means the cached ones are out of date.
        void invalidatePlan(band).then((ent) => {
          if (hit.unconfirmed && !confirmStorageLimit(ent)) return;
          if (inLiveMode()) return;
          setShown({ hit, bandId: band, ent });
        });
      }),
    [],
  );

  const close = () => setShown(null);
  const hit = shown?.hit;
  const ent = shown?.ent ?? null;
  const key = hit?.key;
  // Band creation has no band yet: the person's own wording, always.
  const isAdmin = key === 'bands_as_admin' || !!ent?.isAdmin;
  const limit = hit?.limit ?? (key ? limitFor(ent ? { ...ent, enforced: true } : null, key) : null);
  const used = hit?.used ?? (key ? ent?.usage[key] : undefined) ?? null;

  const title = key ? titleFor(t, key) : '';
  const body = !key
    ? ''
    : !isAdmin
      ? t('Your band’s plan has no room for this. Ask your band admin about the plan.')
      : bodyFor(t, key, used, limit, ent ? planName(ent) : null);
  const canOpenPlan = isAdmin && !!shown?.bandId && key !== 'bands_as_admin';
  // P5: the first limit an admin meets can start the Pro trial (164 decides).
  const offer = useTrialOffer(shown?.bandId ?? null, canOpenPlan && !!shown);
  const [starting, setStarting] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  useEffect(() => setTrialError(null), [shown]);
  const tryPro = async () => {
    if (!shown?.bandId || starting) return;
    setStarting(true);
    const res = await startTrial(shown.bandId);
    await invalidatePlan(shown.bandId);
    setStarting(false);
    if (res.error) setTrialError(res.error);
    else close();
  };

  return (
    <BwSheet
      open={!!shown}
      onClose={close}
      overline={t('Your plan')}
      title={title}
      tone="light"
      zIndex={320}
      portal
      footer={
        <div className="flex flex-col gap-2" data-testid="plan-limit-actions">
          {canOpenPlan && offer && (
            <PillButton onClick={() => void tryPro()} loading={starting}>
              {t('Try Pro free for {days} days', { days: offer.days })}
            </PillButton>
          )}
          {canOpenPlan ? (
            <>
              <PillButton
                variant={offer ? 'outline' : undefined}
                onClick={() => {
                  close();
                  onOpenPlan();
                }}
              >
                {t('See your plan')}
              </PillButton>
              <PillButton variant="outline" onClick={close}>
                {t('Not now')}
              </PillButton>
            </>
          ) : (
            <PillButton onClick={close}>{t('OK')}</PillButton>
          )}
        </div>
      }
    >
      <div data-testid="plan-limit-sheet" data-key={key} className="flex flex-col gap-3">
        <p className="bw-body-md text-muted-foreground">{body}</p>
        {trialError && (
          <p role="alert" className="bw-body-sm text-destructive">
            {trialError}
          </p>
        )}
      </div>
    </BwSheet>
  );
};

type T = ReturnType<typeof useT>;

// Whole sentences per key, so every language gets its grammar right.
function titleFor(t: T, key: LimitKey): string {
  switch (key) {
    case 'quotes_sent_month':
      return t('This month’s quote sends are used');
    case 'contracts_sent_month':
      return t('This month’s contract sends are used');
    case 'deputies':
      return t('No room for another deputy');
    case 'admins':
      return t('No room for another admin');
    case 'custom_templates':
      return t('No room for another template');
    case 'gear_items':
      return t('No room for more band gear');
    case 'storage_mb':
      return t('Your band’s storage is full');
    case 'bands_as_admin':
      return t('One Free band per account');
    default:
      return t('Your band’s plan has no room for this');
  }
}

function bodyFor(t: T, key: LimitKey, used: number | null, limit: number | null, plan: string | null): string {
  const n = (v: number | null) => (v === null ? null : String(v));
  switch (key) {
    case 'quotes_sent_month':
    case 'contracts_sent_month':
      return limit !== null
        ? t('{plan} sends {limit} a month, and this month’s are used. Your draft is saved: nothing is lost.', { plan: plan ?? 'Free', limit: n(limit)! })
        : t('This month’s sends are used. Your draft is saved: nothing is lost.');
    case 'storage_mb':
      return used !== null && limit !== null
        ? t('Your band uses {used} of {limit} MB. Files already there stay; a new upload needs room.', { used: n(used)!, limit: n(limit)! })
        : t('Files already there stay; a new upload needs room.');
    case 'bands_as_admin':
      return t('Your account already runs a Free band as admin. To run another, make one of your bands Pro, or let someone else create it and invite you.');
    default:
      return used !== null && limit !== null
        ? t('Your band’s plan has room for {limit}, and {used} are already there. Everything already there stays.', { used: n(used)!, limit: n(limit)! })
        : t('Your band’s plan has no room for this. Everything already there stays.');
  }
}

export default PlanLimitSheet;
