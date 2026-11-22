// Claude review #285 r8 (NIT, AuthenticatedApp upcoming rehearsals): the
// synthetic id of one date of a repeating rehearsal counted its place in the
// list, so deleting one date (skip_dates, #297) shifted the id of every later
// date. Keyed by the series and the date instead.
// Put at src/app/__tests__/AuthenticatedApp.occurrenceIds.test.ts
import { describe, it, expect } from 'vitest';
import appSrc from '../AuthenticatedApp.tsx?raw';
import { uuidToNumericId } from '@/lib/numericId';

describe('upcoming rehearsals: one id per date, whatever is deleted before it', () => {
  it('no id from the position in the list', () => {
    expect(appSrc).not.toMatch(/\*\s*31\s*\+\s*generated/);
    expect(appSrc).toContain('id: uuidToNumericId(`${e.eventId ?? e.id}-occ-${occDate}`),');
  });
  // Round 12 NIT: every date AuthenticatedApp expands is marked, so Home
  // never takes one for a new series (a behavioural test would need the two
  // builders lifted out of the component; they stay where #285 and #297 see them).
  it('both builders mark their dates with the series id', () => {
    expect(appSrc).toMatch(/id: uuidToNumericId\(`\$\{e\.eventId \?\? e\.id\}-occ-\$\{occDate\}`\),\s*eventId: e\.eventId,\s*occurrence_of: e\.eventId \?\? e\.id,/);
    expect(appSrc).toMatch(/id: `\$\{e\.id\}-occ-\$\{occDate\}`,\s*eventId: e\.id,\s*occurrence_of: e\.id,/);
  });
  it('the key is stable and differs per date', () => {
    const a = uuidToNumericId('r1-occ-2099-01-14');
    expect(uuidToNumericId('r1-occ-2099-01-14')).toBe(a);
    expect(uuidToNumericId('r1-occ-2099-01-21')).not.toBe(a);
  });
});
