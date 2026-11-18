import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fromStatus, capText, meterCells, keptForInvites, meterLabel } from '../src/core/capacity';
import { doneText } from '../src/ui/forms';
import { APK_URL, TESTFLIGHT_URL, SIGNUP_URL } from '../src/content/site';

const SITE = path.resolve(__dirname, '..');
const read = (f: string) => readFileSync(path.join(SITE, f), 'utf8');

// bw_capacity_status (migration 128): 300 spots, 45 kept for band invites.
const status = (taken: number, cap = 300, reserved = 45) => {
  const publicLeft = Math.max(0, cap - reserved - taken);
  const inviteLeft = Math.max(0, cap - taken);
  return { cap, reserved, taken: Math.min(taken, cap), public_left: publicLeft, invite_left: inviteLeft, state: publicLeft > 0 ? 'open' : inviteLeft > 0 ? 'invites' : 'full' };
};

describe('beta counter', () => {
  it('starts at 300: 255 open spots and 45 kept for band invites', () => {
    const c = fromStatus(status(0))!;
    expect(c.state).toBe('open');
    expect(c.publicLeft).toBe(255);
    expect(keptForInvites(c)).toBe(45);
    expect(capText(c)).toBe('255 of 255 open spots left · 45 kept for band invites');
  });

  it('goes down by one for every account', () => {
    expect(fromStatus(status(8))!.publicLeft).toBe(247);
    expect(capText(fromStatus(status(254))!)).toBe('1 of 255 open spots left · 45 kept for band invites');
  });

  it('keeps the reserve for invited people once the open spots are gone', () => {
    const c = fromStatus(status(255))!;
    expect(c.state).toBe('invites');
    expect(capText(c)).toMatch(/^Open spots are gone\. Invited by a band that’s already inside\? 45 spots are still kept for you\.$/);
    expect(capText(fromStatus(status(299))!)).toMatch(/1 spot is still kept/);
  });

  it('says full when the reserve is gone too', () => {
    const c = fromStatus(status(300))!;
    expect(c.state).toBe('full');
    expect(capText(c)).toBe('Every spot is taken right now. Join the waitlist.');
    expect(meterLabel(c)).toBe('All 300 beta spots are taken');
  });

  it('draws taken cells, then empty ones, then the reserve at the end', () => {
    const cells = meterCells(fromStatus(status(150))!, 40);
    expect(cells).toHaveLength(40);
    expect(cells.filter((k) => k === 'on')).toHaveLength(20);
    expect(cells.slice(-6)).toEqual(Array(6).fill('res'));
    expect(meterCells(fromStatus(status(300))!, 40).every((k) => k === 'on')).toBe(true);
  });

  it('hides the counter when there is no limit or the answer makes no sense', () => {
    expect(fromStatus({ cap: null, state: 'open' })).toBeNull();
    expect(fromStatus(null)).toBeNull();
    expect(fromStatus({ cap: 0 })).toBeNull();
    expect(fromStatus({ cap: 300, state: 'weird', public_left: -3 })!.state).toBe('open');
    expect(fromStatus({ cap: 300, state: 'weird', public_left: -3 })!.publicLeft).toBe(0);
  });
});

describe('waitlist reply', () => {
  it('gives the place in line and escapes the email', () => {
    expect(doneText('a<b>@x.io', { ok: true, position: 12 })).toContain('#12 in line');
    expect(doneText('a<b>@x.io', { ok: true, position: 12 })).toContain('a&lt;b&gt;@x.io');
    expect(doneText('a@x.io', { ok: true, position: 3, already: true })).toMatch(/already #3 in line/);
  });
});

describe('Get page doors', () => {
  const html = read('get/index.html');

  it('link straight to the web app, the APK and TestFlight', () => {
    expect(html).toContain(`href="${SIGNUP_URL.replace(/&/g, '&amp;')}" data-door="web"`);
    expect(html).toContain(`href="${APK_URL}" data-door="android"`);
    expect(html).toContain(`href="${TESTFLIGHT_URL}" data-door="ios"`);
  });

  it('has only the waitlist form (no email round trip for the apps)', () => {
    expect(html.match(/data-beta-form="([a-z]+)"/g)).toEqual(['data-beta-form="waitlist"']);
  });

  it('never promises a hold or a release of spots the database does not do', () => {
    expect(html).not.toMatch(/72 hours|14 days|last 30 days|open today/);
  });
});
