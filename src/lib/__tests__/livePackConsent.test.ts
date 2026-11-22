import { describe, it, expect, vi, beforeEach } from 'vitest';

const saved = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown>]> }));
vi.mock('../livePackStatus', () => ({
  saveProfileChoice: async (u: string, p: Record<string, unknown>) => {
    saved.calls.push([u, p]);
  },
}));

import {
  readChoice,
  hasAnswered,
  chooseAutomatic,
  chooseThisEvent,
  chooseNotNow,
  setAutomatic,
  setWifiOnly,
  packAllowed,
  LIVE_PACK_CHOICE_EVENT,
} from '../livePackConsent';

const NOW = new Date('2026-11-21T20:00:00.000Z');

beforeEach(() => {
  localStorage.clear();
  saved.calls = [];
});

describe('consent sheet answers (plan §3.3)', () => {
  it('nobody has answered at first', () => {
    expect(hasAnswered(readChoice('u-1'))).toBe(false);
  });

  it('"Download and keep it automatic": every event, saved on the profile too', () => {
    const seen = vi.fn();
    window.addEventListener(LIVE_PACK_CHOICE_EVENT, seen);
    chooseAutomatic('u-1', 'ev-1', NOW);
    window.removeEventListener(LIVE_PACK_CHOICE_EVENT, seen);
    const c = readChoice('u-1');
    expect(c.auto).toBe(true);
    expect(packAllowed(c, 'ev-other')).toBe(true);
    expect(hasAnswered(c)).toBe(true);
    expect(seen).toHaveBeenCalled();
    expect(saved.calls).toEqual([['u-1', { auto: true, askedAt: NOW.toISOString() }]]);
  });

  it('"Only this gig": just that event; the server keeps asking for others', () => {
    chooseThisEvent('u-1', 'ev-1', NOW);
    const c = readChoice('u-1');
    expect(c.auto).toBe(false);
    expect(packAllowed(c, 'ev-1')).toBe(true);
    expect(packAllowed(c, 'ev-2')).toBe(false);
    expect(saved.calls).toEqual([['u-1', { askedAt: NOW.toISOString() }]]);
  });

  it('"Not now": nothing downloads, the answer is remembered', () => {
    chooseNotNow('u-1', NOW);
    const c = readChoice('u-1');
    expect(c.notNowAt).toBe(NOW.toISOString());
    expect(packAllowed(c, 'ev-1')).toBe(false);
    expect(hasAnswered(c)).toBe(true);
  });

  it('Settings: automatic off keeps the single events, Wi-Fi only is per device', () => {
    chooseThisEvent('u-1', 'ev-1', NOW);
    setAutomatic('u-1', true);
    setAutomatic('u-1', false);
    setWifiOnly('u-1', true);
    const c = readChoice('u-1');
    expect(c).toMatchObject({ auto: false, wifiOnly: true, events: ['ev-1'] });
    expect(saved.calls.filter(([, p]) => 'auto' in p).map(([, p]) => p.auto)).toEqual([true, false]);
  });

  it('keeps at most the last 50 single events', () => {
    for (let i = 0; i < 60; i++) chooseThisEvent('u-1', `ev-${i}`, NOW);
    const c = readChoice('u-1');
    expect(c.events).toHaveLength(50);
    expect(c.events[49]).toBe('ev-59');
  });
});
