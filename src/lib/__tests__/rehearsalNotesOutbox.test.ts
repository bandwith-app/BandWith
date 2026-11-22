import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addOp, applyOps, clearNoteBackoff, dismissRejected, flushOutbox, queueNoteOp, readOutbox, readRejected, rejectedKey, writeOutbox, type NoteOp } from '../rehearsalNotesOutbox';
import type { RehearsalNote } from '../rehearsalNotes';

const ME = 'user-me';
const note = (id: string, extra: Partial<RehearsalNote> = {}): RehearsalNote => ({
  id,
  bandId: 'b',
  eventId: 'e',
  date: '2026-11-19',
  sessionId: null,
  songId: 's1',
  songTitle: 'Paper Boats',
  preset: 'tempo',
  section: null,
  body: null,
  scope: 'members',
  status: 'open',
  markedAtS: null,
  createdBy: ME,
  okBy: null,
  okAt: null,
  createdAt: '2026-11-19T20:00:00.000Z',
  assignees: [{ userId: ME, practisedAt: null }],
  ...extra,
});

describe('rehearsal notes outbox: queue', () => {
  it('a later change of the same kind replaces the earlier one', () => {
    let ops: NoteOp[] = [];
    ops = addOp(ops, { kind: 'save', note: note('n1', { body: 'a' }), before: [] });
    ops = addOp(ops, { kind: 'save', note: note('n1', { body: 'b' }), before: [] });
    ops = addOp(ops, { kind: 'practised', id: 'n1', userId: ME, value: true });
    ops = addOp(ops, { kind: 'practised', id: 'n1', userId: ME, value: false });
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ kind: 'save', note: { body: 'b' } });
    expect(ops[1]).toMatchObject({ kind: 'practised', value: false });
  });

  it('a delete drops what was waiting for that note', () => {
    let ops: NoteOp[] = [];
    ops = addOp(ops, { kind: 'save', note: note('n1'), before: [] });
    ops = addOp(ops, { kind: 'ok', id: 'n1', value: true });
    ops = addOp(ops, { kind: 'save', note: note('n2'), before: [] });
    ops = addOp(ops, { kind: 'delete', id: 'n1' });
    expect(ops.map((o) => o.kind)).toEqual(['save', 'delete']);
  });

  it('the list shows what waits on this device', () => {
    const saved = [note('n1'), note('n2')];
    const ops: NoteOp[] = [
      { kind: 'save', note: note('n3', { body: 'offline' }), before: [] },
      { kind: 'practised', id: 'n1', userId: ME, value: true },
      { kind: 'ok', id: 'n1', value: true },
      { kind: 'delete', id: 'n2' },
    ];
    const out = applyOps(saved, ops, ME);
    expect(out.map((n) => n.id).sort()).toEqual(['n1', 'n3']);
    const n1 = out.find((n) => n.id === 'n1')!;
    expect(n1.status).toBe('ok');
    expect(n1.assignees[0].practisedAt).not.toBeNull();
  });
});

describe('rehearsal notes outbox: replay', () => {
  beforeEach(() => localStorage.clear());

  it('kept per user under bw: (wiped on logout)', () => {
    writeOutbox(ME, [{ kind: 'delete', id: 'n1' }]);
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '');
    expect(keys.some((k) => k.startsWith('bw:') && k.includes(ME))).toBe(true);
    expect(readOutbox(ME)).toEqual([{ kind: 'delete', id: 'n1' }]);
    expect(readOutbox('someone-else')).toEqual([]);
  });

  it('sends in order; offline keeps the rest; a refusal is dropped', async () => {
    const calls: string[] = [];
    const api = {
      save: vi.fn(async (n: RehearsalNote) => {
        calls.push(`save ${n.id}`);
        return { error: n.id === 'bad' ? { code: '42501', message: 'denied' } : null };
      }),
      remove: vi.fn(async (id: string) => {
        calls.push(`delete ${id}`);
        return { error: { message: 'Failed to fetch' } };
      }),
      practised: vi.fn(async () => ({ error: null })),
      ok: vi.fn(async () => ({ error: null })),
    };
    writeOutbox(ME, [
      { kind: 'save', note: note('bad'), before: [] },
      { kind: 'save', note: note('n1'), before: [] },
      { kind: 'delete', id: 'n2' },
      { kind: 'ok', id: 'n1', value: true },
    ]);
    const res = await flushOutbox(ME, api);
    expect(calls).toEqual(['save bad', 'save n1', 'delete n2']);
    expect(res).toEqual({ sent: 1, dropped: 1, left: 2 });
    expect(readOutbox(ME).map((o) => o.kind)).toEqual(['delete', 'ok']);
  });

  it('a change queued while sending goes in the same pass', async () => {
    const sent: string[] = [];
    const api = {
      save: vi.fn(async (n: RehearsalNote) => {
        sent.push(n.id);
        // The player taps a preset while the mark is on its way.
        if (n.id === 'mark') writeOutbox(ME, [...readOutbox(ME), { kind: 'save', note: note('preset'), before: [] }]);
        return { error: null };
      }),
      remove: vi.fn(async () => ({ error: null })),
      practised: vi.fn(async () => ({ error: null })),
      ok: vi.fn(async () => ({ error: null })),
    };
    writeOutbox(ME, [{ kind: 'save', note: note('mark'), before: [] }]);
    expect(await flushOutbox(ME, api)).toEqual({ sent: 2, dropped: 0, left: 0 });
    expect(sent).toEqual(['mark', 'preset']);
  });
});

