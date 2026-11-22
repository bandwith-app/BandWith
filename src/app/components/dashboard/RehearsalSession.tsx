import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Pause, Play } from '@/app/components/icons';
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { cn } from '@/app/components/ui/utils';
import { durations, easings } from '@/styles/motion';
import {
  buildSummary,
  elapsedSeconds,
  formatClock,
  spanParts,
  type SessionState,
  type SessionStatus,
  type SessionSummary,
} from '@/lib/rehearsalSession';
import type { RehearsalSessionControls } from '@/app/components/event/useRehearsalSession';

const MONO: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

/** Seconds rehearsed, ticking once a second while the session runs. */
export function useSessionSeconds(state: SessionState | null, status: SessionStatus): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (status !== 'live') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status, state]);
  return state ? elapsedSeconds(state, now) : 0;
}

/** "1 h 52 min", "45 min". */
export const formatSpan = (sec: number, t: ReturnType<typeof useT>) => {
  const { h, m } = spanParts(sec);
  return h > 0 ? t('{h} h {m} min', { h, m }) : t('{m} min', { m });
};

const statusLabel = (status: SessionStatus, t: ReturnType<typeof useT>) =>
  status === 'live' ? t('Rehearsing') : status === 'paused' ? t('Paused') : status === 'ended' ? t('Ended') : t('Not started');

/**
 * Live mode on a rehearsal: the session timer (plan A1b). The admin starts,
 * pauses and ends it; members see the same clock. Ending shows the summary.
 */
export const RehearsalSessionBar: React.FC<{
  session: RehearsalSessionControls;
  accentColor: string;
  onShowSummary: () => void;
  className?: string;
}> = ({ session, accentColor, onShowSummary, className }) => {
  const t = useT();
  const { status, state, canControl } = session;
  const seconds = useSessionSeconds(state, status);
  const [confirmEnd, setConfirmEnd] = useState(false);
  useEffect(() => {
    if (status !== 'live' && status !== 'paused') setConfirmEnd(false);
  }, [status]);

  // Members see nothing until the admin starts it.
  if (status === 'idle' && !canControl) return null;

  const pill = 'flex items-center justify-center gap-2 min-h-11 px-4 rounded-full bw-label-sm whitespace-nowrap';
  const tap = (fn: () => void) => () => {
    haptic.tap();
    fn();
  };

  return (
    <section aria-label={t('Rehearsal timer')} className={cn('flex flex-col gap-1 shrink-0', className)}>
      {status === 'idle' ? (
        <button
          type="button"
          onClick={tap(session.start)}
          // Not before the saved session has been read: it may already exist (audit 06 #4).
          disabled={!session.ready}
          aria-busy={!session.ready}
          className={cn(pill, 'w-full min-h-12 text-black disabled:opacity-60')}
          style={{ backgroundColor: accentColor }}
        >
          {/* Disabled until the saved rehearsal is read (Claude r8 B1): says why, seen and announced. */}
          <Play className="w-5 h-5" aria-hidden /> {session.ready ? t('Start rehearsal') : t('Loading the rehearsal…')}
        </button>
      ) : (
        <div className="flex items-center gap-3 min-w-0 min-h-12">
          <span className="flex flex-col min-w-0">
            <span
              role="timer"
              aria-label={t('Rehearsed {time}', { time: formatClock(seconds) })}
              className="bw-num text-[28px] leading-none font-medium"
              style={{ ...MONO, color: status === 'live' ? accentColor : 'rgba(255,255,255,0.7)' }}
            >
              {formatClock(seconds)}
            </span>
            <span className="bw-label-xs text-white/70 truncate" role="status">
              {statusLabel(status, t)}
              {session.unsaved && canControl ? ` · ${t('Saved when back online')}` : ''}
            </span>
            {/* A Start here met a rehearsal that had already ended (Claude r8 B1b). Always there,
                only its text changes, so screen readers announce it (#296 round 10). */}
            <span className="bw-label-xs text-white" role="status" aria-live="polite" data-bw-ended-notice="">
              {status === 'ended' && session.alreadyEnded
                ? t('This rehearsal had already ended. Any songs you played were added to it.')
                : ''}
            </span>
          </span>
          <span className="flex items-center gap-2 ml-auto shrink-0">
            {canControl && confirmEnd ? (
              <>
                <span className="bw-label-xs text-white">{t('End rehearsal?')}</span>
                <button type="button" onClick={tap(() => setConfirmEnd(false))} className={cn(pill, 'border border-white/40 text-white')}>
                  {t('Keep going')}
                </button>
                <button
                  type="button"
                  onClick={tap(() => {
                    setConfirmEnd(false);
                    session.end();
                  })}
                  className={cn(pill, 'bg-white text-black')}
                >
                  {t('End now')}
                </button>
              </>
            ) : canControl && (status === 'live' || status === 'paused') ? (
              <>
                <button
                  type="button"
                  onClick={tap(status === 'live' ? session.pause : session.resume)}
                  className={cn(pill, 'border border-white/40 text-white')}
                >
                  {status === 'live' ? <Pause className="w-4 h-4" aria-hidden /> : <Play className="w-4 h-4" aria-hidden />}
                  {status === 'live' ? t('Pause') : t('Resume')}
                </button>
                <button type="button" onClick={tap(() => setConfirmEnd(true))} className={cn(pill, 'border border-white text-white')}>
                  {t('End', { context: 'session' })}
                </button>
              </>
            ) : status === 'ended' ? (
              <button type="button" onClick={tap(onShowSummary)} className={cn(pill, 'border border-white/40 text-white')}>
                {t('Summary')}
              </button>
            ) : null}
          </span>
        </div>
      )}
    </section>
  );
};

