import React, { useState } from 'react';
import { Check, Clock, MapPin, X } from '@/app/components/icons';
import { BwSheet, PillButton } from '@/app/components/bw';
import { cn } from '@/app/components/ui/utils';
import { useT } from '@/lib/i18n';
import { answerDateHold, holdDay, holdPlace, holdTime, type DateHold, type HoldAnswer } from '@/lib/dateHolds';

/**
 * A possible gig that's still a quote (178): the member sees the day, the
 * time and the place, nothing else, and says whether they're free.
 * The answer goes to the band's admins.
 */
export const DateHoldCard: React.FC<{
  hold: DateHold;
  /** Several bands: the band's name above the card. */
  showBand?: boolean;
  onAnswered?: (eventId: string, answer: HoldAnswer) => void;
  /** The date became free while the card was open (quote declined…). */
  onGone?: (eventId: string) => void;
  onShowToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}> = ({ hold, showBand, onAnswered, onGone, onShowToast }) => {
  const t = useT();
  const [saving, setSaving] = useState<HoldAnswer | null>(null);
  const [answer, setAnswer] = useState<HoldAnswer | null>(hold.myAnswer);
  // A reload with a newer answer (another device) wins.
  React.useEffect(() => setAnswer(hold.myAnswer), [hold.myAnswer]);

  const time = holdTime(hold);
  const place = holdPlace(hold);

  const answerWith = async (next: HoldAnswer) => {
    if (saving || next === answer) return;
    const before = answer;
    setAnswer(next);
    setSaving(next);
    const res = await answerDateHold(hold.eventId, next);
    setSaving(null);
    if (res.error) {
      setAnswer(before);
      if (res.gone) {
        onShowToast?.(t('The date is free again'), 'info');
        onGone?.(hold.eventId);
      } else {
        onShowToast?.(t("Couldn't save your answer. Try again."), 'error');
      }
      return;
    }
    onAnswered?.(hold.eventId, next);
  };

  return (
    <section
      className="rounded-[24px] p-4 flex flex-col gap-4 bg-card text-card-foreground min-w-0"
      aria-label={t('Possible gig – keep the date free')}
      data-testid="date-hold-card"
    >
      <div className="flex flex-col gap-1 min-w-0">
        {showBand && hold.bandName && (
          <span className="bw-label-sm text-muted-foreground truncate">{hold.bandName}</span>
        )}
        <h3 className="bw-h3 [overflow-wrap:anywhere]">{t('Possible gig – keep the date free')}</h3>
      </div>

      <div className="flex flex-col gap-2 min-w-0">
        <span className="bw-h1 [overflow-wrap:anywhere]">{holdDay(hold.date)}</span>
        <span className="flex items-center gap-2 bw-body-md min-w-0">
          <Clock className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">{time || t('Time not set yet')}</span>
        </span>
        <span className="flex items-center gap-2 bw-body-md min-w-0">
          <MapPin className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">{place || t('Place not set yet')}</span>
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2" role="group" aria-label={t('Are you free?')}>
        <PillButton
          size="md"
          variant={answer === 'free' ? 'primary' : 'outline'}
          className="min-w-0 px-3 whitespace-normal leading-tight h-auto min-h-11 py-2"
          icon={answer === 'free' ? <Check className="w-4 h-4 shrink-0" /> : undefined}
          aria-pressed={answer === 'free'}
          loading={saving === 'free'}
          onClick={() => void answerWith('free')}
        >
          {t("I'm free")}
        </PillButton>
        <PillButton
          size="md"
          variant={answer === 'busy' ? 'dark' : 'outline'}
          className="min-w-0 px-3 whitespace-normal leading-tight h-auto min-h-11 py-2"
          icon={answer === 'busy' ? <X className="w-4 h-4 shrink-0" /> : undefined}
          aria-pressed={answer === 'busy'}
          loading={saving === 'busy'}
          onClick={() => void answerWith('busy')}
        >
          {t("I can't")}
        </PillButton>
      </div>

      <p className={cn('bw-body-sm text-muted-foreground', !answer && 'sr-only')} role="status">
        {answer === 'free'
          ? t("You said you're free. We'll tell you if it's confirmed.")
          : answer === 'busy'
            ? t("You said you can't. You can change it until it's confirmed.")
            : ''}
      </p>
    </section>
  );
};

/** Home: every date this account is asked to keep free. */
export const DateHoldList: React.FC<{
  holds: DateHold[];
  /** Holds from another band name it on the card. */
  activeBandId?: string | null;
  onShowToast?: (message: string, type: 'success' | 'error' | 'info') => void;
  onChanged?: () => void;
}> = ({ holds, activeBandId, onShowToast, onChanged }) => {
  const manyBands = new Set(holds.map((h) => h.bandId)).size > 1;
  return (
    <div className="flex flex-col gap-3">
      {holds.map((hold) => (
        <DateHoldCard
          key={hold.eventId}
          hold={hold}
          showBand={manyBands || (!!activeBandId && hold.bandId !== activeBandId)}
          onShowToast={onShowToast}
          onGone={onChanged}
        />
      ))}
    </div>
  );
};

/**
 * One hold in a sheet, over whatever is open: a hold notice or a hold in the
 * calendar opens it directly (also on the Duo Laptop pose, where Home sits
 * under the desk).
 */
export const DateHoldSheet: React.FC<{
  hold: DateHold | null;
  onClose: () => void;
  onShowToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}> = ({ hold, onClose, onShowToast }) => {
  const t = useT();
  return (
    <BwSheet open={!!hold} onClose={onClose} overline={hold?.bandName || undefined} title={t('Possible gig')} portal>
      {hold && <DateHoldCard hold={hold} onShowToast={onShowToast} onGone={onClose} />}
    </BwSheet>
  );
};
