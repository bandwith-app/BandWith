import { describe, expect, it } from 'vitest';
import { bleLinked, bleProblem, stageBleNotice, type StageBleNoticeInput } from '../stageBleNotice';

const member = (over: Partial<StageBleNoticeInput>): StageBleNoticeInput => ({
  status: 'connected',
  online: false,
  isLeader: false,
  followers: 0,
  platform: 'ios',
  ...over,
});
const leader = (over: Partial<StageBleNoticeInput>) => member({ isLeader: true, status: 'leading', ...over });

describe('stageBleNotice: one plain line, only when it matters', () => {
  it('says nothing while the internet works: Bluetooth stays invisible', () => {
    expect(stageBleNotice(member({ online: true, status: 'connected' }))).toBeNull();
    expect(stageBleNotice(member({ online: true, status: 'searching' }))).toBeNull();
    expect(stageBleNotice(member({ online: true, status: 'bt-off' }))).toBeNull();
    expect(stageBleNotice(leader({ online: true, followers: 3 }))).toBeNull();
    expect(stageBleNotice(member({ status: 'off' }))).toBeNull();
  });

  it('member offline: linked to the leader, or what to do', () => {
    expect(stageBleNotice(member({ status: 'connected' }))).toEqual({ tone: 'ok', text: "Connected to the leader's phone" });
    expect(stageBleNotice(member({ status: 'searching' }))).toEqual({ tone: 'warn', text: 'Not connected: ask the leader to open Stage' });
  });

  it('leader offline: how many phones follow', () => {
    expect(stageBleNotice(leader({ followers: 0 }))).toEqual({ tone: 'warn', text: 'No phones connected yet: ask the band to open Stage' });
    expect(stageBleNotice(leader({ followers: 1 }))).toEqual({ tone: 'ok', text: '1 phone connected to you' });
    expect(stageBleNotice(leader({ followers: 4 }))).toEqual({ tone: 'ok', text: '4 phones connected to you' });
  });

  it('missing permission: asked even online (set it up before the internet drops), with one button', () => {
    expect(stageBleNotice(member({ status: 'denied', online: true }))).toEqual({
      tone: 'warn',
      text: 'Allow Bluetooth to stay with the band when the internet drops.',
      action: 'allow',
    });
    expect(stageBleNotice(leader({ status: 'denied', platform: 'android' }))).toEqual({
      tone: 'warn',
      text: 'Allow Bluetooth so the band can follow you when the internet drops.',
      action: 'allow',
    });
  });

  it('Bluetooth off: a button where the phone can turn it on (Android), a hint where it cannot (iPhone)', () => {
    expect(stageBleNotice(member({ status: 'bt-off', platform: 'android' }))).toEqual({
      tone: 'warn',
      text: 'Bluetooth is off: turn it on to stay in sync without internet.',
      action: 'turn-on',
    });
    expect(stageBleNotice(member({ status: 'bt-off', platform: 'ios' }))).toEqual({
      tone: 'warn',
      text: 'Bluetooth is off: turn it on in Control Center to stay in sync without internet.',
    });
  });

  it('an older setlist or a phone that cannot do it, offline', () => {
    expect(stageBleNotice(member({ status: 'outdated' }))?.text).toBe(
      'This phone has an older setlist: connect to the internet once to follow the leader.',
    );
    expect(stageBleNotice(member({ status: 'outdated', online: true }))).toBeNull();
    expect(stageBleNotice(member({ status: 'unsupported' }))?.text).toBe("This phone can't follow the leader without internet.");
    expect(stageBleNotice(leader({ status: 'unsupported' }))?.text).toBe("This phone can't lead the band without internet.");
  });

  it("a leader on an older app: followed, and one plain line asks to update it, online too", () => {
    const text = "The leader's app is out of date: ask them to update";
    expect(stageBleNotice(member({ status: 'old-leader' }))).toEqual({ tone: 'warn', text });
    expect(stageBleNotice(member({ status: 'old-leader', online: true }))).toEqual({ tone: 'warn', text });
    expect(bleLinked('old-leader')).toBe(true);
    expect(bleLinked('connected')).toBe(true);
    expect(bleLinked('searching')).toBe(false);
  });

  it('a phone that kept an out-of-date key (the band changed who can lead): one plain line, offline only', () => {
    expect(stageBleNotice(member({ status: 'stale-key' }))).toEqual({
      tone: 'warn',
      text: 'The band changed who can lead: connect to the internet once to follow the leader.',
    });
    expect(stageBleNotice(member({ status: 'stale-key', online: true }))).toBeNull();
    expect(bleLinked('stale-key')).toBe(false);
  });

  it("a leader not verified yet: following, one plain line offline, saying who goes online (Claude on #288)", () => {
    expect(stageBleNotice(member({ status: 'unverified' }))).toEqual({
      tone: 'warn',
      text: 'Leader not verified yet: connect to the internet once to check it.',
    });
    expect(stageBleNotice(member({ status: 'leader-unverified' }))).toEqual({
      tone: 'warn',
      text: 'Leader not verified yet: ask the leader to connect to the internet once.',
    });
    expect(stageBleNotice(member({ status: 'unverified', online: true }))).toBeNull();
    expect(stageBleNotice(member({ status: 'leader-unverified', online: true }))).toBeNull();
    expect(bleLinked('unverified')).toBe(true);
    expect(bleLinked('leader-unverified')).toBe(true);
  });

  it('never uses technical words', () => {
    const all = (['connected', 'old-leader', 'stale-key', 'unverified', 'leader-unverified', 'searching', 'leading', 'denied', 'bt-off', 'outdated', 'unsupported'] as const).flatMap((status) =>
      [false, true].flatMap((isLeader) =>
        (['ios', 'android'] as const).map((platform) => stageBleNotice({ status, online: false, isLeader, followers: 2, platform })?.text ?? ''),
      ),
    );
    for (const text of all) expect(text).not.toMatch(/\bBLE\b|peripheral|central|offset|GATT|MTU|\bBT\b/i);
  });
});

describe('bleProblem: what a failed start means', () => {
  it('tells a missing permission from a phone without Bluetooth LE', () => {
    expect(bleProblem(new Error('BLE permission denied'))).toBe('denied');
    expect(bleProblem(new Error('Permission denied.'))).toBe('denied');
    expect(bleProblem(new Error('BLE unsupported'))).toBe('unsupported');
    expect(bleProblem(new Error('BLE not available.'))).toBe('unsupported');
    expect(bleProblem('weird')).toBe('denied');
  });
});
