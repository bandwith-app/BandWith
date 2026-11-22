import React, { useEffect, useState } from 'react';
import { cn } from '@/app/components/ui/utils';
import { useT } from '@/lib/i18n';
import { useWaitingChanges } from '@/app/hooks/useLiveOutbox';
import { useOnline } from '@/app/components/event/useLivePack';
import { BwSheet } from '@/app/components/bw/Screen';
import { PillButton } from '@/app/components/bw/Form';
import { dismissLiveRefused, LIVE_OUTBOX_EVENT, readLiveRefused, type LiveRefused } from '@/lib/liveOutbox';

/** Changes the server refused or never took, kept on this phone (liveOutbox.ts). */
function useLiveRefused(userId?: string | null): LiveRefused[] {
  const [items, setItems] = useState(() => readLiveRefused(userId));
  useEffect(() => {
    const update = () => setItems(readLiveRefused(userId));
    update();
    window.addEventListener(LIVE_OUTBOX_EVENT, update);
    return () => window.removeEventListener(LIVE_OUTBOX_EVENT, update);
  }, [userId]);
  return items;
}

/** The words a refused change carried, to copy (none for a new order). */
function wordsOf(item: LiveRefused): string {
  const op = item.op;
  if (op.kind === 'note') return op.body;
  if (op.kind === 'suggestion') {
    const proposed = op.row.proposed as { note?: unknown } | undefined;
    const note = proposed?.note ?? op.row.note;
    return typeof note === 'string' ? note : '';
  }
  return '';
}

/**
 * "3 changes waiting for signal" (plan §3.5): notes, suggestions and the
 * leader's order made with no signal, kept on this phone until they are
 * sent. With full signal and the server busy for a moment: "waiting to
 * send". A change the server refused or never took is not lost: "1 change
 * wasn't saved" opens it, to copy its words and remove it. Nothing when
 * nothing waits. `stage`: white on the dark Stage header.
 */
export const WaitingChangesTag: React.FC<{ userId?: string | null; stage?: boolean; className?: string }> = ({
  userId,
  stage,
  className,
}) => {
  const t = useT();
  const n = useWaitingChanges(userId);
  const online = useOnline();
  const refused = useLiveRefused(userId);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!refused.length) setOpen(false);
  }, [refused.length]);
  if (n <= 0 && !refused.length) return null;

  const pill = cn(
    'self-start inline-flex items-center gap-1.5 min-h-6 max-w-full px-2.5 rounded-full border bw-label-xs whitespace-nowrap overflow-hidden text-ellipsis',
    stage ? 'border-white/40 text-white/80' : 'border-foreground/30 text-muted-foreground',
  );
  const waiting = online
    ? n === 1
      ? t('1 change waiting to send')
      : t('{n} changes waiting to send', { n })
    : n === 1
      ? t('1 change waiting for signal')
      : t('{n} changes waiting for signal', { n });

  return (
    <>
      {n > 0 && (
        <span
          role="status"
          title={online ? t('Saved on this phone, sent as soon as the server answers.') : t('Saved on this phone, sent when you’re back online.')}
          className={cn(pill, className)}
        >
          <span aria-hidden className={cn('w-1.5 h-1.5 rounded-full shrink-0', stage ? 'bg-white/60' : 'bg-foreground/50')} />
          <span className="truncate">{waiting}</span>
        </span>
      )}
      {refused.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(pill, 'relative border-destructive/70 after:absolute after:-inset-y-2.5 after:inset-x-0 after:content-[\'\']', stage ? 'text-white' : 'text-foreground', n > 0 ? '' : className)}
        >
          <span aria-hidden className="w-1.5 h-1.5 rounded-full shrink-0 bg-destructive" />
          <span className="truncate">
            {refused.length === 1 ? t('1 change wasn’t saved') : t('{n} changes weren’t saved', { n: refused.length })}
          </span>
        </button>
      )}
      <BwSheet open={open} onClose={() => setOpen(false)} overline={t('Offline & live')} title={t('Not saved')} closeLabel={t('Close')} zIndex={200}>
        <div className="flex flex-col gap-4">
          <p className="bw-body-sm text-sheet-foreground/80">{t('These changes couldn’t be saved. Copy what you need, then remove them.')}</p>
          {refused.map((item) => {
            const words = wordsOf(item);
            const what =
              item.op.kind === 'note' ? t('Your note') : item.op.kind === 'suggestion' ? t('Suggestion to the band') : t('New song order');
            return (
              <div key={item.key} className="flex flex-col gap-2 rounded-[16px] border border-sheet-foreground/20 p-4">
                <span className="bw-label-xs text-sheet-foreground/70">{what}</span>
                {words && <p className="bw-body [overflow-wrap:anywhere] whitespace-pre-wrap select-text">{words}</p>}
                <span className="bw-body-sm text-sheet-foreground/70">
                  {item.why === 'refused' ? t('The server didn’t accept it.') : t('The server didn’t answer for too long.')}
                </span>
                <div className="flex gap-2 pt-1">
                  {words && (
                    <PillButton
                      variant="outline"
                      size="sm"
                      fullWidth={false}
                      onClick={() => void navigator.clipboard?.writeText(words).catch(() => undefined)}
                    >
                      {t('Copy')}
                    </PillButton>
                  )}
                  <PillButton variant="ghost" size="sm" fullWidth={false} onClick={() => userId && dismissLiveRefused(userId, item.key)}>
                    {t('Remove')}
                  </PillButton>
                </div>
              </div>
            );
          })}
        </div>
      </BwSheet>
    </>
  );
};
