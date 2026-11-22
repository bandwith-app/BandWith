import { describe, it, expect, vi, beforeEach } from 'vitest';

// Audit 09 #5 / #9 and PR #295 review round 2: moving an accepted suggested
// song's files into the band's folders must never leave a song on a missing
// file, whatever runs at once (two admins, one admin on phone + iPad) or
// stops half-way. A fake Storage + the 197 RPCs (same rules as the SQL,
// which supabase/tests/song_files_adopted.pglite.mjs checks on Postgres).

type Song = { id: string; band_id: string; status: string; audio_url: string | null; chart_url: string | null };
type Adoption = { song_id: string; field: string; from: string; to: string; state: 'copying' | 'repointed' | 'deleting' | 'cleaned'; by: string | null; deletingAt?: number; deletingBy?: string };
type Step = 'begin' | 'reserve' | 'release' | 'copy' | 'info' | 'repoint' | 'sweep_list' | 'sweep_claim' | 'remove' | 'sweep_done' | 'reread' | 'claim_delete' | 'removed';

const fake = vi.hoisted(() => {
  const REF = 'sb://song-files/';
  // seq: when the object was made (197 compares storage.objects.created_at).
  const store = new Map<string, { body: string; etag: string; seq?: number }>();
  let seq = 0;
  const songs = new Map<string, Song>();
  let adoptions: Adoption[] = [];
  // Delete claims outside the sweep (197: bw_song_files_claim_delete).
  const removals = new Map<string, { by: string; at: number }>();
  // Copies registered before they are made (197: bw_song_file_copy_reserve).
  // reservedSeq: the first registration; an object older than it was already there.
  const copies = new Map<string, { at: number; by: string; song: string; reservedSeq: number }>();
  const ours = (p: string, c: { reservedSeq: number }) => (store.get(p)?.seq ?? Infinity) > c.reservedSeq;
  let failRemove = 0;
  const clock = { now: 0 };
  const LAPSE = 10 * 60_000;
  const lapsed = (r: Adoption) => r.state === 'deleting' && clock.now - (r.deletingAt ?? 0) > LAPSE;
  const admins = new Set<string>();
  const inUse = (path: string) => [...songs.values()].some((s) => s.audio_url === REF + path || s.chart_url === REF + path);
  const etag = (body: string) => `"${[...body].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16)}"`;

  const rpcs = {
    bw_song_file_adopt_begin: (uid: string, a: { p_song_id: string; p_field: 'audio_url' | 'chart_url' }) => {
      const s = songs.get(a.p_song_id);
      if (!s || !admins.has(uid)) return { error: { message: 'Only band admins', code: '42501' } };
      if (s.status === 'suggested') return { data: { won: false, reason: 'waiting' } };
      const ref = s[a.p_field];
      const pre = `${REF}${s.band_id}/suggestions/`;
      if (!ref || !ref.startsWith(pre)) return { data: { won: false, reason: 'nothing', ref } };
      const from = ref.slice(REF.length);
      const p = from.split('/');
      const to = `${p[0]}/${p[3]}/${s.id}-${p[4]}`;
      const row = adoptions.find((r) => r.song_id === s.id && r.field === a.p_field && r.from === from);
      if (row && row.state === 'copying' && row.by && row.by !== uid) return { data: { won: false, reason: 'busy' } };
      if (row) Object.assign(row, { to, state: 'copying', by: uid });
      else adoptions.push({ song_id: s.id, field: a.p_field, from, to, state: 'copying', by: uid });
      return { data: { won: true, from, to } };
    },
    bw_song_file_copy_reserve: (uid: string, a: { p_song_id: string; p_field: string; p_from: string; p_to: string }) => {
      const s = songs.get(a.p_song_id);
      if (!s || !admins.has(uid)) return { error: { message: 'Only band admins', code: '42501' } };
      const kind = a.p_from.split('/')[3];
      const prefix = `${s.band_id}/${kind}/${s.id}-`;
      if (!a.p_to.startsWith(prefix) || a.p_to.slice(prefix.length).includes('/')) return { error: { message: 'Bad destination', code: '22023' } };
      const had = copies.get(a.p_to);
      copies.set(a.p_to, { at: clock.now, by: uid, song: s.id, reservedSeq: had?.reservedSeq ?? ++seq });
      return { data: !had };
    },
    bw_song_file_copy_release: (uid: string, a: { p_song_id: string; p_to: string }) => {
      const s = songs.get(a.p_song_id);
      if (!s || !admins.has(uid)) return { error: { message: 'Only band admins', code: '42501' } };
      const c = copies.get(a.p_to);
      if (!c || c.by !== uid || c.song !== s.id) return { data: false };
      copies.delete(a.p_to);
      return { data: true };
    },
    bw_song_file_adopt_repoint: (uid: string, a: { p_song_id: string; p_field: 'audio_url' | 'chart_url'; p_from: string; p_to: string }) => {
      const s = songs.get(a.p_song_id);
      if (!s || !admins.has(uid)) return { error: { message: 'Only band admins', code: '42501' } };
      const kind = a.p_from.split('/')[3];
      const prefix = `${s.band_id}/${kind}/${s.id}-`;
      if (!a.p_to.startsWith(prefix) || a.p_to.slice(prefix.length).includes('/')) return { error: { message: 'Bad destination', code: '22023' } };
      const row = adoptions.find((r) => r.song_id === s.id && r.field === a.p_field && r.from === a.p_from);
      if (s[a.p_field] !== REF + a.p_from) {
        if (row && row.by === uid && row.state === 'copying') row.by = null;
        return { data: { won: false, ref: s[a.p_field], to_referenced: inUse(a.p_to) } };
      }
      s[a.p_field] = REF + a.p_to;
      copies.delete(a.p_to);
      if (row) Object.assign(row, { to: a.p_to, state: 'repointed', by: null });
      else adoptions.push({ song_id: s.id, field: a.p_field, from: a.p_from, to: a.p_to, state: 'repointed', by: null });
      return { data: { won: true, ref: REF + a.p_to, to_referenced: true } };
    },
    bw_song_file_sweep_list: (uid: string, a: { p_band_id: string }) => {
      if (!admins.has(uid)) return { error: { message: 'Only band admins', code: '42501' } };
      const paths = adoptions
        .filter((r) => (r.state === 'repointed' || lapsed(r)) && r.from.startsWith(`${a.p_band_id}/suggestions/`) && !inUse(r.from))
        .map((r) => r.from);
      // Lapsed delete claims and stale copies of the band, any folder.
      for (const [p, c] of removals) if (p.startsWith(`${a.p_band_id}/`) && clock.now - c.at > LAPSE && !inUse(p)) paths.push(p);
      for (const [p, c] of copies) if (p.startsWith(`${a.p_band_id}/`) && clock.now - c.at > LAPSE && ours(p, c) && !inUse(p)) paths.push(p);
      return { data: [...new Set(paths)] };
    },
    bw_song_file_sweep_claim: (uid: string, a: { p_band_id: string; p_path: string }) => {
      if (!admins.has(uid)) return { error: { message: 'Only band admins', code: '42501' } };
      const r = adoptions.find((x) => x.from === a.p_path && (x.state === 'repointed' || x.state === 'deleting'));
      if (!r) {
        const cp = copies.get(a.p_path);
        if (!removals.has(a.p_path) && !(cp && clock.now - cp.at > LAPSE && ours(a.p_path, cp))) return { data: { ok: false, reason: 'gone' } };
        if (inUse(a.p_path)) return { data: { ok: false, reason: 'referenced' } };
        const c = removals.get(a.p_path);
        if (c && c.by !== uid && clock.now - c.at <= LAPSE) return { data: { ok: false, reason: 'busy' } };
        removals.set(a.p_path, { by: uid, at: clock.now });
        copies.delete(a.p_path);
        return { data: { ok: true } };
      }
      if (r.state === 'deleting' && !lapsed(r)) return { data: { ok: false, reason: 'busy' } };
      if (inUse(a.p_path)) {
        r.state = 'repointed';
        return { data: { ok: false, reason: 'referenced' } };
      }
      Object.assign(r, { state: 'deleting', deletingAt: clock.now, deletingBy: uid });
      return { data: { ok: true } };
    },
    bw_song_files_claim_delete: (uid: string, a: { p_refs: string[] }) => {
      const out: string[] = [];
      for (const r of a.p_refs || []) {
        const p = r.slice(REF.length);
        if (!r.startsWith(REF) || !admins.has(uid) || inUse(p)) continue;
        const c = removals.get(p);
        if (c && c.by !== uid && clock.now - c.at <= LAPSE) continue;
        removals.set(p, { by: uid, at: clock.now });
        out.push(r);
      }
      return { data: out };
    },
    bw_song_files_removed: (uid: string, a: { p_refs: string[] }) => {
      let n = 0;
      for (const r of a.p_refs || []) if (removals.get(r.slice(REF.length))?.by === uid) (removals.delete(r.slice(REF.length)), copies.delete(r.slice(REF.length)), n++);
      return { data: n };
    },
    bw_song_file_sweep_done: (uid: string, a: { p_band_id: string; p_paths: string[] }) => {
      if (!admins.has(uid)) return { error: { message: 'Only band admins', code: '42501' } };
      let n = 0;
      for (const r of adoptions) if (r.state === 'deleting' && a.p_paths.includes(r.from)) (r.state = 'cleaned'), n++;
      for (const p of a.p_paths) if (removals.get(p)?.by === uid) (removals.delete(p), copies.delete(p), n++);
      return { data: n };
    },
  } as Record<string, (uid: string, a: any) => { data?: unknown; error?: unknown }>;

  type Hook = { kind: 'pause'; reached: () => void; release: Promise<void> } | { kind: 'crash' } | { kind: 'lost-after' } | { kind: 'lost-before' };
  const actor = (uid: string, opts: { noRpc?: boolean } = {}) => {
    const hooks = new Map<Step, Hook>();
    const log: string[] = [];
    const at = async (step: Step): Promise<Hook | undefined> => {
      const h = hooks.get(step);
      if (!h) return undefined;
      hooks.delete(step);
      if (h.kind === 'pause') {
        h.reached();
        await h.release;
        return undefined;
      }
      // The app closes here: this run never goes on.
      if (h.kind === 'crash') return new Promise<never>(() => undefined);
      return h;
    };
    const STEP: Record<string, Step> = {
      bw_song_file_adopt_begin: 'begin', bw_song_file_adopt_repoint: 'repoint', bw_song_file_sweep_list: 'sweep_list', bw_song_file_sweep_claim: 'sweep_claim', bw_song_file_sweep_done: 'sweep_done',
      bw_song_files_claim_delete: 'claim_delete', bw_song_files_removed: 'removed', bw_song_file_copy_reserve: 'reserve', bw_song_file_copy_release: 'release',
    };
    const client = {
      rpc: async (fn: string, args: unknown) => {
        const h = await at(STEP[fn]);
        if (opts.noRpc) return { data: null, error: { message: `Could not find the function public.${fn}`, code: 'PGRST202' } };
        if (h?.kind === 'lost-before') return { data: null, error: { message: 'Failed to fetch' } };
        const res = rpcs[fn](uid, args);
        log.push(`${fn}`);
        if (h?.kind === 'lost-after') return { data: null, error: { message: 'Failed to fetch' } };
        return { data: res.data ?? null, error: res.error ?? null };
      },
      from: (table: string) => {
        if (table !== 'songs') throw new Error(`unexpected table ${table}`);
        let id = '';
        const b = {
          select: () => b,
          eq: (_k: string, v: string) => ((id = v), b),
          maybeSingle: async () => {
            await at('reread');
            const s = songs.get(id);
            return { data: s ? { audio_url: s.audio_url, chart_url: s.chart_url } : null, error: null };
          },
        };
        return b;
      },
      storage: {
        from: () => ({
          copy: async (from: string, to: string) => {
            await at('copy');
            const src = store.get(from);
            if (!src) return { data: null, error: Object.assign(new Error('Object not found'), { statusCode: '404' }) };
            if (store.has(to)) return { data: null, error: Object.assign(new Error('The resource already exists'), { statusCode: '409' }) };
            store.set(to, { ...src, seq: ++seq });
            log.push(`copy ${from} -> ${to}`);
            return { data: { path: to }, error: null };
          },
          info: async (path: string) => {
            await at('info');
            const o = store.get(path);
            return o ? { data: { size: o.body.length, etag: o.etag }, error: null } : { data: null, error: new Error('Object not found') };
          },
          remove: async (paths: string[]) => {
            await at('remove');
            if (failRemove > 0) {
              failRemove--;
              return { data: null, error: new Error('Failed to fetch') };
            }
            // 197's RESTRICTIVE delete policy: only a file this user claimed
            // (sweep or delete claim, not lapsed) that nothing links.
            const allowed = (p: string) =>
              !inUse(p) &&
              (adoptions.some((r) => r.from === p && r.state === 'deleting' && r.deletingBy === uid && clock.now - (r.deletingAt ?? 0) <= LAPSE) ||
                (removals.get(p)?.by === uid && clock.now - removals.get(p)!.at <= LAPSE));
            const gone = paths.filter((p) => allowed(p) && store.delete(p));
            log.push(`remove ${paths.join(',')}`);
            return { data: gone.map((name) => ({ name })), error: null };
          },
        }),
      },
    };
    const pause = (step: Step) => {
      let reached!: () => void;
      let release!: () => void;
      const r = new Promise<void>((res) => (reached = res));
      const rel = new Promise<void>((res) => (release = res));
      hooks.set(step, { kind: 'pause', reached, release: rel });
      return { reached: r, release };
    };
    return { uid, client, log, pause, crashAt: (s: Step) => hooks.set(s, { kind: 'crash' }), lose: (s: Step, when: 'before' | 'after') => hooks.set(s, { kind: when === 'after' ? 'lost-after' : 'lost-before' }) };
  };
  const reset = () => {
    store.clear();
    songs.clear();
    adoptions = [];
    removals.clear();
    copies.clear();
    failRemove = 0;
    clock.now = 0;
    seq = 0;
    admins.clear();
  };
  return {
    REF, store, songs, admins, etag, actor, reset, clock,
    /** Past the claim's 10 minutes. */
    lapse: () => void (clock.now += LAPSE + 1),
    adoptions: () => adoptions,
    removals: () => removals,
    copies: () => copies,
    failNextRemove: () => void failRemove++,
    put: (path: string, body: string) => store.set(path, { body, etag: etag(body), seq: ++seq }),
  };
});

