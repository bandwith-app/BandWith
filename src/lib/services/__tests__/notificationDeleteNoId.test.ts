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
