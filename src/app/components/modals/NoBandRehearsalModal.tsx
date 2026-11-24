import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RailCover } from '@/lib/railActions';
import { PillButton } from '@/app/components/bw';
import { BandRequired, type BandRequiredReason } from '@/app/components/band/BandRequired';
import { useT } from '@/lib/i18n';

interface NoBandRehearsalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenUpgrade: () => void;
  /** What was asked for: proposing a rehearsal (default), the chat, or another band screen. */
  reason?: BandRequiredReason;
}

/** Figma "Rehearsal / No band – modal" (27:551): centred canvas card over a dark scrim. */
export const NoBandRehearsalModal: React.FC<NoBandRehearsalModalProps> = ({
  isOpen,
  onClose,
  onOpenUpgrade,
  reason = 'rehearsal',
}) => {
  const tr = useT();
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {/* iPhone Duo: on the open display the dialog sits on the trailing pane;
          its scrim stops at the rail (Figma "Rehearsal / No band – modal"). */}
      <div className="bw-pane-detail fixed inset-0 z-[180]">
      <RailCover pane />
      {/* Duo Laptop pose: the card sits on the Deck, clear of the fold (bw-deck-dialog, index.css). */}
      <div className="bw-deck-dialog relative h-full flex items-center justify-center p-6">
        {/* Scrim (clickable to close) */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 z-0 bg-black/60 cursor-pointer"
        />

        {/* Modal card */}
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="no-band-rehearsal-title"
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => e.stopPropagation()}
          className="relative z-10 w-full max-w-[342px] bg-background text-foreground rounded-[24px] p-6 flex flex-col gap-4 select-none"
        >
          <BandRequired
            reason={reason}
            size="dialog"
            titleId="no-band-rehearsal-title"
            onCreateBand={() => {
              onClose();
              onOpenUpgrade();
            }}
          >
            <PillButton variant="outline" onClick={onClose}>
              {tr('Maybe later')}
            </PillButton>
          </BandRequired>
        </motion.div>
      </div>
      </div>
    </AnimatePresence>
  );
};
