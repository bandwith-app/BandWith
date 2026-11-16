import type { BrowserContext, Page } from '@playwright/test';
import { DB_KEY, DEMO_USER_ID, FIXED_NOW, fakeDate, type App } from '../../fixtures';
import { duoInitScript, type DuoProfile } from '../../support/devices';
import { stubNetwork } from '../../support/network';
import { settle } from '../../support/settle';
import { openEvent, escapeRe } from '../../support/flows';
import { openHub, openChatTab } from '../../support/hub';
import { crawlInitScript } from './dom';
import type { Area, CrawlRole } from './types';

/**
 * One crawl session: a browser page signed in as one role on one device
 * profile, the demo database it starts from, and the roots (top-level
 * screens) the crawl starts from.
 *
 * "Fresh copy of a state" = restore the storage captured when the session
 * was ready (the demo database lives in localStorage), reload, enter the
 * root and replay the clicks that led to the state.
 */

export interface Root {
  id: string;
  area: Area;
  /** Page to load (default "/"). */
  url?: string;
  /** Keep the urgent pop-up (default: dismiss it). */
  keepPopup?: boolean;
  enter: (s: Session) => Promise<void>;
}

/** A wizard draft (src/lib/wizardDrafts.ts) so "Drafts" on Home has a row. */
const CRAWL_DRAFT = {
  id: 'draft-crawl-1',
  userId: DEMO_USER_ID,
  bandId: '10000064-0000-4000-8000-000000000100',
  title: 'Spring showcase',
  date: '2026-12-05',
  venue: 'Blue Note',
  eventType: 'gig',
  savedAt: '2026-11-15T18:00:00.000Z',
  state: {},
};

const tabRoots = (withDraft: boolean): Root[] => [
  { id: 'home', area: 'home', enter: async (s) => s.tab('Home') },
  { id: 'calendar', area: 'calendar', enter: async (s) => s.tab('Calendar') },
  { id: 'chat', area: 'chat', enter: async (s) => openChatTab(s.app) },
  { id: 'hub', area: 'settings', enter: async (s) => openHub(s.app) },
  { id: 'create', area: 'create', enter: async (s) => s.tab('Create') },
  {
    id: 'inbox',
    area: 'notifications',
    enter: async (s) => {
      await s.page.getByRole('button', { name: /^Notifications/ }).filter({ visible: true }).first().click();
      await s.settle();
    },
  },
  { id: 'gig', area: 'event', enter: async (s) => openEvent(s.app, 'Rooftop Session') },
  { id: 'rehearsal', area: 'event', enter: async (s) => openEvent(s.app, 'Weekly rehearsal') },
  { id: 'quote', area: 'event', enter: async (s) => openEvent(s.app, 'Jazz Club Night') },
  {
    id: 'quote-draft',
    area: 'event',
    // Only on Home (Upcoming): the calendar has no quote drafts.
    enter: async (s) => {
      await s.tab('Home');
      const row = s.page.getByRole('button', { name: /40th birthday party/i }).filter({ visible: true }).first();
      await row.scrollIntoViewIfNeeded();
      await row.click();
      await s.settle();
    },
  },
  { id: 'personal', area: 'event', enter: async (s) => openEvent(s.app, 'Vocal lesson') },
  ...(withDraft
    ? [
        {
          id: 'draft',
          area: 'create' as Area,
          enter: async (s: Session) => {
            await s.tab('Home');
            const row = s.page.getByRole('button', { name: new RegExp(escapeRe(CRAWL_DRAFT.title), 'i') }).filter({ visible: true }).first();
            await row.scrollIntoViewIfNeeded();
            await row.click();
            await s.settle();
          },
        },
      ]
    : []),
  { id: 'urgent', area: 'notifications', keepPopup: true, enter: async () => {} },
];

export const ROOTS: Record<CrawlRole, Root[]> = {
  admin: tabRoots(true),
  // Members never see unconverted quotes (src/lib/eventVisibility.ts).
  member: tabRoots(false).filter((r) => r.id !== 'quote' && r.id !== 'quote-draft'),
  deputy: [{ id: 'deputy-home', area: 'deputy', enter: async () => {} }],
  noband: [{ id: 'no-band', area: 'auth', enter: async () => {} }],
  signedout: [{ id: 'sign-in', area: 'auth', enter: async () => {} }],
  client: ['viewed', 'discussing', 'accepted', 'declined', 'expired'].map((state) => ({
    id: `quote-${state}`,
    area: 'client' as Area,
    url: `/quote.html?t=demo&state=${state}`,
    enter: async () => {},
  })),
};

