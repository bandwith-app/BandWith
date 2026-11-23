import { describe, expect, it, vi, beforeEach } from 'vitest';

const result: { data: unknown; error: unknown } = { data: null, error: null };
const updates: unknown[] = [];
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => result }) }),
      update: (u: unknown) => {
        updates.push(u);
        return { eq: async () => ({ error: result.error }) };
      },
    }),
  },
}));

import { getCountInStyle, setCountInStyle } from '../countInStyle';

beforeEach(() => {
  result.data = null;
  result.error = null;
  updates.length = 0;
});

describe('the band’s count-in direction (171)', () => {
  it('reads up or down; before 171 (no column) or on any error it counts down', async () => {
    result.data = { count_in_style: 'up' };
    expect(await getCountInStyle('b')).toBe('up');
    result.data = { count_in_style: 'down' };
    expect(await getCountInStyle('b')).toBe('down');
    result.data = null;
    result.error = { code: '42703', message: 'column bands.count_in_style does not exist' };
    expect(await getCountInStyle('b')).toBe('down');
  });

  it('saves only that column', async () => {
    expect(await setCountInStyle('b', 'up')).toEqual({ error: null });
    expect(updates).toEqual([{ count_in_style: 'up' }]);
  });
});
