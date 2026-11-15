import { describe, expect, it } from 'vitest';
import { fitsSession, sessionAudience } from '../sessionRoster';

describe('fitsSession', () => {
  it('counts keys in a Rhythm session (drums, bass, keys)', () => {
    expect(fitsSession('rhythm', 'Keys')).toBe(true);
    expect(fitsSession('rhythm', 'Tastiere')).toBe(true);
    expect(fitsSession('rhythm', 'Piano')).toBe(true);
    expect(fitsSession('rhythm', 'Batteria')).toBe(true);
    expect(fitsSession('rhythm', 'Bass guitar')).toBe(true);
    expect(fitsSession('rhythm', 'Lead vocals')).toBe(false);
  });

  it('keeps vocals and acoustic as before', () => {
    expect(fitsSession('vocals', 'Backing vocals')).toBe(true);
    expect(fitsSession('vocals', 'Coro')).toBe(true);
    expect(fitsSession('acoustic', 'Chitarra')).toBe(true);
    expect(fitsSession('acoustic', 'Keyboard')).toBe(true);
    expect(fitsSession('acoustic', 'Drums')).toBe(false);
  });
});

describe('sessionAudience', () => {
  const members = [
    { id: 'v', role: 'Vocals' },
    { id: 'k', role: 'Keyboards' },
    { id: 'd', role: 'Drums' },
  ];

  it('picks the members who fit', () => {
    expect(sessionAudience('rhythm', members)).toEqual(['k', 'd']);
  });

  it('falls back to everyone when nobody fits or the type has no filter', () => {
    expect(sessionAudience('acoustic', [{ id: 'd', role: 'Drums' }])).toEqual(['d']);
    expect(sessionAudience('custom', members)).toEqual(['v', 'k', 'd']);
  });
});
