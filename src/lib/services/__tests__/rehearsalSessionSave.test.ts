import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Audit 06 #3/#4: a rehearsal session is saved only on top of the revision
 * it was read at, or as a new row; never upserted over one that moved on.
 */
let answer: { data: unknown; error: unknown } = { data: null, error: null };
const calls: [string, ...unknown[]][] = [];
vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'update', 'insert', 'upsert', 'eq', 'select', 'rpc']) {
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
  paused_at: null,
  ended_at: '2026-11-19T20:30:00.000Z',
  summary: { v: 1, durationS: 1800, played: [], total: 3 },
};
/** Running (Pause, Resume, a song): through the function when it has a revision (#296 round 8). */
const running: SessionRow = { ...row, paused_at: '2026-11-19T20:30:00.000Z', ended_at: null };
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

  it('#296 round 8 (Codex r8 B5): running on a revision goes through bw_save_rehearsal_session, the one path that reopens an End', async () => {
    let rpcAnswer: { data: unknown; error: unknown } = { data: '2026-11-19T20:31:00.1+00:00', error: null };
    answer = rpcAnswer;
    expect(await saveRehearsalSession(running, REV)).toEqual({ error: null, rev: '2026-11-19T20:31:00.1+00:00' });
    const rpc = calls.find((c) => c[0] === 'rpc')!;
    expect(rpc[1]).toBe('bw_save_rehearsal_session');
    expect(rpc[2]).toEqual({
      p_event_id: 'e',
      p_occurrence_date: '2026-11-19',
      p_rev: REV,
      p_started_at: running.started_at,
      p_paused_ms: 0,
      p_paused_at: running.paused_at,
      p_ended_at: null,
      p_summary: running.summary,
    });
    expect(calls.map((c) => c[0])).not.toContain('update');
    // Nothing written (moved on): a conflict.
    calls.length = 0;
    rpcAnswer = { data: null, error: null };
    answer = rpcAnswer;
    expect(await saveRehearsalSession(running, REV)).toEqual({ error: null, conflict: true });
    // An End, or no revision: never through it.
    calls.length = 0;
    answer = { data: [{ updated_at: 'r9' }], error: null };
    await saveRehearsalSession(row, REV);
    await saveRehearsalSession(running, null);
    expect(calls.map((c) => c[0])).not.toContain('rpc');
  });

  it('#296 round 8: the function not there yet (196 not applied): the plain update, as before', async () => {
    let n = 0;
    answer = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    const then = (resolve: (v: unknown) => unknown) => {
      n++;
      return Promise.resolve(n === 1 ? answer : { data: [{ updated_at: 'r5' }], error: null }).then(resolve);
    };
    const { supabase } = (await import('@/lib/supabase')) as unknown as { supabase: { then: unknown } };
    const was = supabase.then;
    supabase.then = then;
    try {
      expect(await saveRehearsalSession(running, REV)).toEqual({ error: null, rev: 'r5' });
      expect(calls.map((c) => c[0])).toContain('update');
    } finally {
      supabase.then = was;
    }
  });
});
