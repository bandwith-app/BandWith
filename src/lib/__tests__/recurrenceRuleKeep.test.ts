import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Codex #297 B2: editing a repeating rehearsal (wizard, overview card,
 * offline replay) rewrote recurrence_rule from the cadence alone, so every
 * deleted date (skip_dates) came back. The stored rule's other keys stay;
 * only the cadence is replaced.
 */
const db = vi.hoisted(() => ({
  stored: { frequency: 'weekly', interval: 1, skip_dates: ['2099-12-08'], custom: 'keep me' } as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/supabase', () => {
  const from = () => {
    let op = 'select';
    let payload: Record<string, unknown> = {};
    const q: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') return (res: (v: unknown) => void) => res({ data: null, error: null });
        if (prop === 'maybeSingle') return async () => ({ data: { id: 'ev', recurrence_rule: db.stored }, error: null });
        if (prop === 'single') return async () => {
          if (op === 'update') db.updates.push(payload);
          return { data: { id: 'ev', ...payload }, error: null };
        };
        return (arg?: unknown) => {
          if (prop === 'update') { op = 'update'; payload = arg as Record<string, unknown>; }
          return q;
        };
      },
    });
    return q;
  };
  return { supabase: { from, rpc: async () => ({ data: null, error: null }) }, getSafeUser: async () => null };
});

import { mergeRecurrenceRule } from '../recurrenceSkips';
import { updateEvent } from '../services/events';
import { eventCardPatch, eventCardValues, changedPatch } from '../eventOverviewEdit';
import appSrc from '@/app/AuthenticatedApp.tsx?raw';

beforeEach(() => {
  db.stored = { frequency: 'weekly', interval: 1, skip_dates: ['2099-12-08'], custom: 'keep me' };
  db.updates.length = 0;
});

describe('mergeRecurrenceRule', () => {
  it('replaces the cadence and keeps deleted dates and unknown keys', () => {
    expect(mergeRecurrenceRule({ freq: 'monthly', interval: 3, skip_dates: ['2099-12-08'], until: '2100-01-01' }, { frequency: 'weekly', interval: 2 }))
      .toEqual({ frequency: 'weekly', interval: 2, skip_dates: ['2099-12-08'], until: '2100-01-01' });
    expect(mergeRecurrenceRule({ frequency: 'weekly', skip_dates: ['2099-12-08'] }, null)).toBeNull();
    expect(mergeRecurrenceRule(null, { frequency: 'weekly', interval: 1 })).toEqual({ frequency: 'weekly', interval: 1 });
  });
});

describe('saving a repeating rehearsal keeps its deleted dates', () => {
  it('updateEvent merges the stored rule (wizard, overview card, offline replay)', async () => {
    const { error } = await updateEvent('ev', { title: 'Weekly jam', recurrence_rule: { frequency: 'weekly', interval: 2 } } as any);
    expect(error).toBeNull();
    expect(db.updates[0].recurrence_rule).toEqual({ frequency: 'weekly', interval: 2, skip_dates: ['2099-12-08'], custom: 'keep me' });
    expect(db.updates[0].title).toBe('Weekly jam');
  });

  it('turning the repeat off still clears the rule', async () => {
    await updateEvent('ev', { is_recurring: false, recurrence_rule: null } as any);
    expect(db.updates[0].recurrence_rule).toBeNull();
  });

  it('the overview Event card keeps them, and a title change is not a cadence change', () => {
    const ev = { title: 'Weekly', eventType: 'rehearsal', date: '2099-12-01', time: '19:00', is_recurring: true,
      recurrence_rule: { frequency: 'weekly', interval: 1, skip_dates: ['2099-12-08'] } } as any;
    const v = { ...eventCardValues(ev), title: 'Weekly jam' };
    const patch = changedPatch(ev, eventCardPatch('rehearsal', v, ev));
    expect(patch?.recurrence_rule).toEqual({ frequency: 'weekly', interval: 1, skip_dates: ['2099-12-08'] });
    expect(changedPatch(ev, eventCardPatch('rehearsal', eventCardValues(ev), ev))).toBeNull();
  });

  it('the wizard builds the rule on top of the one it edits', () => {
    const start = appSrc.indexOf('recurrence_rule: (data.recurrence && data.recurrence !==');
    const near = appSrc.slice(Math.max(0, start - 200), start + 400);
    expect(near).toMatch(/mergeRecurrenceRule\(/);
  });
});

describe('a queued edit never overrides fresher deleted dates (Codex #297 round 3 B1)', () => {
  it('stale skip_dates in the payload are unioned with the stored ones', async () => {
    db.stored = { frequency: 'weekly', interval: 1, skip_dates: ['2099-12-08', '2099-12-15'] };
    // Queued before the other admin deleted Dec 15; changes the cadence.
    await updateEvent('ev', { recurrence_rule: { frequency: 'weekly', interval: 2, skip_dates: ['2099-12-08', '2099-12-22'] } } as any);
    expect(db.updates[0].recurrence_rule).toEqual({ frequency: 'weekly', interval: 2, skip_dates: ['2099-12-08', '2099-12-15', '2099-12-22'] });
  });

  it('same cadence: the rule is not written at all (a rename never races a delete)', async () => {
    db.stored = { freq: 'weekly', skip_dates: ['2099-12-15'] };
    await updateEvent('ev', { title: 'Renamed', recurrence_rule: { frequency: 'weekly', interval: 1, skip_dates: [] } } as any);
    expect(db.updates[0]).not.toHaveProperty('recurrence_rule');
    expect(db.updates[0].title).toBe('Renamed');
  });

  it('mergeRecurrenceRule unions skip_dates', () => {
    expect(mergeRecurrenceRule({ frequency: 'weekly', skip_dates: ['2099-12-15'] }, { frequency: 'weekly', interval: 1, skip_dates: ['2099-12-08'] }))
      .toEqual({ frequency: 'weekly', interval: 1, skip_dates: ['2099-12-08', '2099-12-15'] });
  });
});
