/**
 * Codex round 3 on #293 (185:314): the balance send names the
 * balance_version it published, so one replaced meanwhile is refused.
 * A database before 185 has no such parameter: recorded without it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc, from: vi.fn(), functions: { invoke: vi.fn() } }, getSafeUser: vi.fn() }));

import * as links from '../quoteLinks';

beforeEach(() => rpc.mockReset());

describe('markQuoteBalanceSent', () => {
  it('sends the balance version it published', async () => {
    rpc.mockResolvedValue({ data: 'balance_requested', error: null });
    const r = await links.markQuoteBalanceSent('q-1', 'sent', 'email', 4);
    expect(r).toEqual({ data: 'balance_requested', error: null });
    expect(rpc).toHaveBeenCalledWith('bw_quote_balance_mark_sent', { p_quote_id: 'q-1', p_kind: 'sent', p_channel: 'email', p_balance_version: 4 });
  });

  it('a balance replaced meanwhile comes back as a balance-changed error', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'BW_BALANCE_CHANGED: the balance was changed after this one was sent' } });
    const r = await links.markQuoteBalanceSent('q-1', 'sent', 'whatsapp', 4);
    expect(typeof (links as any).isBalanceChangedError).toBe('function');
    expect(links.isBalanceChangedError(r.error)).toBe(true);
    expect(links.isBalanceChangedError(new Error('Failed to fetch'))).toBe(false);
  });

  it('a database before 185: recorded without the version', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
      .mockResolvedValueOnce({ data: 'balance_requested', error: null });
    const r = await links.markQuoteBalanceSent('q-1', 'reminded', 'copy', 2);
    expect(r.error).toBeNull();
    expect(rpc).toHaveBeenLastCalledWith('bw_quote_balance_mark_sent', { p_quote_id: 'q-1', p_kind: 'reminded', p_channel: 'copy' });
  });
});
