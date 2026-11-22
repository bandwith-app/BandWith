import React, { useCallback, useEffect, useState } from 'react';
import { Download, Trash2, Wifi } from '@/app/components/icons';
import { PillButton, Toggle } from '@/app/components/bw';
import { cn } from '@/app/components/ui/utils';
import { AcademyHelpButton } from '@/app/components/academy/AcademyHelpButton';
import { localDecimal, useT } from '@/lib/i18n';
import { packSizeMb, type LivePack } from '@/lib/livePack';
import { LIVE_PACK_CHANGED, deleteAllPacks, listPacks } from '@/lib/livePackStore';
import { packFilesSize } from '@/lib/livePackFiles';
import { LIVE_PACK_CHOICE_EVENT, readChoice, setAutomatic, setWifiOnly, type LivePackChoice } from '@/lib/livePackConsent';

const CARD = 'bg-card text-card-foreground rounded-[24px]';
const ROW = 'p-4 flex items-center gap-3 w-full text-left';

const Tile: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span aria-hidden className="size-10 rounded-full bg-foreground/[0.08] flex items-center justify-center text-foreground shrink-0 [&>svg]:size-[18px]">
    {children}
  </span>
);

const Text: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <span className="flex flex-col gap-1 min-w-0 flex-1">
    <span className="bw-label-md text-foreground">{title}</span>
    {hint && <span className="bw-body-sm text-muted-foreground">{hint}</span>}
  </span>
);

/** Bytes this device keeps for the packs: the setlists themselves plus my files. */
export async function packsSpace(packs: LivePack[]): Promise<number> {
  let bytes = 0;
  for (const p of packs) {
    try {
      bytes += new TextEncoder().encode(JSON.stringify(p)).length;
    } catch {
      /* not measurable */
    }
  }
  const files = packs.flatMap((p) => Object.values(p.personal ?? {}).flatMap((x) => x.files));
  return bytes + (await packFilesSize(files).catch(() => 0));
}

/**
 * Settings → Offline & live (plan §3.3): the answer given on the consent
 * sheet, changeable anytime. Automatic follows the account (every device);
 * Wi-Fi only and what is kept are this device's.
 */
export const OfflineLiveSection: React.FC<{ userId?: string }> = ({ userId }) => {
  const t = useT();
  const [choice, setChoice] = useState<LivePackChoice>(() => readChoice(userId));
  const [kept, setKept] = useState<{ count: number; bytes: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    const packs = await listPacks(userId).catch(() => [] as LivePack[]);
    setKept({ count: packs.length, bytes: await packsSpace(packs) });
  }, [userId]);

  useEffect(() => {
    void load();
    const onChoice = () => setChoice(readChoice(userId));
    window.addEventListener(LIVE_PACK_CHOICE_EVENT, onChoice);
    window.addEventListener(LIVE_PACK_CHANGED, load);
    return () => {
      window.removeEventListener(LIVE_PACK_CHOICE_EVENT, onChoice);
      window.removeEventListener(LIVE_PACK_CHANGED, load);
    };
  }, [userId, load]);

  const deleteAll = async () => {
    if (!userId) return;
    setDeleting(true);
    await deleteAllPacks(userId).catch(() => undefined);
    setDeleting(false);
    setConfirming(false);
    void load();
  };

  const space =
    kept && kept.count > 0
      ? kept.count === 1
        ? t('1 setlist · {size} MB', { size: localDecimal(packSizeMb(kept.bytes)) })
        : t('{n} setlists · {size} MB', { n: kept.count, size: localDecimal(packSizeMb(kept.bytes)) })
      : t('Nothing kept on this device');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3 px-1">
        <p className="bw-body-sm text-muted-foreground flex-1 min-w-0">
          {t('Lyrics, chords, structures and your own notes for your next gigs, on this device for when there is no signal. No fees, no contracts.')}
        </p>
        <AcademyHelpButton article="offline-and-live-settings" size="sm" />
      </div>

      <div className={cn(CARD, ROW)}>
        <Tile>
          <Download />
        </Tile>
        <Text title={t('Automatic download')} hint={t('Every setlist of your next 7 days, updated by itself')} />
        <Toggle
          checked={choice.auto}
          disabled={!userId}
          onCheckedChange={(on: boolean) => userId && setAutomatic(userId, on)}
          aria-label={t('Automatic download')}
        />
      </div>

      <div className={cn(CARD, ROW)}>
        <Tile>
          <Wifi />
        </Tile>
        <Text title={t('Wi-Fi only')} hint={t('Automatic downloads wait for Wi-Fi on this device')} />
        <Toggle
          checked={choice.wifiOnly}
          disabled={!userId}
          onCheckedChange={(on: boolean) => userId && setWifiOnly(userId, on)}
          aria-label={t('Wi-Fi only')}
        />
      </div>

      <div className={cn(CARD, 'p-4 flex flex-col gap-3')}>
        <div className="flex items-center gap-3">
          <Tile>
            <Trash2 />
          </Tile>
          <Text title={t('Space used')} hint={kept ? space : undefined} />
        </div>
        {kept && kept.count > 0 &&
          (confirming ? (
            <div className="flex flex-col gap-2" role="group" aria-label={t('Delete all offline setlists?')}>
              <p className="bw-body-md">{t('Delete all offline setlists?')}</p>
              <p className="bw-body-sm text-muted-foreground">{t('They download again when you open the gig with signal.')}</p>
              <div className="flex flex-wrap gap-2">
                <PillButton variant="danger" size="md" fullWidth={false} onClick={deleteAll} disabled={deleting}>
                  {t('Delete all')}
                </PillButton>
                <PillButton variant="ghost" size="md" fullWidth={false} onClick={() => setConfirming(false)} disabled={deleting}>
                  {t('Cancel')}
                </PillButton>
              </div>
            </div>
          ) : (
            <PillButton variant="outline" size="md" fullWidth={false} onClick={() => setConfirming(true)}>
              {t('Delete all')}
            </PillButton>
          ))}
      </div>
    </div>
  );
};
