import { describe, expect, it } from 'vitest';
import supabaseSrc from '../../supabase.ts?raw';
import appSrc from '../../../app/AuthenticatedApp.tsx?raw';
import demoSrc from '../../demo/demoClient.ts?raw';
import sheetSrc from '../../../app/components/plans/PlanLimitSheet.tsx?raw';

/**
 * Limit prompts (paid plans P3b) are wired once: the Supabase client's fetch
 * reports plan refusals, the app shell shows the sheet, and the demo raises
 * the same refusal as the server so e2e can reach every prompt.
 */
const files: Record<string, string> = {
  'src/lib/supabase.ts': supabaseSrc,
  'src/app/AuthenticatedApp.tsx': appSrc,
  'src/lib/demo/demoClient.ts': demoSrc,
  'src/app/components/plans/PlanLimitSheet.tsx': sheetSrc,
};
const src = (p: string) => files[p];

describe('plan limit wiring', () => {
  it('the Supabase client reports refusals through planAwareFetch', () => {
    expect(src('src/lib/supabase.ts')).toMatch(/global:\s*\{\s*fetch:\s*planAwareFetch\(/);
  });
  it('the app shell renders the sheet once', () => {
    const app = src('src/app/AuthenticatedApp.tsx');
    expect(app.match(/<PlanLimitSheet\b/g)?.length).toBe(1);
  });
  it('the demo refuses like the server and reports it', () => {
    const demo = src('src/lib/demo/demoClient.ts');
    expect(demo).toMatch(/BW_PLAN_LIMIT:/);
    expect(demo).toMatch(/reportPlanLimit\(/);
  });
  it('the sheet never opens over Stage / Live mode', () => {
    expect(src('src/app/components/plans/PlanLimitSheet.tsx')).toMatch(/\.bw-stage/);
  });
});
