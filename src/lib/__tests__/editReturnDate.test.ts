import { describe, it, expect } from 'vitest';
import { openDateFor } from '../recurrenceSkips';
import appSrc from '@/app/AuthenticatedApp.tsx?raw';

/**
 * Codex #297 round 3 (main): cancelling the wizard on one date of a series
 * reopens that exact date, not the next date still on. The close handlers
 * (#292's closeCreateEventRef, the Android Back) call navigateToEvent(id)
 * with no date; the date being edited is remembered for that call.
 */
describe('openDateFor', () => {
  const editing = { eventId: 'r1', date: '2099-12-15' };
  it('an explicit date wins', () => {
    expect(openDateFor('r1', '2099-12-08', editing)).toBe('2099-12-08');
  });
  it('no date: the date being edited, for that event only', () => {
    expect(openDateFor('r1', null, editing)).toBe('2099-12-15');
    expect(openDateFor('r1', undefined, editing)).toBe('2099-12-15');
    expect(openDateFor('other', null, editing)).toBeNull();
    expect(openDateFor('r1', null, null)).toBeNull();
  });
});

describe('the app', () => {
  it('remembers the date being edited and navigateToEvent uses it', () => {
    expect(appSrc).toMatch(/editReturnRef\.current = \{ eventId: editingEventData\.eventId, date: editingEventData\.date \}/);
    const nav = appSrc.slice(appSrc.indexOf('const navigateToEvent = useCallback'), appSrc.indexOf('const navigateToEvent = useCallback') + 900);
    expect(nav).toMatch(/openDateFor\(eventDbId, asked, editReturnRef\.current\)/);
  });
});
