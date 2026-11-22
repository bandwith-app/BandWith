import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { installIdbStub } from './idbStub';

// Round 6 (Claude r5 M3 + #291 FYI): the chat outbox is read and written
// through storage.ts only; the sign-out count and the account deletion look
// in both stores (localStorage and IndexedDB). Refused messages (`refused`,
// maybe '') are still unsent. Made-up messages (New York).

vi.mock('@/lib/livePackStore', () => ({ deleteAllPacks: vi.fn(async () => {}) }));
vi.mock('../syncQueue', async () => {
  const st = await import('../storage');
  return { clearOfflineQueue: vi.fn(async (u: string) => st.removeOfflineItem(`bw:offline_queue:${u}`)) };
});

const UID = '0b7c6a1e-2f4d-4c8e-9a51-3d2e1f0a9b8c';
const OTHER = '9f1e2d3c-4b5a-4678-8a9b-0c1d2e3f4a5b';
const msg = (n: number, extra: Record<string, unknown> = {}) => ({ chatId: 'c1', clientId: `m${n}`, body: 'Load-in at 6 in Brooklyn', createdAt: '2026-11-22T18:00:00Z', ...extra });

let idb: Map<string, unknown>;
let st: typeof import('../storage');
let discardAccountWrites: typeof import('../../accountWrites').discardAccountWrites;

beforeAll(async () => {
  idb = installIdbStub();
  st = await import('../storage');
  ({ discardAccountWrites } = await import('../../accountWrites'));
});
beforeEach(() => {
  localStorage.clear();
  idb.clear();
});

describe('chat outbox helpers (storage.ts)', () => {
  it('readChatOutbox keeps replyToId and refused (also ""), skips malformed entries, never throws', () => {
    localStorage.setItem(`bw:chat_outbox:${UID}`, JSON.stringify([msg(1, { replyToId: 'q1' }), msg(2, { refused: '' }), { chatId: 'c1' }, null]));
    expect(st.readChatOutbox(UID)).toEqual([msg(1, { replyToId: 'q1' }), msg(2, { refused: '' })]);
    localStorage.setItem(`bw:chat_outbox:${UID}`, '{oops');
    expect(st.readChatOutbox(UID)).toEqual([]);
    expect(st.readChatOutbox(null)).toEqual([]);
  });

  it('writeChatOutbox writes the list; an empty one removes the key', () => {
    st.writeChatOutbox(UID, [msg(1, { refused: 'Not allowed' })]);
    expect(JSON.parse(localStorage.getItem(`bw:chat_outbox:${UID}`) || '[]')).toEqual([msg(1, { refused: 'Not allowed' })]);
    st.writeChatOutbox(UID, []);
    expect(localStorage.getItem(`bw:chat_outbox:${UID}`)).toBeNull();
  });

  it('counts waiting and refused messages alike (refused "" too)', async () => {
    st.writeChatOutbox(UID, [msg(1), msg(2, { refused: '' }), msg(3, { refused: 'Chat closed' })]);
    expect(await st.readChatOutboxCount(UID)).toBe(3);
  });

  it('an entry only in IndexedDB is counted; one only in localStorage too; the same message in both once', async () => {
    idb.set(`bw:chat_outbox:${UID}`, [msg(1)]);
    expect(await st.readChatOutboxCount(UID)).toBe(1);
    idb.clear();
    st.writeChatOutbox(UID, [msg(2)]);
    expect(await st.readChatOutboxCount(UID)).toBe(1);
    idb.set(`bw:chat_outbox:${UID}`, [msg(2), msg(3)]);
    expect(await st.readChatOutboxCount(UID)).toBe(2);
  });

  it('bad JSON and nothing in IndexedDB: 0', async () => {
    localStorage.setItem(`bw:chat_outbox:${UID}`, '{oops');
    expect(await st.readChatOutboxCount(UID)).toBe(0);
  });

  it('deleteChatOutboxEntry removes one message from both stores, the others stay', async () => {
    idb.set(`bw:chat_outbox:${UID}`, [msg(1), msg(2, { refused: '' })]);
    st.writeChatOutbox(UID, [msg(2, { refused: '' }), msg(3)]);
    expect((await st.readChatOutboxAll(UID)).map((e) => e.clientId)).toEqual(['m2', 'm3', 'm1']);
    await st.deleteChatOutboxEntry(UID, 'm2');
    expect((idb.get(`bw:chat_outbox:${UID}`) as { clientId: string }[]).map((e) => e.clientId)).toEqual(['m1']);
    expect(st.readChatOutbox(UID).map((e) => e.clientId)).toEqual(['m3']);
    await st.deleteChatOutboxEntry(UID, 'm1');
    expect(idb.has(`bw:chat_outbox:${UID}`)).toBe(false);
    expect(st.readChatOutbox(UID).map((e) => e.clientId)).toEqual(['m3']);
  });

  // Sign-out pipeline step 4 (deletion wins over the kept lists): the kept
  // lists of the deleted account go in both stores; another account's stay.
  it('deleting the account erases its refused rehearsal notes and chat outbox in both stores', async () => {
    const kept = [`bw:rehearsal_notes_rejected:${UID}`, `bw:chat_outbox:${UID}`, `bw:live_refused:${UID}`];
    for (const k of kept) {
      idb.set(k, [{ id: 'n1', body: 'Tighter ending' }]);
      localStorage.setItem(k, JSON.stringify([{ id: 'n1', body: 'Tighter ending' }]));
    }
    idb.set(`bw:rehearsal_notes_rejected:${OTHER}`, [{ id: 'n2' }]);
    localStorage.setItem(`bw:rehearsal_notes_rejected:${OTHER}`, JSON.stringify([{ id: 'n2' }]));
    await discardAccountWrites(UID);
    for (const k of kept) {
      expect(idb.has(k)).toBe(false);
      expect(localStorage.getItem(k)).toBeNull();
    }
    expect(idb.has(`bw:rehearsal_notes_rejected:${OTHER}`)).toBe(true);
    expect(localStorage.getItem(`bw:rehearsal_notes_rejected:${OTHER}`)).toBeTruthy();
  });

  it('deleting the account erases its chat outbox in both stores; another account’s stays', async () => {
    idb.set(`bw:chat_outbox:${UID}`, [msg(1)]);
    idb.set(`bw:live_refused:${UID}`, [{ kind: 'note' }]);
    st.writeChatOutbox(UID, [msg(2)]);
    idb.set(`bw:chat_outbox:${OTHER}`, [msg(3)]);
    st.writeChatOutbox(OTHER, [msg(4)]);
    await discardAccountWrites(UID);
    expect(idb.has(`bw:chat_outbox:${UID}`)).toBe(false);
    expect(idb.has(`bw:live_refused:${UID}`)).toBe(false);
    expect(localStorage.getItem(`bw:chat_outbox:${UID}`)).toBeNull();
    expect(await st.readChatOutboxCount(UID)).toBe(0);
    expect(idb.has(`bw:chat_outbox:${OTHER}`)).toBe(true);
    expect(await st.readChatOutboxCount(OTHER)).toBe(2);
  });
});
