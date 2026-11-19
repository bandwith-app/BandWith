import React, { useState } from 'react';
import { Crown, X } from '@/app/components/icons';
import { usePlan } from '@/lib/usePlan';
import { noticeDate, planNotice } from '@/lib/planText';
import { useT } from '@/lib/i18n';

const dismissKey = (bandId: string, date: string) => `bw-plan-notice:${bandId}:${date}`;
const isDismissed = (bandId: string, date: string) => {
  try {
    return localStorage.getItem(dismissKey(bandId, date)) === '1';
  } catch {
    return false;
  }
};

/**
 * The launch notice on Home (paid plans §5.3): admins only, while the plans
 * are off and `plan_settings.launch_notice` carries a date, so it can be
 * turned on on the notice day without a release. Dismissed once per band
 * and date. Opens Settings → Plan.
 */
export const LaunchNoticeCard: React.FC<{ bandId: string; onOpenPlan?: () => void }> = ({ bandId, onOpenPlan }) => {
  const t = useT();
  const notice = planNotice(usePlan(bandId));
  const [hidden, setHidden] = useState(false);
  if (!notice || hidden || isDismissed(bandId, notice.date)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(dismissKey(bandId, notice.date), '1');
    } catch {
      /* storage blocked: hidden for this visit */
    }
    setHidden(true);
  };

  return (
    <div role="note" className="bg-accent text-accent-foreground rounded-[24px] p-4 flex items-start gap-3" data-testid="plan-launch-notice">
      <Crown aria-hidden className="w-[22px] h-[22px] shrink-0 mt-0.5" />
      <button type="button" onClick={onOpenPlan} className="flex flex-col gap-1 min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-[12px]">
        <span className="bw-label-md">{t('Plans start on {date}', { date: noticeDate(notice) })}</span>
        <span className="bw-body-sm">{t('Free stays free, with every tool. Pro and Maestro add more room for busy bands.')}</span>
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('Dismiss plans notice')}
        className="size-11 -m-2 rounded-full flex items-center justify-center shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X aria-hidden className="w-[18px] h-[18px]" />
      </button>
    </div>
  );
};

export default LaunchNoticeCard;
