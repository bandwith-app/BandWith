import { test, expect } from '../fixtures';
import { excluded, generatePaths, runnable, type ModelPath, type ProfileName } from '../models/lifecycle.ts';
import { MODEL_STEPS } from '../models/registry.ts';
import type { Ctx, ModelSteps } from '../models/steps.ts';
import type { Lifecycle } from '../models/lifecycle.ts';

/**
 * Lifecycle model paths (e2e/models, docs/lifecycles). One test per path
 * generated from each XState model: after every event, the target state's
 * check runs. Paths listed as known bugs in a model are left out (the
 * coverage report, `pnpm e2e:models:coverage`, prints them).
 *
 * Profiles: every path runs on phone-portrait; the model's `wide` paths also
 * on ipad-landscape and duo-laptop (titles tagged @laptop, the Duo Laptop
 * project's tag); a path with a gesture only some layouts allow runs only
 * there (e.g. @duo-book).
 *
 * CI runs this file in its own job, "E2E lifecycles", beside the three
 * E2E shards (which skip it with E2E_SKIP_LIFECYCLES=1).
 */

const DB_KEY = 'bw-demo-db-v6';
/**
 * E2E_KNOWN_BUGS=1 runs only the paths excluded as known bugs (they are
 * expected to fail until the app is fixed): the way to reproduce one and
 * refresh its trace.
 */
const KNOWN_BUGS = !!process.env.E2E_KNOWN_BUGS;

async function runPath(steps: ModelSteps<Lifecycle>, path: ModelPath, c: Ctx) {
  const states = steps.states as Record<string, (c: Ctx) => Promise<void>>;
  const events = steps.events as Record<string, (c: Ctx) => Promise<void>>;
  await test.step(`start: ${steps.model.initial}`, async () => {
    await (steps.boot ?? (async ({ app }: Ctx) => app.open()))(c);
    await states[steps.model.initial](c);
  });
  for (const s of path.steps) {
    await test.step(`${s.event} → ${s.to}`, async () => {
      await events[s.event](c);
      await states[s.to](c);
    });
  }
}

for (const steps of MODEL_STEPS) {
  const model = steps.model;
  test.describe(model.title, () => {
    test.use({ role: model.role, autoOpen: false });
    for (const path of generatePaths(model).paths) {
      // The variants to run on a profile: the runnable ones, or with
      // E2E_KNOWN_BUGS only the ones a known bug leaves out.
      const todo = (profile: ProfileName) =>
        path.profiles.includes(profile)
          ? KNOWN_BUGS
            ? path.variants.filter((v) => excluded(path, v || undefined, profile))
            : runnable(path, profile)
          : [];
      const title = KNOWN_BUGS ? `[known bug] ${path.name}` : path.name;

      const body = async ({ app, profileId }: { app: Ctx['app']; profileId: string }) => {
        for (const [i, variant] of todo(profileId as ProfileName).entries()) {
          const c: Ctx = { app, variant, data: {} };
          if (i > 0) {
            // Next variant: fresh demo data, same browser.
            await app.page.evaluate((k) => localStorage.removeItem(k), DB_KEY);
          }
          if (variant) await test.step(`variant: ${variant}`, () => runPath(steps, path, c));
          else await runPath(steps, path, c);
        }
        expect(app.errors).toEqual([]);
      };

      const phone = todo('phone-portrait').length > 0;
      const ipad = todo('ipad-landscape').length > 0;
      if (phone || ipad) {
        // Most paths run on phone-portrait only: the tag keeps them out of the
        // other full project (playwright.config.ts), so they don't count there.
        const tag = ipad ? [] : ['@phone-portrait-only'];
        test.describe(() => {
          test.skip(({ profileId }) => !todo(profileId as ProfileName).length, `path runs on ${path.profiles.join(', ')}`);
          test(title, { tag }, body);
        });
      }
      if (todo('duo-laptop').length) test(`${title} @laptop`, body);
      if (todo('duo-book').length) test(`${title} @duo-book`, body);
    }
  });
}
