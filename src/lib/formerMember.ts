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
