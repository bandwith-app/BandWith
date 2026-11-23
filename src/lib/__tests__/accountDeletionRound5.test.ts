import { describe, it, expect } from 'vitest';
import * as deletion from '../../../supabase/functions/_shared/account-deletion';
import fn from '../../../supabase/functions/delete-account/index.ts?raw';
import chatsSource from '../services/chats.ts?raw';
import chatModalSource from '../../app/components/chat/ChatDetailModal.tsx?raw';
import { directChatName } from '../formerMember';

// Buckets in memory, read the way the server does (round 8): the names under
// a prefix straight from storage.objects (bw_account_storage_names, keyset
// pages), removed through the Storage API.
type Buckets = Record<string, Set<string>>;
const names = (buckets: Buckets, args: Record<string, unknown>) => {
  const all = [...(buckets[String(args.p_bucket)] ?? [])].sort();
  const prefix = `${String(args.p_prefix)}/`;
  const after = (args.p_after as string | null) ?? '';
  return all.filter((n) => n.startsWith(prefix) && n > after).slice(0, Number(args.p_limit ?? 1000));
};
const storeOf = (buckets: Buckets, b: string, failRemoveOnce?: (p: string[]) => boolean) => {
  let failed = false;
  return {
    async remove(ps: string[]) {
      if (!failed && failRemoveOnce?.(ps)) {
        failed = true;
        return { error: { message: 'Storage is down' } };
      }
      ps.forEach((p) => buckets[b]?.delete(p));
      return { error: null };
    },
  };
};
const listingServer = (buckets: Buckets, calls: Record<string, unknown>[] = []) => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name !== 'bw_account_storage_names') return { data: null, error: null };
    calls.push(args);
    return { data: names(buckets, args), error: null };
  },
  store: (b: string) => storeOf(buckets, b),
});

// Codex round 6 (B3): no folder walk and no depth cap: the names come from
// storage.objects, page by page.
describe('round 8: files at any depth, from storage.objects', () => {
  it('removes a file 70 folders deep', async () => {
    const deep = `u1/${Array.from({ length: 70 }, (_, i) => `d${i}`).join('/')}/take.m4a`;
    const buckets: Buckets = { 'personal-files': new Set([deep, 'u1/top.m4a', 'u2/keep.m4a']) };
    expect(await deletion.removeObjects(listingServer(buckets), 'personal-files', 'u1')).toBe(true);
    expect([...buckets['personal-files']]).toEqual(['u2/keep.m4a']);
  });

  it('pages through more names than one page holds', async () => {
    const buckets: Buckets = { 'song-files': new Set(Array.from({ length: 2500 }, (_, i) => `b1/s${String(i).padStart(4, '0')}/t.m4a`)) };
    const calls: Record<string, unknown>[] = [];
    expect(await deletion.removeObjects(listingServer(buckets, calls), 'song-files', 'b1')).toBe(true);
    expect(buckets['song-files'].size).toBe(0);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls[1].p_after).toBeTruthy();
  });

  it('a failed listing or removal reports the folder as not empty', async () => {
    const buckets: Buckets = { avatars: new Set(['u1/me.png']) };
    const failing = { ...listingServer(buckets), rpc: async () => ({ data: null, error: { message: 'timeout' } }) };
    expect(await deletion.removeObjects(failing, 'avatars', 'u1')).toBe(false);
    const stuck = { ...listingServer(buckets), store: () => ({ remove: async () => ({ error: { message: 'denied' } }) }) };
    expect(await deletion.removeObjects(stuck, 'avatars', 'u1')).toBe(false);
  });

  it('the folder walk is gone', () => {
    expect((deletion as Record<string, unknown>).removeFolder).toBeUndefined();
  });
});

