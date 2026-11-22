import React from 'react';
import { Capacitor } from '@capacitor/core';
import { useT } from '@/lib/i18n';
import { cn } from '@/app/components/ui/utils';
import { stageBleNotice, type StageBleStatus } from '@/lib/stageBleNotice';

interface Props {
  status?: StageBleStatus;
  /** The live channel (internet) is connected. */
  online: boolean;
  isLeader: boolean;
  followers?: number;
  /** Allow Bluetooth / turn it on (useStageBle().fix). */
  onFix?: () => void | Promise<void>;
  accentColor?: string;
  className?: string;
}

/**
 * Stage mode's one line about the offline link to the leader, in plain words,
 * with at most one button. Nothing at all while the internet works (except a
 * missing Bluetooth permission, worth granting before the internet drops).
 */
export const StageBleNoticeLine: React.FC<Props> = ({ status, online, isLeader, followers, onFix, accentColor, className }) => {
  const t = useT();
  const platform = Capacitor.getPlatform();
  const notice = stageBleNotice({ status: status ?? 'off', online, isLeader, followers: followers ?? 0, platform });
  if (!notice) return null;
  const label = notice.action === 'turn-on' ? t('Turn on') : platform === 'ios' ? t('Open Settings') : t('Allow');
  return (
    <div className={cn('flex items-center gap-3 min-w-0', className)} role="status" data-testid="stage-ble-notice">
      <span
        aria-hidden
        className={cn('w-2 h-2 rounded-full shrink-0', notice.tone === 'ok' ? '' : 'border border-white/70')}
        style={notice.tone === 'ok' ? { backgroundColor: accentColor ?? 'var(--accent-gig, #D5FB46)' } : undefined}
      />
      <span className="flex-1 min-w-0 bw-body-sm text-white/80">{notice.text}</span>
      {notice.action && onFix && (
        <button
          type="button"
          onClick={() => void onFix()}
          className="shrink-0 min-h-11 px-4 rounded-full border border-white/40 text-white bw-label-xs whitespace-nowrap"
        >
          {label}
        </button>
      )}
    </div>
  );
};
