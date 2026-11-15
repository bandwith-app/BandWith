// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ inserted: [] as any[], profiles: [] as any[] }));
vi.mock('@/lib/supabase', () => {
  const chain = (table: string): any => {
    const c: any = new Proxy(function () {}, {
      get: (_t, prop) => {
        if (prop === 'insert') return (rows: any) => { db.inserted = Array.isArray(rows) ? rows : [rows]; return c; };
        if (prop === 'then') {
          const p = Promise.resolve({ data: table === 'profiles' ? db.profiles : [], error: null });
          return p.then.bind(p);
        }
        return c;
      },
      apply: () => c,
    });
    return c;
  };
  return { supabase: { from: (table: string) => chain(table) }, getSafeUser: async () => ({ data: { user: null } }) };
});

import { notifyEventMembersCreated, notifyEventMembersRemoved } from '../notifications';
import { notificationTarget } from '@/lib/notificationRouting';

beforeEach(() => {
  db.inserted = [];
  db.profiles = [];
});

describe('gig edit: musicians taken off the lineup are told', () => {
  it('writes one notice per removed musician, in their language, never to the editor', async () => {
    db.profiles = [{ id: 'm1', preferred_language: 'it' }, { id: 'm2', preferred_language: null }];
    await notifyEventMembersRemoved('b1', 'e1', 'Wedding Rossi', '2026-12-12', 'gig', 'admin', 'Leo', ['m1', 'm2', 'admin']);
    expect(db.inserted.map((r) => r.user_id)).toEqual(['m1', 'm2']);
    const it = db.inserted.find((r) => r.user_id === 'm1');
    const en = db.inserted.find((r) => r.user_id === 'm2');
    expect(it.title).toBe('Formazione cambiata: Wedding Rossi');
    expect(it.body).toContain('Leo ti ha tolto dalla formazione di “Wedding Rossi”');
    expect(en.title).toBe('Lineup changed: Wedding Rossi');
    expect(en.body).toBe('Leo took you off the lineup of “Wedding Rossi” (Sat, Dec 12). You no longer need to keep the date free.');
    // No fee or money in it, and no screen to open (the gig isn't theirs any more).
    expect(JSON.stringify(en.data)).not.toMatch(/fee/);
    expect(notificationTarget(en.type, en.data)).toBeNull();
  });

  it('sends nothing when nobody was removed', async () => {
    await notifyEventMembersRemoved('b1', 'e1', 'Gig', '2026-12-12', 'gig', 'admin', 'Leo', ['admin']);
    expect(db.inserted).toEqual([]);
  });
});

describe('gig invite text', () => {
  it('writes the date in English, like the rest of the English text (090 translates both)', async () => {
    await notifyEventMembersCreated('b1', 'e1', 'Wedding Rossi', '2026-12-12', '19:30', 'gig', 'admin', 'Leo', ['m1'], { memberFees: { m1: 300 } });
    expect(db.inserted[0].body).toContain('for Sat, Dec 12 at 19:30');
    expect(db.inserted[0].data.member_fee).toBe(300);
  });
});
