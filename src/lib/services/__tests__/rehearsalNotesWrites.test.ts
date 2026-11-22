import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Audit 06 #5: the outbox can only tell a 503 from a refusal if the write
 * says which HTTP status it got (supabase-js puts it next to the error).
 */
let answer: { data: unknown; error: unknown; status: number } = { data: null, error: null, status: 200 };
vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'update', 'insert', 'delete', 'upsert', 'eq', 'in', 'select']) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(answer).then(resolve);
  return { supabase: chain };
});

import { deleteNote, saveNote, setNoteOk, setPractised } from '../rehearsalNotes';
import type { RehearsalNote } from '@/lib/rehearsalNotes';

const note: RehearsalNote = {
  id: 'n1',
  bandId: 'b',
  eventId: 'e',
  date: '2026-11-19',
  sessionId: null,
  songId: null,
  songTitle: null,
  preset: 'tempo',
  section: null,
  line: null,
  body: 'Bridge rushes',
  scope: 'band',
  status: 'open',
  markedAtS: null,
  createdBy: 'u1',
  okBy: null,
  okAt: null,
  createdAt: '2026-11-19T20:00:00.000Z',
  assignees: [],
};

describe('rehearsal note writes report their HTTP status', () => {
  beforeEach(() => {
    answer = { data: null, error: { message: 'Service Unavailable', code: '' }, status: 503 };
  });

  it('save, delete, practised and OK: a 503 comes back as such', async () => {
    expect(await saveNote(note, [])).toMatchObject({ status: 503 });
    expect(await deleteNote('n1')).toMatchObject({ status: 503 });
    expect(await setPractised('n1', 'u1', true)).toMatchObject({ status: 503 });
    expect(await setNoteOk('n1', true)).toMatchObject({ status: 503 });
  });

  it('a saved note has no error', async () => {
    answer = { data: [{ id: 'n1' }], error: null, status: 200 };
    expect((await saveNote(note, [])).error).toBeNull();
  });
});
