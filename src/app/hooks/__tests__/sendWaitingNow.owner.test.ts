import { describe, it, expect, vi, beforeEach } from 'vitest';

// Round 5 (Codex B2): A's sign-out sheet is open; another tab signs B in.
// "Send now" must never send A's rehearsal note (or anything) as B: every
// change goes only while its owner is the session, else it stays queued.

const m = vi.hoisted(() => ({ session: 'u-a' as string | null, switchTo: null as string | null, sent: [] as string[], saveError: null as unknown }));
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
  return { saveNote: async () => ({ error: m.saveError }), deleteNote: sent('rehearsal'), setPractised: async () => ({ error: null }), setNoteOk: async () => ({ error: null }) };
});

import { sendWaitingNow } from '../useLiveOutbox';
import { queueNoteOp, readOutbox } from '@/lib/rehearsalNotesOutbox';

beforeEach(() => {
  localStorage.clear();
  m.session = 'u-a';
  m.switchTo = null;
  m.sent = [];
  m.saveError = null;
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

// Round 6 (Codex B6): Send now, and the server refuses a rehearsal note for
// good (not allowed): the note is kept in #296's refused list
// (`bw:rehearsal_notes_rejected:<uid>`, the note itself), never deleted, so
// "1 change was refused, you'll find it…" is true. A passing server problem
// keeps it queued.
describe('Send now: a refused rehearsal note is kept, never deleted', () => {
  const note = {
    id: 'rn1', bandId: 'b1', eventId: 'e1', date: '2026-11-22', sessionId: null, songId: 's1', songTitle: 'Autumn Leaves',
    preset: null, section: null, body: 'Bridge: wait for the drums in Brooklyn', authorId: 'u-a', assignees: [], status: 'open',
  } as never;
  it('42501 on a note: moved to the rehearsal refused list, counted as refused', async () => {
    queueNoteOp('u-a', { kind: 'save', note, before: [] });
    m.saveError = { code: '42501', message: 'permission denied' };
    const res = await sendWaitingNow('u-a');
    expect(readOutbox('u-a')).toEqual([]);
    const kept = JSON.parse(localStorage.getItem('bw:rehearsal_notes_rejected:u-a') || '[]');
    expect(kept).toEqual([note]);
    expect(res.refused).toBe(1);
  });

  // #296 round 6: one entry per refused version (its rejectedKey); a later
  // refused version of the same note never writes over the earlier words.
  it('a second refused version of the same note: both kept, the new one counted as refused', async () => {
    const earlier = { ...(note as object), body: 'Bridge: wait for the drums' };
    localStorage.setItem('bw:rehearsal_notes_rejected:u-a', JSON.stringify([earlier]));
    queueNoteOp('u-a', { kind: 'save', note, before: [] });
    m.saveError = { code: '42501', message: 'permission denied' };
    const res = await sendWaitingNow('u-a');
    expect(readOutbox('u-a')).toEqual([]);
    expect(JSON.parse(localStorage.getItem('bw:rehearsal_notes_rejected:u-a') || '[]')).toEqual([earlier, note]);
    expect(res).toMatchObject({ refused: 1, refusedNotes: 1 });
  });

  it('a 503 is not a refusal: the note stays queued, nothing in the refused list', async () => {
    queueNoteOp('u-a', { kind: 'save', note, before: [] });
    m.saveError = { code: '503', message: 'Service Unavailable', status: 503 };
    const res = await sendWaitingNow('u-a');
    expect(readOutbox('u-a')).toHaveLength(1);
    expect(localStorage.getItem('bw:rehearsal_notes_rejected:u-a')).toBeNull();
    expect(res.refused).toBe(0);
  });
});

