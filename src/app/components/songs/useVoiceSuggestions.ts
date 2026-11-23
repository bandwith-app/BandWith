import { useMemo } from 'react';
import { useFlag } from '@/lib/appFlags';
import { suggestVoiceParts } from '@/lib/voiceParts';

/**
 * Lines that look like backing vocals or all together ("(ooh, yeah)"), for
 * the "Mark the voice parts" offer. None while voice_parts is switched off
 * (app_flags, docs/flags.md) or once the person said Not now.
 */
export function useVoiceSuggestions(lyrics: string, dismissed: boolean): ReturnType<typeof suggestVoiceParts> {
  const on = useFlag('voice_parts');
  return useMemo(() => (!on || dismissed ? [] : suggestVoiceParts(lyrics)), [lyrics, dismissed, on]);
}
