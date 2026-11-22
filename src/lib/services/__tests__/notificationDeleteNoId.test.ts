import { describe, it, expect } from 'vitest';
import src from '../../../app/AuthenticatedApp.tsx?raw';

/**
 * Review #273 round 4 (data loss): the inbox's onDelete without an id used to
 * delete every notification in the open list. It must be a no-op; Clear all
 * is its own button (onClearAll).
 */
describe('AuthenticatedApp: Delete without an id deletes nothing', () => {
  it('returns before deleting anything when no id is given', () => {
    const start = src.indexOf('onDelete={(id) => {');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('}}', start));
    const guard = body.indexOf('if (!id) return;');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf('removeNotifications('));
    expect(body).not.toMatch(/selectedNotifications\.map\(\(n\) => n\.id\)/);
  });
});

/**
 * Review #273 round 5: Clear all deletes only what the inbox shows. Items
 * hidden by a kill switch (useSwitchedOffHidden) stay in the snapshot
 * unseen, so the ids come from the shown lists, never the raw ones.
 */
describe('AuthenticatedApp: Clear all deletes only the shown notifications', () => {
  it('takes its ids from shownSelectedNotification(s)', () => {
    const start = src.indexOf('onClearAll={() => {');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('}}', start));
    const ids = body.slice(0, body.indexOf('removeNotifications('));
    expect(ids).toMatch(/shownSelectedNotification\?\.id/);
    expect(ids).toMatch(/shownSelectedNotifications\.map\(\(n\) => n\.id\)/);
    expect(ids).not.toMatch(/\[selectedNotification\?\.id/);
    expect(ids).not.toMatch(/[^n]selectedNotifications\.map/);
  });
});
