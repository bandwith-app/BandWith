import { describe, expect, it } from 'vitest';
import { mentionedUserIds } from '../chatMentions';

const people = [
  { id: 'ana', name: 'Ana' },
  { id: 'anam', name: 'Ana Maria' },
  { id: 'leo', name: 'Leo M.' },
  { id: 'me', name: 'Marco Rossi' },
];

describe('mentionedUserIds', () => {
  it('finds names the composer inserted', () => {
    expect(mentionedUserIds('@Leo M. can you bring the DI?', people)).toEqual(['leo']);
    expect(mentionedUserIds('ok @ana', people)).toEqual(['ana']);
  });

  it('prefers the longer name', () => {
    expect(mentionedUserIds('@Ana Maria see you at 8', people)).toEqual(['anam']);
    expect(mentionedUserIds('@Ana Maria and @Ana, both', people).sort()).toEqual(['ana', 'anam']);
  });

  it('needs the whole name and skips the sender', () => {
    expect(mentionedUserIds('@Anabel hi', people)).toEqual([]);
    expect(mentionedUserIds('@Marco Rossi note to self', people, 'me')).toEqual([]);
    expect(mentionedUserIds('no mentions here', people)).toEqual([]);
  });
});
