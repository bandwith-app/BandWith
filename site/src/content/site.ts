/**
 * Addresses the site links to. The app keeps its definitive address
 * (src/lib/appUrl.ts); bandwith.app belongs to an unrelated product: never link to it.
 */
export const APP_URL = 'https://app.bandwith.fun';

/** Web door: the app opens straight on Create account (?start=signup). */
export const SIGNUP_URL = `${APP_URL}/?start=signup&src=site`;

/**
 * The Academy (user guide, 6 languages) inside the app's deployment. The site
 * links its static pages, one per language and article (/academy/<lang>/ and
 * /academy/<lang>/a/<id>/): they are the ones search engines index. The bare
 * /academy/ is the app shell (noindex) and a #/a/<id> link is only a fragment
 * of it. Written here in English; on /it/ and /es/ i18n/langs.ts swaps the
 * language (localizeHref).
 */
export const ACADEMY_HOME = `${APP_URL}/academy/`;
export const ACADEMY_GUIDE = `${ACADEMY_HOME}en/`;
export const academyArticle = (id: string) => `${ACADEMY_HOME}en/a/${id}/`;

/** Academy captures, served at /shots/ (see site/vite.config.ts). */
export type ShotDevice = 'phone' | 'tablet' | 'web' | 'duoClosed' | 'duoBook' | 'duoLaptop';
export const shot = (id: string, device: ShotDevice = 'phone') => `/shots/${id}@${device}.webp`;

/** iPhone & iPad door: TestFlight's public link (it installs TestFlight first). */
export const TESTFLIGHT_URL = 'https://testflight.apple.com/join/8zJGuprA';

/** Android door: always the newest APK release (scripts/release-android.sh). */
export const APK_URL = 'https://github.com/bandwith-app/BandWith/releases/latest/download/BandWith.apk';
