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
    expect((await c.rpc('bw_deputy_revoke_links', { p_deputy_id: dep.id })).data).toBe('revoked');
    const now = await keys();
    expect(now.token).not.toBe(before);
    for (const k of ['calendar_token', 'gig_calendar_token']) if (was[k]) expect(now[k]).not.toBe(was[k]);
  });
});

describe('demo: revoke never unlinks', () => {
  it("a deputy with an account: 'linked', nothing changed", async () => {
    const c = createDemoClient() as any;
    const { data: dep } = await c.from('band_deputies').insert({ band_id: 'demo-band', name: 'Ada Lin', user_id: 'someone' }).select().single();
    expect((await c.rpc('bw_deputy_revoke_links', { p_deputy_id: dep.id })).data).toBe('linked');
    const { data: still } = await c.from('band_deputies').select('*').eq('id', dep.id).single();
    expect(still.user_id).toBe('someone');
  });
});

// Claude review of #285 round 5: as 182, opening an event reads its link
// (none until the first tap), the tap makes it.
describe('demo: one-event calendar link', () => {
  it('is read on open, made on the tap', async () => {
    const c = createDemoClient() as any;
    const args = { p_event_id: '11111111-2222-4333-8444-555555555555', p_date: '2026-12-08' };
    expect((await c.rpc('bw_my_event_calendar_link', args)).data).toBeNull();
    const made = (await c.rpc('bw_my_event_calendar_token', args)).data;
    expect(made).toMatch(/^[0-9a-f]{64}$/);
    expect((await c.rpc('bw_my_event_calendar_link', args)).data).toBe(made);
  });
});