describe('audit 06 #5: a server error never throws a note away', () => {
  beforeEach(() => {
    localStorage.clear();
    clearNoteBackoff();
  });
  const apiWith = (save: (n: RehearsalNote) => Promise<{ error: unknown; status?: number }>) => ({
    save: vi.fn(save),
    remove: vi.fn(async () => ({ error: null })),
    practised: vi.fn(async () => ({ error: null })),
    ok: vi.fn(async () => ({ error: null })),
  });

  it('503 Service Unavailable: the note stays queued for the next try', async () => {
    writeOutbox(ME, [{ kind: 'save', note: note('n1', { body: 'Bridge rushes' }), before: [] }]);
    const api = apiWith(async () => ({ error: { message: 'Service Unavailable', code: '' }, status: 503 }));
    expect(await flushOutbox(ME, api)).toEqual({ sent: 0, dropped: 0, left: 1 });
    expect(readOutbox(ME)).toHaveLength(1);
    expect(readRejected(ME)).toEqual([]);
  });

  it('other passing problems (schema cache 503, an expired session, too many requests, a timeout) wait too', async () => {
    for (const res of [
      { error: { code: 'PGRST002', message: 'Could not query the database for the schema cache. Retrying.' }, status: 503 },
      { error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 },
      { error: { message: 'Too Many Requests' }, status: 429 },
      { error: { code: '57014', message: 'canceling statement due to statement timeout' }, status: 500 },
      { error: { message: 'Bad Gateway', status: 502 } },
    ]) {
      localStorage.clear();
      clearNoteBackoff();
      writeOutbox(ME, [{ kind: 'save', note: note('n1'), before: [] }]);
      expect(await flushOutbox(ME, apiWith(async () => res))).toEqual({ sent: 0, dropped: 0, left: 1 });
    }
  });

  it('refused for good (not allowed): its text is kept to show, the rest still goes', async () => {
    writeOutbox(ME, [
      { kind: 'save', note: note('bad', { body: 'Count the outro in four' }), before: [] },
      { kind: 'save', note: note('n2'), before: [] },
    ]);
    const api = apiWith(async (n) => (n.id === 'bad' ? { error: { code: '42501', message: 'denied' }, status: 403 } : { error: null }));
    expect(await flushOutbox(ME, api)).toEqual({ sent: 1, dropped: 1, left: 0 });
    expect(readRejected(ME).map((n) => [n.id, n.body])).toEqual([['bad', 'Count the outro in four']]);
    dismissRejected(ME, 'bad');
    expect(readRejected(ME)).toEqual([]);
  });

  it('#296 round 3: 25 notes refused together: every one is kept to copy (none pushed out)', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `n${i}`);
    writeOutbox(ME, ids.map((id) => ({ kind: 'save' as const, note: note(id, { body: `Note ${id}` }), before: [] })));
    const api = apiWith(async () => ({ error: { code: '42501', message: 'denied' }, status: 403 }));
    expect(await flushOutbox(ME, api)).toEqual({ sent: 0, dropped: 25, left: 0 });
    expect(readRejected(ME).map((n) => n.id)).toEqual(ids);
  });

  it('#296 round 4: storage full: the refused note stays in the outbox (never sent again) and shows as “space full”', async () => {
    writeOutbox(ME, [{ kind: 'save', note: note('full', { body: 'Bridge: half time' }), before: [] }]);
    const real = localStorage.setItem.bind(localStorage);
    const quota = vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
      if (k.startsWith('bw:rehearsal_notes_rejected:')) throw new DOMException('quota', 'QuotaExceededError');
      return real(k, v);
    });
    try {
      const api = apiWith(async () => ({ error: { code: '42501', message: 'denied' }, status: 403 }));
      await flushOutbox(ME, api);
      expect(readRejected(ME).map((n) => [n.id, n.body, n.spaceFull])).toEqual([['full', 'Bridge: half time', true]]);
      // Kept on the device, not waiting to be sent, and not sent again.
      expect(JSON.parse(localStorage.getItem(`bw:rehearsal_notes_outbox:${ME}`)!)).toHaveLength(1);
      expect(readOutbox(ME)).toEqual([]);
      await flushOutbox(ME, api);
      expect(api.save).toHaveBeenCalledTimes(1);
      dismissRejected(ME, 'full');
      expect(readRejected(ME)).toEqual([]);
      expect(localStorage.getItem(`bw:rehearsal_notes_outbox:${ME}`)).toBeNull();
    } finally {
      quota.mockRestore();
    }
  });

  it('#296 round 4: storage completely full (the outbox can’t be rewritten either): the original entry is never removed', async () => {
    writeOutbox(ME, [{ kind: 'save', note: note('full', { body: 'Bridge: half time' }), before: [] }]);
    const quota = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    try {
      const api = apiWith(async () => ({ error: { code: '42501', message: 'denied' }, status: 403 }));
      await flushOutbox(ME, api);
      expect(JSON.parse(localStorage.getItem(`bw:rehearsal_notes_outbox:${ME}`)!)[0].note.body).toBe('Bridge: half time');
      expect(readRejected(ME).map((n) => [n.id, n.spaceFull])).toEqual([['full', true]]);
      await flushOutbox(ME, api);
      expect(api.save).toHaveBeenCalledTimes(1);
    } finally {
      quota.mockRestore();
      dismissRejected(ME, 'full');
    }
  });

  it('Claude minor: one note that keeps failing (5xx) waits on its own; the others still go, and it is tried again later', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    writeOutbox(ME, [
      { kind: 'save', note: note('stuck'), before: [] },
      { kind: 'ok', id: 'stuck', value: true },
      { kind: 'save', note: note('n2'), before: [] },
    ]);
    const api = apiWith(async (n) => (n.id === 'stuck' ? { error: { message: 'Internal Server Error' }, status: 500 } : { error: null }));
    expect(await flushOutbox(ME, api)).toEqual({ sent: 1, dropped: 0, left: 2 });
    // Its later change waits behind it, in order.
    expect(api.ok).not.toHaveBeenCalled();
    expect(readOutbox(ME).map((o) => o.kind)).toEqual(['save', 'ok']);
    // Right away again: not hammered.
    await flushOutbox(ME, api);
    expect(api.save.mock.calls.filter(([n]) => n.id === 'stuck')).toHaveLength(1);
    // Later: tried again; now it goes, and its OK after it.
    now.mockReturnValue(1_000_000 + 10 * 60_000);
    api.save.mockImplementation(async () => ({ error: null }));
    expect(await flushOutbox(ME, api)).toEqual({ sent: 2, dropped: 0, left: 0 });
    now.mockRestore();
  });

  it('no signal still stops the whole pass (everything would fail)', async () => {
    writeOutbox(ME, [
      { kind: 'save', note: note('a'), before: [] },
      { kind: 'save', note: note('b'), before: [] },
    ]);
    const api = apiWith(async () => ({ error: { message: 'Failed to fetch' } }));
    expect(await flushOutbox(ME, api)).toEqual({ sent: 0, dropped: 0, left: 2 });
    expect(api.save).toHaveBeenCalledTimes(1);
  });
});

