/**
 * Chat @mentions. The composer inserts "@{name} " with the participant's
 * display name (personName); this finds whom a message mentions, so they can
 * be told ("Ana mentioned you").
 */

interface Participant {
  id: string;
  name: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Participants mentioned in `content`: "@Name" followed by the end, a space
 * or punctuation (case-insensitive). Longer names win, so "@Ana Maria" goes to
 * Ana Maria, not to Ana.
 */
export function mentionedUserIds(content: string, participants: Participant[], excludeId?: string | null): string[] {
  if (!content || !content.includes('@')) return [];
  let rest = content;
  const found: string[] = [];
  const byLength = participants
    .filter((p) => p.id && p.id !== excludeId && p.name.trim())
    .sort((a, b) => b.name.trim().length - a.name.trim().length);
  for (const p of byLength) {
    const re = new RegExp(`@${escape(p.name.trim())}(?=$|[\\s.,;:!?)\\]}'"’])`, 'giu');
    if (re.test(rest)) {
      if (!found.includes(p.id)) found.push(p.id);
      rest = rest.replace(re, ' ');
    }
  }
  return found;
}
