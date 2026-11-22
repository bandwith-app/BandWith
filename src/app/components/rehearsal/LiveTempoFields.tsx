import React from 'react';
import { Minus, Plus } from '@/app/components/icons';
import { Selector, Toggle } from '@/app/components/bw';
import { COMMON_TIMES, DEFAULT_TIME, normalizeTime } from '@/lib/meter';
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/i18n';

export interface LiveTempoValues {
  /** "" = the chart's time signature, else 4/4 (shown as the pick). */
  timeSignature: string;
  countInBars: number;
  pickupBeats: number;
  backingTrack: boolean;
}

export const LIVE_TEMPO_DEFAULTS: LiveTempoValues = { timeSignature: '', countInBars: 1, pickupBeats: 0, backingTrack: false };

/**
 * Song form, next to BPM (live mode, migration 171): time signature, how
 * many bars the count-in lasts, a pickup ("starts N beats early") and
 * "Played with a backing track" (no count-in for that song).
 */
export const LiveTempoFields: React.FC<{
  value: LiveTempoValues;
  onChange: (v: LiveTempoValues) => void;
  /** The chord chart's time signature, used when none is picked. */
  chartTime?: string | null;
}> = ({ value, onChange, chartTime }) => {
  const t = useT();
  const set = (patch: Partial<LiveTempoValues>) => onChange({ ...value, ...patch });
  const fromChart = normalizeTime(chartTime);
  // Nothing picked: the chart's, else 4/4 (what live mode uses).
  const implicit = fromChart ?? DEFAULT_TIME;
  const shown = normalizeTime(value.timeSignature) ?? implicit;
  const beatsInBar = Number(shown.split('/')[0]) || 4;
  const step = 'h-9 w-9 rounded-full border border-border flex items-center justify-center disabled:opacity-40';
  const times = Array.from(new Set<string>([...COMMON_TIMES, shown]));

  return (
    <div className="flex flex-col gap-4 pt-1">
      <fieldset className="flex flex-col gap-2">
        <legend className="bw-label-sm text-muted-foreground mb-2">{t('Time signature')}</legend>
        <div className="flex flex-wrap gap-2">
          {times.map((ts) => (
            <Selector
              key={ts}
              size="md"
              selected={shown === ts}
              ariaLabel={t('Time signature {time}', { time: ts })}
              onClick={() => {
                haptic.selection();
                // Picking the chart's own again goes back to following the chart.
                set({ timeSignature: (shown === ts && !!value.timeSignature) || ts === implicit ? '' : ts });
              }}
            >
              {ts}
            </Selector>
          ))}
        </div>
        {fromChart && !value.timeSignature && <p className="bw-body-sm text-muted-foreground">{t('From the chord chart.')}</p>}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="bw-label-sm text-muted-foreground mb-2">{t('Count-in')}</legend>
        <div className="flex flex-wrap gap-2">
          {[1, 2].map((n) => (
            <Selector key={n} size="md" selected={value.countInBars === n} onClick={() => set({ countInBars: n })}>
              {n === 1 ? t('1 bar') : t('2 bars')}
            </Selector>
          ))}
        </div>
        {value.countInBars === 2 && <p className="bw-body-sm text-muted-foreground">{t('For slow songs: the first bar counts in half time.')}</p>}
        <div className="flex items-center gap-3 pt-1" role="group" aria-label={t('Pickup')}>
          <button type="button" className={step} disabled={value.pickupBeats <= 0} onClick={() => set({ pickupBeats: value.pickupBeats - 1 })} aria-label={t('One beat less')}>
            <Minus className="w-4 h-4" />
          </button>
          <span className="bw-body-sm flex-1" aria-live="polite">
            {value.pickupBeats > 0 ? t('Starts {n} beats early', { n: value.pickupBeats }) : t('Starts on the downbeat')}
          </span>
          <button type="button" className={step} disabled={value.pickupBeats >= beatsInBar - 1} onClick={() => set({ pickupBeats: value.pickupBeats + 1 })} aria-label={t('One beat more')}>
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </fieldset>

      <label className="flex items-start gap-3 cursor-pointer">
        <span className="flex-1 flex flex-col gap-0.5">
          <span className="bw-body-md">{t('Played with a backing track')}</span>
          <span className="bw-body-sm text-muted-foreground">{t('No count-in on stage: the track starts the band.')}</span>
        </span>
        <Toggle checked={value.backingTrack} onCheckedChange={(on) => set({ backingTrack: on })} aria-label={t('Played with a backing track')} />
      </label>
    </div>
  );
};
