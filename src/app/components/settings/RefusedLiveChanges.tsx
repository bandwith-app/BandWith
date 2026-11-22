import React, { useEffect, useState } from 'react';
import { cn } from '@/app/components/ui/utils';
import { useT } from '@/lib/i18n';
import { LIVE_REFUSED_EVENT, readRefusedLiveOps, removeRefusedLiveOp, type LiveOp } from '@/lib/liveOutbox';

type T = ReturnType<typeof useT>;

/** What the person wrote or did, in words they can copy. */
export function refusedText(op: LiveOp, t: T): string {
  switch (op.kind) {
    case 'note':
      return op.body;
    case 'noteDelete':
      return t('Deleting one of my notes');
    case 'suggestion': {
      const proposed = (op.row.proposed ?? {}) as { note?: unknown; lyrics?: unknown };
      const text = [proposed.note, proposed.lyrics, op.row.message].find((x) => typeof x === 'string' && x.trim());
      return typeof text === 'string' ? text : t('A suggestion to the band');
    }
    case 'order':
      return t('A new setlist order');
  }
}

/**
 * Changes made on this phone that the server refused for this account (the
 * note was gone, no longer allowed, the setlist changed meanwhile): kept on
 * the phone, never deleted unseen. Copy what you need, then remove them.
 * Settings › Offline & live.
 */
export const RefusedLiveChanges: React.FC<{ userId?: string | null }> = ({ userId }) => {
  const t = useT();
  const [ops, setOps] = useState<LiveOp[]>(() => readRefusedLiveOps(userId));
  const [copied, setCopied] = useState<number | null>(null);
  /** The clipboard refused (none in this browser, or blocked): said, the text stays selectable. */
  const [copyFailed, setCopyFailed] = useState<number | null>(null);

  useEffect(() => {
    const sync = () => setOps(readRefusedLiveOps(userId));
    sync();
    window.addEventListener(LIVE_REFUSED_EVENT, sync);
    return () => window.removeEventListener(LIVE_REFUSED_EVENT, sync);
  }, [userId]);

  if (!userId || !ops.length) return null;

  const copy = async (i: number, text: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      setCopyFailed(null);
      setCopied(i);
    } catch {
      setCopied(null);
      setCopyFailed(i);
    }
  };
  const remove = (i: number) => {
    setCopied(null);
    setCopyFailed(null);
    removeRefusedLiveOp(userId, i);
  };
  const pill = 'flex items-center min-h-11 px-3 rounded-full bw-label-sm whitespace-nowrap border border-border text-foreground';

  return (
    <section aria-label={t('Not sent')} className="bg-card text-card-foreground rounded-[24px] p-4 flex flex-col gap-2 min-w-0">
      {/* Static text: read once as a status, not an alert. */}
      <span className="bw-label-sm" role="status">
        {t("These changes weren't sent: the band didn't accept them. Copy what you need, then remove them.")}
      </span>
      <ul className="flex flex-col">
        {ops.map((op, i) => {
          const text = refusedText(op, t);
          const short = text.length > 60 ? `${text.slice(0, 59)}…` : text;
          return (
            <li key={`${i}:${op.kind}`} className={cn('flex flex-col gap-2 py-2 border-b border-border last:border-b-0 min-w-0')}>
              <span className="bw-body-sm whitespace-pre-wrap break-words select-text">{text}</span>
              <span className="flex flex-wrap gap-2">
                <button type="button" className={pill} aria-label={t('Copy change: {change}', { change: short })} onClick={() => void copy(i, text)}>
                  {copied === i ? t('Copied') : t('Copy')}
                </button>
                <button type="button" className={pill} aria-label={t('Remove change: {change}', { change: short })} onClick={() => remove(i)}>
                  {t('Remove')}
                </button>
              </span>
              <span className="bw-body-sm text-destructive" aria-live="polite">
                {copyFailed === i ? t('Couldn’t copy this change. Select the text and copy it yourself.') : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
