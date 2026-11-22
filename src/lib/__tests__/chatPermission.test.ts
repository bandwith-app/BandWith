import { describe, it, expect, beforeEach } from 'vitest';
import { chatPermissionKey, offlinePermission, readChatPermission, saveChatPermission } from '../chatPermission';
import { clearOfflineCache } from '../offline/storage';

// Main's decision (#291 r4): the last answer is kept per (chat, account) and
// never outlives the sign-out or leaks to the next account on the device.
describe('chatPermission cache', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* none */ }
  });

  it('is kept per account and chat', async () => {
    await saveChatPermission('u1', 'c1', { permitted: true, reason: '' });
    expect(await readChatPermission('u1', 'c1')).toEqual({ permitted: true, reason: '' });
    expect(await readChatPermission('u2', 'c1')).toBeNull();
    expect(await readChatPermission('u1', 'c2')).toBeNull();
    expect(await readChatPermission(null, 'c1')).toBeNull();
  });

  it('sign-out clears it (clearOfflineCache, as AuthContext calls it)', async () => {
    await saveChatPermission('u1', 'c1', { permitted: true, reason: '' });
    expect(chatPermissionKey('u1', 'c1').startsWith('bw:u1:')).toBe(true);
    await clearOfflineCache();
    expect(await readChatPermission('u1', 'c1')).toBeNull();
  });

  it('a pending-write prefix never matches it (fix/auth-signout keeps only those)', () => {
    const key = chatPermissionKey('8f1f6c2e-1111-4222-8333-944455556666', 'c1');
    for (const p of ['bw:offline_queue:', 'bw:rehearsal_notes_outbox:', 'bw:live_outbox:']) {
      expect(key.startsWith(p)).toBe(false);
    }
  });

  it('with no answer and nothing kept it is open; a kept answer wins', () => {
    expect(offlinePermission(null)).toEqual({ permitted: true, reason: '' });
    expect(offlinePermission({ permitted: false, reason: 'x' })).toEqual({ permitted: false, reason: 'x' });
  });
});
