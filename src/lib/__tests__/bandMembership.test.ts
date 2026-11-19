import { describe, expect, it } from 'vitest';
import { bandsUnchanged, canCoManage, isRosterChange, leaveBandBlock, memberInstrument, parseFeeInput } from '../bandMembership';

describe('leaveBandBlock', () => {
  const members = [
    { user_id: 'a1', role: 'admin' },
    { user_id: 'm1', role: 'member' },
  ];

  it('lets a member leave', () => {
    expect(leaveBandBlock(members, 'm1')).toBeNull();
  });

  it('keeps the only admin in the band', () => {
    expect(leaveBandBlock(members, 'a1')).toBe('last_admin');
  });

  it('lets an admin leave while another active admin stays', () => {
    expect(leaveBandBlock([...members, { user_id: 'a2', role: 'admin' }], 'a1')).toBeNull();
    expect(leaveBandBlock([...members, { user_id: 'a2', role: 'admin', is_active: false }], 'a1')).toBe('last_admin');
  });

  it('says nothing without a signed-in user', () => {
    expect(leaveBandBlock(members, null)).toBeNull();
  });
});

describe('memberInstrument', () => {
  it("uses the band's entry first, then the profile", () => {
    expect(memberInstrument({ instrument: 'Bass', profile: { instrument: 'Guitar' } })).toBe('Bass');
    expect(memberInstrument({ instrument: '  ', profile: { instrument: 'Keys ' } })).toBe('Keys');
    expect(memberInstrument({ instrument: null, profile: null })).toBe('');
  });
});

describe('parseFeeInput', () => {
  it('reads numbers with a dot or a comma', () => {
    expect(parseFeeInput('150')).toEqual({ value: 150, invalid: false });
    expect(parseFeeInput('150,5')).toEqual({ value: 150.5, invalid: false });
  });

  it('treats empty as no fee and rejects the rest', () => {
    expect(parseFeeInput(' ')).toEqual({ value: null, invalid: false });
    expect(parseFeeInput('-3').invalid).toBe(true);
    expect(parseFeeInput('abc').invalid).toBe(true);
  });
});

describe('canCoManage', () => {
  const ent = (enforced: boolean, admins: number | null) => ({
    enforced, plan: 'free' as const, source: null, status: null, trialEndsAt: null, grantUntil: null,
    isPayer: false, isAdmin: true, limits: { admins }, usage: {}, checkout: false, notice: null,
  });

  it('is open to every band while the plans are off, or when nothing is known', () => {
    expect(canCoManage(ent(false, 1), 5)).toBe(true);
    expect(canCoManage(null, 5)).toBe(true);
  });

  it("follows the band's admins limit once the plans are on", () => {
    expect(canCoManage(ent(true, 3), 2)).toBe(true);
    expect(canCoManage(ent(true, 3), 3)).toBe(false);
    expect(canCoManage(ent(true, null), 30)).toBe(true);
  });
});

describe('roster refresh', () => {
  it('reloads the rosters on join and leave notices only', () => {
    expect(isRosterChange('member_joined')).toBe(true);
    expect(isRosterChange('member_left')).toBe(true);
    expect(isRosterChange('event_invite')).toBe(false);
    expect(isRosterChange(undefined)).toBe(false);
  });

  const band = (members: { user_id: string; role: string }[]) => ({ id: 'b1', name: 'Band', members });

  it('keeps the band list when nothing changed', () => {
    const a = [band([{ user_id: 'a1', role: 'admin' }])];
    const b = [band([{ user_id: 'a1', role: 'admin' }])];
    expect(bandsUnchanged(a, b)).toBe(true);
  });

  it('takes the new list when someone joined, left or changed role', () => {
    const before = [band([{ user_id: 'a1', role: 'admin' }])];
    expect(bandsUnchanged(before, [band([{ user_id: 'a1', role: 'admin' }, { user_id: 'n1', role: 'member' }])])).toBe(false);
    expect(bandsUnchanged(before, [band([])])).toBe(false);
    expect(bandsUnchanged(before, [band([{ user_id: 'a1', role: 'member' }])])).toBe(false);
    expect(bandsUnchanged(before, [])).toBe(false);
  });
});
