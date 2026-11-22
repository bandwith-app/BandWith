import { describe, it, expect, vi, beforeEach } from 'vitest';

// Round 5 (Codex B2): A's sign-out sheet is open; another tab signs B in.
// "Send now" must never send A's rehearsal note (or anything) as B: every
// change goes only while its owner is the session, else it stays queued.

const m = vi.hoisted(() => ({ session: 'u-a' as string | null, switchTo: null as string | null, sent: [] as string[] }));
vi.mock('@/lib/sessionUser', () => ({ sessionUserId: async () => m.session }));
vi.mock('@/lib/services/liveOutboxApi', () => ({
  liveOutboxApi: {
    isSessionUser: async (u: string) => m.session === u,
    note: async (op: { id: string }) => (m.sent.push(`note:${op.id}`), { error: null }),
    noteDelete: async () => ({ error: null }),
    suggestion: async () => ({ error: null }),
    order: async () => ({ error: null }),
  },
}));
vi.mock('@/lib/services/rehearsalNotes', () => {
  const sent = (tag: string) => async (id: string) => {
    m.sent.push(`${tag}:${id}`);
    if (m.switchTo) m.session = m.switchTo;
    return { error: null };
  };
  return { saveNote: async () => ({ error: null }), deleteNote: sent('rehearsal'), setPractised: async () => ({ error: null }), setNoteOk: async () => ({ error: null }) };
});

import { sendWaitingNow } from '../useLiveOutbox';
import { queueNoteOp, readOutbox } from '@/lib/rehearsalNotesOutbox';

beforeEach(() => {
  localStorage.clear();
  m.session = 'u-a';
  m.switchTo = null;
  m.sent = [];
});

describe('Send now sends only as the owner', () => {
  it("B signed in meanwhile: A's rehearsal note is not sent and stays queued for A", async () => {
    queueNoteOp('u-a', { kind: 'delete', id: 'r1' });
    m.session = 'u-b';
    const res = await sendWaitingNow('u-a');
    expect(m.sent).toEqual([]);
    expect(readOutbox('u-a')).toHaveLength(1);
    expect(res.left).toBe(1);
  });

  it('the session switches after the first note: the next one waits for its owner', async () => {
    queueNoteOp('u-a', { kind: 'delete', id: 'r1' });
    queueNoteOp('u-a', { kind: 'delete', id: 'r2' });
    m.switchTo = 'u-b';
    await sendWaitingNow('u-a');
    expect(m.sent).toEqual(['rehearsal:r1']);
    expect(readOutbox('u-a').map((o) => (o as { id: string }).id)).toEqual(['r2']);
  });
});
