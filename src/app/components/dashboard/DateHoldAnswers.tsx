import React from 'react';
import { Tag } from '@/app/components/bw/Screen';
import { useT } from '@/lib/i18n';
import { groupAnswers, type DateHoldAnswerRow } from '@/lib/dateHolds';
import { useDateHoldAnswers } from '@/app/hooks/useDateHolds';

/**
 * Admin, on a quote event (178): the members were asked to keep the date
 * free. Who is free, who can't, who hasn't answered. Members never see this.
 */
export const DateHoldAnswers: React.FC<{ eventId: string | null | undefined; className?: string }> = ({ eventId, className }) => {
  const t = useT();
  const rows = useDateHoldAnswers(eventId);
  if (!eventId || rows === null) return null;
  if (rows.length === 0) {
    return (
      <section className={className} aria-label={t("Who's free")} data-testid="date-hold-answers">
        <h3 className="bw-label-sm text-muted-foreground">{t("Who's free")}</h3>
        <p className="bw-body-sm text-muted-foreground mt-2">{t('No members to ask yet.')}</p>
      </section>
    );
  }
  const { free, busy, none } = groupAnswers(rows);
  const group = (label: string, list: DateHoldAnswerRow[], testId: string) => (
    <div className="flex flex-col gap-2 min-w-0" data-testid={testId}>
      <span className="bw-label-md">{label}</span>
      {list.length === 0 ? (
        <span className="bw-body-sm text-muted-foreground">—</span>
      ) : (
        <ul className="flex flex-col gap-1.5 min-w-0">
          {list.map((r) => (
            <li key={r.userId} className="flex items-center justify-between gap-3 min-w-0">
              <span className="bw-body-md min-w-0 truncate">{r.name || t('Member')}</span>
              {r.onLineup && <Tag variant="subtle">{t('On the lineup')}</Tag>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <section className={className} aria-label={t("Who's free")} data-testid="date-hold-answers">
      <div className="flex flex-col gap-1 mb-3">
        <h3 className="bw-label-sm text-muted-foreground">{t("Who's free")}</h3>
        <p className="bw-body-sm text-muted-foreground">
          {t('Members see only the day, time and place, and keep the date free until you confirm.')}
        </p>
      </div>
      <div className="rounded-[24px] p-4 bg-card text-card-foreground flex flex-col gap-4 min-w-0">
        {group(t('Free ({count})', { count: free.length }), free, 'hold-free')}
        {group(t("Can't ({count})", { count: busy.length }), busy, 'hold-busy')}
        {group(t('No answer yet ({count})', { count: none.length }), none, 'hold-none')}
      </div>
    </section>
  );
};
