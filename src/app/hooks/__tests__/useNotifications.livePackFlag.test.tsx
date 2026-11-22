import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Kill switch live_pack turned off while the inbox is open (docs/flags.md):
// its "keep it offline" prompts leave the list at once and the unread count
// is asked again, without waiting for the next refresh.
const h = vi.hoisted(() => ({ lists: 0, counts: 0 }));
const ROWS = [
  { id: 'n1', type: 'event_invite', title: 'Saturday at the Bowery', read: false, data: {} },
  { id: 'n2', type: 'live_pack_ready', title: 'Keep Saturday offline', read: false, data: {} },
];
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 'me' } }) }));
vi.mock('@/lib/safetyNetPoll', () => ({ startSafetyNetPoll: () => () => {} }));
vi.mock('@/lib/services/notifications', () => ({
  getNotifications: async () => {
    h.lists++;
    return { data: ROWS, error: null };
  },
  getUnreadCount: async () => {
    h.counts++;
    return { data: 2, error: null };
  },
  subscribeToNotifications: () => () => {},
  isChatNotificationType: () => false,
}));
vi.mock('@/lib/offline/storage', () => ({
  getCacheKey: () => 'k',
  getOfflineItem: async () => null,
  setOfflineItem: async () => {},
  onCachedRolesChanged: () => () => {},
}));

import { useNotifications, useUnreadCount } from '../useData';
import { __resetAppFlagsForTest, __setAppFlagsForTest } from '@/lib/appFlags';

beforeEach(() => {
  h.lists = 0;
  h.counts = 0;
  __resetAppFlagsForTest(null);
});

describe('inbox while live_pack flips', () => {
  it('off: the prompts leave the open list and the list is asked again', async () => {
    const { result } = renderHook(() => useNotifications({ excludeChat: true }));
    await waitFor(() => expect(result.current.notifications).toHaveLength(2));
    const before = h.lists;
    act(() => __setAppFlagsForTest({ live_pack: false }));
    expect(result.current.notifications.map((n) => n.id)).toEqual(['n1']);
    await waitFor(() => expect(h.lists).toBeGreaterThan(before));
  });

  it('off: the unread count is asked again', async () => {
    renderHook(() => useUnreadCount());
    await waitFor(() => expect(h.counts).toBe(1));
    act(() => __setAppFlagsForTest({ live_pack: false }));
    await waitFor(() => expect(h.counts).toBe(2));
  });
});
