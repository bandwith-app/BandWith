import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PLAN_LIMIT_EVENT,
  confirmStorageLimit,
  onPlanLimit,
  planAwareFetch,
  planLimitFromResponse,
  planLimitHit,
  reportPlanLimit,
  type PlanLimitHit,
} from '../planLimit';
import type { Entitlements } from '../plans';

const BAND = '0c6f1c7e-2d4b-4f8a-9a51-3c1f0e2b7d10';
const REST = 'https://x.supabase.co/rest/v1/band_deputies';
const refusal = {
  code: 'P0001',
  message: 'BW_PLAN_LIMIT:deputies',
  details: 'BW_PLAN_LIMIT:deputies used=7 limit=7',
  hint: 'Your band’s plan has no room for this. Update BandWith to see the plans.',
};

const ent = (over: Partial<Entitlements> = {}): Entitlements => ({
  enforced: true,
  plan: 'free',
  source: null,
  status: null,
  trialEndsAt: null,
  grantUntil: null,
  isPayer: false,
  isAdmin: true,
  limits: { storage_mb: 50 },
  usage: { storage_mb: 50 },
  checkout: false,
  notice: null,
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe('planLimitHit', () => {
  it('reads the key and the numbers of the DETAIL', () => {
    expect(planLimitHit(refusal)).toEqual({ key: 'deputies', used: 7, limit: 7 });
  });
  it('the key alone when there is no DETAIL', () => {
    expect(planLimitHit({ message: 'BW_PLAN_LIMIT:bands_as_admin' })).toEqual({ key: 'bands_as_admin' });
  });
  it('anything else is not a plan refusal', () => {
    expect(planLimitHit({ message: 'new row violates row-level security policy' })).toBeNull();
    expect(planLimitHit({ message: 'BW_PLAN_LIMIT:not_a_key' })).toBeNull();
    expect(planLimitHit(null)).toBeNull();
    expect(planLimitHit('BW_PLAN_LIMIT:deputies')).toBeNull();
  });
});

describe('planLimitFromResponse', () => {
  it('PostgREST refusal (insert or rpc)', () => {
    expect(planLimitFromResponse(REST, 400, JSON.stringify(refusal))).toEqual({ key: 'deputies', used: 7, limit: 7 });
    expect(planLimitFromResponse('https://x.supabase.co/rest/v1/rpc/bw_quote_link_mark_sent', 400, JSON.stringify({ message: 'BW_PLAN_LIMIT:quotes_sent_month' }))).toEqual({
      key: 'quotes_sent_month',
    });
  });
  it('other errors and successes are ignored', () => {
    expect(planLimitFromResponse(REST, 200, JSON.stringify(refusal))).toBeNull();
    expect(planLimitFromResponse(REST, 403, '{"message":"permission denied"}')).toBeNull();
  });
  it('an upload refused on a band bucket is a possible storage limit, for that band', () => {
    const body = '{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}';
    expect(planLimitFromResponse(`https://x.supabase.co/storage/v1/object/song-files/${BAND}/song/a.pdf`, 400, body)).toEqual({
      key: 'storage_mb',
      bandId: BAND,
      unconfirmed: true,
    });
    expect(planLimitFromResponse(`https://x.supabase.co/storage/v1/object/quotes/quotes/${BAND}/q.pdf`, 403, body)?.bandId).toBe(BAND);
    expect(planLimitFromResponse(`https://x.supabase.co/storage/v1/object/band-branding/${BAND}/logo.png`, 400, body)?.key).toBe('storage_mb');
  });
  it('avatars, personal files and other upload errors never count', () => {
    const body = '{"message":"new row violates row-level security policy"}';
    expect(planLimitFromResponse(`https://x.supabase.co/storage/v1/object/avatars/${BAND}/a.png`, 400, body)).toBeNull();
    expect(planLimitFromResponse(`https://x.supabase.co/storage/v1/object/song-files/${BAND}/a.pdf`, 413, '{"message":"Payload too large"}')).toBeNull();
  });
});

describe('the event', () => {
  it('reportPlanLimit dispatches bw:plan-limit and says so', () => {
    const seen: PlanLimitHit[] = [];
    const off = onPlanLimit((h) => seen.push(h));
    expect(reportPlanLimit(refusal)).toBe(true);
    expect(reportPlanLimit({ message: 'boom' })).toBe(false);
    off();
    reportPlanLimit(refusal);
    expect(seen).toEqual([{ key: 'deputies', used: 7, limit: 7 }]);
    expect(PLAN_LIMIT_EVENT).toBe('bw:plan-limit');
  });
});

describe('planAwareFetch', () => {
  it('returns the response untouched and reports a refusal from a clone', async () => {
    const base = vi.fn(async () => new Response(JSON.stringify(refusal), { status: 400 }));
    const seen: PlanLimitHit[] = [];
    const off = onPlanLimit((h) => seen.push(h));
    const res = await planAwareFetch(base as unknown as typeof fetch)(REST, { method: 'POST' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(refusal);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    off();
  });
  it('successful responses are not read', async () => {
    const res = new Response('[]', { status: 200 });
    const clone = vi.spyOn(res, 'clone');
    await planAwareFetch((async () => res) as unknown as typeof fetch)(REST);
    expect(clone).not.toHaveBeenCalled();
  });
});

describe('confirmStorageLimit', () => {
  it('only when the plans are on and the band is full', () => {
    expect(confirmStorageLimit(ent())).toBe(true);
    expect(confirmStorageLimit(ent({ usage: { storage_mb: 12 } }))).toBe(false);
    expect(confirmStorageLimit(ent({ enforced: false }))).toBe(false);
    expect(confirmStorageLimit(ent({ limits: {} }))).toBe(false);
    expect(confirmStorageLimit(null)).toBe(false);
  });
});
