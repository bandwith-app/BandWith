import { describe, it, expect, beforeEach } from 'vitest';
import {
  addLiveOp,
  applyNoteOps,
  flushLiveOutbox,
  queueLiveOp,
  readLiveOutbox,
  waitingChanges,
  type LiveOp,
  type LiveOutboxApi,
} from '../liveOutbox';
import { queueNoteOp } from '../rehearsalNotesOutbox';

const me = 'u-1';
const note = (id: string, body: string, isNew = false): LiveOp => ({
  kind: 'note',
  id,
  songId: 's1',
  anchor: { type: 'song' } as never,
  body,
  isNew,
});

beforeEach(() => localStorage.clear());

describe('live outbox: what waits on the phone', () => {
  it('a later edit of the same note replaces the waiting one and stays "new"', () => {
    let ops = addLiveOp([], note('n1', 'capo 2', true));
    ops = addLiveOp(ops, note('n1', 'capo 3'));
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ body: 'capo 3', isNew: true });
  });

  it('deleting a note written offline sends nothing at all', () => {
    let ops = addLiveOp([], note('n1', 'capo 2', true));
    ops = addLiveOp(ops, { kind: 'noteDelete', id: 'n1', songId: 's1' });
    expect(ops).toEqual([]);
  });

  it('deleting a saved note replaces its waiting edit', () => {
    let ops = addLiveOp([], note('n1', 'capo 2'));
    ops = addLiveOp(ops, { kind: 'noteDelete', id: 'n1', songId: 's1' });
    expect(ops).toEqual([{ kind: 'noteDelete', id: 'n1', songId: 's1' }]);
  });

  it('the leader reordering twice sends the last order, diffed from the first saved one', () => {
    const order = (ids: string[], before: string[]): LiveOp => ({
      kind: 'order',
      setlistId: 'sl',
      eventId: 'e1',
      rows: ids.map((id, i) => ({ id, setlist_id: 'sl', song_id: `song-${id}`, position: i, set_number: 1 })),
      before: before.map((id) => ({ songId: `song-${id}`, setNumber: 1 })),
    });
    let ops = addLiveOp([], order(['b', 'a', 'c'], ['a', 'b', 'c']));
    ops = addLiveOp(ops, order(['c', 'b', 'a'], ['b', 'a', 'c']));
    expect(ops).toHaveLength(1);
    expect((ops[0] as Extract<LiveOp, { kind: 'order' }>).rows.map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect((ops[0] as Extract<LiveOp, { kind: 'order' }>).before.map((b) => b.songId)).toEqual(['song-a', 'song-b', 'song-c']);
  });

  it('shows my notes as they will be once sent', () => {
    const saved = [
      { id: 'n1', song_id: 's1', anchor: { type: 'song' }, body: 'old' },
      { id: 'n2', song_id: 's1', anchor: { type: 'song' }, body: 'gone' },
    ] as never[];
    const ops: LiveOp[] = [note('n1', 'new'), { kind: 'noteDelete', id: 'n2', songId: 's1' }, note('n3', 'added', true), { ...note('x', 'other song'), songId: 's2' } as LiveOp];
    const out = applyNoteOps(saved, ops, 's1');
    expect(out.map((n: any) => `${n.id}:${n.body}`)).toEqual(['n1:new', 'n3:added']);
  });

  it('counts every change waiting on this phone, rehearsal notes included', () => {
    queueLiveOp(me, note('n1', 'capo 2', true));
    queueLiveOp(me, { kind: 'suggestion', id: 'g1', row: { band_id: 'b', song_id: 's1', kind: 'note', proposed: { note: 'x' } } });
    queueNoteOp(me, { kind: 'delete', id: 'r1' });
    expect(waitingChanges(me)).toBe(3);
    expect(waitingChanges('someone-else')).toBe(0);
  });
});

describe('flushLiveOutbox', () => {
  const api = (over: Partial<LiveOutboxApi> = {}): LiveOutboxApi & { log: string[] } => {
    const log: string[] = [];
    const ok = (tag: string) => async () => {
      log.push(tag);
      return { error: null };
    };
    return {
      log,
      note: over.note ?? (async (op) => (log.push(`note:${op.id}`), { error: null })),
      noteDelete: over.noteDelete ?? ok('noteDelete'),
      suggestion: over.suggestion ?? ok('suggestion'),
      order: over.order ?? ok('order'),
    };
  };

  it('sends everything in order and empties the outbox', async () => {
    queueLiveOp(me, note('n1', 'a', true));
    queueLiveOp(me, note('n2', 'b', true));
    const a = api();
    const r = await flushLiveOutbox(me, a);
    expect(a.log).toEqual(['note:n1', 'note:n2']);
    expect(r).toEqual({ sent: 2, dropped: 0, left: 0 });
    expect(readLiveOutbox(me)).toEqual([]);
  });

  it('still no signal: stops and keeps the rest', async () => {
    queueLiveOp(me, note('n1', 'a', true));
    queueLiveOp(me, note('n2', 'b', true));
    const r = await flushLiveOutbox(me, api({ note: async () => ({ error: { message: 'Failed to fetch' } }) }));
    expect(r.left).toBe(2);
  });

  it('refused by the server (no longer allowed, song gone): dropped, the rest goes', async () => {
    queueLiveOp(me, note('n1', 'a', true));
    queueLiveOp(me, note('n2', 'b', true));
    const a = api({ note: async (op) => (op.id === 'n1' ? { error: { message: 'permission denied', code: '42501' } } : { error: null }) });
    const r = await flushLiveOutbox(me, a);
    expect(r).toEqual({ sent: 1, dropped: 1, left: 0 });
  });
});
