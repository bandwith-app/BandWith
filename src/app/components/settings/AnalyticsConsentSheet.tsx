import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { BarChart3 } from '@/app/components/icons';
import { RailCover } from '@/lib/railActions';
import { useSheetDrag } from '@/app/components/bw/useSheetDrag';
import { useT } from '@/lib/i18n';
import { useSystemBack } from '@/lib/backStack';

/**
 * The one-time question on the Android and iOS apps: share anonymous usage
 * statistics (src/lib/appAnalytics.ts)? Both answers weigh the same; closing
 * the sheet without answering asks again on the next launch. The answer can
 * be changed in Settings › Privacy & account.
 */
export const AnalyticsConsentSheet: React.FC<{
  open: boolean;
  onAnswer: (allow: boolean) => void;
  onDismiss: () => void;
}> = ({ open, onAnswer, onDismiss }) => {
  const t = useT();
  const drag = useSheetDrag(onDismiss);
  useSystemBack(open, onDismiss);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <React.Fragment key="analytics-consent">
          <RailCover sheet />
          <motion.div
            key="analytics-consent-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onDismiss}
            className="bw-rail-sheet fixed inset-0 z-[200] bg-black/60"
          />
          <motion.div
            key="analytics-consent-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="analytics-consent-title"
            aria-describedby="analytics-consent-body"
            data-testid="analytics-consent-sheet"
            // Not a layer for useLayerOpen: the question waits for Stage mode and sheets, never for itself.
            data-bw-yields=""
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 360 }}
            {...drag.sheet}
            onPointerDown={drag.handle.onPointerDown}
            className="bw-rail-sheet bw-sheet-card touch-none fixed bottom-0 left-0 right-0 z-[201] bg-sheet text-sheet-foreground rounded-t-[32px] sm:rounded-[32px] px-5 pt-3 sm:max-w-lg sm:mx-auto sm:bottom-6 flex flex-col gap-4"
            style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}
          >
            <span className="bw-grabber mx-auto w-10 h-[5px] rounded-full bg-sheet-foreground/85" aria-hidden />
            <div className="flex items-start gap-3">
              <BarChart3 className="w-6 h-6 shrink-0 mt-0.5" aria-hidden />
              <div className="flex flex-col gap-1">
                <span id="analytics-consent-title" className="bw-label-md">
                  {t('Help us improve BandWith?')}
                </span>
                <span id="analytics-consent-body" className="bw-body-sm text-sheet-foreground/70">
                  {t('Share anonymous usage statistics (which screens are used and how often) and, if the app crashes, the crash details. Never your songs, gigs, messages or contacts, and nothing for ads. You can change this anytime in Settings › Privacy & account.')}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onAnswer(false)}
                className="min-h-12 rounded-full border border-sheet-foreground/25 bw-button-sm"
              >
                {t('No thanks')}
              </button>
              <button
                type="button"
                onClick={() => onAnswer(true)}
                className="min-h-12 rounded-full border border-sheet-foreground/25 bw-button-sm"
              >
                {t('Allow')}
              </button>
            </div>
          </motion.div>
        </React.Fragment>
      )}
    </AnimatePresence>,
    document.body
  );
};