const defaultActor = vi.hoisted(() => ({ current: null as null | ReturnType<typeof fake.actor> }));
vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return defaultActor.current!.client;
  },
}));
vi.mock('../../supabase', () => ({
  get supabase() {
    return defaultActor.current!.client;
  },
}));

import { adoptSuggestionFiles, sweepAdoptedFiles } from '../songFiles';
import { reviewSongSuggestion } from '../songSuggestions';

const BAND = 'band-1';
const SONG = 'song-1';
const ORIG = `${BAND}/suggestions/member-1/audio/abc-take.mp3`;
const DEST = `${BAND}/audio/${SONG}-abc-take.mp3`;
const ref = (p: string) => `${fake.REF}${p}`;
const song = () => fake.songs.get(SONG)!;
const adopt = (a: ReturnType<typeof fake.actor>, s = song(), busyWait = { tries: 0, ms: 0 }) =>
  adoptSuggestionFiles({ ...s }, { client: a.client as never, busyWait }).catch((e) => ({ refs: {}, error: e as Error }));

/** Every song points at a file that exists (or at no stored file). */
const noDanglingSong = () => {
  for (const s of fake.songs.values())
    for (const r of [s.audio_url, s.chart_url])
      if (r?.startsWith(fake.REF)) expect(fake.store.has(r.slice(fake.REF.length)), `${s.id} → ${r}`).toBe(true);
};
/** Finished: the song on its own copy with the member's recording, the original gone, nothing left to sweep. */
const finished = (body = 'take one') => {
  expect(song().audio_url).toBe(ref(DEST));
  expect(fake.store.get(DEST)?.body).toBe(body);
  expect(fake.store.has(ORIG)).toBe(false);
  expect(fake.adoptions().filter((r) => r.state === 'repointed' || r.state === 'deleting')).toEqual([]);
  noDanglingSong();
};