describe('#296 round 5: the refused list and account deletion', () => {
  it('its key prefix stays exactly bw:rehearsal_notes_rejected: (the sign-out exclusion in #292 matches it)', async () => {
    const { REJECTED_PREFIX } = await import('../rehearsalNotesOutbox');
    expect(REJECTED_PREFIX).toBe('bw:rehearsal_notes_rejected:');
  });

});

/**
 * #296 round 6 (Codex r7 B1): with #292, sign-out keeps the refused list and
 * only deleting the account erases it. #292 lands first; until then its
 * rules are copied here as data, from fix/data-loss-audit 0dd8a121:
 * src/lib/offline/storage.ts (KEEP_ON_SIGN_OUT_PREFIXES, every bw: key but
 * those goes at sign-out) and src/lib/accountWrites.ts (discardAccountWrites:
 * the account's bw:…:<uid> keys). Once #292 is on main, the block after this
 * one runs the real functions.
 */
const KEEP_ON_SIGN_OUT_292 = ['bw:live_refused:', 'bw:rehearsal_notes_rejected:', 'bw:chat_outbox:'];
const signOut292 = () => {
  const drop: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith('bw:') && !KEEP_ON_SIGN_OUT_292.some((p) => k.startsWith(p))) drop.push(k);
  }
  drop.forEach((k) => localStorage.removeItem(k));
};
const deleteAccount292 = (uid: string) => {
  const drop: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith('bw:') && k.endsWith(`:${uid}`)) drop.push(k);
  }
  drop.forEach((k) => localStorage.removeItem(k));
};
const refuseOne = async (uid: string, body: string) => {
  writeOutbox(uid, [{ kind: 'save', note: note('gone', { body, createdBy: uid }), before: [] }]);
  await flushOutbox(uid, {
    save: vi.fn(async () => ({ error: { code: '42501', message: 'denied' }, status: 403 })),
    remove: vi.fn(async () => ({ error: null })),
    practised: vi.fn(async () => ({ error: null })),
    ok: vi.fn(async () => ({ error: null })),
  });
};

