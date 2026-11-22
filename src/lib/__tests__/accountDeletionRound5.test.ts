import { describe, it, expect } from 'vitest';
import * as deletion from '../../../supabase/functions/_shared/account-deletion';
import { removeFolder, type FolderStore } from '../../../supabase/functions/_shared/account-deletion';
import fn from '../../../supabase/functions/delete-account/index.ts?raw';
import chatsSource from '../services/chats.ts?raw';

// A Storage bucket in memory: list() shows one level, `limit` entries, sorted.
const bucket = (paths: string[], failRemoveOnce?: (p: string[]) => boolean) => {
  const files = new Set(paths);
  let failed = false;
  const store: FolderStore = {
    async list(prefix, opts) {
      const seen = new Map<string, boolean>();
      for (const f of [...files].sort()) {
        if (!f.startsWith(prefix + '/')) continue;
        const rest = f.slice(prefix.length + 1);
        const [head, ...more] = rest.split('/');
        if (!seen.has(head)) seen.set(head, more.length === 0);
      }
      return { data: [...seen].slice(0, opts.limit).map(([name, isFile]) => ({ name, id: isFile ? `id-${name}` : null })), error: null };
    },
    async remove(ps) {
      if (!failed && failRemoveOnce?.(ps)) {
        failed = true;
        return { error: { message: 'Storage is down' } };
      }
      ps.forEach((p) => files.delete(p));
      return { error: null };
    },
  };
  return { store, files };
};

// Codex B5: a file more than five folders deep was never reached, so the
// deletion stopped with a 503 for good.
describe('round 5: folders of any depth', () => {
  it('removes a file 7 folders deep', async () => {
    const deep = 'u1/a/b/c/d/e/f/g/take.m4a';
    const { store, files } = bucket([deep, 'u1/top.m4a', 'u2/keep.m4a']);
    expect(await removeFolder(store, 'u1')).toBe(true);
    expect([...files]).toEqual(['u2/keep.m4a']);
  });

  it('pages through more than 100 entries at every level', async () => {
    const paths = Array.from({ length: 130 }, (_, i) => `u1/x/y/z/w/v/song-${String(i).padStart(3, '0')}/t.m4a`);
    const { store, files } = bucket(paths);
    expect(await removeFolder(store, 'u1')).toBe(true);
    expect(files.size).toBe(0);
  });
});

// A fake server for finishCommitted: buckets in memory, RPCs recorded.
const server = (opts: {
  avatarFailsOnce?: boolean;
  userGone?: boolean;
} = {}) => {
  const calls: string[] = [];
  const personal = bucket(['u1/song/take.m4a']);
  const avatars = bucket(['u1/me.png'], opts.avatarFailsOnce ? (ps) => ps.some((p) => p.startsWith('u1/')) : undefined);
  const stores: Record<string, ReturnType<typeof bucket>> = {
    'personal-files': personal,
    avatars,
    'song-files': bucket(['solo/song/chart.pdf']),
    'band-branding': bucket([]),
    quotes: bucket([]),
  };
  let deleted = false;
  const s: deletion.DeletionServer = {
    rpc: async (name) => {
      calls.push(name);
      if (name === 'bw_account_storage_release') {
        const left = personal.files.size + [...avatars.files].filter((f) => f.startsWith('u1/')).length;
        return { data: { released: 0, personal_left: left }, error: null };
      }
      return { data: null, error: null };
    },
    store: (b) => {
      calls.push(`list:${b}`);
      return (stores[b] ?? bucket([])).store;
    },
    pendingBandIds: async () => ({ data: { band_ids: ['solo'] }, error: null }),
    bandsStillThere: async () => ({ data: [], error: null }),
    deleteUser: async () => {
      calls.push('deleteUser');
      if (opts.userGone || deleted) return { error: { status: 404, code: 'user_not_found', message: 'User not found' } };
      deleted = true;
      return { error: null };
    },
  };
  return { s, calls, stores };
};

