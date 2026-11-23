import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/livePackStore', () => ({ deleteAllPacks: vi.fn(async () => {}) }));
// A slow disk for the queue (M2 test): its write lands 50 ms after it starts.
const slow = vi.hoisted(() => ({ on: false }));
vi.mock('../storage', async (orig) => {
  const real = await orig<typeof import('../storage')>();
  return {
    ...real,
    setOfflineItem: async <T,>(key: string, value: T) => {
      if (slow.on && key.startsWith('bw:offline_queue:')) await new Promise((r) => setTimeout(r, 50));
      return real.setOfflineItem(key, value);
    },
  };
});

import { clearOfflineCache, KEEP_ON_SIGN_OUT_PREFIXES, CHAT_OUTBOX_PREFIX, readChatOutboxCount } from '../storage';
import { discardAccountWrites } from '../../accountWrites';

// Audit review round 5 (Codex B1, Claude BLOCKER): changes the server refused
// (Stage notes and orders, rehearsal notes, #296) stay on the phone through
// sign-out; only deleting the account erases them.
const UID = '0b7c6a1e-2f4d-4c8e-9a51-3d2e1f0a9b8c';
const OTHER = '9f1e2d3c-4b5a-4678-8a9b-0c1d2e3f4a5b';

describe('KEEP_ON_SIGN_OUT_PREFIXES', () => {
  beforeEach(() => localStorage.clear());

  it('lists the Stage and rehearsal refused lists, and the chat outbox (#291)', () => {
    expect(KEEP_ON_SIGN_OUT_PREFIXES).toEqual(['bw:live_refused:', 'bw:rehearsal_notes_rejected:', 'bw:chat_outbox:']);
    expect(CHAT_OUTBOX_PREFIX).toBe('bw:chat_outbox:');
  });

  for (const prefix of ['bw:live_refused:', 'bw:rehearsal_notes_rejected:', 'bw:chat_outbox:']) {
    it(`${prefix} survives sign-out (clearOfflineCache)`, async () => {
      localStorage.setItem(`${prefix}${UID}`, JSON.stringify([{ kind: 'noteAdd' }]));
      localStorage.setItem(`bw:${UID}:global:songs`, '[]');
      await clearOfflineCache();
      expect(localStorage.getItem(`${prefix}${UID}`)).toBeTruthy();
      expect(localStorage.getItem(`bw:${UID}:global:songs`)).toBeNull();
    });

    it(`${prefix} is erased when the account is deleted, other accounts' stay`, async () => {
      localStorage.setItem(`${prefix}${UID}`, JSON.stringify([{ kind: 'noteAdd' }]));
      localStorage.setItem(`${prefix}${OTHER}`, JSON.stringify([{ kind: 'noteAdd' }]));
      await discardAccountWrites(UID);
      expect(localStorage.getItem(`${prefix}${UID}`)).toBeNull();
      expect(localStorage.getItem(`${prefix}${OTHER}`)).toBeTruthy();
    });
  }

  // The chat outbox (#291): `bw:chat_outbox:<uid>` = [{ chatId, clientId, body, createdAt }].
  it('readChatOutboxCount counts the queued messages; bad JSON or no key counts 0, never throws', async () => {
    const msg = (n: number) => ({ chatId: 'c1', clientId: `m${n}`, body: 'Load-in at 6 in Brooklyn', createdAt: '2026-11-22T18:00:00Z' });
    expect(await readChatOutboxCount(UID)).toBe(0);
    localStorage.setItem(`bw:chat_outbox:${UID}`, JSON.stringify([msg(1), msg(2)]));
    expect(await readChatOutboxCount(UID)).toBe(2);
    localStorage.setItem(`bw:chat_outbox:${UID}`, '{not json');
    expect(await readChatOutboxCount(UID)).toBe(0);
    localStorage.setItem(`bw:chat_outbox:${UID}`, JSON.stringify({ chatId: 'c1' }));
    expect(await readChatOutboxCount(UID)).toBe(0);
    expect(await readChatOutboxCount(null)).toBe(0);
  });

  // Round 6 (Claude r5 M2): the queue is removed under its lock, so a write
  // already in flight (an edit queued as the account is deleted) can't put
  // it back afterwards.
  it('deleting the account: a queue write in flight does not survive', async () => {
    const q = await import('../syncQueue');
    q.setOfflineQueueUser(UID);
    await new Promise((r) => setTimeout(r, 20));
    slow.on = true;
    try {
      const queued = q.enqueueMutation('update_event', { eventId: 'e1', updates: { title: 'Load-in, Brooklyn' } });
      await new Promise((r) => setTimeout(r, 10)); // the write has started
      await discardAccountWrites(UID);
      await queued;
      await new Promise((r) => setTimeout(r, 80));
    } finally {
      slow.on = false;
    }
    expect(localStorage.getItem(`bw:offline_queue:${UID}`)).toBeNull();
  });
});