describe('#296 round 6: the refused list with #292’s sign-out', () => {
  beforeEach(() => {
    localStorage.clear();
    clearNoteBackoff();
  });

  it('its key is in #292’s keep list', async () => {
    const { REJECTED_PREFIX } = await import('../rehearsalNotesOutbox');
    expect(KEEP_ON_SIGN_OUT_292).toContain(REJECTED_PREFIX);
  });

  it('sign-out, then the same account signs in: the refused note is still there; another account never sees it', async () => {
    await refuseOne(ME, 'Outro: four bars');
    signOut292();
    expect(readRejected(ME).map((n) => n.body)).toEqual(['Outro: four bars']);
    expect(readRejected('someone-else')).toEqual([]);
  });

  it('deleting the account erases it; other accounts’ lists on the device stay', async () => {
    await refuseOne(ME, 'Outro: four bars');
    await refuseOne('other-uid', 'Intro: drums only');
    deleteAccount292(ME);
    expect(readRejected(ME)).toEqual([]);
    expect(readRejected('other-uid').map((n) => n.body)).toEqual(['Intro: drums only']);
  });
});

// The real functions, once #292 is on this branch's base (skipped before).
const storage292 = import.meta.glob('../offline/storage.ts', { eager: true }) as Record<string, Record<string, unknown>>;
const accountWrites292 = import.meta.glob('../accountWrites.ts') as Record<string, () => Promise<Record<string, unknown>>>;
const has292 = Array.isArray(Object.values(storage292)[0]?.KEEP_ON_SIGN_OUT_PREFIXES) && Object.keys(accountWrites292).length === 1;
describe.runIf(has292)('#296 round 6: with #292 merged (real clearOfflineCache, discardAccountWrites)', () => {
  it('sign-out keeps the refused note for the next sign-in; account deletion erases it', async () => {
    localStorage.clear();
    clearNoteBackoff();
    await refuseOne(ME, 'Outro: four bars');
    const { clearOfflineCache } = Object.values(storage292)[0] as { clearOfflineCache: () => Promise<void> };
    await clearOfflineCache();
    expect(readRejected(ME).map((n) => n.body)).toEqual(['Outro: four bars']);
    const { discardAccountWrites } = (await Object.values(accountWrites292)[0]()) as { discardAccountWrites: (u: string) => Promise<void> };
    await discardAccountWrites(ME);
    expect(readRejected(ME)).toEqual([]);
  });
});