// Codex B1 + Claude blocker: committing comes before any file goes, and a
// committed deletion is finished by a retry or by the server job.
describe('round 5: committed before any file goes', () => {
  it('the function commits (prepare) before it removes any file', () => {
    // The user's request, from the caller check on.
    const flow = fn.slice(fn.indexOf('const caller = await requireCaller'));
    const begin = flow.indexOf("rpc('bw_account_deletion_begin'");
    const prepare = flow.indexOf('"bw_prepare_account_deletion"');
    const firstErase = Math.min(
      ...[flow.indexOf('removeFolder('), flow.indexOf('finishCommitted(')].filter((i) => i >= 0),
    );
    expect(begin).toBeGreaterThan(0);
    expect(prepare).toBeGreaterThan(begin);
    expect(firstErase).toBeGreaterThan(prepare);
  });

  it('the avatar step fails: not ready, the account stays; the retry finishes it', async () => {
    const { s, calls, stores } = server({ avatarFailsOnce: true });
    const finishCommitted = deletion.finishCommitted;
    expect(typeof finishCommitted).toBe('function');
    const first = await finishCommitted(s, 'u1', []);
    expect(first.kind).toBe('not_ready');
    expect(calls).not.toContain('deleteUser');
    const second = await finishCommitted(s, 'u1', []);
    expect(second).toEqual({ kind: 'done' });
    expect(calls.filter((c) => c === 'deleteUser')).toHaveLength(1);
    expect(stores.avatars.files.size).toBe(0);
    expect(stores['song-files'].files.size).toBe(0); // the solo band's files
  });

  it('runs the last step before Auth and the final scrub after it', async () => {
    const { s, calls } = server();
    expect(await deletion.finishCommitted(s, 'u1', [])).toEqual({ kind: 'done' });
    const finish = calls.indexOf('bw_account_deletion_finish');
    const auth = calls.indexOf('deleteUser');
    const scrub = calls.indexOf('bw_account_deletion_scrub');
    expect(finish).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(finish);
    expect(scrub).toBeGreaterThan(auth);
    // Storage is checked before the last step.
    expect(calls.indexOf('bw_account_storage_release')).toBeLessThan(finish);
  });

  it('a user Auth already deleted (the job and a retry at once) counts as done', async () => {
    const { s, calls } = server({ userGone: true });
    expect(await deletion.finishCommitted(s, 'u1', [])).toEqual({ kind: 'done' });
    expect(calls).toContain('bw_account_deletion_scrub');
  });

  it('the server job: dispatch secret, leased rows, each one finished', () => {
    expect(fn).toMatch(/x-bw-dispatch-secret/);
    expect(fn).toMatch(/rpc\(["']bw_verify_push_dispatch_secret["']/);
    expect(fn).toMatch(/rpc\(["']bw_account_deletions_due["']/);
    const sweep = fn.slice(fn.indexOf('bw_account_deletions_due'));
    expect(sweep).toMatch(/finishCommitted\(/);
  });

  it('a 503 after commit says the deletion is underway (committed)', () => {
    expect(fn).toMatch(/committed: true/);
  });

  // Round 6 (Claude 7): a retry whose begin answers committed and whose
  // prepare then fails is still committed: a 503 with committed, not a 500.
  it('a prepare error after a committed begin answers committed', () => {
    expect(deletion.beginOutcome({ ok: true, committed: true, band_ids: [] }, null)).toEqual({ kind: 'ok', bandIds: [], committed: true });
    const flow = fn.slice(fn.indexOf('const caller = await requireCaller'));
    expect(flow).toMatch(/if \(prepError && begin\.committed\) return notReady\("prepare", prepError, true\);/);
  });

  // Round 6 (Codex B2): after prepare the pending row lists only the bands
  // it deleted; begin's guess is not passed on.
  it('finishes with the bands prepare noted, not begin\'s list', () => {
    const flow = fn.slice(fn.indexOf('const caller = await requireCaller'));
    expect(flow).toMatch(/finishCommitted\(deletionServer\(admin\), caller\.id\)/);
  });
});

// Claude minor 1 / Codex B3: notices carry the sender's id and the message's
// id, so the cleanup never matches by name.
describe('round 5: chat notices carry ids', () => {
  it('sendMessage sends sender_id and message_id', () => {
    const common = chatsSource.slice(chatsSource.indexOf('const common = {') - 400, chatsSource.indexOf('const common = {') + 400);
    expect(common).toMatch(/sender_id: user\.id/);
    expect(common).toMatch(/message_id: data\?\.id/);
  });
});
