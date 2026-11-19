import React, { useState } from 'react';
import { Crown, X } from '@/app/components/icons';
import { usePlan } from '@/lib/usePlan';
import { planEnding } from '@/lib/trial';
import { longDate } from '@/lib/planText';
import { useT } from '@/lib/i18n';

const dismissKey = (bandId: string, date: string) => `bw-plan-ending:${bandId}:${date}`;
const isDismissed = (bandId: string, date: string) => {
  try {
    return localStorage.getItem(dismissKey(bandId, date)) === '1';
  } catch {
    return false;
  }
};

/**
 * The end of a Pro trial or of Pro offered by BandWith is near (paid plans
 * P5, §6): a card at the top of Home for the band's admins in the last week,
 * once per band and end date. Opens Settings → Plan. The server also leaves
 * a note in the inbox 7 days and 1 day before (164).
 */
export const PlanEndingCard: React.FC<{ bandId: string; onOpenPlan?: () => void }> = ({ bandId, onOpenPlan }) => {
  const t = useT();
  const ending = planEnding(usePlan(bandId), new Date());
  const [hidden, setHidden] = useState(false);
  if (!ending || hidden || isDismissed(bandId, ending.date)) return null;

  const date = longDate(ending.date);
  const dismiss = () => {
    try {
      localStorage.setItem(dismissKey(bandId, ending.date), '1');
    } catch {
      /* storage blocked: hidden for this visit */
    }
    setHidden(true);
  };

  return (
    <div role="note" className="bg-accent text-accent-foreground rounded-[24px] p-4 flex items-start gap-3" data-testid="plan-ending">
      <Crown aria-hidden className="w-[22px] h-[22px] shrink-0 mt-0.5" />
      <button type="button" onClick={onOpenPlan} className="flex flex-col gap-1 min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-[12px]">
        <span className="bw-label-md">
          {ending.kind === 'trial' ? t('Your Pro trial ends on {date}', { date }) : t('Pro offered by BandWith ends on {date}', { date })}
        </span>
        <span className="bw-body-sm">{t('Then the band is on Free: nothing is deleted.')}</span>
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('Dismiss plan reminder')}
        className="size-11 -m-2 rounded-full flex items-center justify-center shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X aria-hidden className="w-[18px] h-[18px]" />
      </button>
    </div>
  );
};

export default PlanEndingCard;