describe('#296 round 6 (Codex r7 #6): saving other words never deletes a refused version', () => {
  beforeEach(() => {
    localStorage.clear();
    clearNoteBackoff();
  });
  const apiBy = (refuse: (n: RehearsalNote) => boolean) => ({
    save: vi.fn(async (n: RehearsalNote) => (refuse(n) ? { error: { code: '42501', message: 'denied' }, status: 403 } : { error: null })),
    remove: vi.fn(async () => ({ error: null })),
    practised: vi.fn(async () => ({ error: null })),
    ok: vi.fn(async () => ({ error: null })),
  });

  it('refused, then a new wording of the note is saved: the refused words stay until Remove', async () => {
    writeOutbox(ME, [{ kind: 'save', note: note('n1', { body: 'first words' }), before: [] }]);
    await flushOutbox(ME, apiBy((n) => n.body === 'first words'));
    queueNoteOp(ME, { kind: 'save', note: note('n1', { body: 'second words' }), before: [] });
    await flushOutbox(ME, apiBy((n) => n.body === 'first words'));
    expect(readOutbox(ME)).toEqual([]);
    expect(readRejected(ME).map((n) => n.body)).toEqual(['first words']);
    dismissRejected(ME, rejectedKey(readRejected(ME)[0]));
    expect(readRejected(ME)).toEqual([]);
  });

  it('refused twice with other words: both versions are kept; Remove takes only the one chosen', async () => {
    writeOutbox(ME, [{ kind: 'save', note: note('n1', { body: 'first words' }), before: [] }]);
    await flushOutbox(ME, apiBy(() => true));
    writeOutbox(ME, [{ kind: 'save', note: note('n1', { body: 'second words' }), before: [] }]);
    await flushOutbox(ME, apiBy(() => true));
    expect(readRejected(ME).map((n) => n.body)).toEqual(['first words', 'second words']);
    dismissRejected(ME, rejectedKey(readRejected(ME)[0]));
    expect(readRejected(ME).map((n) => n.body)).toEqual(['second words']);
  });
});

describe('#296 round 5 (Claude): a refused note kept here never blocks or loses a later edit', () => {
  const api403 = () => ({
    save: vi.fn(async (n: RehearsalNote) => (n.body === 'first words' ? { error: { code: '42501', message: 'denied' }, status: 403 } : { error: null })),
    remove: vi.fn(async () => ({ error: null })),
    practised: vi.fn(async () => ({ error: null })),
    ok: vi.fn(async () => ({ error: null })),
  });

  it('marked refused in the outbox: a new save of the same note goes out, the refused words stay', async () => {
    localStorage.clear();
    clearNoteBackoff();
    writeOutbox(ME, [{ kind: 'save', note: note('n1', { body: 'first words' }), before: [], refused: true }]);
    queueNoteOp(ME, { kind: 'save', note: note('n1', { body: 'second words' }), before: [] });
    expect(readOutbox(ME).map((o) => (o.kind === 'save' ? o.note.body : o.kind))).toEqual(['second words']);
    const api = api403();
    await flushOutbox(ME, api);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.save.mock.calls[0][0].body).toBe('second words');
    expect(readRejected(ME).map((n) => n.body)).toEqual(['first words']);
  });

  it('a delete of the note doesn’t erase the refused words either', () => {
    localStorage.clear();
    writeOutbox(ME, [{ kind: 'save', note: note('n1', { body: 'first words' }), before: [], refused: true }]);
    queueNoteOp(ME, { kind: 'delete', id: 'n1' });
    expect(readRejected(ME).map((n) => n.body)).toEqual(['first words']);
  });

  it('refused in memory only (storage completely full): a later edit of the note is still sent', async () => {
    localStorage.clear();
    clearNoteBackoff();
    writeOutbox(ME, [{ kind: 'save', note: note('n1', { body: 'first words' }), before: [] }]);
    const quota = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const api = api403();
    try {
      await flushOutbox(ME, api);
    } finally {
      quota.mockRestore();
    }
    queueNoteOp(ME, { kind: 'save', note: note('n1', { body: 'second words' }), before: [] });
    await flushOutbox(ME, api);
    expect(api.save.mock.calls.map((c) => c[0].body)).toEqual(['first words', 'second words']);
    dismissRejected(ME, 'n1');
  });
});

// ------------------------------------------------- #296 round 8 (Codex r8 B1) --