const settle = () => new Promise((r) => setTimeout(r, 20));

let A: ReturnType<typeof fake.actor>;
let B: ReturnType<typeof fake.actor>;
beforeEach(() => {
  fake.reset();
  fake.admins.add('admin-1');
  fake.admins.add('admin-2');
  fake.songs.set(SONG, { id: SONG, band_id: BAND, status: 'learning', audio_url: ref(ORIG), chart_url: null });
  fake.put(ORIG, 'take one');
  A = fake.actor('admin-1');
  B = fake.actor('admin-1'); // the same admin on a second device (phone + iPad)
  defaultActor.current = A;
});

describe('moving an accepted song’s files', () => {
  it('copies, repoints on the server, then sweeps the original', async () => {
    const out = await adopt(A);
    expect(out).toEqual({ refs: { audio_url: ref(DEST) }, error: null });
    finished();
  });

  it('review accepts through the same path', async () => {
    const a = fake.actor('admin-1');
    defaultActor.current = a;
    const rpc = a.client.rpc;
    a.client.rpc = (async (fn: string, args: unknown) =>
      fn === 'bw_review_song_suggestion' ? { data: { status: 'accepted', song_id: SONG, files: [] }, error: null } : rpc(fn, args)) as typeof rpc;
    const res = await reviewSongSuggestion({ id: 'sg-1', kind: 'new_song' }, 'accept', { song: { audio_url: ref(ORIG), chart_url: null } });
    expect(res).toEqual({ status: 'accepted', error: null });
    finished();
  });
});

