import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { Loader2 } from '@/app/components/icons';
import { AuthScreen, Kicker } from '@/app/components/bw/Form';
import { DuoAuthLayout } from '@/app/components/onboarding/DuoAuthLayout';
import { useT } from '@/lib/i18n';
import { onSignOutWipe, signOutWipeRunning } from '@/lib/signOutWipeState';

/** True from the start of a failed sign-out's wipe until the reload (signOutWipeState). */
export const useSigningOut = (): boolean => useSyncExternalStore(onSignOutWipe, signOutWipeRunning, () => false);

/**
 * "Signing out…" (#296 round 12): the only screen from the start of a failed
 * sign-out's wipe until the reload. No sign-in form and nothing to press, so
 * nobody signs in while a sync pass for the account that left may still be
 * running. The auth screens' shell, so it fits the phone, every Duo posture
 * and the iPad as they do.
 */
export const SigningOutScreen: React.FC = () => {
  const t = useT();
  const notice = useRef<HTMLDivElement>(null);
  // The screen that had focus is gone: focus (and the screen reader) lands on the notice.
  useEffect(() => {
    notice.current?.focus();
  }, []);
  return (
    <DuoAuthLayout screenKey="signing-out">
      <AuthScreen top={<span className="bw-label-sm text-muted-foreground">BandWith</span>}>
        <div
          ref={notice}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          aria-busy="true"
          data-testid="signing-out"
          className="flex flex-col gap-5 outline-none"
        >
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" aria-hidden />
          <Kicker size="md" title={t('Signing out…')} />
        </div>
      </AuthScreen>
    </DuoAuthLayout>
  );
};

export default SigningOutScreen;
