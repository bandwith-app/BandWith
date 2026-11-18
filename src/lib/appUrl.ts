/**
 * The definitive web address of BandWith (Vercel, the owner's account) =
 * Supabase Auth site_url. Edge functions keep their own copy
 * (supabase/functions/send-email, deputy-calendar); the product site is
 * https://bandwith.fun (site/src/content/site.ts links here).
 *
 * Previous addresses keep serving the same app, so links already sent with
 * them (and links the installed apps up to 1.0.7 still generate) keep
 * working; they are only no longer generated: bandwith-beryl.vercel.app
 * (same Vercel project, until 2026-11-18) and bandwith.pages.dev (Cloudflare).
 * Note: bandwith.app belongs to an unrelated product; never link to it.
 */
export const APP_URL = 'https://app.bandwith.fun';
