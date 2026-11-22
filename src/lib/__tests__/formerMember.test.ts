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