// A fake server for finishCommitted: buckets in memory, RPCs recorded.
const server = (opts: {
  avatarFailsOnce?: boolean;
  userGone?: boolean;
  pending?: string[];
} = {}) => {
  const calls: string[] = [];
  const buckets: Buckets = {
    'personal-files': new Set(['u1/song/take.m4a']),
    avatars: new Set(['u1/me.png']),
    'song-files': new Set(['solo/song/chart.pdf', 'gone/song/old.pdf']),
    'band-branding': new Set(),
    quotes: new Set(),
  };
  let deleted = false;
  const cache: Record<string, ReturnType<typeof storeOf>> = {};
  const s: deletion.DeletionServer = {
    rpc: async (name, args) => {
      calls.push(name);
      if (name === 'bw_account_storage_names') return { data: names(buckets, args), error: null };
      if (name === 'bw_account_storage_release') {
        const left = buckets['personal-files'].size + [...buckets.avatars].filter((f) => f.startsWith('u1/')).length;
        return { data: { released: 0, personal_left: left }, error: null };
      }
      return { data: null, error: null };
    },
    store: (b) => {
      calls.push(`store:${b}`);
      return (cache[b] ??= storeOf(buckets, b, b === 'avatars' && opts.avatarFailsOnce ? (ps) => ps.some((p) => p.startsWith('u1/')) : undefined));
    },
    pendingBandIds: async () => ({ data: { band_ids: opts.pending ?? ['solo'] }, error: null }),
    bandsStillThere: async () => ({ data: [], error: null }),
    deleteUser: async () => {
      calls.push('deleteUser');
      if (opts.userGone || deleted) return { error: { status: 404, code: 'user_not_found', message: 'User not found' } };
      deleted = true;
      return { error: null };
    },
  };
  const stores = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, { files: v }]));
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
      ...[flow.indexOf('removeObjects('), flow.indexOf('finishCommitted(')].filter((i) => i >= 0),
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
    expect([...stores['song-files'].files]).toEqual(['gone/song/old.pdf']); // the solo band's files go, an unnoted band's stay
  });

  // Codex round 6 (B1): a band recorded at begin and deleted before prepare
  // is still noted; its files are cleaned by its path.
  it('cleans the files of a noted band that is already gone', async () => {
    const { s, stores } = server({ pending: ['gone'] });
    expect(await deletion.finishCommitted(s, 'u1')).toEqual({ kind: 'done' });
    expect([...stores['song-files'].files]).toEqual(['solo/song/chart.pdf']);
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
describe('round 8: the chat header names a direct chat as the list does', () => {
  // Round 13: behaviour first (the rule the header applies), then the
  // header's call itself, anchored on directChatName (#291 adds another
  // `fullChat.type === 'direct'` branch above it, in checkPermission).
  it('names a direct chat from its creator or last sender, "Former member" only when nobody is there', () => {
    const base = { storedName: null, fallback: '', former: 'Former member', me: 'me' };
    expect(directChatName({ ...base, others: [], otherIds: ['them', null] })).toBe('');
    expect(directChatName({ ...base, others: [], otherIds: [null, 'them'] })).toBe('');
    expect(directChatName({ ...base, others: [], otherIds: ['me', 'me'] })).toBe('Former member');
    expect(directChatName({ ...base, others: [{ profile: { full_name: 'Gina Torres' } }], otherIds: [] })).toBe('Gina Torres');
  });

  it('uses directChatName with the creator and the last sender', () => {
    const at = chatModalSource.indexOf('directChatName({');
    expect(at).toBeGreaterThan(-1);
    const call = chatModalSource.slice(at, chatModalSource.indexOf('});', at));
    expect(call).toMatch(/others,/);
    expect(call).toMatch(/me: user\?\.id,/);
    expect(call).toMatch(/otherIds: \[\(fullChat as any\)\.created_by, fullChat\.last_message\?\.sender_id\]/);
  });
});

describe('round 5: chat notices carry ids', () => {
  it('sendMessage sends sender_id and message_id', () => {
    const common = chatsSource.slice(chatsSource.indexOf('const common = {') - 400, chatsSource.indexOf('const common = {') + 400);
    expect(common).toMatch(/sender_id: user\.id/);
    expect(common).toMatch(/message_id: data\?\.id/);
  });
});
