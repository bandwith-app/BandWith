// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getCacheKey, getOfflineItem, onCachedRolesChanged, setOfflineItem, syncCachedRoles } from '../storage';

/**
 * The cached data was read for one role per band: a member's rows have no
 * client, price or colleagues' fees, an admin's have them. A role change
 * drops what was cached for the old role (emulator pass 11-16).
 */
const me = 'u1';
const events = getCacheKey(me, 'b1,b2', 'events_{}');
const fallback = getCacheKey(me, 'global', 'events_fallback_{}');
const detail = getCacheKey(me, 'global', 'event_detail_gig');
const profile = getCacheKey(me, 'global', 'user_profile');
const selected = getCacheKey(me, 'global', 'selected_band_id');
const otherUser = getCacheKey('u2', 'b1', 'events_{}');
const queue = 'bw:offline_queue:u1';

async function seedCache() {
  await setOfflineItem(events, [{ id: 'gig', client_name: 'Aurora Events' }]);
  await setOfflineItem(fallback, [{ id: 'gig', client_name: 'Aurora Events' }]);
  await setOfflineItem(detail, { id: 'gig', client_name: 'Aurora Events' });
  await setOfflineItem(profile, { id: me, full_name: 'Leo' });
  await setOfflineItem(selected, 'b1');
  await setOfflineItem(otherUser, [{ id: 'x' }]);
  await setOfflineItem(queue, [{ id: 'm1' }]);
}

beforeEach(() => {
  localStorage.clear();
});

describe('syncCachedRoles', () => {
  it('admin made member: the cached client and price are dropped, identity and queue kept', async () => {
    await syncCachedRoles(me, { b1: 'admin', b2: 'member' });
    await seedCache();
    const heard = vi.fn();
    const off = onCachedRolesChanged(heard);
    expect(await syncCachedRoles(me, { b1: 'member', b2: 'member' })).toBe(true);
    off();
    expect(await getOfflineItem(events)).toBeNull();
    expect(await getOfflineItem(fallback)).toBeNull();
    expect(await getOfflineItem(detail)).toBeNull();
    expect(await getOfflineItem(profile)).toEqual({ id: me, full_name: 'Leo' });
    expect(await getOfflineItem(selected)).toBe('b1');
    expect(await getOfflineItem(otherUser)).toEqual([{ id: 'x' }]);
    expect(await getOfflineItem(queue)).toEqual([{ id: 'm1' }]);
    expect(heard).toHaveBeenCalledWith(me);
  });

  it('member made admin: the member-shaped rows are dropped too', async () => {
    await syncCachedRoles(me, { b1: 'member' });
    await setOfflineItem(events, [{ id: 'gig' }]);
    expect(await syncCachedRoles(me, { b1: 'admin' })).toBe(true);
    expect(await getOfflineItem(events)).toBeNull();
  });

  it('same roles: the cache stays and nobody refetches', async () => {
    await syncCachedRoles(me, { b1: 'admin' });
    await seedCache();
    const heard = vi.fn();
    const off = onCachedRolesChanged(heard);
    expect(await syncCachedRoles(me, { b1: 'admin', b3: 'member' })).toBe(false);
    off();
    expect(await getOfflineItem(events)).not.toBeNull();
    expect(heard).not.toHaveBeenCalled();
  });

  it('a cache from before the check (no record): dropped once, quietly', async () => {
    await seedCache();
    const heard = vi.fn();
    const off = onCachedRolesChanged(heard);
    expect(await syncCachedRoles(me, { b1: 'admin' })).toBe(true);
    off();
    expect(await getOfflineItem(events)).toBeNull();
    expect(await getOfflineItem(profile)).not.toBeNull();
    expect(heard).not.toHaveBeenCalled();
    expect(await syncCachedRoles(me, { b1: 'admin' })).toBe(false);
  });
});
