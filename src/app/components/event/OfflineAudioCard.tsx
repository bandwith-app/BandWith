import React, { useEffect, useMemo, useRef } from 'react';
import { AlertTriangle, CheckCircle2, Download, RotateCw } from '@/app/components/icons';
import { PillButton } from '@/app/components/bw/Form';
import { cn } from '@/app/components/ui/utils';
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import type { AudioFailure } from '@/lib/regiaAudio';
import { audioReasonText } from './audioReason';
import { useAudioDownloads } from './useAudioDownloads';

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/**
 * "Audio on this device x/y" on a gig's setlist (admins: whoever can be the
 * stage manager). Download brings the songs' files onto this device ahead of
 * time, so Stage mode plays them at a venue with no internet; `auto` does it
 * by itself (the days before the gig, with internet).
 */
export const OfflineAudioCard: React.FC<{ songs: { title: string; audio?: string }[]; auto?: boolean; className?: string }> = ({
  songs,
  auto = false,
  className,
}) => {
  const t = useT();
  const refs = useMemo(() => [...new Set(songs.map((s) => s.audio).filter((a): a is string => !!a))], [songs]);
  const key = refs.join('|');
  const dl = useAudioDownloads(refs);
  const { check, prepare } = dl;
  const started = useRef(false);

  useEffect(() => {
    if (!refs.length) return;
    if (auto && isOnline()) {
      started.current = true;
      void prepare();
    } else void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, auto]);

  // Back online: try again the songs that failed for want of internet.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const back = () => {
      if (started.current && Object.values(dl.audioRef.current).some((a) => a.state === 'failed' && a.reason === 'offline')) void prepare();
    };
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  }, [prepare, dl.audioRef]);

  if (!refs.length) return null;

  const total = refs.length;
  const ready = refs.filter((r) => dl.cached.has(r)).length;
  const allReady = ready === total;
  const failed: { title: string; reason: AudioFailure }[] = [];
  for (const s of songs) {
    const a = s.audio ? dl.audio[s.audio] : undefined;
    if (a?.state === 'failed' && !dl.cached.has(s.audio!)) failed.push({ title: s.title, reason: a.reason });
  }
  const downloading = dl.downloading;
  const pct = downloading ? Math.round(downloading.progress * 100) : 0;

  const start = () => {
    haptic.tap();
    started.current = true;
    void prepare();
  };

  return (
    <div className={cn('bg-card rounded-[16px] p-4 flex flex-col gap-3', className)} aria-label={t('Audio for the stage manager')} role="group">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span className="flex items-start gap-3 flex-1 min-w-[200px]">
          {allReady ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-success mt-0.5" aria-hidden />
          ) : failed.length > 0 && !downloading ? (
            <AlertTriangle className="w-5 h-5 shrink-0 text-warning mt-0.5" aria-hidden />
          ) : (
            <Download className="w-5 h-5 shrink-0 text-muted-foreground mt-0.5" aria-hidden />
          )}
          <span className="flex flex-col gap-1 min-w-0">
            <span className="bw-body-md tabular-nums">{t('Audio on this device {ready}/{total}', { ready, total })}</span>
            <span className="bw-body-sm text-muted-foreground">
              {downloading
                ? t('Downloading {done}/{total} · {pct}%', { done: downloading.done, total: downloading.total, pct })
                : allReady
                  ? t('Ready: the stage manager plays it without internet.')
                  : t('Download it now: at the gig the stage manager plays it without internet.')}
            </span>
          </span>
        </span>
        {!allReady && !downloading && (
          <PillButton
            variant={failed.length ? 'outline' : 'dark'}
            size="sm"
            fullWidth={false}
            onClick={start}
            icon={failed.length ? <RotateCw className="w-4 h-4" /> : <Download className="w-4 h-4" />}
            className="shrink-0"
          >
            {failed.length ? t('Try again') : t('Download audio')}
          </PillButton>
        )}
      </div>
      {downloading && (
        <div
          role="progressbar"
          aria-label={t('Download progress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-1.5 rounded-full bg-foreground/[0.08] overflow-hidden"
        >
          <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}
      {failed.length > 0 && !downloading && (
        <ul className="flex flex-col gap-2 border-t border-border pt-3">
          {failed.map((f, i) => (
            <li key={`${f.title}-${i}`} className="flex flex-col gap-0.5">
              <span className="bw-body-sm">{f.title}</span>
              <span className="bw-label-xs normal-case tracking-normal text-muted-foreground">{audioReasonText(f.reason, t)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
