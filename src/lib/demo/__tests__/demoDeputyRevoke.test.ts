// Codex review #285 round 5: the demo's "Revoke sent links" behaves like 182:
// the links of every request to that deputy change, so an old one stops.
import { describe, expect, it } from 'vitest';
import { createDemoClient } from '../demoClient';

describe('demo: revoke sent links', () => {
  it('rotates the reply and calendar keys of the deputy requests', async () => {
    const c = createDemoClient() as any;
    const { data: ev } = await c.from('events').select('id').limit(1);
    const eventId = ev?.[0]?.id ?? 'demo-event';
    const { data: dep } = await c.from('band_deputies').insert({ band_id: 'demo-band', name: 'Sam Rivera', user_id: null }).select().single();
    const { data: opened } = await c.rpc('bw_deputy_request_open', { p_event_id: eventId, p_deputy_id: dep.id });
    const before = opened[0].token;
    const keys = async () => (await c.from('deputy_requests').select('*').eq('id', opened[0].id).single()).data;
    const was = await keys();
    expect((await c.rpc('bw_deputy_unlink', { p_deputy_id: dep.id })).data).toBe('revoked');
    const now = await keys();
    expect(now.token).not.toBe(before);
    for (const k of ['calendar_token', 'gig_calendar_token']) if (was[k]) expect(now[k]).not.toBe(was[k]);
  });
});