describe('two runs at once (phone + iPad, or two admins)', () => {
  it('A copies, B finds the copy; A repoints first: B deletes nothing', async () => {
    const aRe = A.pause('repoint');
    const pa = adopt(A);
    await aRe.reached;
    const bRe = B.pause('repoint');
    const pb = adopt(B);
    await bRe.reached;
    expect(B.log.some((l) => l.startsWith('copy'))).toBe(false); // B reused A's copy
    aRe.release();
    await pa;
    noDanglingSong();
    bRe.release();
    await pb;
    expect(B.log.filter((l) => l.startsWith('remove') && l.includes(DEST))).toEqual([]);
    finished();
  });

  it('A copies, B finds the copy; B repoints first: A (who made the copy) deletes nothing', async () => {
    const aRe = A.pause('repoint');
    const pa = adopt(A);
    await aRe.reached;
    await adopt(B);
    noDanglingSong();
    aRe.release();
    await pa;
    expect(A.log.filter((l) => l.startsWith('remove') && l.includes(DEST))).toEqual([]);
    finished();
  });

  it('B runs entirely before A copies: A stops, nothing lost', async () => {
    const aCopy = A.pause('copy');
    const pa = adopt(A);
    await aCopy.reached;
    await adopt(B);
    aCopy.release();
    await pa;
    finished();
  });

  it('another admin busy with the same file: the second waits, then reports the copy the song now uses (Codex review of #295)', async () => {
    const other = fake.actor('admin-2');
    const aRe = A.pause('repoint');
    const pa = adopt(A);
    await aRe.reached;
    const po = adopt(other, song(), { tries: 20, ms: 5 });
    await new Promise((r) => setTimeout(r, 12));
    aRe.release();
    await pa;
    const out = await po;
    expect(out.refs).toEqual({ audio_url: ref(DEST) });
    expect(other.log.filter((l) => l.startsWith('copy') || l.startsWith('remove'))).toEqual([]);
    finished();
  });

  it('the other device already finished: its copy is reported, not dropped (Codex review of 02405d5c)', async () => {
    await adopt(A);
    finished();
    const other = fake.actor('admin-2');
    // This screen still shows the original.
    const out = await adopt(other, { ...song(), audio_url: ref(ORIG) });
    expect(out.refs).toEqual({ audio_url: ref(DEST) });
    expect(other.log.filter((l) => l.startsWith('copy') || l.startsWith('remove'))).toEqual([]);
  });

  it('another admin busy with the same file: the second waits (does nothing)', async () => {
    const other = fake.actor('admin-2');
    const aRe = A.pause('repoint');
    const pa = adopt(A);
    await aRe.reached;
    const out = await adopt(other);
    expect(out.refs).toEqual({});
    expect(other.log.filter((l) => l.startsWith('copy') || l.startsWith('remove'))).toEqual([]);
    aRe.release();
    await pa;
    finished();
  });
});

