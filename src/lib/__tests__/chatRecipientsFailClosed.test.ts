import { describe, it, expect } from 'vitest';
import { isMissingRpc } from '../../../supabase/functions/_shared/rpc-missing';
import authSrc from '../../../supabase/functions/_shared/auth.ts?raw';

// Codex #289 r2: chatRecipients fell back to raw chat_participants rows on
// ANY error of bw_chat_recipient_ids, so a transient failure pushed message
// previews to people 175 had taken out of the chat (a demoted admin off the
// lineup keeps a participant row). Only "the function is not there yet"
// (175 not applied) may use the old list; anything else sends nothing.
describe('chat push recipients fail closed', () => {
  it('knows "function not applied yet" from other errors', () => {
    expect(isMissingRpc({ code: 'PGRST202', message: 'Could not find the function public.bw_chat_recipient_ids' })).toBe(true);
    expect(isMissingRpc({ code: '42883', message: 'function public.bw_chat_recipient_ids(uuid, uuid) does not exist' })).toBe(true);
    expect(isMissingRpc({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false);
    expect(isMissingRpc({ code: '', message: 'fetch failed' })).toBe(false);
    expect(isMissingRpc({ message: 'FetchError: network' })).toBe(false);
    expect(isMissingRpc(null)).toBe(false);
  });

  it('chatRecipients falls back only for a missing function, otherwise sends to nobody', () => {
    const fn = authSrc.slice(authSrc.indexOf('export async function chatRecipients'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toMatch(/isMissingRpc\(rpcError\)/);
    expect(body).toMatch(/if \(rpcError && !isMissingRpc\(rpcError\)\)[\s\S]{0,200}return \[\];/);
  });
});
