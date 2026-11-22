import { describe, it, expect } from 'vitest';
import * as former from '../formerMember';
import chatModal from '../../app/components/chat/ChatDetailModal.tsx?raw';
import chats from '../services/chats.ts?raw';
import suggestions from '../../app/components/songs/SongSuggestionsView.tsx?raw';
import it_ from '../i18n/locales/it';
import es from '../i18n/locales/es';
import fr from '../i18n/locales/fr';
import de from '../i18n/locales/de';
import pt from '../i18n/locales/pt';

// Owner decision 11-22: a deleted account's band and event chat messages
// stay with sender_id NULL (migration 180); the app names the author
// "Former member" instead of a generic "Member".
describe('former member', () => {
  const authorName = (former as any).authorName;

  it('a message without sender is a former member', () => {
    expect(authorName?.(null, null, 'Member', 'Former member')).toBe('Former member');
    expect(authorName?.(undefined, undefined, 'Member', 'Former member')).toBe('Former member');
  });

  it('a sender whose profile is not loaded yet is still a member', () => {
    expect(authorName?.('u1', null, 'Member', 'Former member')).toBe('Member');
    expect(authorName?.('u1', { full_name: 'Dana Reyes' }, 'Member', 'Former member')).toBe('Dana Reyes');
  });

  it('chat bubble, reply quote, search and song suggestions use it', () => {
    expect(chatModal).toMatch(/authorName\(message\.sender_id, message\.sender, t\('Member'\), t\('Former member'\)\)/);
    expect(chatModal).toMatch(/authorName\(replyTo\.sender_id, replyTo\.sender, t\('Unknown'\), t\('Former member'\)\)/);
    expect(chats).toMatch(/!msg\.sender_id \? t\('Former member'\)/);
    expect(suggestions.match(/authorName\(s\.created_by, s\.author, t\('Member'\), t\('Former member'\)\)/g)?.length).toBe(2);
  });

  it('is translated in every locale', () => {
    for (const d of [it_, es, fr, de, pt] as Record<string, string>[]) expect(d['Former member']).toBeTruthy();
  });
});

import appSource from '../../app/AuthenticatedApp.tsx?raw';

// #282 round 4: a direct chat whose other person deleted their account (no
// other participant left) is named "Former member" in the chat list, never
// the name stored on the chat.
describe('former member in a direct chat', () => {
  const directChatName = (former as any).directChatName;
  const base = { storedName: 'Rosa Diaz', fallback: 'Member', former: 'Former member' };

  it('no other participant left: a former member', () => {
    expect(directChatName?.({ ...base, others: [] })).toBe('Former member');
  });

  it('the other person with a profile: their name', () => {
    expect(directChatName?.({ ...base, others: [{ profile: { full_name: 'Gina Torres' } }] })).toBe('Gina Torres');
  });

  it('the other person without a profile loaded: as before (stored name, else Member)', () => {
    expect(directChatName?.({ ...base, others: [{ profile: null }] })).toBe('Rosa Diaz');
    expect(directChatName?.({ ...base, storedName: 'Direct Chat', others: [{ profile: null }] })).toBe('Member');
  });

  // Codex round 6: a missing participant row alone is not a deleted account
  // (old chats lost rows). An id of theirs still on the chat or its last
  // message means the account is there (both columns are cleared when it goes).
  it('no participant row but their id on the chat: the stored name, not a former member', () => {
    expect(directChatName?.({ ...base, others: [], me: 'me', otherIds: ['them'] })).toBe('Rosa Diaz');
    expect(directChatName?.({ ...base, storedName: 'Direct Chat', others: [], me: 'me', otherIds: ['them'] })).toBe('Member');
  });

  it('only my own id (or none) left: a former member', () => {
    expect(directChatName?.({ ...base, others: [], me: 'me', otherIds: ['me', null, undefined] })).toBe('Former member');
  });

  it('the chat list uses it, with the chat creator and the last sender', () => {
    expect(appSource).toMatch(/directChatName\(\{/);
    expect(appSource).toMatch(/otherIds: \[\(chat as any\)\.created_by, chat\.last_message\?\.sender_id\]/);
  });
});
