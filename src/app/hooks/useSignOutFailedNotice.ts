import { useEffect } from 'react';
import { showAppToast } from '@/lib/appToast';
import { useT } from '@/lib/i18n';
import { takeSignOutFailed } from '@/lib/signOutNotice';

/**
 * AuthenticatedApp (so: signed in): a sign-out whose wipe threw before this
 * reload left the person signed in. Said once, with the app's toast
 * (signOutNotice.ts). Call it after the app-toast listener is set up.
 */
export function useSignOutFailedNotice(): void {
  const t = useT();
  useEffect(() => {
    if (takeSignOutFailed()) showAppToast(t('Couldn’t sign out. Try again.'), 'error');
    // Once, when the app opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** App, signed out (`signedOut` true once that is known): the sign-out did happen, the mark goes unsaid. */
export function useForgetSignOutFailed(signedOut: boolean): void {
  useEffect(() => {
    if (signedOut) takeSignOutFailed();
  }, [signedOut]);
}