describe('a lost response', () => {
  it('after the repoint committed: the copy the song now uses stays', async () => {
    A.lose('repoint', 'after');
    const out = await adopt(A);
    expect(out.refs).toEqual({ audio_url: ref(DEST) });
    expect(A.log.filter((l) => l.startsWith('remove') && l.includes(DEST))).toEqual([]);
    finished();
  });

  it('before the repoint reached the server: the song keeps the original, a re-run finishes', async () => {
    A.lose('repoint', 'before');
    const out = await adopt(A);
    expect(out.error).toBeTruthy();
    expect(song().audio_url).toBe(ref(ORIG));
    noDanglingSong();
    await adopt(fake.actor('admin-1'));
    finished();
  });
});

describe('a run stopped at each step, then run again', () => {
  for (const step of ['begin', 'copy', 'info', 'repoint', 'sweep_list', 'sweep_claim', 'remove', 'sweep_done'] as Step[]) {
    it(`stopped at ${step}`, async () => {
      if (step === 'info') fake.put(DEST, 'take one'); // a copy from an earlier try, checked with info()
      A.crashAt(step);
      void adopt(A);
      await settle();
      noDanglingSong();
      // Stopped while deleting: the claim lapses, then the original is pending again.
      if (step === 'remove' || step === 'sweep_done') fake.lapse();
      const again = fake.actor('admin-1');
      await adopt(again, song());
      finished();
    });
  }

  it('stopped after the repoint: the repertoire’s sweep removes the original', async () => {
    A.crashAt('sweep_list');
    void adopt(A);
    await settle();
    expect(song().audio_url).toBe(ref(DEST));
    noDanglingSong();
    await sweepAdoptedFiles(BAND, { client: fake.actor('admin-1').client as never });
    finished();
  });
});

