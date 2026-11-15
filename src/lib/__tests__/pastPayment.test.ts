import { describe, it, expect } from 'vitest';
import { pastPayKinds, pastPayState } from '../pastPayment';

describe('past events: payment state', () => {
  const gig = (eventId: string, paymentStatus?: string) => ({ eventId, status: 'CONFIRMED', paymentStatus });

  it('admins see the client payment', () => {
    expect(pastPayState(gig('a', 'paid'), true, {})).toEqual({ kind: 'client', paid: true });
    expect(pastPayState(gig('a'), true, {})).toEqual({ kind: 'client', paid: false });
  });

  it('members see their own payout, never the client payment', () => {
    expect(pastPayState(gig('a', 'paid'), false, { a: false })).toEqual({ kind: 'own', paid: false });
    expect(pastPayState(gig('a'), false, { a: true })).toEqual({ kind: 'own', paid: true });
    // Unknown payout: nothing shown (not "Overdue").
    expect(pastPayState(gig('a'), false, {})).toBeNull();
  });

  it('rehearsals and quotes carry no payment state', () => {
    expect(pastPayState({ eventId: 'r', status: 'REHEARSAL' }, true, {})).toBeNull();
    expect(pastPayState({ eventId: 'q', status: 'QUOTE' }, false, { q: true })).toBeNull();
  });

  it('names the filter by what the list shows', () => {
    expect(pastPayKinds([null, null])).toBeNull();
    expect(pastPayKinds([{ kind: 'client', paid: true }, null])).toBe('client');
    expect(pastPayKinds([{ kind: 'own', paid: false }])).toBe('own');
    expect(pastPayKinds([{ kind: 'own', paid: false }, { kind: 'client', paid: true }])).toBe('mixed');
  });
});
