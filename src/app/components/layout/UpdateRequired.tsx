import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BrandMark, PillButton } from '@/app/components/bw';
import { useMinVersion, type Platform } from '@/lib/minVersion';
import { ANDROID_APK_URL, checkAndroidUpdate, openAndroidUpdate } from '@/lib/androidUpdate';
import { openExternal } from '@/lib/nativeFiles';
import { useAuth } from '@/lib/AuthContext';
import { useT } from '@/lib/i18n';

/** Stage / Live mode is on screen: never interrupt it (paid plans §7.1). */
const inLiveMode = () => typeof document !== 'undefined' && !!document.querySelector('.bw-stage');

const TESTFLIGHT_URL = 'itms-beta://';
const reloadKey = (min: string) => `bw-min-reloaded:${min}`;

async function update(platform: Platform, storeUrl: string | null) {
  if (platform === 'android') {
    const next = await checkAndroidUpdate(true).catch(() => null);
    if (next) await openAndroidUpdate(next, 'settings');
    else await openExternal(ANDROID_APK_URL);
    return;
  }
  if (platform === 'ios') {
    await openExternal(storeUrl || TESTFLIGHT_URL);
    return;
  }
  window.location.reload();
}

/**
 * "Update BandWith" (paid plans P4): full screen when this build is older
 * than the server's minimum for its platform (162). Data is not touched and
 * signing out still works. Never shown over Stage / Live mode; the web
 * reloads once on its own (a newer bundle is already on the server).
 */
export const UpdateRequired: React.FC = () => {
  const t = useT();
  const { status, platform, info } = useMinVersion();
  const { isAuthenticated, signOut } = useAuth();
  const [live, setLive] = useState(inLiveMode);
  const blocked = status === 'blocked';

  // Wait for Live mode to end before showing anything.
  useEffect(() => {
    if (!blocked) return;
    setLive(inLiveMode());
    const id = window.setInterval(() => setLive(inLiveMode()), 15_000);
    return () => window.clearInterval(id);
  }, [blocked]);

  // The web: one automatic reload per minimum (a newer bundle is served).
  useEffect(() => {
    if (!blocked || live || platform !== 'web' || !info?.minVersion) return;
    try {
      if (sessionStorage.getItem(reloadKey(info.minVersion))) return;
      sessionStorage.setItem(reloadKey(info.minVersion), '1');
    } catch {
      return;
    }
    window.location.reload();
  }, [blocked, live, platform, info?.minVersion]);

  // The app underneath is out of reach (taps, focus, screen readers) while shown.
  const shown = blocked && !live;
  useEffect(() => {
    const root = document.getElementById('root');
    if (!shown || !root) return;
    root.setAttribute('inert', '');
    root.setAttribute('aria-hidden', 'true');
    return () => {
      root.removeAttribute('inert');
      root.removeAttribute('aria-hidden');
    };
  }, [shown]);

  if (!shown) return null;

  const button = platform === 'web' ? t('Reload') : platform === 'ios' && !info?.storeUrl?.startsWith('https://') ? t('Open TestFlight') : t('Update');

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="bw-update-required-title"
      data-testid="update-required"
      className="fixed inset-0 z-[1000] bg-background text-foreground flex flex-col items-center justify-center px-6"
      style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}
    >
      <div className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
        <BrandMark size={56} title="" />
        <div className="flex flex-col gap-2">
          <h1 id="bw-update-required-title" className="bw-h2">
            {t('Update BandWith')}
          </h1>
          <p className="bw-body-md text-muted-foreground">
            {t('This version is too old to keep working with your band. Update to carry on: nothing is lost.')}
          </p>
        </div>
        <div className="w-full flex flex-col gap-3">
          <PillButton onClick={() => void update(platform, info?.storeUrl ?? null)}>{button}</PillButton>
          {isAuthenticated && (
            <PillButton variant="outline" onClick={() => void signOut()}>
              {t('Sign out')}
            </PillButton>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default UpdateRequired;
