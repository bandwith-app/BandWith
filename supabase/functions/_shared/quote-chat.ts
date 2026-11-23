/**
 * Quote chats (migration 178): of the people send-push would tell about a
 * chat message, only those who may read that chat. The event chat of a gig
 * that is still a quote is for the band's admins; bw_chat_push_readers
 * applies that rule per recipient, whatever the participant rows say.
 *
 * Plain TypeScript with no imports: Deno and vitest share this file.
 */

export type RpcCall = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

/** PostgREST: the function is not in the schema (178 not applied yet). */
const isMissingFunction = (error: unknown): boolean => {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === 'PGRST202' || e?.code === '42883' || /bw_chat_push_readers/.test(String(e?.message ?? '')) && /not find|does not exist/i.test(String(e?.message ?? ''));
};

/**
 * `ids` filtered by the quote rule. Before 178 is applied there is no rule:
 * everyone stays. Any other error: nobody (a push can wait, a leak can't).
 */
export async function quoteChatReaders(rpc: RpcCall, chatId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return ids;
  const { data, error } = await rpc('bw_chat_push_readers', { p_chat_id: chatId, p_user_ids: ids });
  if (error) return isMissingFunction(error) ? ids : [];
  if (!Array.isArray(data)) return [];
  const ok = new Set((data as unknown[]).map(String));
  return ids.filter((id) => ok.has(id));
}
