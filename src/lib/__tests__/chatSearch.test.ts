import { describe, expect, it } from 'vitest';
import { clearedAtByChat, visibleAfterClear } from '../chatSearch';

describe('visibleAfterClear', () => {
  it('hides messages from before the chat was deleted', () => {
    expect(visibleAfterClear('2026-11-01T10:00:00Z', '2026-11-02T00:00:00Z')).toBe(false);
    expect(visibleAfterClear('2026-11-03T10:00:00Z', '2026-11-02T00:00:00Z')).toBe(true);
  });

  it('shows everything in a chat never deleted', () => {
    expect(visibleAfterClear('2026-11-01T10:00:00Z', null)).toBe(true);
  });
});

describe('clearedAtByChat', () => {
  it("reads the viewer's own cleared_at", () => {
    const map = clearedAtByChat(
      [
        { id: 'c1', participants: [{ user_id: 'me', cleared_at: '2026-11-02T00:00:00Z' }, { user_id: 'x', cleared_at: '2026-01-01T00:00:00Z' }] },
        { id: 'c2', participants: [{ user_id: 'x', cleared_at: '2026-01-01T00:00:00Z' }] },
      ],
      'me',
    );
    expect(map.get('c1')).toBe('2026-11-02T00:00:00Z');
    expect(map.has('c2')).toBe(false);
  });
});
