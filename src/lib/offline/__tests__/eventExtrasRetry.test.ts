import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Audit 05 #6: stage and rider are separate steps, so a retry never adds a second rider. */
const mocks = vi.hoisted(() => ({
  persistComposerStage: vi.fn(),
  riders: [] as { id: string }[],
}));

const query = (table: string) => {
  const q: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => void) => res({ data: table === 'contracts' ? mocks.riders : null, error: null });
      if (prop === 'maybeSingle') return async () => ({ data: null, error: null });
      return () => q;
    },
  });
  return q;
};

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => query(t) } }));
vi.mock('@/lib/services/songs', () => ({ createSetlist: vi.fn(), replaceSetlistSongs: vi.fn(), updateSetlist: vi.fn() }));
vi.mock('@/lib/services/eventTasks', () => ({ syncEventTasks: vi.fn(async () => ({ error: null })) }));
vi.mock('@/lib/services/eventMemberMoney', () => ({ saveEventLineup: vi.fn(async () => ({ error: null })) }));
vi.mock('@/lib/services/composerStage', () => ({ persistComposerStage: mocks.persistComposerStage }));

import * as extrasModule from '../eventExtras';
import { replayEventExtras } from '../eventExtras';

const stage = { items: [] } as any;
const gig = { title: 'Gig' };

beforeEach(() => {
  mocks.persistComposerStage.mockReset();
  mocks.persistComposerStage.mockResolvedValue(null);
  mocks.riders = [];
});

describe('stage and rider replayed apart (audit 05 #6)', () => {
  it('a failed stage is reported on its own and the rider is created once', async () => {
    mocks.persistComposerStage.mockImplementation(async (_e: string, _b: string, p: any) => (p.stage ? 'stage failed' : null));
    const failed = await replayEventExtras('e1', { stage: { bandId: 'b1', payload: { stage, createRider: true }, gig } });
    expect(failed).toEqual(['stage']);
    expect(mocks.persistComposerStage).toHaveBeenCalledWith('e1', 'b1', { stage, createRider: false }, gig);
    expect(mocks.persistComposerStage).toHaveBeenCalledWith('e1', 'b1', { stage: null, createRider: true }, gig);
    const remainingExtras = (extrasModule as any).remainingExtras;
    expect(remainingExtras({ stage: { bandId: 'b1', payload: { stage, createRider: true }, gig } }, failed)).toEqual({
      stage: { bandId: 'b1', payload: { stage, createRider: false }, gig },
    });
  });

  it('does not add a second rider when the gig has one already', async () => {
    mocks.riders = [{ id: 'c1' }];
    const failed = await replayEventExtras('e1', { stage: { bandId: 'b1', payload: { stage: null, createRider: true }, gig } });
    expect(failed).toEqual([]);
    expect(mocks.persistComposerStage).not.toHaveBeenCalled();
  });

  it('nothing left when every step saved', () => {
    const remainingExtras = (extrasModule as any).remainingExtras;
    expect(remainingExtras({ tasks: { drafts: [], originalIds: ['t'], eventDate: null } }, [])).toBeNull();
  });
});
