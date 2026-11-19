import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Crown, ArrowUpRight } from '@/app/components/icons';
import { cn } from '@/app/components/ui/utils';
import { useOptionalBand } from '@/lib/BandContext';
import { invalidatePlan, usePlan } from '@/lib/usePlan';
import { startTrial, useTrialOffer } from '@/lib/trial';
import { PillButton } from '@/app/components/bw';
import { PLAN_SITE_URL, noticeDate, planLine, planName, planNotice, planUsageRows } from '@/lib/planText';
import { openExternal } from '@/lib/nativeFiles';
import { useT } from '@/lib/i18n';

/**
 * Settings → Plan (paid plans P3a). The band's plan, in words, and for admins
 * the meters of the counted limits. No prices in the app; the web page with
 * the plans is linked only when checkout is open and never on iOS (Apple
 * 3.1.1, plan §8 option A).
 */
export const PlanSection: React.FC = () => {
  const t = useT();
  const band = useOptionalBand()?.selectedBand ?? null;
  const ent = usePlan(band?.id);
  const rows = planUsageRows(ent);
  const notice = planNotice(ent);
  const canLinkOut = !!ent?.checkout && ent.isAdmin && Capacitor.getPlatform() !== 'ios';
  // P5: the Pro trial, when the server offers it to this admin (164).
  const offer = useTrialOffer(band?.id ? String(band.id) : null, !!ent?.isAdmin, ent?.plan);
  const [starting, setStarting] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  const begin = async () => {
    if (!band?.id || starting) return;
    setStarting(true);
    setTrialError(null);
    const res = await startTrial(String(band.id));
    if (res.error) setTrialError(res.error);
    await invalidatePlan(String(band.id));
    setStarting(false);
  };

  if (!band) {
    return (
      <div className="bg-card text-card-foreground rounded-[24px] p-4">
        <p className="bw-body-md text-muted-foreground">{t('Plans are per band. Join or create a band to see its plan.')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="plan-section">
      <div className="dark bg-sheet text-sheet-foreground rounded-[24px] p-5 flex flex-col gap-2">
        <span className="bw-label-sm text-sheet-foreground/70 truncate">{band.name}</span>
        <span className="flex items-center gap-2">
          <Crown aria-hidden className="w-[22px] h-[22px] text-accent shrink-0" />
          <span className="bw-h3">{planName(ent)}</span>
        </span>
        <p className="bw-body-md text-sheet-foreground/85">{planLine(ent, new Date())}</p>
      </div>

      {notice && (
        <div role="note" className="bg-accent text-accent-foreground rounded-[24px] p-4 flex flex-col gap-1">
          <span className="bw-label-md">{t('Plans start on {date}', { date: noticeDate(notice) })}</span>
          <span className="bw-body-sm">{t('Free stays free, with every tool. Pro and Maestro add more room for busy bands.')}</span>
        </div>
      )}

      {offer && (
        <div className="bg-card text-card-foreground rounded-[24px] p-4 flex flex-col gap-3" data-testid="plan-trial">
          <div className="flex flex-col gap-1">
            <span className="bw-label-md">{t('Try Pro free for {days} days', { days: offer.days })}</span>
            <span className="bw-body-sm text-muted-foreground">{t('No card. Once per account; then the band is on Free again, and nothing is deleted.')}</span>
          </div>
          <PillButton onClick={() => void begin()} loading={starting}>
            {t('Start the trial')}
          </PillButton>
          {trialError && (
            <p role="alert" className="bw-body-sm text-destructive">
              {trialError}
            </p>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <ul className="bg-card text-card-foreground rounded-[24px] p-4 flex flex-col gap-4" aria-label={t('What your band uses')}>
          {rows.map((r) => (
            <li key={r.key} className="flex flex-col gap-2">
              <span className="flex items-baseline gap-3">
                <span className="bw-label-md flex-1 min-w-0 truncate">{r.label}</span>
                <span className={cn('bw-label-sm shrink-0', r.over ? 'text-destructive' : 'text-muted-foreground')}>{r.value}</span>
              </span>
              <span aria-hidden className="h-1.5 rounded-full bg-foreground/[0.08] overflow-hidden">
                <span
                  className={cn('block h-full rounded-full', r.over ? 'bg-destructive' : 'bg-accent')}
                  style={{ width: `${Math.round(r.fill * 100)}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}

      {canLinkOut && (
        <button
          type="button"
          onClick={() => void openExternal(PLAN_SITE_URL)}
          className="bg-card text-card-foreground rounded-[24px] p-4 flex items-center gap-3 w-full text-left transition-colors hover:bg-foreground/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="bw-label-md flex-1 min-w-0">{t('See the plans on the web')}</span>
          <ArrowUpRight aria-hidden className="w-[18px] h-[18px] shrink-0" />
        </button>
      )}
    </div>
  );
};

export default PlanSection;
