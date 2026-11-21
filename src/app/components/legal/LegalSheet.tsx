import React from 'react';
import { createPortal } from 'react-dom';
import { X } from '@/app/components/icons';
import { IconButton } from '@/app/components/bw/Screen';
import { useT, getLocale } from '@/lib/i18n';
import { useCloseOnBack } from '@/lib/overlayBack';

export type LegalDoc = 'terms' | 'privacy' | 'help';


/** Bundled with the app (public/legal) and served on the web domains too. */
// Help is translated in the page itself and opens in the app's language;
// the Privacy Policy has Italian and Spanish pages (privacy-it/-es.html);
// the Terms and the other languages use the English page.
const PRIVACY_LANGS = new Set(['it', 'es']);
export const legalUrl = (doc: LegalDoc) => {
  const l = getLocale();
  if (doc === 'help') return `/legal/help.html?lang=${l}`;
  if (doc === 'privacy' && PRIVACY_LANGS.has(l)) return `/legal/privacy-${l}.html`;
  return `/legal/${doc}.html`;
};

/**
 * Terms / Privacy viewer. The documents are static pages shipped in the app
 * bundle, so they open offline and inside the native WebView without leaving
 * the app.
 */
export const LegalSheet: React.FC<{ doc: LegalDoc | null; onClose: () => void }> = ({ doc, onClose }) => {
  const tr = useT();
  useCloseOnBack(!!doc, onClose);
  if (!doc || typeof document === 'undefined') return null;
  const title = doc === 'terms' ? tr('Terms of Service') : doc === 'help' ? tr('Help & support') : tr('Privacy Policy');
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="bw-pane-detail fixed inset-0 z-[200] flex flex-col bg-background text-foreground"
      style={{ paddingTop: 'var(--safe-top, env(safe-area-inset-top))' }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 bw-status-clear">
        <span className="bw-label-sm">{title}</span>
        <IconButton label={tr('Close')} variant="filled" icon={<X />} onClick={onClose} />
      </div>
      <iframe title={title} src={legalUrl(doc)} className="flex-1 w-full border-0 bg-background" />
    </div>,
    document.body,
  );
};
