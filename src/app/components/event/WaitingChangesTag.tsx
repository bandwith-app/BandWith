import React from 'react';
import { cn } from '@/app/components/ui/utils';
import { useT } from '@/lib/i18n';
import { useWaitingChanges } from '@/app/hooks/useLiveOutbox';

/**
 * "3 changes waiting for signal" (plan §3.5): notes, suggestions and the
 * leader's order made with no signal, kept on this phone until they are
 * sent. Nothing when nothing waits. `stage`: white on the dark Stage header.
 */
export const WaitingChangesTag: React.FC<{ userId?: string | null; stage?: boolean; className?: string }> = ({
  userId,
  stage,
  className,
}) => {
  const t = useT();
  const n = useWaitingChanges(userId);
  if (n <= 0) return null;
  return (
    <span
      role="status"
      title={t('Saved on this phone, sent when you’re back online.')}
      className={cn(
        'self-start inline-flex items-center gap-1.5 min-h-6 max-w-full px-2.5 rounded-full border bw-label-xs whitespace-nowrap overflow-hidden text-ellipsis',
        stage ? 'border-white/40 text-white/80' : 'border-foreground/30 text-muted-foreground',
        className,
      )}
    >
      <span aria-hidden className={cn('w-1.5 h-1.5 rounded-full shrink-0', stage ? 'bg-white/60' : 'bg-foreground/50')} />
      <span className="truncate">{n === 1 ? t('1 change waiting for signal') : t('{n} changes waiting for signal', { n })}</span>
    </span>
  );
};
