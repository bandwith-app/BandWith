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
  it('the key is stable and differs per date', () => {
    const a = uuidToNumericId('r1-occ-2099-01-14');
    expect(uuidToNumericId('r1-occ-2099-01-14')).toBe(a);
    expect(uuidToNumericId('r1-occ-2099-01-21')).not.toBe(a);
  });
});
