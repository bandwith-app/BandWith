// Audit 04 #9: signing out keeps each account's unsent changes.
import { beforeEach, describe, expect, it } from 'vitest';
import { clearOfflineCache } from '../offline/storage';
import ctx from '../AuthContext.tsx?raw';
import settings from '../../app/views/SettingsView.tsx?raw';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const keys = () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) as string).sort();

describe('sign-out and unsent changes', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(`bw:rehearsal_notes_outbox:${B}`, '[{"kind":"delete","id":"n1"}]');
    localStorage.setItem(`bw:offline_queue:${A}`, '[{"id":"m1"}]'); // kept at A's earlier sign-out
    localStorage.setItem(`bw:offline_queue:${B}`, '[{"id":"m2"}]');
    localStorage.setItem(`bw:live_outbox:${B}`, '[{"kind":"noteDelete","id":"x"}]');
    localStorage.setItem('bw:offline_queue:anonymous', '[{"id":"orphan"}]');
    localStorage.setItem('bw_offline_mutation_queue', '[{"id":"legacy"}]');
    localStorage.setItem(`bw:${B}:band:quotes`, '{"cached":true}');
  });

  it("keeps every account's outboxes, drops read caches and orphan queues", async () => {
    await clearOfflineCache('bw:', { keepPendingWrites: true });
    expect(keys()).toEqual([`bw:live_outbox:${B}`, `bw:offline_queue:${A}`, `bw:offline_queue:${B}`, `bw:rehearsal_notes_outbox:${B}`].sort());
  });

  it('a full wipe (deleted account) still clears everything', async () => {
    await clearOfflineCache();
    expect(keys()).toEqual([]);
  });

  // Codex review #287: deleting Bob's account must not erase Alice's notes.
  it("a deleted account's unsent changes go, nobody else's", async () => {
    await clearOfflineCache('bw:', { keepPendingWrites: true, discardPendingWritesOf: B });
    expect(keys()).toEqual([`bw:offline_queue:${A}`]);
  });

  it('sign-out keeps them, account deletion drops only its own', () => {
    expect(ctx).toMatch(/clearOfflineCache\('bw:', \{\s*keepPendingWrites: true,\s*discardPendingWritesOf: opts\?\.discardPendingWrites \? user\?\.id \?\? null : null,\s*\}\)/);
    expect(settings).toMatch(/signOut\(\{ discardPendingWrites: true \}\)/);
  });
});
