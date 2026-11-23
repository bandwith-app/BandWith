/**
 * A rehearsal date deleted on its own (PR #297, src/lib/recurrenceSkips.ts)
 * must not come back on Home, in the lists or on the calendar after the
 * repeats moved to repeatDates (#298). Both PRs edit the same loops: this
 * checks the merge kept `!isSkippedOccurrence(…)` inside every repeatDates
 * loop. Skipped until recurrenceSkips is on the branch.
 */
import { describe, it, expect } from 'vitest';

const SOURCES = import.meta.glob(
  ['/src/app/views/HomeView.tsx', '/src/app/views/EventsView.tsx', '/src/app/AuthenticatedApp.tsx', '/src/lib/recurrenceSkips.ts'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;
const hasSkips = !!SOURCES['/src/lib/recurrenceSkips.ts'];

/** The body of each `for (… of repeatDates(…))` / `repeatDates(…).forEach(` loop that adds cards. */
const loops = (src: string): string[] => {
  const out: string[] = [];
  for (const m of src.matchAll(/repeatDates\(/g)) {
    const body = src.slice(m.index!, m.index! + 900);
    // The month grid adds each date through addToMap, which checks the skip itself.
    if (/^repeatDates\([^)]*\)\)\s*addToMap/.test(body)) continue;
    out.push(body);
  }
  return out;
};

describe('deleted rehearsal dates stay deleted with repeatDates', () => {
  it.skipIf(!hasSkips)('Home and the lists skip a deleted date inside every repeatDates loop', () => {
    const home = loops(SOURCES['/src/app/views/HomeView.tsx']);
    expect(home).toHaveLength(1);
    for (const file of ['/src/app/views/HomeView.tsx', '/src/app/views/EventsView.tsx', '/src/app/AuthenticatedApp.tsx']) {
      for (const body of loops(SOURCES[file])) {
        expect(body.slice(0, body.indexOf('.push(')), file).toMatch(/!isSkippedOccurrence\(/);
      }
    }
  });

  it.skipIf(!hasSkips)('the month grid skips it in addToMap', () => {
    expect(SOURCES['/src/app/views/EventsView.tsx']).toMatch(/const addToMap[\s\S]{0,600}isSkippedOccurrence\(/);
  });

  it('finds the loops (so the check above has something to look at)', () => {
    expect(loops(SOURCES['/src/app/views/HomeView.tsx'])).toHaveLength(1);
    expect(loops(SOURCES['/src/app/AuthenticatedApp.tsx'])).toHaveLength(2);
    expect(loops(SOURCES['/src/app/views/EventsView.tsx'])).toHaveLength(1);
  });
});
