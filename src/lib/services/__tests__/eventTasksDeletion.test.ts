import { afterEach, describe, expect, it, vi } from 'vitest';

// What PostgREST hands the app when 180 refuses a task assigned to a member
// whose account deletion is committed (round 6).
const refusal = {
  code: 'P0001',
  message: 'This person is deleting their account. Choose someone else.',
  details: JSON.stringify({ conflict: 'account_being_deleted', by: 'member' }),
  hint: 'account_deletion_in_progress',
};
const insert = vi.fn(async () => ({ error: refusal }));
vi.mock('../../supabase', () => ({ supabase: { from: () => ({ insert }) } }));

import { syncEventTasks } from '../eventTasks';
import { setLocalePref } from '@/lib/i18n';

// Main, round 6: the triggers' refusals in the app's own words, translated.
describe('a task assigned to a member who is deleting their account', () => {
  afterEach(() => setLocalePref('en'));

  it('says so in the app language (Italian)', async () => {
    await setLocalePref('it');
    const { error } = await syncEventTasks('ev1', [{ title: 'Porta il PA', assignedTo: 'u-leaving' }], '2026-11-28');
    expect(error?.message).toBe('Questa persona sta eliminando il suo account. Scegli qualcun altro.');
  });

  it('and in English', async () => {
    const { error } = await syncEventTasks('ev1', [{ title: 'Bring the PA', assignedTo: 'u-leaving' }], '2026-11-28');
    expect(error?.message).toBe('This person is deleting their account. Choose someone else.');
  });
});
