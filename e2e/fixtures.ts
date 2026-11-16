import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { duoInitScript, type DuoProfile } from './support/devices';
import { expectHealthy } from './support/health';
import { settle } from './support/settle';
import { stubNetwork } from './support/network';
import { tr, type Locale } from './support/i18n';

export { expect };
export type { Locale };

/** The demo account (Leo M.), admin of the demo band "Velvet Static". */
export const DEMO_USER_ID = '10000001-0000-4000-8000-000000000001';
const DB_KEY = 'bw-demo-db-v6';

/**
 * Every test runs at the same moment: Monday 16 Nov 2026, 10:00 in Milan.
 * The demo seed dates everything relative to "today" (a gig today at 21:00,
 * a rehearsal tomorrow…), so a fixed clock keeps screens identical whether
 * CI runs at noon or at midnight. Time still flows from there.
 */
export const FIXED_NOW = new Date('2026-11-16T10:00:00+01:00');

/** Init script: Date (and Date.now) shifted by `offset` ms; timers untouched. */
function fakeDate(offset: number) {
  const RealDate = Date;
  const now = () => RealDate.now() + offset;
  function FakeDate(this: unknown, ...args: unknown[]) {
    if (!new.target) return new RealDate(now()).toString();
    return args.length ? new (RealDate as unknown as new (...a: unknown[]) => Date)(...args) : new RealDate(now());
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = now;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  (globalThis as unknown as { Date: unknown }).Date = FakeDate;
}

export type Role = 'admin' | 'member';
type DemoDB = Record<string, Record<string, unknown>[]>;

export interface App {
  page: Page;
  role: Role;
  locale: Locale;
  /** The visible text of `source` in the test's language. */
  t: (source: string, vars?: Record<string, string | number>) => string;
  /** Opens the app (fresh demo data for this test) and waits for Home. */
  open: (path?: string) => Promise<void>;
  /** Waits for the screen to settle, then runs the page-health check. */
  check: (where: string) => Promise<void>;
  /** Waits until layers stop moving. */
  settle: () => Promise<void>;
  /** A main tab: Home, Calendar, Create, Chat, Settings. */
  tab: (name: 'Home' | 'Calendar' | 'Create' | 'Chat' | 'Settings') => Promise<void>;
  /** Visible button (or link/tab) by its accessible name in the test's language. */
  button: (source: string, opts?: { exact?: boolean; vars?: Record<string, string | number> }) => Locator;
  /**
   * Makes the demo user (Leo M.) admin or member of the demo band and
   * reloads. Like a fresh install of that member's phone, the offline cache
   * from the previous session is cleared, unless `keepOfflineCache` is set
   * (the same device after an admin hands the band over).
   */
  setRole: (role: Role, opts?: { keepOfflineCache?: boolean }) => Promise<void>;
  /** Changes the demo database, then reloads so the app reads it. */
  editDb: (mutate: (db: DemoDB, ids: { me: string }) => void) => Promise<void>;
  /** Reads the demo database. */
  readDb: () => Promise<DemoDB>;
  /** JS errors seen so far (also checked by `check`). */
  errors: string[];
}

interface Options {
  role: Role;
  /** App language (bw-locale-v1). Not Playwright's `locale` (the browser's). */
  lang: Locale;
  profileId: string;
  duo: DuoProfile | null;
  /** Open the app before the test body (default true). */
  autoOpen: boolean;
}

export const test = base.extend<Options & { app: App }>({
  role: ['admin', { option: true }],
  lang: ['en', { option: true }],
  profileId: ['default', { option: true }],
  duo: [null, { option: true }],
  autoOpen: [true, { option: true }],

  app: async ({ page, role, lang: locale, duo, autoOpen }, use, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.split('\n')[0]}`));

    await stubNetwork(page.context());
    // Only Date moves to FIXED_NOW. Playwright's clock.install also fakes
    // performance.now and timers; after a page reload its performance.now
    // runs ahead of the browser's animation timeline by the time spent before
    // the reload, so exit animations (closing the urgent pop-up, sheets)
    // stall for that long. The offset is fixed per test, so time keeps
    // flowing across reloads without jumping back.
    await page.addInitScript(fakeDate, FIXED_NOW.getTime() - Date.now());

    // Signed in to the demo, first-run tours already seen, language chosen.
    // Only on a fresh context: a reload keeps what the test changed.
    await page.addInitScript(
      ({ locale }) => {
        try {
          if (!localStorage.getItem('bw-e2e')) {
            localStorage.setItem('bw-e2e', '1');
            localStorage.setItem('bw-demo-session', '1');
            localStorage.setItem('bw-role-tour-seen:admin', '1');
            localStorage.setItem('bw-role-tour-seen:member', '1');
            localStorage.setItem('bw-locale-v1', locale);
          }
        } catch {
          /* storage blocked */
        }
        const errs: string[] = [];
        (window as unknown as { __e2eErrors: string[] }).__e2eErrors = errs;
        window.addEventListener('error', (e) => errs.push(`error: ${e.message}`));
        window.addEventListener('unhandledrejection', (e) =>
          errs.push(`unhandled rejection: ${String((e.reason && e.reason.message) || e.reason)}`),
        );
      },
      { locale },
    );
    if (duo) await page.addInitScript(duoInitScript, { regions: duo.regions });

    const t = (source: string, vars?: Record<string, string | number>) => tr(locale, source, vars);

    // The urgent pop-up (an unanswered gig invitation) shows up on its own a
    // moment after launch, over whatever the test is doing: close it whenever
    // it is in the way, like the testers did.
    await page.addLocatorHandler(page.getByRole('button', { name: t('Dismiss alert'), exact: true }), async (b) => {
      await b.click();
    });
    await page.addLocatorHandler(page.getByRole('button', { name: t('Close tour'), exact: true }), async (b) => {
      await b.click();
    });

    const readDb = () =>
      page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}') as DemoDB, DB_KEY);

    const waitForHome = async () => {
      await expect(page.getByRole('button', { name: t('Home'), exact: true }).first()).toBeVisible({ timeout: 30_000 });
    };

    const app: App = {
      page,
      role,
      locale,
      t,
      errors,
      settle: () => settle(page),
      open: async (path = '/') => {
        await page.goto(path);
        await waitForHome();
        if (role === 'member') await app.setRole('member');
        await settle(page);
      },
      setRole: async (next, opts = {}) => {
        await page.evaluate(
          ({ k, id, next, clear }) => {
            const d = JSON.parse(localStorage.getItem(k) || '{}');
            for (const m of d.band_members || []) if (m.user_id === id) m.role = next;
            localStorage.setItem(k, JSON.stringify(d));
            if (clear) {
              // src/lib/offline/storage.ts: IndexedDB with a localStorage fallback.
              for (const key of Object.keys(localStorage)) if (key.startsWith('bw:')) localStorage.removeItem(key);
              indexedDB.deleteDatabase('bandwith_offline_db');
            }
          },
          { k: DB_KEY, id: DEMO_USER_ID, next, clear: !opts.keepOfflineCache },
        );
        await page.reload();
        await waitForHome();
        await settle(page);
      },
      check: async (where) => {
        await settle(page);
        const h = { foldBand: duo?.foldBand ?? null };
        await expectHealthy(page, where, h);
        expect(errors, `uncaught JS errors by "${where}"`).toEqual([]);
      },
      tab: async (name) => {
        await page.getByRole('button', { name: t(name), exact: true }).first().click();
        await settle(page);
      },
      button: (source, opts = {}) => {
        const name = t(source, opts.vars);
        const exact = opts.exact ?? false;
        return page
          .getByRole('button', { name, exact })
          .or(page.getByRole('link', { name, exact }))
          .or(page.getByRole('tab', { name, exact }))
          .filter({ visible: true });
      },
      editDb: async (mutate) => {
        const db = await readDb();
        mutate(db, { me: DEMO_USER_ID });
        await page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: DB_KEY, v: JSON.stringify(db) });
        await page.reload();
        await waitForHome();
        await settle(page);
      },
      readDb,
    };

    if (autoOpen) await app.open();
    await use(app);

    // Every test ends on a healthy screen with no JS errors.
    if (testInfo.status === testInfo.expectedStatus && !page.isClosed()) {
      await app.check('end of test');
    }
  },
});