type Storage = Record<string, string>;

export class Session {
  readonly app: App;
  base: Storage = {};
  resets = 0;
  resetCount = 0;
  softResets = 0;
  resetMs = 0;
  readonly phases = { goto: 0, ready: 0, popup: 0, enter: 0 };
  baseOrigin = '';
  loads = 0;
  readonly chunks = new Set<string>();
  requests = 0;
  readonly pageErrors: string[] = [];
  readonly dialogs: string[] = [];
  readonly downloads: string[] = [];
  readonly popups: string[] = [];
  readonly fileChoosers: string[] = [];

  constructor(
    readonly page: Page,
    readonly context: BrowserContext,
    readonly role: CrawlRole,
    readonly profile: string,
    readonly duo: DuoProfile | null,
  ) {
    const t = (s: string, vars?: Record<string, string | number>) =>
      vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
    // The support helpers (openEvent, openHub…) take the fixture's App; the
    // crawler gives them the parts they use.
    this.app = {
      page,
      role: role === 'member' ? 'member' : 'admin',
      locale: 'en',
      t,
      errors: this.pageErrors,
      settle: () => settle(page),
      tab: (name: string) => this.tab(name),
    } as unknown as App;
  }

  settle(timeout = 3000) {
    return settle(this.page, timeout);
  }

  async tab(name: string) {
    await this.page.getByRole('button', { name, exact: true }).filter({ visible: true }).first().click();
    await this.settle();
  }

