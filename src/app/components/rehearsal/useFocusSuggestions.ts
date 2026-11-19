import { useMemo } from 'react';
import { useOptionalAuth } from '@/lib/AuthContext';
import { useBandFlag } from '@/lib/flags';
import { suggestedFocusSongs } from '@/lib/toPractise';
import { useBandNotes } from '@/app/components/event/useBandNotes';

/**
 * Focus songs suggested by open rehearsal notes (plan A3, 097): pre-selected
 * when an admin creates the next rehearsal or a poll; they can untick them.
 * `ready` once the band's notes were read (so a late answer isn't missed).
 */
export function useFocusSuggestions(bandId: string | null | undefined, enabled = true) {
  const userId = useOptionalAuth()?.user?.id;
  const on = useBandFlag(bandId, 'rehearsal_notes') && enabled;
  const { notes, loaded } = useBandNotes(bandId, userId, on);
  const songs = useMemo(() => suggestedFocusSongs(notes), [notes]);
  return { songs, ready: on && loaded };
}
