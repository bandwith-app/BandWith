import React from 'react';
import { useFlag } from '@/lib/appFlags';
import { useT } from '@/lib/i18n';
import { hasVoiceMarkers, keepVoiceParts, stripVoiceMarkers } from '@/lib/voiceParts';

/**
 * Lyrics in a plain text box (song form, a member's correction, the
 * review): the voice part markers ({bv}…{/bv}) never show; the parts stay
 * with their lines while the words are edited (keepVoiceParts).
 */
export function useVoiceSafeText(lyrics: string, setLyrics: (next: string) => void) {
  return {
    value: stripVoiceMarkers(lyrics),
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setLyrics(keepVoiceParts(lyrics, e.target.value)),
  };
}

/** Under the box: how many lines have a part, so nobody wonders where they went. */
export const VoicePartsKept: React.FC<{ lyrics: string | null | undefined; className?: string }> = ({ lyrics, className }) => {
  const t = useT();
  // voice_parts switched off (docs/flags.md): the markers stay saved, unmentioned.
  const voicesOn = useFlag('voice_parts');
  const n = React.useMemo(() => (lyrics || '').split('\n').filter((l) => hasVoiceMarkers(l)).length, [lyrics]);
  if (!n || !voicesOn) return null;
  return (
    <span role="status" className={className ?? 'bw-body-sm text-muted-foreground'}>
      {n === 1
        ? t('1 line has a voice part. It stays on its line when you edit the words.')
        : t('{n} lines have a voice part. They stay on their lines when you edit the words.', { n })}
    </span>
  );
};
