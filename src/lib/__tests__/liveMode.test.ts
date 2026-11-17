import { describe, it, expect } from 'vitest';
import { canGoLive, liveKind } from '../liveMode';

describe('live mode: which events offer it', () => {
  const cases: [string, Parameters<typeof liveKind>[0], ReturnType<typeof liveKind>][] = [
    ['upcoming band gig', { eventType: 'gig', isPast: false, isPersonalGig: false }, 'gig'],
    ['upcoming band rehearsal', { eventType: 'rehearsal', isPast: false, isPersonalGig: false }, 'rehearsal'],
    ['past gig', { eventType: 'gig', isPast: true, isPersonalGig: false }, null],
    ['past rehearsal', { eventType: 'rehearsal', isPast: true, isPersonalGig: false }, null],
    ['personal gig', { eventType: 'gig', isPast: false, isPersonalGig: true }, null],
    ['personal event', { eventType: 'other', isPast: false, isPersonalGig: true }, null],
    ['quote', { eventType: 'quote', isPast: false, isPersonalGig: false }, null],
  ];
  for (const [name, event, kind] of cases) {
    it(`${name}: ${kind ?? 'none'}`, () => {
      expect(liveKind(event)).toBe(kind);
      expect(canGoLive(event)).toBe(kind !== null);
    });
  }
});
