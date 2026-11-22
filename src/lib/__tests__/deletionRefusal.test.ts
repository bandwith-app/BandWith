import { describe, it, expect } from 'vitest';
import { deletionRefusal, deletionRefusalMessage } from '../deletionRefusal';
import { userMessage, planOr, planRefusal } from '../userError';
import { chatErrorMessage } from '../services/chats';
import viewSource from '../../app/views/BandMembersView.tsx?raw';
import invitationsSource from '../services/invitations.ts?raw';
import itDict from '../i18n/locales/it';
import esDict from '../i18n/locales/es';
import frDict from '../i18n/locales/fr';
import deDict from '../i18n/locales/de';
import ptDict from '../i18n/locales/pt';

// What PostgREST hands the app for 180's refusals (round 5).
const guard = (by: 'admin' | 'member') => ({
  code: 'P0001',
  message: by === 'admin'
    ? 'An admin of this band is deleting their account. Try again in a few minutes.'
    : 'A member of this band is deleting their account. Try again in a few minutes.',
  details: JSON.stringify({ conflict: by === 'admin' ? 'last_admin' : 'others_leaving', by }),
  hint: 'account_deletion_in_progress',
});
const sendRefused = { code: 'P0001', message: 'Your account is being deleted.', details: null, hint: 'account_being_deleted' };

// Claude review #282, round 5, minors 4-5.
describe('account deletion refusals', () => {
  it('tells an admin from a member deleting', () => {
    expect(deletionRefusal(guard('admin'))).toBe('admin');
    expect(deletionRefusal(guard('member'))).toBe('member');
    expect(deletionRefusal(sendRefused)).toBe('own');
    expect(deletionRefusal({ message: 'duplicate key value' })).toBeNull();
    expect(deletionRefusal(null)).toBeNull();
  });

  it('gives the app text, not the server English', () => {
    expect(deletionRefusalMessage(guard('admin'))).toBe('An admin of this band is deleting their account. Try again in a few minutes.');
    expect(deletionRefusalMessage(guard('member'))).toBe('A member of this band is deleting their account. Try again in a few minutes.');
    expect(deletionRefusalMessage(sendRefused)).toBe('Your account is being deleted.');
  });

  it('every path: generic errors, plan wrappers, chat send, invites', () => {
    expect(userMessage(guard('member'), 'Failed to create band')).toBe('Failed to create band. A member of this band is deleting their account. Try again in a few minutes.');
    expect(planOr(guard('admin'), 'x')).toBe('An admin of this band is deleting their account. Try again in a few minutes.');
    expect(planRefusal(guard('member'))?.message).toBe('A member of this band is deleting their account. Try again in a few minutes.');
    expect(chatErrorMessage(sendRefused, 'Message not sent. Try again.')).toBe('Your account is being deleted.');
    expect(invitationsSource).toMatch(/deletionRefusalMessage\(error\)/);
  });

  it('the band members screen: admin or member text, no blank double line', () => {
    expect(viewSource).not.toContain('Another admin of this band is deleting');
    expect((viewSource.match(/deletionRefusalMessage\(error\)/g) ?? []).length).toBe(3);
    expect(viewSource).not.toMatch(/\n\s*\n\s*\n\s*const confirmRemoveMember/);
  });

  it('is translated in all five languages', () => {
    const keys = [
      'An admin of this band is deleting their account. Try again in a few minutes.',
      'A member of this band is deleting their account. Try again in a few minutes.',
      'Your account is being deleted.',
      'Your account is being deleted. It will be gone within a few minutes.',
    ];
    for (const [lang, dict] of Object.entries({ it: itDict, es: esDict, fr: frDict, de: deDict, pt: ptDict })) {
      for (const k of keys) expect((dict as Record<string, string>)[k], `${lang}: ${k}`).toBeTruthy();
    }
  });
});