/** A localStorage that holds `limit` characters at most (keys and values), like a full phone. */
const withQuota = (limit: number) => {
  const real = localStorage.setItem.bind(localStorage);
  const used = (skip: string) => {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k !== skip) n += k.length + (localStorage.getItem(k) ?? '').length;
    }
    return n;
  };
  return vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
    if (used(k) + k.length + v.length > limit) throw new DOMException('quota', 'QuotaExceededError');
    return real(k, v);
  });
};
const refuseAll = () => ({
  save: vi.fn(async () => ({ error: { code: '42501', message: 'denied' }, status: 403 })),
  remove: vi.fn(async () => ({ error: null })),
  practised: vi.fn(async () => ({ error: null })),
  ok: vi.fn(async () => ({ error: null })),
});

describe('#296 round 8 (Codex r8 B1): refused notes live in the list sign-out keeps, per account', () => {
  beforeEach(() => {
    localStorage.clear();
    clearNoteBackoff();
  });

  it('storage nearly full: the note leaves the outbox first, so its copy fits in the refused list (not left in the outbox)', async () => {
    const long = 'Count the outro in four, then hold the last chord. '.repeat(40);
    writeOutbox(ME, [{ kind: 'save', note: note('n1', { body: long }), before: [] }]);
    // Room for one copy of the note, not two.
    const quota = withQuota(localStorage.getItem(`bw:rehearsal_notes_outbox:${ME}`)!.length + 1500);
    try {
      await flushOutbox(ME, refuseAll());
      expect(localStorage.getItem(`bw:rehearsal_notes_outbox:${ME}`)).toBeNull();
      expect(readRejected(ME).map((n) => [n.id, n.body, n.spaceFull])).toEqual([['n1', long, undefined]]);
    } finally {
      quota.mockRestore();
    }
  });

  it('an ordinary sign-out (the real clearOfflineCache of this build) keeps each account’s refused notes; the cache goes', async () => {
    const { clearOfflineCache } = await import('../offline/storage');
    const { keepingSignOutLists } = await import('../signOutWipe');
    await refuseOne(ME, 'Outro: four bars');
    await refuseOne('other-uid', 'Intro: drums only');
    localStorage.setItem(`bw:${ME}:global:songs`, '[]');
    await keepingSignOutLists(() => clearOfflineCache());
    expect(localStorage.getItem(`bw:${ME}:global:songs`)).toBeNull();
    expect(readRejected(ME).map((n) => n.body)).toEqual(['Outro: four bars']);
    expect(readRejected('other-uid').map((n) => n.body)).toEqual(['Intro: drums only']);
    expect(readRejected('someone-else')).toEqual([]);
  });

  it('a refused note left in the outbox while storage was full moves to the refused list at sign-out, then stays', async () => {
    const { clearOfflineCache } = await import('../offline/storage');
    const { keepingSignOutLists } = await import('../signOutWipe');
    writeOutbox(ME, [{ kind: 'save', note: note('n2', { body: 'Bridge: half time' }), before: [], refused: true }]);
    await keepingSignOutLists(() => clearOfflineCache());
    expect(readRejected(ME).map((n) => [n.id, n.body, n.spaceFull])).toEqual([['n2', 'Bridge: half time', undefined]]);
    expect(localStorage.getItem(`bw:rehearsal_notes_outbox:${ME}`)).toBeNull();
  });

  // AuthContext's real sign-out (keeps the lists, awaited, a deleted account's go) is checked by
  // behaviour in authSignOutAwaits.test.tsx, not by its source (Claude r8 N2: it survives #287).
});

// With #292 on the base: its counts (sign-out sheet) see a refused note as refused, never as waiting.
const liveOutbox292 = import.meta.glob('../liveOutbox.ts', { eager: true }) as Record<string, Record<string, unknown>>;
const counts292 = Object.values(liveOutbox292)[0] as
  | { waitingChanges?: (u: string) => number; refusedRehearsalNotes?: (u: string) => number }
  | undefined;
describe.runIf(has292 && typeof counts292?.waitingChanges === 'function')('#296 round 8: with #292 merged, its sign-out counts', () => {
  it('a refused note: 0 waiting, 1 refused; kept by the real sign-out clear; full storage the same once settled', async () => {
    localStorage.clear();
    clearNoteBackoff();
    await refuseOne(ME, 'Outro: four bars');
    expect(counts292!.waitingChanges!(ME)).toBe(0);
    expect(counts292!.refusedRehearsalNotes!(ME)).toBe(1);
    const { clearOfflineCache } = Object.values(storage292)[0] as { clearOfflineCache: () => Promise<void> };
    const { keepingSignOutLists } = await import('../signOutWipe');
    writeOutbox(ME, [{ kind: 'save', note: note('n3', { body: 'Bridge: half time' }), before: [], refused: true }]);
    expect(counts292!.waitingChanges!(ME)).toBe(0);
    await keepingSignOutLists(() => clearOfflineCache());
    expect(counts292!.refusedRehearsalNotes!(ME)).toBe(2);
    expect(readRejected(ME).map((n) => n.body).sort()).toEqual(['Bridge: half time', 'Outro: four bars']);
  });
});

