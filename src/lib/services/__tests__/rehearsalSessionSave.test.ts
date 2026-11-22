import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Audit 06 #3/#4: a rehearsal session is saved only on top of the revision
 * it was read at, or as a new row; never upserted over one that moved on.
 */
let answer: { data: unknown; error: unknown } = { data: null, error: null };
const calls: [string, ...unknown[]][] = [];
vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'update', 'insert', 'upsert', 'eq', 'select']) {
    chain[m] = vi.fn((...a: unknown[]) => {
      calls.push([m, ...a]);
      return chain;
    });
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(answer).then(resolve);
  return { supabase: chain };
});

import { saveRehearsalSession } from '../rehearsalSessions';
import type { SessionRow } from '@/lib/rehearsalSession';

const row: SessionRow = {
  band_id: 'b',
  event_id: 'e',
  occurrence_date: '2026-11-19',
  started_at: '2026-11-19T20:00:00.000Z',
  paused_ms: 0,
  paused_at: '2026-11-19T20:30:00.000Z',
  ended_at: null,
  summary: { v: 1, durationS: 1800, played: [], total: 3 },
};
const REV = '2026-11-19T20:25:00.123456+00:00';

beforeEach(() => {
  calls.length = 0;
  answer = { data: [{ updated_at: '2026-11-19T20:30:00.5+00:00' }], error: null };
});

describe('saveRehearsalSession', () => {
  it('with a revision: updates only that revision of this occurrence, and hands back the new one', async () => {
    expect(await saveRehearsalSession(row, REV)).toEqual({ error: null, rev: '2026-11-19T20:30:00.5+00:00' });
    expect(calls.map((c) => c[0])).not.toContain('upsert');
    expect(calls).toContainEqual(['update', row]);
    expect(calls).toContainEqual(['eq', 'event_id', 'e']);
    expect(calls).toContainEqual(['eq', 'occurrence_date', '2026-11-19']);
    expect(calls).toContainEqual(['eq', 'updated_at', REV]);
  });

  it('the row moved on (nothing updated): a conflict, nothing written', async () => {
    answer = { data: [], error: null };
    expect(await saveRehearsalSession(row, REV)).toEqual({ error: null, conflict: true });
  });

  it('without a revision: only a new row; one already there is a conflict', async () => {
    expect((await saveRehearsalSession(row, null)).rev).toBeTruthy();
    expect(calls.map((c) => c[0])).toContain('insert');
    expect(calls.map((c) => c[0])).not.toContain('upsert');
    answer = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "rehearsal_sessions_occurrence_key"' } };
    expect(await saveRehearsalSession(row)).toEqual({ error: null, conflict: true });
  });

  it('the server guard (196) refusing a new start over a saved one is a conflict too; other errors stay errors', async () => {
    answer = { data: null, error: { code: 'P0001', message: 'rehearsal_session_conflict: started over a saved session' } };
    expect(await saveRehearsalSession(row, REV)).toEqual({ error: null, conflict: true });
    answer = { data: null, error: { message: 'Failed to fetch' } };
    expect(await saveRehearsalSession(row, REV)).toEqual({ error: { message: 'Failed to fetch' } });
  });
});
