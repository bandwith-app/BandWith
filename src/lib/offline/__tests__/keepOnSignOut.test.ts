import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/livePackStore', () => ({ deleteAllPacks: vi.fn(async () => {}) }));

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
  it('readChatOutboxCount counts the queued messages; bad JSON or no key counts 0, never throws', () => {
    const msg = (n: number) => ({ chatId: 'c1', clientId: `m${n}`, body: 'Load-in at 6 in Brooklyn', createdAt: '2026-11-22T18:00:00Z' });
    expect(readChatOutboxCount(UID)).toBe(0);
    localStorage.setItem(`bw:chat_outbox:${UID}`, JSON.stringify([msg(1), msg(2)]));
    expect(readChatOutboxCount(UID)).toBe(2);
    localStorage.setItem(`bw:chat_outbox:${UID}`, '{not json');
    expect(readChatOutboxCount(UID)).toBe(0);
    localStorage.setItem(`bw:chat_outbox:${UID}`, JSON.stringify({ chatId: 'c1' }));
    expect(readChatOutboxCount(UID)).toBe(0);
    expect(readChatOutboxCount(null)).toBe(0);
  });
});

