import { personName } from './personName';

type Named = Parameters<typeof personName>[0];

/**
 * Who wrote a message or a song suggestion. A deleted account's band and
 * event chat messages and suggestions stay with no author id (migration 180,
 * owner decision 11-22): that is a former member. With an id but no profile
 * loaded (yet), `fallback` as before.
 */
export function authorName(authorId: string | null | undefined, person: Named, fallback: string, former: string): string {
  return authorId ? personName(person, fallback) : former;
}

const GENERIC_CHAT_NAMES = new Set(['', 'New Chat', 'Chat', 'Direct Chat']);

/**
 * The name of a direct chat in the chat list. When the other person deleted
 * their account their participant row went with the profile (migration 180):
 * with no other participant left, that is a former member, never the name
 * stored on the chat. Otherwise the other person's name, else the stored
 * name, else `fallback` (as before).
 *
 * Codex round 6: an old chat can miss a participant row while the account
 * is there. `otherIds` are the ids still on the chat (its creator, the last
 * sender): an id that isn't mine means that account exists (180 clears both
 * when it goes), so the chat keeps its stored name.
 */
export function directChatName(opts: {
  others: { profile?: Named | null }[];
  storedName?: string | null;
  fallback: string;
  former: string;
  me?: string | null;
  otherIds?: (string | null | undefined)[];
}): string {
  const otherAccountThere = (opts.otherIds ?? []).some((id) => !!id && id !== opts.me);
  if (opts.others.length === 0 && !otherAccountThere) return opts.former;
  const withProfile = opts.others.find((p) => p.profile);
  const name = withProfile ? personName(withProfile.profile, '') : '';
  if (name) return name;
  const stored = (opts.storedName ?? '').trim();
  return GENERIC_CHAT_NAMES.has(stored) ? opts.fallback : stored;
}
