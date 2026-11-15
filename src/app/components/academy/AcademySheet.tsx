import React from 'react';
import { createPortal } from 'react-dom';
import { X } from '@/app/components/icons';
import { IconButton } from '@/app/components/bw/Screen';
import { FoldSplit, useLaptopPose } from '@/app/components/duo/FoldSplit';
import { useT } from '@/lib/i18n';
import { useCloseOnBack } from '@/lib/overlayBack';
import { useTheme } from '@/lib/ThemeContext';
import { academyUrl, type AcademyTarget } from '@/lib/academy';
import { RailHeaderActionsContext } from '@/lib/railActions';

/**
 * The BandWith Academy (user guide) inside the app. Same shape as the legal
 * viewer: a full-screen layer on <body> with the guide in an iframe, so it
 * opens offline (it ships in the app bundle) and never leaves the app.
 * Two-pane Duo / tablet: it takes the detail pane, like LegalSheet.
 * Laptop pose: the title rests on the Display, the guide is on the Deck.
 *
 * `target` null = closed; `{}` home, `{ role }` a role path, `{ article }` one guide.
 */
export const AcademySheet: React.FC<{ target: AcademyTarget | undefined; onClose: () => void }> = ({
  target,
  onClose,
}) => {
  // Closed: render nothing (and read no context), so screens with a "?" stay cheap.
  if (target === undefined || typeof document === 'undefined') return null;
  // Opened from a "?" that lives in a header's rail slot (iPhone Duo): the
  // sheet's own Close must stay in the sheet, not move to the rail under it.
  return (
    <RailHeaderActionsContext.Provider value={null}>
      <OpenSheet target={target} onClose={onClose} />
    </RailHeaderActionsContext.Provider>
  );
};

const OpenSheet: React.FC<{ target: AcademyTarget; onClose: () => void }> = ({ target, onClose }) => {
  const tr = useT();
  const { resolvedTheme } = useTheme();
  const laptop = useLaptopPose();
  useCloseOnBack(true, onClose);

  const title = tr('BandWith Academy');
  // The guide is written in English for now (the app's own labels are in bold).
  const frame = (
    <iframe title={title} src={academyUrl(target, resolvedTheme)} className="flex-1 w-full border-0 bg-background" />
  );
  const bar = (
    <div className="flex items-center justify-between gap-3 px-4 py-3 bw-status-clear">
      <span className="bw-label-sm">{title}</span>
      <IconButton label={tr('Close')} variant="filled" icon={<X />} onClick={onClose} />
    </div>
  );

  if (laptop) {
    return (
      <FoldSplit
        zIndex={200}
        displayLabel={title}
        deckLabel={title}
        display={
          <div className="bw-fold-pad flex h-full flex-col justify-end gap-2 pb-6 pt-3">
            <span className="bw-label-sm text-muted-foreground">{tr('Guides for every role and device')}</span>
            <span className="text-4xl font-medium leading-none tracking-tight">{title}</span>
          </div>
        }
        deck={
          // Fills the whole Deck: the sheet covers the tab bar, so the Deck's
          // bottom clearance for it would only leave an empty band.
          <div role="dialog" aria-modal="true" aria-label={title} className="absolute inset-0 flex flex-col bg-background" style={{ paddingBottom: 'var(--safe-bottom, 0px)' }}>
            {bar}
            {frame}
          </div>
        }
      />
    );
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="bw-pane-detail fixed inset-0 z-[200] flex flex-col bg-background text-foreground"
      style={{ paddingTop: 'var(--safe-top, env(safe-area-inset-top))' }}
    >
      {bar}
      {frame}
    </div>,
    document.body,
  );
};
