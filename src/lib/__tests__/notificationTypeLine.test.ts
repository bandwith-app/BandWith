import { describe, it, expect } from 'vitest';
import { notificationTypeLine } from '../notificationTypeLine';

describe('inbox type line', () => {
  it('a rehearsal notification does not say REHEARSAL twice', () => {
    expect(notificationTypeLine('Rehearsal', null, 'Rehearsal · Weekly rehearsal')).toBe('Rehearsal · Weekly rehearsal');
  });

  it('keeps the band and a subtitle that names something else', () => {
    expect(notificationTypeLine('Gig invitation', 'Velvet Static', 'Gig Alert · Jazz Club Night')).toBe(
      'Gig invitation · Velvet Static · Gig Alert · Jazz Club Night',
    );
    expect(notificationTypeLine('Chat', 'Velvet Static', 'Velvet Static')).toBe('Chat · Velvet Static');
    expect(notificationTypeLine('Alert', null, null)).toBe('Alert');
  });
});