describe('names that collide', () => {
  it('a member’s file named like another song’s recording never replaces it', async () => {
    // Another song uses band-1/audio/abc-take.mp3; the member uploads a different file under that name.
    fake.songs.set('song-0', { id: 'song-0', band_id: BAND, status: 'ready', audio_url: ref(`${BAND}/audio/abc-take.mp3`), chart_url: null });
    fake.put(`${BAND}/audio/abc-take.mp3`, 'the band’s real recording');
    fake.put(ORIG, 'not the same file');
    await adopt(A);
    expect(fake.songs.get('song-0')!.audio_url).toBe(ref(`${BAND}/audio/abc-take.mp3`));
    expect(fake.store.get(`${BAND}/audio/abc-take.mp3`)?.body).toBe('the band’s real recording');
    finished('not the same file');
  });

  it('two songs with the same file name get their own recordings', async () => {
    const ORIG2 = `${BAND}/suggestions/member-2/audio/abc-take.mp3`;
    fake.songs.set('song-2', { id: 'song-2', band_id: BAND, status: 'ready', audio_url: ref(ORIG2), chart_url: null });
    fake.put(ORIG2, 'take two');
    await adopt(A);
    await adopt(A, fake.songs.get('song-2')!);
    finished();
    expect(fake.store.get(`${BAND}/audio/song-2-abc-take.mp3`)?.body).toBe('take two');
    expect(fake.songs.get('song-2')!.audio_url).toBe(ref(`${BAND}/audio/song-2-abc-take.mp3`));
  });

  it('a different file already at the destination is kept: a new name is used', async () => {
    fake.put(DEST, 'something else');
    await adopt(A);
    expect(fake.store.get(DEST)?.body).toBe('something else');
    const now = song().audio_url!.slice(fake.REF.length);
    expect(now).not.toBe(DEST);
    expect(now.startsWith(`${BAND}/audio/${SONG}-`)).toBe(true);
    expect(fake.store.get(now)?.body).toBe('take one');
    expect(fake.store.has(ORIG)).toBe(false);
    noDanglingSong();
  });

  it('the name it gave up is not left registered: only the chosen copy was (Codex review of ed7ec29f)', async () => {
    fake.put(DEST, 'something else');
    const out = await adopt(A);
    expect(out.error).toBeNull();
    expect(A.log).toContain('bw_song_file_copy_release');
    expect(fake.copies().has(DEST)).toBe(false);
    fake.lapse();
    await sweepAdoptedFiles(BAND, { client: A.client as never });
    expect(fake.store.get(DEST)?.body).toBe('something else');
  });

  it('a run that stops after giving up a name leaves the file already there alone (Codex review of ed7ec29f)', async () => {
    fake.put(DEST, 'something else');
    A.crashAt('release');
    void adopt(A);
    await settle();
    expect(fake.copies().has(DEST)).toBe(true);
    fake.lapse();
    const out = await sweepAdoptedFiles(BAND, { client: B.client as never });
    expect(out.error).toBeNull();
    expect(fake.store.get(DEST)?.body).toBe('something else');
  });

  it('the same file already there (an earlier run’s copy) keeps its registration', async () => {
    fake.put(DEST, 'take one');
    const out = await adopt(A);
    expect(out).toEqual({ refs: { audio_url: ref(DEST) }, error: null });
    expect(A.log).not.toContain('bw_song_file_copy_release');
    finished();
  });
});

