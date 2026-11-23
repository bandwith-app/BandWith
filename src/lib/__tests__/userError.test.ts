import { describe, expect, it, vi } from 'vitest';
import { UserError, planOr, userMessage } from '../userError';

describe('userMessage', () => {
  it('never shows raw server text', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fb = 'Could not delete the song.';
    expect(userMessage(new Error('new row violates row-level security policy for table "songs"'), fb)).toBe(`${fb} Only band admins can do this.`);
    expect(userMessage({ message: 'x', code: '42501' }, fb)).toBe(`${fb} Only band admins can do this.`);
    expect(userMessage(new TypeError('Failed to fetch'), fb)).toBe(`${fb} Check your connection and try again.`);
    expect(userMessage({ message: 'The object exceeded the maximum allowed size', statusCode: '413' }, fb)).toBe(`${fb} This file is too large.`);
    expect(userMessage(new Error('JSON object requested, multiple (or no) rows returned'), fb)).toBe(`${fb} Try again.`);
    expect(userMessage(null, fb)).toBe(fb);
    expect(userMessage(new Error('boom'), 'Could not delete the song')).toBe('Could not delete the song. Try again.');
  });

  it('a plan refusal (161) says the plan has no room, not "only admins"', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fb = 'Could not add the deputy.';
    const msg = `${fb} Your band’s plan has no room for this.`;
    expect(userMessage({ message: 'BW_PLAN_LIMIT:deputies', code: 'P0001' }, fb)).toBe(msg);
    // Services that wrap the error keep its message.
    expect(userMessage(new Error('BW_PLAN_LIMIT:gear_items'), fb)).toBe(msg);
  });

  it('a file that is gone or another song’s says to upload it again, with no retry (197)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fb = 'Could not save the song.';
    const gone = `${fb} This file is no longer available: upload it again.`;
    expect(userMessage({ message: 'BW_FILE_REMOVED: this file is being removed; upload it again', code: 'BWF02' }, fb)).toBe(gone);
    expect(userMessage({ message: 'x', code: 'BWF02' }, fb)).toBe(gone);
    const taken = `${fb} This file belongs to another song: upload it again.`;
    expect(userMessage({ message: 'BW_FILE_IN_USE: this file belongs to another song; upload it again', code: 'BWF01' }, fb)).toBe(taken);
    expect(userMessage(new Error('BW_FILE_IN_USE: x'), fb)).toBe(taken);
  });

  it('planOr: the plan sentence for a refusal, the screen\'s own text otherwise', () => {
    expect(planOr(new Error('BW_PLAN_LIMIT:gear_items'), 'raw')).toBe('Your band’s plan has no room for this.');
    expect(planOr(new Error("This category can't be saved yet. Pick another one."), 'kept')).toBe('kept');
    expect(planOr(null, 'kept')).toBe('kept');
  });

  it('keeps messages written for people', () => {
    expect(userMessage(new UserError('Links must start with https://'), 'x')).toBe('Links must start with https://');
  });
});
