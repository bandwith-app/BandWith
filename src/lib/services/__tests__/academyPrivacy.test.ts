import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('../supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

import { isPollVotingClosed, pollVoteDeadline, POLL_COLUMNS } from '../rehearsalPolls';
import { INVENTORY_COLUMNS, toInventoryRow } from '../inventory';

describe('poll vote-by deadline (117)', () => {
  it('has no deadline without vote_by', () => {
    expect(pollVoteDeadline({ vote_by: null })).toBeNull();
    expect(isPollVotingClosed({ vote_by: null }, new Date('2030-01-01T00:00:00'))).toBe(false);
  });

  it('closes at the vote-by time, local', () => {
    const poll = { vote_by: '2026-12-11', vote_by_time: '18:00:00' };
    expect(isPollVotingClosed(poll, new Date('2026-12-11T17:59:00'))).toBe(false);
    expect(isPollVotingClosed(poll, new Date('2026-12-11T18:01:00'))).toBe(true);
  });

  it('without a time, stays open until the end of that day', () => {
    const poll = { vote_by: '2026-12-11', vote_by_time: null };
    expect(isPollVotingClosed(poll, new Date('2026-12-11T23:30:00'))).toBe(false);
    expect(isPollVotingClosed(poll, new Date('2026-12-12T00:01:00'))).toBe(true);
  });
});

describe('private columns stay out of direct reads (114, 115, 119)', () => {
  it('polls are read without room_cost', () => {
    expect(POLL_COLUMNS.split(',').map((c) => c.trim())).not.toContain('room_cost');
  });

  it('gear is read without purchase data', () => {
    const cols = INVENTORY_COLUMNS.split(',').map((c) => c.trim());
    for (const c of ['serial_number', 'purchase_date', 'purchase_price']) expect(cols).not.toContain(c);
  });

  it('a save leaves purchase data alone when it was not loaded', () => {
    const input = { name: 'Amp', category: 'Other', quantity: 1, status: 'lost', serialNumber: '', purchasePrice: '' };
    const kept = toInventoryRow(input, false).row!;
    expect('serial_number' in kept || 'purchase_date' in kept || 'purchase_price' in kept).toBe(false);
    const full = toInventoryRow(input).row!;
    expect(full).toMatchObject({ serial_number: null, purchase_date: null, purchase_price: null, status: 'lost' });
  });
});
