import React from 'react';
import {
  CodaSign,
  DoubleBarSign,
  FermataSign,
  FinalBarSign,
  RepeatBarSign,
  RepeatEndSign,
  RepeatStartSign,
  RepeatTwoBarsSign,
  SegnoSign,
  SlashSign,
  type IconComponent,
} from '@/app/components/icons';
import { chordLabel } from '@/lib/ireal';
import { LEGEND_SYMBOLS, chordTokenSymbol, musicSymbol, type MusicSymbolId } from '@/lib/musicSymbols';
import { useT } from '@/lib/i18n';
import { cn } from './utils';

/**
 * Draws one music symbol from the registry (src/lib/musicSymbols.ts): its
 * Dot icon, or its short text ("D.C. al Coda", "N.C."), always with the
 * translated accessible name. Every chord chart in the app draws its
 * markers through here.
 */

const ICONS: Partial<Record<MusicSymbolId, IconComponent>> = {
  'repeat-start': RepeatStartSign,
  'repeat-end': RepeatEndSign,
  'final-bar': FinalBarSign,
  'double-bar': DoubleBarSign,
  'repeat-bar': RepeatBarSign,
  'repeat-two-bars': RepeatTwoBarsSign,
  slash: SlashSign,
  segno: SegnoSign,
  coda: CodaSign,
  fermata: FermataSign,
};

/** Width / height of the tall bar-line icons (their viewBox). */
const ASPECT: Partial<Record<MusicSymbolId, number>> = {
  'repeat-start': 13 / 24,
  'repeat-end': 13 / 24,
  'final-bar': 11 / 24,
  'double-bar': 9 / 24,
  'repeat-two-bars': 30 / 24,
};

export interface MusicSymbolProps {
  id: MusicSymbolId;
  /** Ending number, repeat count. */
  n?: number;
  /** Section letter or name, time signature ("3/4"). */
  name?: string;
  /** A comment's own words. */
  text?: string;
  /** Height in em (icons). */
  size?: number;
  className?: string;
  /** Drawn beside its name (the legend): hidden from screen readers. */
  decorative?: boolean;
}

/** The symbol's accessible name, translated: "Ending 2", "Section A", "Play 3 times". */
export const useMusicSymbolName = () => {
  const t = useT();
  return React.useCallback(
    (id: MusicSymbolId, vars: { n?: number; name?: string } = {}) =>
      t(musicSymbol(id).name, { n: vars.n ?? 1, name: vars.name ?? '' }),
    [t],
  );
};

export const MusicSymbol: React.FC<MusicSymbolProps> = ({ id, n, name, text, size = 1, className, decorative }) => {
  const nameOf = useMusicSymbolName();
  const def = musicSymbol(id);
  if (def.render === 'hidden') return null;
  if (id === 'comment') return <span className={className}>{text}</span>;
  const label = nameOf(id, { n, name });
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': label };
  const Icon = ICONS[id];
  if (Icon) {
    const h = `${size}em`;
    return (
      <Icon
        {...a11y}
        data-symbol={id}
        width={`${size * (ASPECT[id] ?? 1)}em`}
        height={h}
        className={cn('inline-block shrink-0 align-middle', className)}
      />
    );
  }
  if (id === 'section') {
    return (
      <span {...a11y} data-symbol={id} className={cn('inline-flex items-center justify-center min-w-[1.5em] h-[1.5em] px-[0.3em] rounded-[0.3em] border-2 border-current font-bold leading-none', className)}>
        {name || 'A'}
      </span>
    );
  }
  if (id === 'time-signature') {
    const [top, bottom] = (name || '4/4').split('/');
    return (
      <span {...a11y} data-symbol={id} className={cn('inline-flex flex-col items-center justify-center font-bold leading-[0.95] text-[0.7em]', className)}>
        <span>{top}</span>
        <span>{bottom}</span>
      </span>
    );
  }
  if (id === 'ending') {
    return (
      <span {...a11y} data-symbol={id} className={cn('font-bold', className)}>
        {n ?? 1}.
      </span>
    );
  }
  // Text symbols, as players read them in any language.
  const shown = id === 'repeat-times' ? `${n ?? 2}×` : (def.text || '').replace(/\{n\}/g, String(n ?? 1));
  return (
    <span {...a11y} data-symbol={id} className={cn('italic font-semibold whitespace-nowrap', className)}>
      {shown}
    </span>
  );
};

/** A token from a bar or a lyric: a chord's readable label, or its symbol (%, N.C., slash). */
export const ChordToken: React.FC<{ token: string; size?: number; className?: string }> = ({ token, size = 0.9, className }) => {
  const sym = chordTokenSymbol(token);
  if (sym) return <MusicSymbol id={sym} size={size} className={className} />;
  return <span className={className}>{chordLabel(token)}</span>;
};

/** Every symbol a chart can show, with what it means: the chart's legend and the Academy's. */
export const SymbolLegend: React.FC<{ className?: string; muted?: string }> = ({ className, muted = 'text-muted-foreground' }) => {
  const nameOf = useMusicSymbolName();
  const t = useT();
  const sample: Partial<Record<MusicSymbolId, { n?: number; name?: string }>> = {
    section: { name: 'A' },
    'time-signature': { name: '3/4' },
    ending: { n: 1 },
    'repeat-times': { n: 3 },
  };
  return (
    <dl className={cn('grid grid-cols-[2.5em_minmax(0,1fr)] gap-x-3 gap-y-2 items-center', className)} aria-label={t('Symbols')}>
      {LEGEND_SYMBOLS.map((id) => (
        <React.Fragment key={id}>
          <dt className="flex justify-center text-[1.1em]">
            <MusicSymbol id={id} {...sample[id]} size={1.3} decorative />
          </dt>
          <dd className={cn('bw-body-sm', muted)}>{nameOf(id, sample[id])}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
};
