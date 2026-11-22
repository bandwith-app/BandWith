import { describe, it, expect } from 'vitest';
import { silentApns, silentFcmMessage, isSilentRequest } from '../../../supabase/functions/_shared/push-silent';

// The live pack's silent refresh (plan §3.2, §8): no alert, no sound, no
// badge, nothing in the notification list; the phone only wakes the app.
describe('silent push payloads', () => {
  const data = { type: 'live_pack_refresh', event_id: 'ev-1' };

  it('iOS: a background push, priority 5, content-available only', () => {
    const r = silentApns(data);
    expect(r.headers['apns-push-type']).toBe('background');
    expect(r.headers['apns-priority']).toBe('5');
    expect(r.payload.aps).toEqual({ 'content-available': 1 });
    expect(r.payload).toMatchObject(data);
    expect(JSON.stringify(r.payload)).not.toMatch(/alert|sound|badge/);
  });

  it('Android: data-only message, no notification block, strings only', () => {
    const m = silentFcmMessage('tok', { ...data, n: 3 });
    expect(m.token).toBe('tok');
    expect(m).not.toHaveProperty('notification');
    expect(m.android).toEqual({ priority: 'normal' });
    expect(m.data).toEqual({ type: 'live_pack_refresh', event_id: 'ev-1', n: '3', silent: '1' });
  });

  it('only server calls may ask for a silent push', () => {
    expect(isSilentRequest({ silent: true }, 'service')).toBe(true);
    expect(isSilentRequest({ silent: true }, 'user')).toBe(false);
    expect(isSilentRequest({}, 'service')).toBe(false);
  });
});
