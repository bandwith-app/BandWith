import React from 'react';
import { Check } from '@/app/components/icons';
import { useOptionalBand } from '@/lib/BandContext';
import { useOptionalAuth } from '@/lib/AuthContext';
import { useT } from '@/lib/i18n';
import { instrumentVoicePart, type VoicePart } from '@/lib/voiceParts';
import { cn } from './utils';

/**
 * Voice parts on screen (plan §5.1). Each part is a shape plus a colour
 * (src/styles/index.css `.bw-voice-*`), never colour alone: second voice
 * underlined, backing italic with a bar on the left and softer, all bold,
 * spoken in small caps and grey.
 */
type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** A part's name on screen (legend, Voice picker, note labels). */
export const voicePartLabel = (p: VoicePart, t: Translate): string =>
  p === 'lead'
    ? t('Lead', { context: 'voice' })
    : p === 'v2'
      ? t('2nd voice')
      : p === 'bv'
        ? t('Backing', { context: 'voice' })
        : p === 'all'
          ? t('All', { context: 'voice' })
          : t('Spoken');

export const voiceClass = (v: VoicePart | 'mixed'): string | undefined =>
  v === 'lead' || v === 'mixed' ? undefined : `bw-voice-${v}`;

/**
 * "My part" when the page knows it (the song's or the setlist's "who sings
 * what"); `null` = I sing no part. Without a provider the member's
 * instrument decides (useMyVoicePart).
 */
const MyPartContext = React.createContext<VoicePart | null | undefined>(undefined);
export const MyVoicePartProvider: React.FC<{ value: VoicePart | null | undefined; children: React.ReactNode }> = ({ value, children }) => (
  <MyPartContext.Provider value={value}>{children}</MyPartContext.Provider>
);

/** The part I sing: the assignment when there is one, else my instrument in the band ("Backing vocals" → Backing). */
export function useMyVoicePart(): VoicePart | null {
  const given = React.useContext(MyPartContext);
  const band = useOptionalBand();
  const auth = useOptionalAuth();
  const uid = auth?.user?.id;
  const instrument = band?.selectedBand?.members?.find((m) => m.user_id === uid)?.instrument ?? null;
  if (given !== undefined) return given;
  return instrumentVoicePart(instrument);
}

export const VOICE_HIGHLIGHT_KEY = 'bw-voice-highlight';
const highlightListeners = new Set<() => void>();
const readHighlight = () => {
  try {
    return localStorage.getItem(VOICE_HIGHLIGHT_KEY) !== 'off';
  } catch {
    return true;
  }
};

/** "Highlight my part": per device, on by default; every reader on screen follows one switch. */
export function useVoiceHighlight(): [boolean, (on: boolean) => void] {
  const [on, setOn] = React.useState(readHighlight);
  React.useEffect(() => {
    const l = () => setOn(readHighlight());
    highlightListeners.add(l);
    return () => {
      highlightListeners.delete(l);
    };
  }, []);
  const set = React.useCallback((v: boolean) => {
    try {
      localStorage.setItem(VOICE_HIGHLIGHT_KEY, v ? 'on' : 'off');
    } catch {
      /* per-device preference */
    }
    setOn(v);
    highlightListeners.forEach((l) => l());
  }, []);
  return [on, set];
}

/**
 * The legend at the top of a song that uses parts ("Lead · 2nd voice ·
 * Backing"), each name drawn in its own style, with the "Highlight my part"
 * switch when I sing one of them.
 */
export const VoiceLegend: React.FC<{
  parts: VoicePart[];
  mine: VoicePart | null;
  highlight: boolean;
  onHighlight: (on: boolean) => void;
  muted?: string;
}> = ({ parts, mine, highlight, onHighlight, muted = 'text-muted-foreground' }) => {
  const t = useT();
  return (
    <div
      role="group"
      aria-label={t('Voice parts')}
      data-voice-legend
      className="flex flex-wrap items-center gap-x-3 gap-y-2 bw-label-sm"
      style={{ lineHeight: 1.3 }}
    >
      {parts.map((p) => (
        <span key={p} data-voice={p} className={voiceClass(p)}>
          {voicePartLabel(p, t)}
        </span>
      ))}
      {mine && (
        <button
          type="button"
          aria-pressed={highlight}
          onClick={() => onHighlight(!highlight)}
          className={cn(
            'ml-auto min-h-9 px-3 rounded-full border inline-flex items-center gap-1.5 whitespace-nowrap transition-colors',
            highlight ? 'border-current' : cn('border-current/30', muted),
          )}
        >
          {highlight && <Check className="w-4 h-4" aria-hidden />}
          {t('Highlight my part')}
        </button>
      )}
    </div>
  );
};
