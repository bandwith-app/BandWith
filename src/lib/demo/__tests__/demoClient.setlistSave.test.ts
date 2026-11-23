import { describe, it, expect, beforeEach } from 'vitest';

// Round 8 (Claude r7 nit): the demo's bw_save_setlist_songs compared who
// sings what with its own JSON.stringify, so the same singers in another key
// order were a "changed meanwhile" in the demo only. It uses voicesKey now,
// like the app and 188: key order doesn't count, {} and null are the same.

import { createDemoClient } from '../demoClient';

type Row = { id: string; setlist_id: string; song_id: string; set_number?: number; position: number; vocal_parts?: unknown };

const setup = async () => {
  const client = createDemoClient() as any;
  const { data } = await client.from('setlist_songs').select('*');
  const rows = (data as Row[]).filter((r) => r.setlist_id === (data as Row[])[0].setlist_id).sort((a, b) => (a.set_number ?? 1) - (b.set_number ?? 1) || a.position - b.position);
  return { client, rows, setlistId: rows[0].setlist_id };
};
const asExpected = (rows: Row[], voices: (i: number) => unknown) =>
  rows.map((r, i) => ({ id: r.id, song_id: r.song_id, set_number: r.set_number ?? 1, vocal_parts: voices(i) }));

beforeEach(() => localStorage.clear());

describe('demo: a setlist saved in one go (188) checks who sings what like the app', () => {
  it('the same singers in another key order are not a change', async () => {
    const { client, rows, setlistId } = await setup();
    await client.from('setlist_songs').update({ vocal_parts: { lead: 'u-ana', harmony: ['u-ben', 'u-cy'] } }).eq('id', rows[0].id);
    const res = await client.rpc('bw_save_setlist_songs', {
      p_setlist_id: setlistId,
      p_songs: rows.map((r) => ({ id: r.id, song_id: r.song_id, set_number: r.set_number ?? 1 })),
      p_expected: { songs: asExpected(rows, (i) => (i === 0 ? { harmony: ['u-ben', 'u-cy'], lead: 'u-ana' } : {})) },
    });
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ saved: true });
  });

  it('other singers are still a change', async () => {
    const { client, rows, setlistId } = await setup();
    await client.from('setlist_songs').update({ vocal_parts: { lead: 'u-ana' } }).eq('id', rows[0].id);
    const res = await client.rpc('bw_save_setlist_songs', {
      p_setlist_id: setlistId,
      p_songs: rows.map((r) => ({ id: r.id, song_id: r.song_id, set_number: r.set_number ?? 1 })),
      p_expected: { songs: asExpected(rows, (i) => (i === 0 ? { lead: 'u-ben' } : null)) },
    });
    expect(res.data).toMatchObject({ saved: false, conflict: true });
  });
});
