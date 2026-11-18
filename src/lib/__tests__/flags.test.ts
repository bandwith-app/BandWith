import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { FLAG_DEFAULTS, parseFlagSnapshot, resolveFlag } from '../flags';

describe('feature flags: resolving one', () => {
  const defaults = { on_by_default: true, off_by_default: false };

  it('no snapshot (offline, first launch): the default in code', () => {
    expect(resolveFlag('on_by_default', null, defaults)).toBe(true);
    expect(resolveFlag('off_by_default', null, defaults)).toBe(false);
  });

  it('a platform switch set off turns it off for every band (kill switch wins)', () => {
    const snap = { platform: { on_by_default: false }, band: { on_by_default: true } };
    expect(resolveFlag('on_by_default', snap, defaults)).toBe(false);
  });

  it('the band setting comes next', () => {
    expect(resolveFlag('off_by_default', { platform: {}, band: { off_by_default: true } }, defaults)).toBe(true);
    expect(resolveFlag('on_by_default', { platform: {}, band: { on_by_default: false } }, defaults)).toBe(false);
  });

  it('a platform switch set on turns a default-off feature on where the band says nothing', () => {
    expect(resolveFlag('off_by_default', { platform: { off_by_default: true }, band: {} }, defaults)).toBe(true);
    expect(resolveFlag('off_by_default', { platform: { off_by_default: true }, band: { off_by_default: false } }, defaults)).toBe(false);
  });

  it('rehearsal sessions are on unless switched off', () => {
    expect(FLAG_DEFAULTS.rehearsal_sessions).toBe(true);
    expect(resolveFlag('rehearsal_sessions', null)).toBe(true);
    expect(resolveFlag('rehearsal_sessions', { platform: { rehearsal_sessions: false }, band: {} })).toBe(false);
  });
});

describe('feature flags: what the server sends (bw_band_features)', () => {
  it('keeps booleans only', () => {
    expect(parseFlagSnapshot({ platform: { a: true, b: 'yes', c: false }, band: { d: true, e: 1 } })).toEqual({
      platform: { a: true, c: false },
      band: { d: true },
    });
  });

  it('missing halves are empty', () => {
    expect(parseFlagSnapshot({ platform: { a: false } })).toEqual({ platform: { a: false }, band: {} });
  });

  it('anything else: null (the defaults apply)', () => {
    expect(parseFlagSnapshot(null)).toBeNull();
    expect(parseFlagSnapshot('x')).toBeNull();
    expect(parseFlagSnapshot([])).toBeNull();
  });
});
