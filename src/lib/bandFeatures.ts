/**
 * "May this account use band features?": the ONE rule behind every gate for
 * things that need a band or other people (chat, rehearsals and proposals,
 * the members list, the band's repertoire, gear, to-do lists, contracts,
 * pricing, band settings, plan).
 *
 * True when the account is in a REAL band. False for an account with no
 * band: it picked "Solo schedule" at sign-up, or it left or lost its last
 * band. Such an account has a personal calendar, personal gigs and its
 * earnings; a band-only entry is either not offered or answers "Band
 * required" with "Create a band" (src/app/components/band/BandRequired.tsx).
 *
 * A PERSONAL band is not a real band. The plan (owner, 11-24) is to give an
 * account without a band a hidden band of one member (a flag like
 * `bands.is_personal`), so that songs, setlists, Stage and practice work for
 * it. That band must count as "no real band" here: nobody else is in it, so
 * chat, proposals, members, plan and the rest stay band-only. `isRealBand`
 * already reads the flag; when it exists, the gates that only need a place
 * to keep things (Repertoire, and whatever else the personal band is for)
 * are the ones to lift, one by one, and every other gate keeps working
 * unchanged. Do not add `!band` / `user_mode === 'solo'` checks elsewhere:
 * use `useBandFeatures()` (or the value AuthenticatedApp passes down from it).
 *
 * The band list decides, not only `profiles.user_mode`: a real band always
 * wins (the profile can be a moment behind after joining or creating one),
 * and a list known to hold no real band means "no" whatever the profile
 * says. While the list is loading, or when it could not be loaded, only the
 * profile's own "solo" says no: "not loaded" is never taken for "no band".
 */
import { useAuth } from './AuthContext';
import { useBand } from './BandContext';

/** A band other people can be in. A personal band (`is_personal`) is not one. */
export function isRealBand(band: unknown): boolean {
  if (!band || typeof band !== 'object') return false;
  return (band as { is_personal?: boolean | null }).is_personal !== true;
}

export interface BandFeaturesInput {
  /** profiles.user_mode */
  userMode?: string | null;
  /** The account's bands (and the selected one, if the list is behind). */
  bands: readonly unknown[];
  bandsLoading: boolean;
  /** The last fetch of the band list failed. */
  bandsError?: unknown;
}

export function canUseBandFeatures({ userMode, bands, bandsLoading, bandsError }: BandFeaturesInput): boolean {
  if (bands.some(isRealBand)) return true;
  if (userMode === 'solo') return false;
  // Not known yet (or not loadable): nothing is taken away from a band account.
  return bandsLoading || !!bandsError;
}

/** True when the signed-in account is in a real band (see the file comment). */
export function useBandFeatures(): boolean {
  const { userMode } = useAuth();
  const { bands, selectedBand, loading, error } = useBand();
  return canUseBandFeatures({
    userMode,
    // A selected band is a band, whatever the list says at this moment.
    bands: [...(bands ?? []), selectedBand],
    bandsLoading: !!loading,
    bandsError: error,
  });
}
