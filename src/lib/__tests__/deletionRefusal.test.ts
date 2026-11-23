import { describe, it, expect } from 'vitest';
import { deletionRefusal, deletionRefusalMessage, serverErrorText } from '../deletionRefusal';
import eventTasksSrc from '../services/eventTasks.ts?raw';
import taskTemplatesSrc from '../services/taskTemplates.ts?raw';
import inventorySrc from '../services/inventory.ts?raw';
import gearKitsSrc from '../services/gearKits.ts?raw';
import contractsSrc from '../services/contracts.ts?raw';
import personalGigModalSrc from '../../app/components/modals/PersonalGigModal.tsx?raw';
import personalGigPartsSrc from '../../app/components/event/PersonalGigParts.tsx?raw';
import financeSrc from '../../app/components/dashboard/expanded/FinanceExpanded.tsx?raw';
import pollModalSrc from '../../app/components/rehearsal/RehearsalPollModal.tsx?raw';
import proposeSrc from '../../app/components/rehearsal/ProposeRehearsalModal.tsx?raw';
import pollCardSrc from '../../app/components/rehearsal/RehearsalPollCard.tsx?raw';
const writePaths = {
  eventTasks: eventTasksSrc, taskTemplates: taskTemplatesSrc, inventory: inventorySrc, gearKits: gearKitsSrc, contracts: contractsSrc,
  PersonalGigModal: personalGigModalSrc, PersonalGigParts: personalGigPartsSrc, FinanceExpanded: financeSrc,
  RehearsalPollModal: pollModalSrc, ProposeRehearsalModal: proposeSrc, RehearsalPollCard: pollCardSrc,
};
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

  // Main, round 6: the two new refusals (a band that goes with a deletion,
  // a row pointed at a member who is deleting), and every write path.
  it('a band that goes with a deletion, and a member who is deleting', () => {
    const closing = { code: 'P0001', message: 'This band is being deleted. You can’t join it.', hint: 'account_deletion_in_progress',
      details: JSON.stringify({ conflict: 'band_closing', by: 'admin' }) };
    const assignee = { code: 'P0001', message: 'This person is deleting their account. Choose someone else.', hint: 'account_deletion_in_progress',
      details: JSON.stringify({ conflict: 'account_being_deleted', by: 'member' }) };
    expect(deletionRefusal(closing)).toBe('band_closing');
    expect(deletionRefusal(assignee)).toBe('assignee');
    expect(deletionRefusalMessage(closing)).toBe('This band is being deleted. You can’t join it.');
    expect(deletionRefusalMessage(assignee)).toBe('This person is deleting their account. Choose someone else.');
    expect(serverErrorText(assignee, 'x')).toBe('This person is deleting their account. Choose someone else.');
    expect(serverErrorText({ message: 'duplicate key' }, 'x')).toBe('duplicate key');
    expect(serverErrorText(null, 'Could not save.')).toBe('Could not save.');
  });

  it('every screen that shows a server error for a write these triggers refuse', () => {
    for (const [name, src] of Object.entries(writePaths)) {
      expect(src, name).toMatch(/serverErrorText\(/);
    }
  });

  it('is translated in all five languages', () => {
    const keys = [
      'This band is being deleted. You can’t join it.',
      'This person is deleting their account. Choose someone else.',
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
