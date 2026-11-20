import React from 'react';
import { chordLabel, keyLabel, type ChartBar, type SongChart } from '@/lib/ireal';
import { chordTokenSymbol, textSymbols } from '@/lib/musicSymbols';
import { MusicSymbol, SymbolLegend } from './MusicSymbol';
import { ChevronDown } from '@/app/components/icons';
import { cn } from '@/app/components/ui/utils';
import { useT } from '@/lib/i18n';
import { transposeChart } from '@/lib/transpose';
import { useTranspose } from './Transpose';

/** Where a chart came from, shown under it: "Source: iReal Pro forum" or the file's name. */
export const chartSource = (chart: SongChart, tr: (s: string, v?: Record<string, string | number>) => string) =>
  chart.source === 'musicxml'
    ? tr('Source: {file}', { file: chart.file || tr('MusicXML file') })
    : tr('Source: iReal Pro forum');

/** "Eb · Medium Swing · 120 BPM · 4/4" */
export const chartSummary = (chart: SongChart) =>
  [keyLabel(chart.key), chart.style, chart.bpm ? `${chart.bpm} BPM` : null, chart.time].filter(Boolean).join(' · ');

/**
 * Chords shrink to fit their bar (a quarter of the row, `cqw` of the grid;
 * half for the two-bar repeat), so long ones (A♭m(maj7)/G) and narrow
 * screens (closed Duo) never cut them. About 0.62em per character; the bar's
 * padding and its signs (repeat, time signature) take the rest.
 */
const chordFontSize = (label: string, bar: ChartBar) => {
  const reserved =
    1 + 0.65 * (Number(!!bar.repeatStart) + Number(!!(bar.repeatEnd || bar.final || bar.doubleEnd))) + (bar.time ? 0.6 : 0);
  const width = 25 * (bar.span || 1);
  return `clamp(0.5em, calc((${width}cqw - ${reserved}em) / ${(Math.max(label.length, 2) * 0.62).toFixed(2)}), 1em)`;
};

/** The bar line that closes a bar: repeat, final, double, or none (the next bar's line). */
const closingSign = (bar: ChartBar) =>
  bar.repeatEnd ? ('repeat-end' as const) : bar.final ? ('final-bar' as const) : bar.doubleEnd ? ('double-bar' as const) : null;

/**
 * One bar. Every marker is a symbol from the registry (src/lib/musicSymbols.ts)
 * drawn by MusicSymbol: bar lines, repeats, endings, segno / coda, fermata,
 * time signature, the road map written on it ("D.C. al Coda", "3×", "Fine").
 */
const Bar: React.FC<{ bar: ChartBar; muted: string; line: string }> = ({ bar, muted, line }) => {
  const closing = closingSign(bar);
  const marks = textSymbols(bar.text);
  const top = !!(bar.ending || bar.segno || bar.coda || bar.fermata);
  return (
    <div
      data-bar
      className={cn(
        'relative min-w-0 overflow-hidden min-h-[2.4em] flex items-center gap-[0.3em] pl-[0.4em] pr-[0.25em] pt-[0.8em] pb-[0.35em]',
        !bar.repeatStart && cn('border-l', line),
        bar.repeatStart && 'pl-0',
        // Room above the chords for the signs over the bar (segno, coda, fermata, ending).
        top && 'pt-[1.15em]',
        closing && 'pr-0',
      )}
      style={bar.span && bar.span > 1 ? { gridColumn: `span ${bar.span}` } : undefined}
    >
      {bar.ending && (
        // Volta bracket over the ending's bar.
        <span aria-hidden className="absolute top-[0.1em] left-0 right-[0.3em] h-[0.9em] border-t-2 border-l-2 border-current opacity-70" />
      )}
      {top && (
        <span className={cn('absolute left-[0.45em] top-[0.12em] flex items-center gap-[0.3em] text-[0.62em] leading-none', muted)}>
          {bar.ending && <MusicSymbol id="ending" n={bar.ending} className="pl-[0.2em]" />}
          {bar.segno && <MusicSymbol id="segno" size={1.45} />}
          {bar.coda && <MusicSymbol id="coda" size={1.45} />}
          {bar.fermata && <MusicSymbol id="fermata" size={1.45} />}
        </span>
      )}
      {bar.repeatStart && <MusicSymbol id="repeat-start" size={1.7} className="-ml-[0.05em]" />}
      {bar.time && <MusicSymbol id="time-signature" name={bar.time} className="text-[0.75em]" />}
      <span className={cn('flex-1 min-w-0 flex flex-wrap items-center gap-x-[0.5em]', bar.chords.length > 1 && 'justify-between')}>
        {bar.chords.map((c, i) => {
          const sym = chordTokenSymbol(c);
          if (sym) {
            return (
              <span key={i} className={cn('font-semibold whitespace-nowrap flex-1 flex', muted, bar.chords.length === 1 && 'justify-center')}>
                <MusicSymbol id={sym} size={sym === 'slash' ? 0.9 : 1.1} />
              </span>
            );
          }
          const label = chordLabel(c);
          return (
            <span key={i} className="font-semibold whitespace-nowrap" style={{ fontSize: chordFontSize(label, bar) }}>
              {label}
            </span>
          );
        })}
        {bar.end && <MusicSymbol id="end" className={cn('text-[0.5em]', muted)} />}
      </span>
      {closing && <MusicSymbol id={closing} size={1.7} />}
      {marks.length > 0 && (
        <span className={cn('absolute right-[0.3em] bottom-[-0.1em] flex items-center gap-[0.4em] text-[0.48em] leading-none max-w-full truncate', muted)}>
          {marks.map((m, i) => (
            <MusicSymbol key={i} id={m.id} n={m.n} text={m.text} className={m.id === 'comment' ? 'italic truncate' : undefined} />
          ))}
        </span>
      )}
    </div>
  );
};