// ---------------------------------- #296 round 8 (from #292: one flush per account) --
describe('#296 round 8: a flush per account (as #292’s live outbox)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearNoteBackoff();
  });
  const apiFor = (save: (n: RehearsalNote) => Promise<{ error: unknown }>) => ({
    save: vi.fn(save),
    remove: vi.fn(async () => ({ error: null })),
    practised: vi.fn(async () => ({ error: null })),
    ok: vi.fn(async () => ({ error: null })),
  });

  it('account switch: Alice’s flush still on its way; Bob’s flush sends Bob’s notes and reports Bob’s counts', async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const alice = apiFor(async () => {
      await slow;
      return { error: null };
    });
    writeOutbox('alice', [{ kind: 'save', note: note('a1'), before: [] }]);
    writeOutbox('bob', [
      { kind: 'save', note: note('b1'), before: [] },
      { kind: 'save', note: note('b2'), before: [] },
    ]);
    const a = flushOutbox('alice', alice);
    const bob = apiFor(async () => ({ error: null }));
    const b = await flushOutbox('bob', bob);
    expect(bob.save.mock.calls.map((c) => c[0].id)).toEqual(['b1', 'b2']);
    expect(b).toEqual({ sent: 2, dropped: 0, left: 0 });
    expect(alice.save.mock.calls.map((c) => c[0].id)).toEqual(['a1']);
    release();
    expect(await a).toEqual({ sent: 1, dropped: 0, left: 0 });
    // The same account twice still shares its one pass.
    writeOutbox('bob', [{ kind: 'save', note: note('b3'), before: [] }]);
    const p1 = flushOutbox('bob', bob);
    const p2 = flushOutbox('bob', bob);
    expect(p1).toBe(p2);
    await p1;
  });
});

// ------------------------- #296 round 8 (three-way sign-out with #287 and #282) --
describe('#296 round 8: a deleted account’s refused notes go, even with the clear not awaited', () => {
  beforeEach(() => localStorage.clear());
  const A = 'aaaaaaaa-1111-4111-8111-111111111111';
  const B = 'bbbbbbbb-2222-4222-8222-222222222222';

  it('normal sign-out keeps every account’s list; a deletion drops only its own, also one written during the clear', async () => {
    const { keepingSignOutLists } = await import('../signOutWipe');
    const list = (u: string) => `bw:rehearsal_notes_rejected:${u}`;
    localStorage.setItem(list(A), '[{"id":"x"}]');
    localStorage.setItem(list(B), '[{"id":"y"}]');
    // Normal: a clear that drops every bw: key (before #292) — both come back.
    const wipeAll = async () => {
      const all = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '');
      for (const k of all) if (k.startsWith('bw:')) localStorage.removeItem(k);
    };
    await keepingSignOutLists(wipeAll);
    expect(localStorage.getItem(list(A))).not.toBeNull();
    expect(localStorage.getItem(list(B))).not.toBeNull();
    // Deleted account A: #292's discardAccountWrites ran first; a refusal answered meanwhile writes A's
    // list again inside the clear (which keeps the kept lists, as with #292); A's goes, B's stays.
    localStorage.removeItem(list(A));
    const keepsLists = async () => {
      localStorage.setItem(list(A), '[{"id":"late"}]');
    };
    await keepingSignOutLists(keepsLists, { gone: A });
    expect(localStorage.getItem(list(A))).toBeNull();
    expect(localStorage.getItem(list(B))).toBe('[{"id":"y"}]');
    // And a refused note still in A's outbox is not moved into a list for it.
    writeOutbox(A, [{ kind: 'save', note: note('z'), before: [], refused: true } as NoteOp]);
    await keepingSignOutLists(async () => {}, { gone: A.toUpperCase() });
    expect(localStorage.getItem(list(A))).toBeNull();
  });
});
