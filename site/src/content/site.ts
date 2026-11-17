/**
 * Addresses the site links to. The app keeps its definitive address
 * (src/lib/appUrl.ts); bandwith.app belongs to an unrelated product: never link to it.
 */
export const APP_URL = 'https://bandwith-beryl.vercel.app';

/** Web door: the app opens straight on Create account (?start=signup). */
export const SIGNUP_URL = `${APP_URL}/?start=signup&src=site`;

/** The Academy (user guide, 6 languages) inside the app's deployment. */
export const academyArticle = (id: string) => `${APP_URL}/academy/#/a/${id}`;
export const ACADEMY_HOME = `${APP_URL}/academy/`;

/** Academy captures, served at /shots/ (see site/vite.config.ts). */
export type ShotDevice = 'phone' | 'tablet' | 'web' | 'duoClosed' | 'duoBook' | 'duoLaptop';
export const shot = (id: string, device: ShotDevice = 'phone') => `/shots/${id}@${device}.webp`;