/**
 * Chord chart imported from iReal Pro: sections with four bars per row
 * (chords, repeats, endings, segno/coda). `size` is the chord size in px,
 * shared with the lyrics A−/A+ setting; `muted` styles labels on dark stages.
 */
export const ChordChartView: React.FC<{
  chart: SongChart;
  size: number;
  muted?: string;
  /** Bar line colour (Stage mode is always dark). */
  line?: string;
  className?: string;
  showSummary?: boolean;
  /** "What the symbols mean" under the chart (the symbol legend). */
  showLegend?: boolean;
}> = ({ chart: original, size, muted = 'text-muted-foreground', line = 'border-border', className, showSummary = true, showLegend = true }) => {
  const tr = useT();
  // Transposed for this reader (TransposeProvider), otherwise as saved.
  const { semitones } = useTranspose();
  const chart = React.useMemo(() => transposeChart(original, semitones), [original, semitones]);
  const summary = chartSummary(chart);
  return (
    <div className={className ?? 'max-w-3xl mx-auto w-full flex flex-col gap-6 pt-4'} style={{ fontSize: size, lineHeight: 1.2 }}>
      {showSummary && summary && <p className={cn('bw-label-sm normal-case', muted)}>{summary}</p>}
      {chart.sections.map((s, i) => (
        <section key={i} className="flex flex-col gap-2" aria-label={s.label ? tr('Section {name}', { name: s.label }) : undefined}>
          {s.label && (
            <h3 className={cn('bw-label-md uppercase flex items-center gap-2', muted)}>
              {/* A one-letter iReal mark is a rehearsal letter in a box; a name stays a heading. */}
              {s.label.length <= 2 ? <MusicSymbol id="section" name={s.label} /> : s.label}
            </h3>
          )}
          <div data-chart-grid className="grid grid-cols-4 gap-y-[0.5em]" style={{ containerType: 'inline-size' }}>
            {s.bars.map((b, j) => (
              <Bar key={j} bar={b} muted={muted} line={line} />
            ))}
          </div>
        </section>
      ))}
      <p className={cn('bw-body-sm', muted)}>{chartSource(chart, tr)}</p>
      {showLegend && (
        <details className={cn('group bw-body-sm', muted)}>
          <summary className="cursor-pointer min-h-11 inline-flex items-center gap-1.5 bw-label-sm normal-case list-none [&::-webkit-details-marker]:hidden">
            {tr('What the symbols mean')}
            <ChevronDown aria-hidden size={16} className="transition-transform group-open:rotate-180" />
          </summary>
          <SymbolLegend className="pt-2 text-[16px]" muted={muted} />
        </details>
      )}
    </div>
  );
};
