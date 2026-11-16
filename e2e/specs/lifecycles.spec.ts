import { test, expect } from '../fixtures';
import { excluded, generatePaths, type ModelPath } from '../models/lifecycle.ts';
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
      const todo = path.variants.filter((v) => !excluded(path, v || undefined) !== KNOWN_BUGS);
      if (!todo.length) continue; // known bug: see the model's knownBugs
      const title = KNOWN_BUGS ? `[known bug] ${path.name}` : path.name;

      const body = async ({ app }: { app: Ctx['app'] }) => {
        for (const [i, variant] of todo.entries()) {
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

      const on = path.profiles;
      if (on.includes('phone-portrait') || on.includes('ipad-landscape')) {
        test.describe(() => {
          test.skip(({ profileId }) => !on.includes(profileId as never), `path runs on ${on.join(', ')}`);
          test(title, body);
        });
      }
      if (on.includes('duo-laptop')) test(`${title} @laptop`, body);
      if (on.includes('duo-book')) test(`${title} @duo-book`, body);
    }
  });
}