  /** Browser listeners and init scripts; then signs in as the role. */
  async start() {
    const { page, context } = this;
    await stubNetwork(context);
    await page.addInitScript(fakeDate, FIXED_NOW.getTime() - Date.now());
    const signedIn = this.role !== 'signedout';
    await page.addInitScript(
      ({ signedIn }) => {
        try {
          if (!localStorage.getItem('bw-e2e')) {
            localStorage.setItem('bw-e2e', '1');
            if (signedIn) localStorage.setItem('bw-demo-session', '1');
            localStorage.setItem('bw-role-tour-seen:admin', '1');
            localStorage.setItem('bw-role-tour-seen:member', '1');
            localStorage.setItem('bw-locale-v1', 'en');
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
      { signedIn },
    );
    if (this.duo) await page.addInitScript(duoInitScript, { regions: this.duo.regions });
    await page.addInitScript(crawlInitScript);

    page.setDefaultTimeout(5000);
    page.on('pageerror', (e) => this.pageErrors.push(e.message.split('\n')[0]));
    page.on('load', () => this.loads++);
    page.on('request', (r) => {
      this.requests++;
      const m = /\/assets\/([A-Za-z][\w]*?)-[\w-]{6,}\.js$/.exec(new URL(r.url()).pathname);
      if (m) this.chunks.add(m[1]);
    });
    page.on('dialog', (d) => {
      this.dialogs.push(`${d.type()}: ${d.message().slice(0, 120)}`);
      void d.dismiss().catch(() => {});
    });
    page.on('download', (d) => {
      this.downloads.push(d.suggestedFilename());
      void d.cancel().catch(() => {});
    });
    page.on('filechooser', (f) => {
      this.fileChoosers.push(f.isMultiple() ? 'multiple' : 'single');
    });
    context.on('page', (p) => {
      if (p === page) return;
      this.popups.push(p.url());
      void p.close().catch(() => {});
    });

    if (this.role === 'client') {
      await page.goto(ROOTS.client[0].url!);
      this.baseOrigin = new URL(page.url()).origin;
      await this.ready();
      this.base = await this.storage();
      return;
    }
    await page.goto('/');
    this.baseOrigin = new URL(page.url()).origin;
    if (this.role === 'signedout') {
      await this.ready();
      this.base = await this.storage();
      return;
    }
    await this.waitForHome();
    // Role set-up on the demo database, then a fresh start (like a fresh
    // install: the offline cache of the admin session is cleared).
    if (this.role !== 'admin') {
      await page.evaluate(
        ({ k, me, role }) => {
          const d = JSON.parse(localStorage.getItem(k) || '{}');
          if (role === 'member') {
            for (const m of d.band_members || []) if (m.user_id === me) m.role = 'member';
          } else {
            d.band_members = (d.band_members || []).filter((m: { user_id: string }) => m.user_id !== me);
            if (role === 'noband') {
              d.demo_deputy_gigs = [];
              d.band_deputies = (d.band_deputies || []).filter((x: { user_id?: string }) => x.user_id !== me);
            }
          }
          localStorage.setItem(k, JSON.stringify(d));
          for (const key of Object.keys(localStorage)) if (key.startsWith('bw:')) localStorage.removeItem(key);
          indexedDB.deleteDatabase('bandwith_offline_db');
        },
        { k: DB_KEY, me: DEMO_USER_ID, role: this.role },
      );
    } else {
      await page.evaluate((d) => localStorage.setItem('bw-event-drafts-v1', JSON.stringify([d])), CRAWL_DRAFT);
    }
    await page.reload();
    await this.ready();
    await this.dismissPopups();
    this.base = await this.storage();
  }

  async waitForHome() {
    await this.page.getByRole('button', { name: 'Home', exact: true }).first().waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** The first screen of the role is up and still. */
  async ready() {
    if (this.role === 'admin' || this.role === 'member') await this.waitForHome();
    else if (this.role === 'client')
      // The quote page shows "Loading…" until the (demo) quote is there.
      await this.page.waitForFunction(() => !/loading/i.test(document.body.innerText) && !!document.querySelector('h1'), null, { timeout: 30_000 });
    else
      await this.page
        .locator('h1,h2,button')
        .filter({ visible: true })
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
    await this.settle(4000);
  }

  /** The urgent pop-up (an unanswered invitation) and tours, as the fixture does. */
  async dismissPopups() {
    const dismiss = this.page.getByRole('button', { name: /^(Dismiss alert|Close tour)$/ }).filter({ visible: true });
    if (this.role === 'admin' || this.role === 'member') {
      // It shows up a moment after launch.
      await dismiss.first().waitFor({ state: 'visible', timeout: 2500 }).catch(() => {});
    }
    for (let i = 0; i < 3 && (await dismiss.count()); i++) {
      await dismiss.first().click().catch(() => {});
      await this.settle();
    }
  }

  async storage(): Promise<Storage> {
    return this.page.evaluate(() => {
      const out: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        out[k] = localStorage.getItem(k) ?? '';
      }
      return out;
    });
  }

  /** Hash of the demo database and the wizard drafts. */
  async dbHash(): Promise<string> {
    return this.page.evaluate((k) => {
      const s = `${localStorage.getItem(k) ?? ''}#${localStorage.getItem('bw-event-drafts-v1') ?? ''}`;
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0).toString(36);
    }, DB_KEY);
  }

  /** Back to the storage the session started with, then the root's screen. */
  async resetTo(root: Root) {
    this.resets++;
    this.resetCount++;
    const t0 = Date.now();
    const { page } = this;
    // After a Back that left the app, the page is no longer on our origin.
    if (!page.url().startsWith(this.baseOrigin)) await page.goto(root.url ?? '/');
    await page.evaluate((base) => {
      localStorage.clear();
      for (const [k, v] of Object.entries(base)) localStorage.setItem(k, v);
      sessionStorage.clear();
    }, this.base);
    await page.goto(root.url ?? '/');
    const t1 = Date.now();
    await this.ready();
    const t2 = Date.now();
    if (root.keepPopup) {
      await page
        .getByRole('button', { name: 'Dismiss alert', exact: true })
        .waitFor({ state: 'visible', timeout: 4000 })
        .catch(() => {});
      await this.settle();
    } else await this.dismissPopups();
    const t3 = Date.now();
    await root.enter(this);
    this.resetMs += Date.now() - t0;
    this.phases.goto += t1 - t0;
    this.phases.ready += t2 - t1;
    this.phases.popup += t3 - t2;
    this.phases.enter += Date.now() - t3;
  }

  /** Swallowed outward actions and toasts so far. */
  crawlLog(): Promise<{ toasts: string[]; outward: string[]; invalid: number }> {
    return this.page.evaluate(() => {
      const c = (window as unknown as { __crawl?: { toasts: string[]; outward: string[]; invalid: number } }).__crawl;
      return { toasts: c ? [...c.toasts] : [], outward: c ? [...c.outward] : [], invalid: c ? c.invalid : 0 };
    });
  }
}
