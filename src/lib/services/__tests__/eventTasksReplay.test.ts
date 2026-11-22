import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Codex #297 MINOR: a task insert that committed but whose answer was lost
 * was inserted again on replay. New drafts get a stable id the first time
 * they are sent; every later try sends the same ids and skips rows already
 * there (insert … on conflict do nothing).
 */
const db = vi.hoisted(() => ({ writes: [] as { op: string; rows: any[]; opts?: any }[] }));

vi.mock('@/lib/supabase', () => {
  const from = () => {
    const q: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') return (res: (v: unknown) => void) => res({ data: [], error: null });
        return (arg?: any, opts?: any) => {
          if (prop === 'insert' || prop === 'upsert') db.writes.push({ op: String(prop), rows: arg, opts });
          return q;
        };
      },
    });
    return q;
  };
  return { supabase: { from } };
});

import { syncEventTasks, type EventTaskDraft } from '../eventTasks';

beforeEach(() => { db.writes.length = 0; });

describe('new tasks sent twice', () => {
  it('carry the same ids both times and never duplicate', async () => {
    const drafts: EventTaskDraft[] = [{ title: 'Book the room' }, { title: 'Print charts' }];
    await syncEventTasks('ev', drafts, '2099-12-01', []);
    // The answer was lost: the queue replays the same drafts (as stored).
    const stored = JSON.parse(JSON.stringify(drafts)) as EventTaskDraft[];
    await syncEventTasks('ev', stored, '2099-12-01', []);
    expect(db.writes.map((w) => w.op)).toEqual(['upsert', 'upsert']);
    const ids = db.writes.map((w) => w.rows.map((r: any) => r.id));
    // crypto.randomUUID (stubbed in the test setup): one id per new task.
    expect(ids[0].every((id: unknown) => typeof id === 'string' && (id as string).length > 0)).toBe(true);
    expect(new Set(ids[0]).size).toBe(2);
    expect(ids[1]).toEqual(ids[0]);
    expect(db.writes[0].opts).toMatchObject({ onConflict: 'id', ignoreDuplicates: true });
  });

  it('saved tasks (with a real id) are still updated, not re-sent', async () => {
    await syncEventTasks('ev', [{ id: 't1', title: 'Kept' }], '2099-12-01', ['t1']);
    expect(db.writes).toEqual([]);
  });
});
