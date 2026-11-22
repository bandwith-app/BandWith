import { describe, it, expect, vi } from 'vitest';

// #281 round 4 (from #291's integrated test): with 175, participant rows are
// kept when someone leaves the band or the lineup, so push recipients must
// come from bw_chat_recipient_ids (the rule), never from chat_participants.
vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({ createClient: () => ({}) }));
// (A Deno file: loaded by path at run time so tsc does not type-check it.)
const AUTH_TS = '../../../supabase/functions/_shared/auth.ts';
const { chatRecipients, allowedRecipients } = await import(/* @vite-ignore */ AUTH_TS);

const CHAT = '11111111-1111-1111-1111-111111111111';
// chat_participants still lists STALE (left the band: row kept); the rule
// (bw_chat_recipient_ids) does not.
const rows = [
  { chat_id: CHAT, user_id: 'me' },
  { chat_id: CHAT, user_id: 'mate' },
  { chat_id: CHAT, user_id: 'stale' },
];
function fakeAdmin(opts: { rpc?: (fn: string, a: Record<string, unknown>) => { data: unknown; error: unknown } } = {}) {
  const tables: string[] = [];
  const rpc = vi.fn(async (fn: string, a: Record<string, unknown>) =>
    opts.rpc ? opts.rpc(fn, a) : fn === 'bw_chat_recipient_ids' ? { data: a.p_sender === 'stale' ? [] : ['me', 'mate'].filter((u) => u !== a.p_sender), error: null } : { data: null, error: null },
  );
  const from = (table: string) => {
    tables.push(table);
    let q = table === 'chat_participants' ? rows : [];
    const chain = {
      select: () => chain,
      eq: (col: string, v: unknown) => ((q = (q as Record<string, unknown>[]).filter((r) => col === 'is_active' || r[col] === v)), chain),
      in: (col: string, vs: unknown[]) => ((q = (q as Record<string, unknown>[]).filter((r) => vs.includes(r[col]))), chain),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: q, error: null }).then(res),
    };
    return chain;
  };
  return { admin: { rpc, from } as never, tables, rpc };
}

describe('send-push recipients follow the rule, not raw participant rows', () => {
  it('chatRecipients asks bw_chat_recipient_ids(chat, sender) and keeps only its answer', async () => {
    const { admin, tables, rpc } = fakeAdmin();
    const out = await chatRecipients(admin, 'me', CHAT, ['mate', 'stale']);
    expect(out).toEqual(['mate']);
    expect(rpc).toHaveBeenCalledWith('bw_chat_recipient_ids', { p_chat_id: CHAT, p_sender: 'me' });
    expect(tables).not.toContain('chat_participants');
  });

  it('a sender whose row the rule refuses reaches nobody', async () => {
    const { admin } = fakeAdmin();
    expect(await chatRecipients(admin, 'stale', CHAT, ['me', 'mate'])).toEqual([]);
  });

  it('allowedRecipients: a kept row shares no chat (rule per chat, no raw roster)', async () => {
    const { admin, rpc } = fakeAdmin();
    expect(await allowedRecipients(admin, 'stale', ['mate'])).toEqual([]);
    expect(await allowedRecipients(admin, 'me', ['mate'])).toEqual(['mate']);
    expect(rpc).toHaveBeenCalledWith('bw_chat_recipient_ids', { p_chat_id: CHAT, p_sender: 'me' });
  });
});
