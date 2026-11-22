/**
 * One web address for BandWith: https://app.bandwith.fun (the product site
 * is https://bandwith.fun). Every copy of it must agree, and the previous
 * address must keep working for links the installed apps (1.0.7 and older)
 * still generate.
 */
import { describe, expect, it } from 'vitest';
import { APP_URL } from '../appUrl';
import { DEPUTY_PAGE_URL } from '../services/deputies';
import { APP_URL as SITE_APP_URL, ACADEMY_HOME } from '../../../site/src/content/site';

// Raw sources, keyed by path from the repo root.
const RAW = import.meta.glob(
  [
    '../../../supabase/functions/send-email/index.ts',
    '../../../supabase/functions/member-calendar/index.ts',
    '../../../supabase/email-templates/_source/build.py',
    '../../../academy/src/blocks.tsx',
    '../../../academy/content/basics.ts',
    '../../../academy/content/i18n/*/basics.ts',
    '../../../site/partials/*.html',
    '../../../site/index.html',
    '../../../site/get/index.html',
    '../../../site/src/content/demos/devices.ts',
    '../../../scripts/android-release-notes.md',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;
const read = (p: string) => {
  const src = RAW[`../../../${p}`];
  if (src === undefined) throw new Error(`not loaded: ${p}`);
  return src;
};

describe('app address', () => {
  it('is app.bandwith.fun', () => {
    expect(APP_URL).toBe('https://app.bandwith.fun');
    expect(DEPUTY_PAGE_URL).toBe('https://app.bandwith.fun/deputy.html');
  });

  it('is the same in the product site, the edge functions and the email previews', () => {
    expect(SITE_APP_URL).toBe(APP_URL);
    expect(ACADEMY_HOME).toBe(`${APP_URL}/academy/`);
    expect(read('supabase/functions/send-email/index.ts')).toContain(`const DEFAULT_APP_URL = "${APP_URL}";`);
    // deputy-calendar links nowhere since 182 (no reply link in a calendar).
    expect(read('supabase/functions/member-calendar/index.ts')).toContain(`const SITE = "${APP_URL}"; // = src/lib/appUrl.ts`);
    expect(read('supabase/email-templates/_source/build.py')).toContain(`PUBLIC_URL = "${APP_URL}"`);
  });

  it('still lets emails link to the previous addresses (links from installed apps)', () => {
    const src = read('supabase/functions/send-email/index.ts');
    const legacy = src.match(/const LEGACY_APP_HOSTS = \[([^\]]*)\]/)?.[1] ?? '';
    for (const host of ['bandwith-beryl.vercel.app', 'bandwith.pages.dev', 'band-with.vercel.app']) {
      expect(legacy).toContain(`"${host}"`);
    }
  });

  it('is no longer the old Vercel address anywhere users read it', () => {
    const files = [
      'academy/src/blocks.tsx',
      'academy/content/basics.ts',
      ...['de', 'es', 'fr', 'it', 'pt'].map((l) => `academy/content/i18n/${l}/basics.ts`),
      'site/partials/nav.html',
      'site/partials/foot.html',
      'site/index.html',
      'site/get/index.html',
      'site/src/content/demos/devices.ts',
      'scripts/android-release-notes.md',
    ];
    for (const f of files) expect(read(f), f).not.toContain('bandwith-beryl.vercel.app');
  });
});
