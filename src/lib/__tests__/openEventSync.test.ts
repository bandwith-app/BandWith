import { describe, it, expect } from 'vitest';
import { syncOpenEvent } from '../openEventSync';

type Ev = { eventId: string; title: string; status: string; venueName?: string };
const open: Ev = { eventId: 'e1', title: 'Gig', status: 'QUOTE', venueName: 'Club' };

describe('syncOpenEvent', () => {
  it('does nothing without an open event or a list version', () => {
    expect(syncOpenEvent<Ev>(null, { title: 'x' }, null)).toEqual({ next: null, seen: null });
    expect(syncOpenEvent(open, undefined, 'sig').next).toBe(open);
  });

  it('only remembers the first list version seen after opening', () => {
    const r = syncOpenEvent(open, { eventId: 'e1', title: 'Old', status: 'QUOTE' }, null);
    expect(r.next).toBe(open);
    expect(r.seen).not.toBeNull();
  });

  it('keeps optimistic changes while the list version is unchanged', () => {
    const listVersion = { eventId: 'e1', title: 'Gig', status: 'QUOTE' };
    const seen = syncOpenEvent(open, listVersion, null).seen;
    const optimistic = { ...open, status: 'CONFIRMED' };
    expect(syncOpenEvent(optimistic, { ...listVersion }, seen).next).toBe(optimistic);
  });

  it('takes a new list version and keeps detail-only fields', () => {
    const seen = syncOpenEvent(open, { eventId: 'e1', title: 'Gig', status: 'QUOTE' }, null).seen;
    const r = syncOpenEvent(open, { eventId: 'e1', title: 'Gig moved', status: 'CONFIRMED' }, seen);
    expect(r.next).toEqual({ eventId: 'e1', title: 'Gig moved', status: 'CONFIRMED', venueName: 'Club' });
    expect(r.seen).not.toBe(seen);
  });
});

describe('one date of a repeating rehearsal (Codex #297 B1)', () => {
  const base = { eventId: 'r1', title: 'Weekly', date: '2099-12-01', is_recurring: true, recurrence_rule: { frequency: 'weekly' } as { frequency: string } | null };

  it('a newer list version keeps the date the detail was opened on', () => {
    const open = { ...base, date: '2099-12-08' };
    const first = syncOpenEvent(open, base, null);
    const { next } = syncOpenEvent(open, { ...base, title: 'Weekly jam' }, first.seen);
    expect(next).toMatchObject({ title: 'Weekly jam', date: '2099-12-08' });
  });

  it('opened on its own date, the detail follows a moved series', () => {
    const first = syncOpenEvent(base, base, null);
    const { next } = syncOpenEvent(base, { ...base, date: '2099-12-02' }, first.seen);
    expect(next?.date).toBe('2099-12-02');
  });

  it('a series that stops repeating takes the list date', () => {
    const open = { ...base, date: '2099-12-08' };
    const first = syncOpenEvent(open, base, null);
    const { next } = syncOpenEvent(open, { ...base, is_recurring: false, recurrence_rule: null }, first.seen);
    expect(next?.date).toBe('2099-12-01');
  });
});

describe('the series moved while one of its dates is open (Codex #297 round 3 B3)', () => {
  const base = { eventId: 'r1', title: 'Weekly', date: '2099-12-01', is_recurring: true, recurrence_rule: { frequency: 'weekly' } as { frequency: string } | null };
  const open = { ...base, date: '2099-12-08', seriesDate: '2099-12-01' };

  it('the open date and the series start move with it', () => {
    const first = syncOpenEvent(open, base, null);
    const { next } = syncOpenEvent(open, { ...base, date: '2099-12-02' }, first.seen);
    expect(next).toMatchObject({ date: '2099-12-09', seriesDate: '2099-12-02' });
  });

  it('a rename keeps both', () => {
    const first = syncOpenEvent(open, base, null);
    const { next } = syncOpenEvent(open, { ...base, title: 'Weekly jam' }, first.seen);
    expect(next).toMatchObject({ title: 'Weekly jam', date: '2099-12-08', seriesDate: '2099-12-01' });
  });
});
