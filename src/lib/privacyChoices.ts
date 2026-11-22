import { CRASH_REPORTS_KEY } from './crashReports';
import { ANALYTICS_CONSENT_KEY, ANALYTICS_CONSENT_VERSION_KEY } from './appAnalytics';

/**
 * The device's privacy choices: kept when local storage is cleared (a
 * sign-out that fails clears it). A missing crash-report key means "on", the
 * default of a new install, so losing an opt-out would turn reports back on
 * without asking.
 */
const KEPT = [CRASH_REPORTS_KEY, ANALYTICS_CONSENT_KEY, ANALYTICS_CONSENT_VERSION_KEY];
/** The same keys, for a wipe that keeps more than these (signOutWipe.ts, a sign-out that failed). */
export const PRIVACY_CHOICE_KEYS: readonly string[] = KEPT;

export function clearStorageKeepingPrivacyChoices(): void {
  try {
    const kept = KEPT.map((k) => [k, localStorage.getItem(k)] as const);
    localStorage.clear();
    for (const [k, v] of kept) if (v !== null) localStorage.setItem(k, v);
  } catch {
    /* storage blocked: nothing to clear or keep */
  }
}
