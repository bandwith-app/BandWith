import React from 'react';
import { Minus, Plus } from '@/app/components/icons';
import { Selector, Toggle } from '@/app/components/bw';
import { COMMON_TIMES, DEFAULT_TIME, meterOf, normalizeTime } from '@/lib/meter';
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
 * many bars the count-in lasts, where the song starts ("Starts on beat 4") and
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
  // Counted beats (6/8: two dotted ones), as the count-in counts them.
  const beatsOf = (ts: string) => meterOf(ts).beats.length;
  const beatsInBar = beatsOf(shown);
  const pickup = Math.min(value.pickupBeats, beatsInBar - 1);
  // The beat the band comes in on: 1 is bar 1; 4 in 4/4 is one beat early.
  const startBeat = pickup > 0 ? beatsInBar - pickup + 1 : 1;
  const step = 'h-9 w-9 rounded-full border border-border flex items-center justify-center disabled:opacity-40';
  const times = Array.from(new Set<string>([...COMMON_TIMES, shown]));
  // What the BPM counts, where it can differ (meter.ts): with no time
  // signature of its own a song keeps the old rule, every written note.
  const meter = meterOf(shown);
  const bpmCounts =
    meter.den <= 4
      ? null
      : !normalizeTime(value.timeSignature)
        ? meter.den === 8
          ? t('The BPM counts every eighth note.')
          : t('The BPM counts every sixteenth note.')
        : meter.compound
          ? t('The BPM counts the dotted beats.')
          : t('The BPM counts quarter notes.');

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
                // Tapping the picked one again goes back to following the chart; so
                // does the chart's own x/4 (same BPM either way). The chart's own
                // 6/8 is set: the BPM then counts the dotted beats.
                const next = (shown === ts && !!value.timeSignature) || (ts === implicit && meterOf(ts).den <= 4) ? '' : ts;
                // A shorter bar: the pickup is cut to fit it.
                set({ timeSignature: next, pickupBeats: Math.min(value.pickupBeats, beatsOf(next || implicit) - 1) });
              }}
            >
              {ts}
            </Selector>
          ))}
        </div>
        {fromChart && !value.timeSignature && <p className="bw-body-sm text-muted-foreground">{t('From the chord chart.')}</p>}
        {bpmCounts && <p className="bw-body-sm text-muted-foreground">{bpmCounts}</p>}
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
        <div className="flex items-center gap-3 pt-1" role="group" aria-label={t('Where the song starts')}>
          <button type="button" className={step} disabled={pickup >= beatsInBar - 1} onClick={() => set({ pickupBeats: pickup + 1 })} aria-label={t('One beat earlier')}>
            <Minus className="w-4 h-4" />
          </button>
          <span className="bw-body-sm flex-1" aria-live="polite">
            {t('Starts on beat {n}', { n: startBeat })}
          </span>
          <button type="button" className={step} disabled={pickup <= 0} onClick={() => set({ pickupBeats: pickup - 1 })} aria-label={t('One beat later')}>
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
