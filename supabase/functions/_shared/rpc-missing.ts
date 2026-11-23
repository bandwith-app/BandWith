/**
 * Is this the error of an RPC that the database does not have yet (its
 * migration not applied)? PostgREST answers PGRST202 ("Could not find the
 * function"); Postgres itself 42883 ("function ... does not exist").
 * Anything else (a timeout, the network, a refused call) is NOT this: a
 * caller that falls back to an older, weaker path must fail closed then.
 * Plain TypeScript with no imports: Deno and vitest share it.
 */
export function isMissingRpc(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST202' || error.code === '42883';
}
