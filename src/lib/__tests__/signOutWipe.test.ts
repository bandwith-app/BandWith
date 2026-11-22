import { describe, it, expect, vi, beforeEach } from 'vitest';
import identityHub from '../../app/components/layout/IdentityHub.tsx?raw';

// #296 round 7 (Claude r6 M3): a sign-out that throws used to run localStorage.clear(),
// which took the refused notes and the list of accounts whose recordings still have to go.
const seenAtCleanup: (string | null)[] = [];
vi.mock('../regiaAudio', () => ({
  clearDownloadedAudio: vi.fn(async () => {
    seenAtCleanup.push(localStorage.getItem('bw-regia-audio:owners'));
    localStorage.setItem('bw-regia-audio:cleanup-pending', JSON.stringify({ users: ['u1'], legacy: false }));
  }),
}));

import { keptOnSignOut, wipeAfterFailedSignOut } from '../signOutWipe';
import { supabase } from '../supabase';
import { ANALYTICS_CONSENT_KEY } from '../appAnalytics';

const UID = 'u1';

describe('a sign-out that failed: wiped, but not what sign-out keeps', () => {
  beforeEach(() => {
    localStorage.clear();
    seenAtCleanup.length = 0;
  });

  it('the recordings’ cleanup runs first, with its list of accounts; refused notes and its marks stay; the rest goes', async () => {
    localStorage.setItem('sb-project-auth-token', '{"access_token":"x"}');
    localStorage.setItem(`bw:${UID}:global:songs`, '[]');
    localStorage.setItem(`bw:rehearsal_notes_rejected:${UID}`, JSON.stringify([{ id: 'n1', body: 'Outro: four bars' }]));
    localStorage.setItem('bw-regia-audio:owners', JSON.stringify([UID]));
    localStorage.setItem(ANALYTICS_CONSENT_KEY, 'denied');
    await wipeAfterFailedSignOut();
    expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe('denied');
    expect(seenAtCleanup).toEqual([JSON.stringify([UID])]);
    expect(localStorage.getItem('sb-project-auth-token')).toBeNull();
    expect(localStorage.getItem(`bw:${UID}:global:songs`)).toBeNull();
    expect(localStorage.getItem(`bw:rehearsal_notes_rejected:${UID}`)).toContain('Outro: four bars');
    expect(localStorage.getItem('bw-regia-audio:cleanup-pending')).not.toBeNull();
  });

  it('#287 r9 / #291 review: every kept prefix survives a failed sign-out, everything else goes', async () => {
    const kept: Record<string, string> = {
      'bandwith.push-revoke': JSON.stringify([{ token: 't1', tries: 0 }]),
      'bandwith.push-delete-pending': '1',
      [ANALYTICS_CONSENT_KEY]: 'granted',
      'bw-regia-audio:owners': JSON.stringify([UID]),
      [`bw:live_refused:${UID}`]: '[1]',
      [`bw:rehearsal_notes_rejected:${UID}`]: '[2]',
      [`bw:chat_outbox:${UID}`]: '[3]',
      [`bw:rehearsal_notes_outbox:${UID}`]: '[4]',
      [`bw:live_outbox:${UID}`]: '[5]',
      [`bw:offline_queue:${UID}`]: '[6]',
    };
    const wiped = ['sb-project-auth-token', `bw:${UID}:global:songs`, `bw:${UID}:b1:events`, 'bandwith.theme', 'random-key'];
    for (const [k, v] of Object.entries(kept)) localStorage.setItem(k, v);
    for (const k of wiped) localStorage.setItem(k, 'x');
    await wipeAfterFailedSignOut();
    for (const [k, v] of Object.entries(kept)) expect([k, localStorage.getItem(k)]).toEqual([k, k === 'bw-regia-audio:owners' ? expect.any(String) : v]);
    for (const k of wiped) expect([k, localStorage.getItem(k)]).toEqual([k, null]);
  });

  it('#287 delta review: a step that throws at once (the local sign-out) still leaves a wiped device that keeps the push state', async () => {
    const out = vi.spyOn(supabase.auth, 'signOut').mockImplementation(() => {
      throw new TypeError('auth is not there');
    });
    localStorage.setItem('bandwith.push-revoke', JSON.stringify([{ token: 't1', userId: UID }]));
    localStorage.setItem('bandwith.push-delete-pending', '1');
    localStorage.setItem(`bw:${UID}:band:quotes`, '{"cached":true}');
    try {
      await wipeAfterFailedSignOut();
    } finally {
      out.mockRestore();
    }
    expect(localStorage.getItem(`bw:${UID}:band:quotes`)).toBeNull();
    expect(localStorage.getItem('bandwith.push-revoke')).toContain(UID);
    expect(localStorage.getItem('bandwith.push-delete-pending')).toBe('1');
  });

  it('keeps #292’s list (copied as data until #292 lands)', () => {
    expect(keptOnSignOut()).toEqual(expect.arrayContaining(['bw:live_refused:', 'bw:rehearsal_notes_rejected:', 'bw:chat_outbox:']));
  });

  it('IdentityHub: no localStorage.clear() when sign-out throws; the wipe is awaited before the reload', () => {
    expect(identityHub).not.toMatch(/localStorage\.clear\(\)/);
    const catchBlock = identityHub.slice(identityHub.indexOf("console.error('Logout failed:', e);"));
    expect(catchBlock.indexOf('await wipeAfterFailedSignOut()')).toBeGreaterThan(-1);
    expect(catchBlock.indexOf('await wipeAfterFailedSignOut()')).toBeLessThan(catchBlock.indexOf("window.location.href = '/'"));
  });
});