describe('what is left behind', () => {
  it('a failed delete of the original is recorded and swept later', async () => {
    fake.failNextRemove();
    const out = await adopt(A);
    expect(out.refs).toEqual({ audio_url: ref(DEST) });
    expect(fake.store.has(ORIG)).toBe(true);
    expect(fake.adoptions().filter((r) => r.state === 'deleting').map((r) => r.from)).toEqual([ORIG]);
    // Claimed and not done: left alone until the claim lapses (10 minutes)…
    await sweepAdoptedFiles(BAND, { client: fake.actor('admin-1').client as never });
    expect(fake.store.has(ORIG)).toBe(true);
    // …then pending again, and the next sweep deletes it.
    fake.lapse();
    await sweepAdoptedFiles(BAND, { client: fake.actor('admin-1').client as never });
    finished();
  });

  it('a song links the original between the sweep’s list and its delete: not deleted', async () => {
    const claim = A.pause('sweep_claim');
    const pa = adopt(A);
    await claim.reached;
    // A member suggests a new song with that same file meanwhile.
    fake.songs.set('song-9', { id: 'song-9', band_id: BAND, status: 'suggested', audio_url: ref(ORIG), chart_url: null });
    claim.release();
    await pa;
    expect(fake.store.has(ORIG)).toBe(true);
    expect(A.log.filter((l) => l.startsWith('remove'))).toEqual([]);
    expect(song().audio_url).toBe(ref(DEST));
    noDanglingSong();
  });

  it('the song changed meanwhile: only this run’s unused copy goes', async () => {
    const aRe = A.pause('repoint');
    const pa = adopt(A);
    await aRe.reached;
    fake.put(`${BAND}/audio/new-take.mp3`, 'new take');
    song().audio_url = ref(`${BAND}/audio/new-take.mp3`);
    aRe.release();
    const out = await pa;
    expect(out.error).toBeTruthy();
    expect(fake.store.has(DEST)).toBe(false);
    expect(fake.store.has(ORIG)).toBe(true); // not this run's to delete
    expect(song().audio_url).toBe(ref(`${BAND}/audio/new-take.mp3`));
    noDanglingSong();
  });

  it('the rollback of its own copy claims it first; the claim is closed after (Codex review of f32a26e7)', async () => {
    const aRe = A.pause('repoint');
    const pa = adopt(A);
    await aRe.reached;
    fake.put(`${BAND}/audio/new-take.mp3`, 'new take');
    song().audio_url = ref(`${BAND}/audio/new-take.mp3`);
    aRe.release();
    await pa;
    const i = A.log.indexOf('bw_song_files_claim_delete');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(A.log.findIndex((l) => l.startsWith(`remove ${DEST}`))).toBeGreaterThan(i);
    expect(fake.store.has(DEST)).toBe(false);
    expect(fake.removals().size).toBe(0);
  });

  it('a sweep delete that wakes up after the lapse, with the original linked again, deletes nothing (Codex review of f32a26e7)', async () => {
    // Stop the first sweep right before its delete.
    const aRm = A.pause('remove');
    const pa = adopt(A);
    await aRm.reached;
    fake.lapse();
    // Meanwhile another song links the original (allowed again after the lapse).
    fake.songs.set('song-9', { id: 'song-9', band_id: BAND, status: 'ready', audio_url: ref(ORIG), chart_url: null });
    aRm.release();
    await pa;
    expect(fake.store.has(ORIG)).toBe(true);
    expect(fake.adoptions().find((r) => r.from === ORIG)?.state).not.toBe('cleaned');
    noDanglingSong();
  });

  it('a server without 197: nothing is touched', async () => {
    const old = fake.actor('admin-1', { noRpc: true });
    const out = await adopt(old);
    expect(out.error).toBeTruthy();
    expect(song().audio_url).toBe(ref(ORIG));
    expect(fake.store.has(ORIG)).toBe(true);
    expect(old.log).toEqual([]);
  });

  it('an expired delete claim in the band’s audio folder is deleted by the sweep (Codex review of 220767ca)', async () => {
    const OLD = `${BAND}/audio/old-take.mp3`;
    fake.put(OLD, 'old take');
    fake.removals().set(OLD, { by: 'admin-2', at: fake.clock.now });
    fake.lapse();
    const out = await sweepAdoptedFiles(BAND, { client: A.client as never });
    expect(out.error).toBeNull();
    expect(fake.store.has(OLD)).toBe(false);
    expect(fake.removals().has(OLD)).toBe(false);
  });

  it('a song deleted between copy and repoint: the copy is registered first and deleted (Codex review of 220767ca)', async () => {
    const aRe = A.pause('repoint');
    const pa = adopt(A);
    await aRe.reached;
    fake.songs.delete(SONG);
    aRe.release();
    const out = await pa;
    expect(out.error).toBeTruthy();
    const reserved = A.log.indexOf('bw_song_file_copy_reserve');
    expect(reserved).toBeGreaterThanOrEqual(0);
    expect(A.log.findIndex((l) => l.startsWith('copy '))).toBeGreaterThan(reserved);
    expect(fake.store.has(DEST)).toBe(false);
    expect(fake.store.has(ORIG)).toBe(true);
  });

  it('a song deleted between copy and repoint, and the delete fails too: the sweep removes the copy (Codex review of 220767ca)', async () => {
    const aRe = A.pause('repoint');
    const pa = adopt(A);
    await aRe.reached;
    fake.songs.delete(SONG);
    fake.failNextRemove();
    aRe.release();
    await pa;
    expect(fake.store.has(DEST)).toBe(true);
    fake.lapse();
    const out = await sweepAdoptedFiles(BAND, { client: A.client as never });
    expect(out.error).toBeNull();
    expect(fake.store.has(DEST)).toBe(false);
    expect(fake.copies().size).toBe(0);
    expect(fake.removals().size).toBe(0);
  });
});