/** The songs played and how long, from a session (live) or what was saved. */
export const summaryOf = (state: SessionState | null, total: number): SessionSummary | null =>
  state ? buildSummary(state, total, Date.now()) : null;

/**
 * End of the rehearsal: how long the band rehearsed (pauses left out) and the
 * songs played. Saved with the session; the rehearsal's page shows it too.
 */
export const RehearsalSummaryDialog: React.FC<{
  summary: SessionSummary;
  accentColor: string;
  /** The admin can go on rehearsing (the gap counts as a pause). */
  onResume?: () => void;
  onClose: () => void;
  /** Marks still to write (plan A2): a button opens the notes. */
  marks?: number;
  onWriteMarks?: () => void;
}> = ({ summary, accentColor, onResume, onClose, marks = 0, onWriteMarks }) => {
  const t = useT();
  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={t('Rehearsal summary')}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: durations.normal, ease: easings.standard }}
      className="absolute inset-0 z-10 flex flex-col bg-black text-white"
      style={{ paddingTop: 'calc(var(--safe-top) + 12px)', paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}
    >
      <div className="flex flex-col flex-1 min-h-0 w-full max-w-[640px] mx-auto px-4 gap-6">
        <div className="flex flex-col gap-2 shrink-0 bw-status-clear-shift">
          <span className="flex items-center gap-2 bw-label-sm text-white">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: accentColor }} />
            {t('Rehearsal summary')}
          </span>
          <span className="bw-display-lg" style={{ color: accentColor }}>
            {formatSpan(summary.durationS, t)}
          </span>
          <span className="bw-label-md text-white/80">
            {t('{played} of {total} songs played', { played: summary.played.length, total: summary.total })}
          </span>
        </div>
        <ol aria-label={t('Songs played')} className="flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-4 px-4">
          {summary.played.length === 0 ? (
            <li className="bw-body-md text-white/70">{t('No songs played in live mode.')}</li>
          ) : (
            summary.played.map((song, i) => (
              <li key={song.id} className="flex items-center gap-3 min-h-11 border-b border-white/15 last:border-b-0">
                <span className="bw-num text-[16px] font-medium w-7 shrink-0 text-white/50" style={MONO}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="flex-1 min-w-0 bw-h2 normal-case leading-[1.15] truncate">{song.title}</span>
              </li>
            ))
          )}
        </ol>
        {onWriteMarks && marks > 0 && (
          <button
            type="button"
            onClick={() => {
              haptic.tap();
              onWriteMarks();
            }}
            className="min-h-14 rounded-[20px] border border-white text-white bw-button-sm shrink-0"
          >
            {t('Marks to write: {count}', { count: marks })}
          </button>
        )}
        <div className={cn('grid gap-3 shrink-0', onResume ? 'grid-cols-2' : 'grid-cols-1')}>
          {onResume && (
            <button
              type="button"
              onClick={() => {
                haptic.tap();
                onResume();
              }}
              className="min-h-14 rounded-[20px] bg-white/10 text-white bw-button-sm"
            >
              {t('Resume rehearsal')}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              haptic.tap();
              onClose();
            }}
            className="min-h-14 rounded-[20px] text-black bw-button-sm"
            style={{ backgroundColor: accentColor }}
          >
            {t('Done')}
          </button>
        </div>
      </div>
    </motion.div>
  );
};

/** The rehearsal's page: the saved session, once there is one. */
export const RehearsalSessionCard: React.FC<{ state: SessionState; status: SessionStatus; total: number }> = ({ state, status, total }) => {
  const t = useT();
  const seconds = useSessionSeconds(state, status);
  const summary = buildSummary(state, total, Date.now());
  return (
    <div className="bg-card rounded-[16px] p-4 flex flex-col gap-2" role="group" aria-label={t('Rehearsal session')}>
      <span className="flex items-baseline justify-between gap-3">
        <span className="bw-h2 normal-case">{formatSpan(seconds, t)}</span>
        <span className="bw-label-sm text-muted-foreground">{statusLabel(status, t)}</span>
      </span>
      <span className="bw-body-sm text-muted-foreground">
        {t('{played} of {total} songs played', { played: summary.played.length, total: summary.total })}
        {summary.played.length > 0 ? ` · ${summary.played.map((s) => s.title).join(', ')}` : ''}
      </span>
    </div>
  );
};
