import React from 'react';
import { motion } from 'motion/react';
import { Users, Plus } from '@/app/components/icons';
import { PillButton } from '@/app/components/bw';
import { ScreenHeader, Card } from '@/app/components/bw/Screen';
import { useT } from '@/lib/i18n';

export type BandRequiredReason = 'rehearsal' | 'chat' | 'other';

/** What "Band required" says for each band-only thing an account with no band reached. */
export function useBandRequiredMessage(reason: BandRequiredReason = 'other'): string {
  const t = useT();
  if (reason === 'rehearsal') {
    return t('Proposing a rehearsal is only available when you’re in a band. Create one or ask an admin for an invite.');
  }
  if (reason === 'chat') {
    return t('Chat is only available when you’re in a band. Create one or ask an admin for an invite.');
  }
  return t('This is only available when you’re in a band. Create one or ask an admin for an invite.');
}

interface BandRequiredProps {
  reason?: BandRequiredReason;
  /** Opens band creation. Without it only the explanation shows. */
  onCreateBand?: () => void;
  /** id for the title (a dialog's aria-labelledby). */
  titleId?: string;
  /** The dialog's title is bigger than the one inside a screen. */
  size?: 'dialog' | 'inline';
  children?: React.ReactNode;
}

/**
 * "Band required" (Figma "Rehearsal / No band – modal"): the one answer to
 * anything that needs a band, for an account that has none. One action:
 * "Create a band". Used by the dialog (NoBandRehearsalModal) and, inline, by
 * band screens opened with no band (Band members, Repertoire).
 */
export const BandRequired: React.FC<BandRequiredProps> = ({ reason = 'other', onCreateBand, titleId, size = 'inline', children }) => {
  const t = useT();
  const message = useBandRequiredMessage(reason);
  return (
    <>
      <span aria-hidden className="bw-band-required-icon w-14 h-14 shrink-0 rounded-full bg-accent text-accent-foreground flex items-center justify-center">
        <Users className="w-6 h-6" />
      </span>

      <div className="flex flex-col gap-2">
        <h2 id={titleId} className={size === 'dialog' ? 'bw-h1 uppercase' : 'bw-h2 uppercase'}>
          {t('Band required')}
        </h2>
        <p className="bw-body-md text-muted-foreground">{message}</p>
      </div>

      {(onCreateBand || children) && (
        <div className="flex flex-col gap-3 pt-1 w-full">
          {onCreateBand && (
            <div className="flex flex-col gap-2">
              <PillButton onClick={onCreateBand} icon={<Plus className="w-[18px] h-[18px]" />}>
                {t('Create a band')}
              </PillButton>
              <p className="bw-label-xs text-muted-foreground">{t('Free, with every tool')}</p>
            </div>
          )}
          {children}
        </div>
      )}
    </>
  );
};

interface BandRequiredScreenProps {
  onBack: () => void;
  backLabel?: string;
  overline?: React.ReactNode;
  title: React.ReactNode;
  onCreateBand?: () => void;
  /**
   * The account's bands could not be loaded (not "no band"): the screen says
   * so and offers to try again, instead of "Band required".
   */
  notLoaded?: boolean;
  onRetry?: () => void;
}

/**
 * A band screen (Band members, Repertoire) opened with no band to show: the
 * screen's own header and "Band required" (or, when the bands could not be
 * loaded, that), never a loader waiting for a band that is not coming.
 */
export const BandRequiredScreen: React.FC<BandRequiredScreenProps> = ({ onBack, backLabel, overline, title, onCreateBand, notLoaded = false, onRetry }) => {
  const t = useT();
  return (
  <motion.div
    initial={{ x: '100%' }}
    animate={{ x: 0 }}
    exit={{ x: '100%' }}
    transition={{ type: 'tween', duration: 0.3, ease: 'easeOut' }}
    className="bw-pane-hub fixed inset-0 z-[70] bg-background text-foreground flex flex-col overflow-y-auto overflow-x-hidden"
    style={{ overscrollBehaviorX: 'none', touchAction: 'pan-y' }}
  >
    <ScreenHeader onBack={onBack} {...(backLabel ? { backLabel } : {})} overline={overline} title={title} />
    <div className="flex-1 flex flex-col gap-4 px-4 pt-4 max-w-2xl mx-auto w-full" style={{ paddingBottom: 'calc(var(--safe-bottom) + 40px)' }}>
      {notLoaded ? (
        <Card role="alert" className="p-6 gap-4">
          <div className="flex flex-col gap-2">
            <h2 className="bw-h2 uppercase">{t('Can’t load your bands')}</h2>
            <p className="bw-body-md text-muted-foreground">
              {t('Your bands and gigs are safe. Check your connection and try again. If it keeps happening, update BandWith to the latest version.')}
            </p>
          </div>
          {onRetry && <PillButton onClick={onRetry}>{t('Try again')}</PillButton>}
        </Card>
      ) : (
        <Card className="p-6 gap-4">
          <BandRequired onCreateBand={onCreateBand} />
        </Card>
      )}
    </div>
  </motion.div>
  );
};
