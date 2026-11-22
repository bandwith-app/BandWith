import { describe, expect, it } from 'vitest';
import authSrc from '../../../supabase/functions/_shared/auth.ts?raw';
import { quoteChatReaders, type RpcCall } from '../../../supabase/functions/_shared/quote-chat';

/**
 * 178 (Codex #294 B1): a member still listed in a quote's event chat must not
 * get message previews by push. send-push asks bw_chat_push_readers per
 * recipient instead of trusting the participant rows.
 */
const rpcReturning = (data: unknown, error: unknown = null): { rpc: RpcCall; calls: unknown[] } => {
  const calls: unknown[] = [];
  return { calls, rpc: async (fn, args) => { calls.push({ fn, args }); return { data, error }; } };
};

describe('quoteChatReaders', () => {
  it('keeps only the people the database allows', async () => {
    const { rpc, calls } = rpcReturning(['admin-2']);
    expect(await quoteChatReaders(rpc, 'chat-1', ['admin-2', 'member-1'])).toEqual(['admin-2']);
    expect(calls).toEqual([{ fn: 'bw_chat_push_readers', args: { p_chat_id: 'chat-1', p_user_ids: ['admin-2', 'member-1'] } }]);
  });
  it('before 178 is applied (no function): everyone stays', async () => {
    const { rpc } = rpcReturning(null, { code: 'PGRST202', message: 'Could not find the function public.bw_chat_push_readers' });
    expect(await quoteChatReaders(rpc, 'chat-1', ['a', 'b'])).toEqual(['a', 'b']);
  });
  it('any other error: nobody', async () => {
    const { rpc } = rpcReturning(null, { code: '57014', message: 'timeout' });
    expect(await quoteChatReaders(rpc, 'chat-1', ['a'])).toEqual([]);
  });
  it('no recipients: no call', async () => {
    const { rpc, calls } = rpcReturning([]);
    expect(await quoteChatReaders(rpc, 'chat-1', [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('send-push wiring', () => {
  it('chatRecipients (used by send-push) applies the quote rule after the participant check', () => {
    const fn = authSrc.slice(authSrc.indexOf('export async function chatRecipients('));
    expect(fn).toContain('chatParticipantRecipients(');
    expect(fn).toContain('quoteChatReaders(');
    // Only one exported chatRecipients, so every caller goes through the rule.
    expect(authSrc.match(/export async function chatRecipients\(/g)).toHaveLength(1);
  });
});
