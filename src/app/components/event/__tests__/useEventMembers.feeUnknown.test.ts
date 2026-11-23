/**
 * Audit of 383f15b, events #5: when the fees fail to load, the lineup must
 * not read as "every fee is 0" (saving the lineup or the fee sheet then
 * wrote 0 over every real fee). Rows carry feeUnknown, and the hook loads
 * again when the device is back online.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';

const db = vi.hoisted(() => ({
  rows: [
    { user_id: 'u-1', status: 'confirmed', role: 'Guitar' },
    { user_id: 'u-2', status: 'confirmed', role: 'Bass' },
  ],
  money: vi.fn(),
}));
vi.mock('@/lib/supabase', () => {
  const chain: any = new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? (res: (v: unknown) => void) => res({ data: db.rows, error: null }) : chain),
    apply: () => chain,
  });
  return { supabase: { from: () => chain, rpc: vi.fn() } };
});
vi.mock('@/lib/services/eventMemberMoney', () => ({
  getEventMemberMoney: db.money,
  markEventPaid: vi.fn(),
}));
vi.mock('@/lib/services/eventStage', () => ({ setMemberPaid: vi.fn() }));

import { useEventMembers } from '../useEventMembers';

const band = {
  id: 'band-1',
  members: [
    { user_id: 'u-1', name: 'Maya Brooks', role: 'admin' },
    { user_id: 'u-2', name: 'Sam Ortiz', role: 'member' },
  ],
};
const opts = { eventId: 'evt-1', bandId: 'band-1', currentUserId: 'u-1', bands: [band], selectedBand: band };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useEventMembers: fees that failed to load', () => {
  it('marks every row feeUnknown instead of fee 0, and reloads when back online', async () => {
    db.money.mockResolvedValueOnce({ data: [], error: new Error('Failed to fetch') });
    const { result } = renderHook(() => useEventMembers(opts));
    await waitFor(() => expect(result.current.members?.length).toBe(2));
    expect(result.current.members!.every((m) => m.feeUnknown)).toBe(true);

    db.money.mockResolvedValueOnce({
      data: [
        { event_id: 'evt-1', user_id: 'u-1', fee: 400, paid_at: null },
        { event_id: 'evt-1', user_id: 'u-2', fee: 350, paid_at: null },
      ],
      error: null,
    });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(result.current.members?.some((m) => m.feeUnknown)).toBe(false));
    expect(result.current.members!.map((m) => m.fee)).toEqual([400, 350]);
  });

  it('a normal load has no feeUnknown', async () => {
    db.money.mockResolvedValueOnce({ data: [{ event_id: 'evt-1', user_id: 'u-1', fee: 400, paid_at: null }], error: null });
    const { result } = renderHook(() => useEventMembers(opts));
    await waitFor(() => expect(result.current.members?.length).toBe(2));
    expect(result.current.members!.some((m) => m.feeUnknown)).toBe(false);
  });
});
