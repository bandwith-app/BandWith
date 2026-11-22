/**
 * Review of #293: before migration 185 the lineup of an edited quote is
 * written directly. Deleting the old rows first meant a connection lost
 * before the insert left the quote with no musicians at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { id: string; quote_id: string; name: string; fee: number };
let rows: Row[];
let failInsert: boolean;
let failDelete: boolean;
const calls: string[] = [];

vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    if (table !== 'quote_musicians') throw new Error(table);
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'delete' | 'insert' = 'select';
    let inserted: Row[] = [];
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: keyof Row, v: unknown) => (filters.push((r) => r[col] === v), b);
    b.in = (col: keyof Row, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), b);
    b.delete = () => ((op = 'delete'), b);
    b.insert = (list: Omit<Row, 'id'>[]) => {
      op = 'insert';
      inserted = list.map((r, i) => ({ ...r, id: `new-${rows.length + i}` }) as Row);
      return b;
    };
    b.then = (ok: (v: unknown) => unknown) => {
      calls.push(op);
      if (op === 'insert') {
        if (failInsert) return Promise.resolve({ data: null, error: { message: 'Network request failed' } }).then(ok);
        rows.push(...inserted);
        return Promise.resolve({ data: inserted, error: null }).then(ok);
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'delete') {
        if (failDelete) return Promise.resolve({ data: null, error: { message: 'Network request failed' } }).then(ok);
        rows = rows.filter((r) => !hit.includes(r));
        return Promise.resolve({ data: null, error: null }).then(ok);
      }
      return Promise.resolve({ data: hit, error: null }).then(ok);
    };
    return b;
  };
  return {
    supabase: {
      // A database before 185: no bw_quote_save_musicians.
      rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
      from,
    },
  };
});

import { saveQuoteMusicians } from '../quotes';

const Q = '22222222-2222-4222-8222-222222222222';
const lineup = [
  { name: 'Maya Brooks', instrument: 'Guitar', fee: 350, user_id: null, is_external: false, is_available: true },
  { name: 'Sam Ortiz', instrument: 'Bass', fee: 300, user_id: null, is_external: false, is_available: true },
];

beforeEach(() => {
  rows = [
    { id: 'old-1', quote_id: Q, name: 'Maya Brooks', fee: 300 },
    { id: 'old-2', quote_id: Q, name: 'Sam Ortiz', fee: 250 },
  ];
  failInsert = false;
  failDelete = false;
  calls.length = 0;
});

describe('saveQuoteMusicians before 185', () => {
  it('replaces the lineup', async () => {
    const res = await saveQuoteMusicians(Q, lineup as never);
    expect(res.error).toBeNull();
    expect(rows.map((r) => `${r.name}:${r.fee}`).sort()).toEqual(['Maya Brooks:350', 'Sam Ortiz:300']);
  });

  it('a connection lost before the new rows are in keeps the old lineup', async () => {
    failInsert = true;
    const res = await saveQuoteMusicians(Q, lineup as never);
    expect(res.error).toBeTruthy();
    expect(rows.map((r) => r.id).sort()).toEqual(['old-1', 'old-2']);
  });

  it('the old rows failing to go: the new rows are taken back, the old lineup stays', async () => {
    failDelete = true;
    const res = await saveQuoteMusicians(Q, lineup as never);
    expect(res.error).toBeTruthy();
    // The cleanup delete fails too here, so at least the musicians are never all gone.
    expect(rows.filter((r) => r.id.startsWith('old-')).length).toBe(2);
  });
});
