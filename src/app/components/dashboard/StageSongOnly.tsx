import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, LayoutTemplate } from '@/app/components/icons';
import { SongBody } from '@/app/components/ui/SongViews';
import { TransposeProvider } from '@/app/components/ui/Transpose';
import { useFoldPanes } from '@/lib/deviceRegions';
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import type { SongContent, SongView } from '@/lib/songFormat';
import { cn } from '@/app/components/ui/utils';
import { FollowArea, FollowStrip, type FollowTempo } from './StageFollow';

/**
 * Song only (11-20): the current song, clean and full screen, with no other
 * information but one small line naming it: the words, the words with their chords, or the chord chart
 * (the player's song view). At the bottom only Show everything, Prev, the
 * click and Next. Stage mode puts it over itself (a layer of its own,
 * portalled to <body>); the Laptop pose has its own (FloorWedgeMode).
 *
 * On a two-pane Duo (Book) the song and its controls take the wider pane, so
 * nothing runs across the fold. Page-turner pedals (← → / Page Up / Down)
 * step through the songs.
 */
export const StageSongOnly: React.FC<{
  title: string;
  /** 0-based position and length of the setlist, read out to screen readers. */
  index: number;
  count: number;
  song: SongContent;
  view: SongView;
  size: number;
  semitones: number;
  songKey: string | null;
  canPrev: boolean;
  canNext: boolean;
  onStep: (delta: number) => void;
  /** The click button (StageClickButton), between Prev and Next; absent without a synced click. */
  click?: React.ReactNode;
  /** The click's glow, drawn above the song. */
  clickFrame?: React.ReactNode;
  onShowAll: () => void;
  accent: string;
  /** Follow the tempo (StageFollow): the one line above the song and the lit bar / line. */
  follow?: FollowTempo;
}> = ({ title, index, count, song, view, size, semitones, songKey, canPrev, canNext, onStep, click, clickFrame, onShowAll, accent, follow }) => {
  const t = useT();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo?.({ top: 0 });
  }, [title, index]);

  // Pedals: the arrows to the side and Page Up / Down turn the song; Up / Down and Space still scroll.
  const step = useRef(onStep);
  step.current = onStep;
  const can = useRef({ canPrev, canNext });
  can.current = { canPrev, canNext };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        if (can.current.canNext) step.current(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        if (can.current.canPrev) step.current(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Two panes at a vertical fold: the wider one (the other side has the system column).
  const fold = useFoldPanes();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [pane, setPane] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!fold) {
      setPane(null);
      return;
    }
    const measure = () => {
      const el = rootRef.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const own = getComputedStyle(el);
      const left = box.left + (parseFloat(own.paddingLeft) || 0);
      const right = box.right - (parseFloat(own.paddingRight) || 0);
      const foldStart = fold.leading;
      const foldEnd = fold.leading + fold.fold;
      const leadingW = foldStart - left;
      const trailingW = right - foldEnd;
      const next = leadingW >= trailingW ? { left: 0, width: Math.round(leadingW) } : { left: Math.round(foldEnd - left), width: Math.round(trailingW) };
      setPane((prev) => (prev && prev.left === next.left && prev.width === next.width ? prev : next));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('bwlayout', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('bwlayout', measure);
    };
  }, [fold?.leading, fold?.fold, fold?.trailing]);

  const node = (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('Song only: {title}', { title })}
      className="bw-song-only fixed inset-0 z-[130] flex flex-col bg-black text-white select-none"
      style={{ paddingTop: 'calc(var(--safe-top) + 12px)', paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}
    >
      <div
        className={cn('flex flex-col flex-1 min-h-0 gap-3', !pane && 'w-full max-w-[900px] mx-auto')}
        style={pane ? { marginLeft: pane.left, width: pane.width } : undefined}
      >
        {/* Which song this is, in one small line: the song itself takes the rest. */}
        <p className="flex items-baseline gap-2 shrink-0 px-4 min-w-0" aria-live="polite">
          <span className="sr-only">{t('Song {index} of {count}', { index: index + 1, count })} · </span>
          <span aria-hidden className="bw-num text-[13px] font-medium shrink-0 text-white/50">
            {String(index + 1).padStart(2, '0')}/{String(count).padStart(2, '0')}
          </span>
          <span className="bw-label-md normal-case truncate min-w-0" style={{ color: accent }}>
            {title}
          </span>
        </p>
        {follow && <FollowStrip follow={follow} accent={accent} className="px-4" />}
        <div ref={bodyRef} data-song-only-body className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4">
          <TransposeProvider semitones={semitones} songKey={songKey}>
            <FollowSlot follow={follow} accent={accent}>
            <SongBody
              song={song}
              view={view}
              size={size}
              muted="text-white/60"
              line="border-white/25"
              className="w-full flex flex-col gap-6 pt-1 pb-4 text-white"
              chartClassName="w-full flex flex-col gap-5 pt-1 pb-4 text-white"
              showLegend={false}
            />
            </FollowSlot>
          </TransposeProvider>
        </div>
        <div className={cn('grid gap-3 shrink-0 px-4', click ? 'grid-cols-[auto_1fr_auto_1fr]' : 'grid-cols-[auto_1fr_1fr]')}>
          <button
            type="button"
            onClick={() => {
              haptic.tap();
              onShowAll();
            }}
            aria-label={t('Show everything')}
            title={t('Show everything')}
            className="w-14 min-h-14 flex items-center justify-center rounded-[20px] border border-white/40 text-white [&_svg]:w-6 [&_svg]:h-6"
          >
            <LayoutTemplate aria-hidden />
          </button>
          <button
            type="button"
            disabled={!canPrev}
            onClick={() => {
              haptic.tap();
              onStep(-1);
            }}
            aria-label={t('Previous song')}
            className="flex items-center justify-center gap-2 min-h-14 min-w-0 rounded-[20px] bg-white/10 text-white bw-button-sm disabled:opacity-40"
          >
            <ChevronLeft className="w-6 h-6 shrink-0" /> <span className="truncate">{t('Prev')}</span>
          </button>
          {click}
          <button
            type="button"
            disabled={!canNext}
            onClick={() => {
              haptic.tap();
              onStep(1);
            }}
            aria-label={t('Next song')}
            className="flex items-center justify-center gap-2 min-h-14 min-w-0 rounded-[20px] text-black bw-button-sm disabled:opacity-40"
            style={{ backgroundColor: accent }}
          >
            <span className="truncate">{t('Next')}</span> <ChevronRight className="w-6 h-6 shrink-0" />
          </button>
        </div>
      </div>
      {clickFrame}
    </div>
  );
  return typeof document === 'undefined' ? node : createPortal(node, document.body);
};

/** The song inside FollowArea when Follow the tempo is there. */
const FollowSlot: React.FC<{ follow?: FollowTempo; accent: string; children: React.ReactNode }> = ({ follow, accent, children }) =>
  follow ? (
    <FollowArea follow={follow} accent={accent}>
      {children}
    </FollowArea>
  ) : (
    <>{children}</>
  );
