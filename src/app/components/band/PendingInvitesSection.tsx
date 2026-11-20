import React from 'react';
import { Copy, MoreHorizontal, Send, Trash2 } from '@/app/components/icons';
import { Card, IconButton, Tag } from '@/app/components/bw/Screen';
import { PillButton } from '@/app/components/bw/Form';
import { cn } from '@/app/components/ui/utils';
import { dateName, useT } from '@/lib/i18n';
import {
  cancelInvitation,
  inviteLink,
  inviteToBand,
  listBandInvitations,
  type BandInvitation,
} from '@/lib/services/invitations';

const shortDate = (iso: string | null) =>
  iso ? dateName(new Date(iso), { day: 'numeric', month: 'short' }, 'en-GB') : '';

const MenuRow: React.FC<{ icon: React.ReactNode; label: string; danger?: boolean; disabled?: boolean; onClick: () => void }> = ({
  icon,
  label,
  danger,
  disabled,
  onClick,
}) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'w-full min-h-[42px] px-3 py-3 flex items-center gap-3 rounded-[16px] text-left transition-colors hover:bg-sheet-foreground/[0.08]',
      'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent',
      danger ? 'text-destructive' : 'text-sheet-foreground',
    )}
  >
    <span className="shrink-0 flex [&_svg]:w-[18px] [&_svg]:h-[18px]">{icon}</span>
    <span className="bw-label-md">{label}</span>
  </button>
);

/**
 * Band members → Invited (admins only, migration 166): invites that haven't
 * turned into members yet, so an admin knows who is still missing and can
 * send the invite again, share its link or cancel it. Shows nothing when no
 * one is waiting (or before the server has the list).
 */
export const PendingInvitesSection: React.FC<{ bandId: string; inviterName?: string; reloadKey?: number }> = ({
  bandId,
  inviterName,
  reloadKey = 0,
}) => {
  const t = useT();
  const [invites, setInvites] = React.useState<BandInvitation[]>([]);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await listBandInvitations(bandId);
      setInvites(res.unavailable ? [] : res.invites);
    } catch {
      // The members list still works; the invites just don't show this time.
      setInvites([]);
    }
  }, [bandId]);

  React.useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice((n) => (n === text ? null : n)), 4000);
  };

  const sendAgain = async (inv: BandInvitation) => {
    setBusyId(inv.id);
    setError(null);
    try {
      await inviteToBand({ bandId, email: inv.email, role: inv.role, inviterName });
      setOpenId(null);
      flash(t('Invite sent again to {email}.', { email: inv.email }));
      await load();
    } catch {
      setError(t('We couldn’t send the invite. Try again.'));
    } finally {
      setBusyId(null);
    }
  };

  // Straight from the tap: a copy after an await is refused on iOS.
  const copyLink = (inv: BandInvitation) => {
    setError(null);
    navigator.clipboard
      .writeText(inviteLink(inv.token))
      .then(() => {
        setOpenId(null);
        flash(t('Link copied'));
      })
      .catch(() => setError(t('Couldn’t copy the invite link. Try again.')));
  };

  const cancel = async (inv: BandInvitation) => {
    setBusyId(inv.id);
    setError(null);
    try {
      await cancelInvitation(inv.id);
      setInvites((list) => list.filter((i) => i.id !== inv.id));
      setOpenId(null);
      setConfirmId(null);
      flash(t('Invite cancelled.'));
    } catch {
      setError(t('We couldn’t cancel the invite. Try again.'));
    } finally {
      setBusyId(null);
    }
  };

  if (invites.length === 0 && !notice) return null;

  return (
    <section aria-labelledby="pending-invites-title" className="flex flex-col gap-3 pt-2">
      <div className="flex flex-col gap-0.5">
        <h2 id="pending-invites-title" className="bw-h3">{t('Invited')}</h2>
        <p className="bw-body-sm text-muted-foreground">{t('Waiting to join. An invite lasts 7 days.')}</p>
      </div>

      {invites.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label={t('Invited')}>
          {invites.map((inv) => {
            const open = openId === inv.id;
            const confirming = confirmId === inv.id;
            const busy = busyId === inv.id;
            const role = inv.role === 'admin' ? t('Admin') : t('Member');
            const when =
              inv.status === 'waiting'
                ? inv.hasAccount
                  ? t('Sees it in the app · until {date}', { date: shortDate(inv.expiresAt) })
                  : t('Until {date}', { date: shortDate(inv.expiresAt) })
                : inv.status === 'expired'
                  ? t('Expired on {date}', { date: shortDate(inv.expiresAt) })
                  : t('Sent on {date}', { date: shortDate(inv.sentAt) });
            return (
              <li key={inv.id} className="flex flex-col">
                <div
                  className={cn(
                    'flex items-center gap-3 p-4 pr-3 rounded-[24px] bg-card text-card-foreground border-[1.5px]',
                    open ? 'border-foreground' : 'border-transparent',
                  )}
                >
                  <span className="flex-1 min-w-0 flex flex-col gap-1">
                    <span className="bw-label-md truncate">{inv.email}</span>
                    <span className="flex items-center gap-2 min-w-0">
                      <Tag variant={inv.status === 'expired' ? 'outline' : 'subtle'}>
                        {inv.status === 'waiting' ? t('Not accepted yet') : inv.status === 'expired' ? t('Expired') : t('Declined')}
                      </Tag>
                      <span className="bw-body-sm text-muted-foreground truncate">{[role, when].join(' · ')}</span>
                    </span>
                  </span>
                  <IconButton
                    label={t('Actions for {email}', { email: inv.email })}
                    variant="ghost"
                    size="sm"
                    icon={<MoreHorizontal />}
                    aria-expanded={open}
                    onClick={() => {
                      setOpenId(open ? null : inv.id);
                      setConfirmId(null);
                    }}
                  />
                </div>

                {open && (
                  <div className="dark mt-3 p-2 rounded-[24px] bg-sheet text-sheet-foreground flex flex-col gap-1" role="menu">
                    {confirming ? (
                      <div className="p-3 flex flex-col gap-3">
                        <p className="bw-body-md text-sheet-foreground">
                          {t('Cancel the invite to {email}? The link stops working.', { email: inv.email })}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <PillButton size="sm" variant="danger" fullWidth={false} disabled={busy} onClick={() => void cancel(inv)}>
                            {t('Yes, cancel it')}
                          </PillButton>
                          <PillButton size="sm" variant="ghost" fullWidth={false} disabled={busy} onClick={() => setConfirmId(null)}>
                            {t('Keep it')}
                          </PillButton>
                        </div>
                      </div>
                    ) : (
                      <>
                        <MenuRow
                          icon={<Send />}
                          label={inv.status === 'waiting' ? t('Send again') : t('Invite again')}
                          disabled={busy}
                          onClick={() => void sendAgain(inv)}
                        />
                        {inv.status === 'waiting' && !inv.hasAccount && (
                          <MenuRow icon={<Copy />} label={t('Copy link')} onClick={() => copyLink(inv)} />
                        )}
                        <MenuRow icon={<Trash2 />} label={t('Cancel invite')} danger disabled={busy} onClick={() => setConfirmId(inv.id)} />
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {notice && (
        <Card className="py-3">
          <p role="status" className="bw-body-sm">{notice}</p>
        </Card>
      )}
      {error && <p role="alert" className="bw-body-sm text-destructive">{error}</p>}
    </section>
  );
};
