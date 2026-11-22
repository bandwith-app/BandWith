import React, { useEffect, useMemo, useState } from 'react';
import { Bell, ChevronDown, Wifi } from '@/app/components/icons';
import { PillButton } from '@/app/components/bw/Form';
import { cn } from '@/app/components/ui/utils';
import { AcademyHelpButton } from '@/app/components/academy/AcademyHelpButton';
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { LIVE_PACK_CHANGED } from '@/lib/livePackStore';
import { fetchEventPackStatus, remindPackDownload, type MemberPackStatus } from '@/lib/livePackStatus';
import type { ResolvedMember } from './parts';

/** Who counts: the lineup with an account, minus those who declined. */
export function offlineCounts(members: ResolvedMember[], status: MemberPackStatus[], self?: { userId?: string; ready?: boolean }) {
  const lineup = members.filter((m) => !!m.userId && m.status !== 'declined');
  const ready = new Set(status.map((s) => s.userId));
  // The viewer's own phone may not have reported yet (web, first save): this device knows.
  if (self?.userId && self.ready) ready.add(self.userId);
  const notReady = lineup.filter((m) => !ready.has(m.userId!));
  return { total: lineup.length, ready: lineup.length - notReady.length, notReady };
}

/**
 * Admins' readiness (plan §3.4): "Offline: 4 of 5 members ready". Each
 * member's phone reports the pack it holds (live_pack_status, 170). Tapping
 * it lists who is not ready, each with "Remind" (one push).
 */
export const OfflineMembersRow: React.FC<{
  eventId: string;
  members: ResolvedMember[];
  online: boolean;
  /** The viewer: never reminded; counted as ready when this device holds the setlist. */
  currentUserId?: string;
  selfReady?: boolean;
  className?: string;
}> = ({ eventId, members, online, currentUserId, selfReady, className }) => {
  const t = useT();
  const [status, setStatus] = useState<MemberPackStatus[] | null>(null);
  const [open, setOpen] = useState(false);
  const [reminded, setReminded] = useState<Record<string, 'sending' | 'sent' | 'failed'>>({});

  useEffect(() => {
    let alive = true;
    const load = () =>
      void fetchEventPackStatus(eventId).then((rows) => {
        if (alive && rows) setStatus(rows);
      });
    load();
    const onChanged = (e: Event) => {
      if ((e as CustomEvent).detail?.eventId === eventId) load();
    };
    window.addEventListener(LIVE_PACK_CHANGED, onChanged);
    window.addEventListener('online', load);
    return () => {
      alive = false;
      window.removeEventListener(LIVE_PACK_CHANGED, onChanged);
      window.removeEventListener('online', load);
    };
  }, [eventId]);

  const counts = useMemo(
    () => offlineCounts(members, status ?? [], { userId: currentUserId, ready: selfReady }),
    [members, status, currentUserId, selfReady],
  );
  // No table yet (database without 170) or nobody to count: nothing to show.
  if (!status || counts.total === 0) return null;

  const remind = async (userId: string) => {
    haptic.tap();
    setReminded((r) => ({ ...r, [userId]: 'sending' }));
    const ok = await remindPackDownload(eventId, userId);
    setReminded((r) => ({ ...r, [userId]: ok ? 'sent' : 'failed' }));
  };

  const all = counts.ready === counts.total;
  return (
    <div className={cn('bg-card rounded-[16px] p-4 flex flex-col gap-3', className)} role="group" aria-label={t('Offline')}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-3 text-left min-h-11 flex-1 min-w-0"
          onClick={() => !all && setOpen((o) => !o)}
          aria-expanded={all ? undefined : open}
          disabled={all}
        >
          <Wifi className={cn('w-5 h-5 shrink-0', all ? 'text-success' : 'text-muted-foreground')} aria-hidden />
          <span className="flex flex-col gap-0.5 flex-1 min-w-0">
            <span className="bw-body-md">{t('Offline: {n} of {m} members ready', { n: counts.ready, m: counts.total })}</span>
            <span className="bw-body-sm text-muted-foreground">
              {all ? t('Everyone has the setlist on their phone.') : t('Who has the setlist on their phone for no signal.')}
            </span>
          </span>
          {!all && <ChevronDown className={cn('w-4 h-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />}
        </button>
        <AcademyHelpButton article="offline-members-ready" size="sm" />
      </div>
      {open && !all && (
        <ul className="flex flex-col gap-2" aria-label={t('Not ready yet')}>
          {counts.notReady.map((m) => {
            const r = reminded[m.userId!];
            const me = m.userId === currentUserId;
            return (
              <li key={m.userId} className="flex items-center gap-3 min-h-11">
                <span className="bw-body-md flex-1 min-w-0 truncate">{me ? t('You') : m.name}</span>
                {me ? null : r === 'sent' ? (
                  <span className="bw-label-sm text-muted-foreground" role="status">
                    {t('Reminded')}
                  </span>
                ) : (
                  <PillButton
                    variant="outline"
                    size="sm"
                    fullWidth={false}
                    icon={<Bell className="w-4 h-4" />}
                    onClick={() => remind(m.userId!)}
                    disabled={!online || r === 'sending'}
                    aria-label={t('Remind {name}', { name: m.name })}
                  >
                    {r === 'failed' ? t('Try again') : t('Remind')}
                  </PillButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
