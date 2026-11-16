import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
import type { DuoProfile } from '../support/devices';
import { crawl } from './lib/crawler';
import { Session } from './lib/session';
import type { CrawlRole } from './lib/types';

/**
 * One crawl per role on each device profile (see crawl.config.ts). Not a
 * pass/fail test: it records the screen map; findings go to findings.md.
 */

const ROLES = (process.env.CRAWL_ROLES || 'admin,member,deputy,noband,signedout,client').split(',') as CrawlRole[];
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');

for (const role of ROLES) {
  test(`crawl ${role}`, async ({ page, context }, testInfo) => {
    const use = testInfo.project.use as { profileId?: string; duo?: DuoProfile | null };
    const profile = use.profileId ?? testInfo.project.name;
    const app = role === 'admin' || role === 'member';
    const minutes = Number(process.env.CRAWL_MINUTES || (app ? process.env.CRAWL_MINUTES_APP || 12 : 4));
    test.setTimeout((minutes + 15) * 60_000);
    const s = new Session(page, context, role, profile, use.duo ?? null);
    await s.start();
    const started = Date.now();
    const run = await crawl(s, {
      outDir: OUT,
      budgetMs: minutes * 60_000,
      maxDepth: Number(process.env.CRAWL_DEPTH || 4),
      maxLayers: 4,
      maxClicksPerState: Number(process.env.CRAWL_CLICKS || 30),
      strict: process.env.CRAWL_STRICT === '1',
      resume: process.env.CRAWL_FRESH !== '1',
      foldBand: use.duo?.foldBand ?? null,
      log: (m) => {
        if (process.env.CRAWL_VERBOSE) console.log(`[${role}/${profile}] ${m}`);
      },
    });
    const edges = run.states.reduce((n, st) => n + st.actions.length, 0);
    console.log(
      `[${role}/${profile}] ${run.states.length} states, ${edges} actions, ${run.clicks} clicks, ` +
        `${Math.round((Date.now() - started) / 1000)}s${run.complete ? '' : ' (budget reached, resumable)'}`,
    );
  });
}
