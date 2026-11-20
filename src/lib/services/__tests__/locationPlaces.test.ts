import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ demo: false, session: { access_token: 'user-jwt' } as { access_token: string } | null }));

vi.mock('@/lib/supabase', () => ({
  get isDemoMode() {
    return state.demo;
  },
  supabase: { auth: { getSession: async () => ({ data: { session: state.session } }) } },
}));
vi.mock('@/lib/i18n', () => ({ getLocale: () => 'it' }));

import {
  _resetPlacesState,
  calculateTravelDistance,
  getGooglePlaceDetails,
  rememberPickedPlace,
  searchVenues,
} from '../location';

const FN = 'https://proj.supabase.co/functions/v1/places';
const TOKEN = '3f2b6c1e-9a4d-4c7b-8e21-0f5a6b7c8d9e';

const photonBody = {
  features: [
    {
      properties: { name: 'Via Borsieri', street: 'Via Pietro Borsieri', housenumber: '37', city: 'Milano', country: 'Italia' },
      geometry: { coordinates: [9.1868, 45.4889] },
    },
  ],
};

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let fnReply: (body: any) => Response;

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  state.demo = false;
  state.session = { access_token: 'user-jwt' };
  calls = [];
  _resetPlacesState();
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('it-IT');
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  fnReply = () => jsonRes({ places: [{ name: 'Blue Note', fullAddress: 'Blue Note, Via Pietro Borsieri, 37, Milano', placeId: 'ChIJ1', provider: 'google' }] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.startsWith(FN)) return fnReply(JSON.parse(String(init?.body ?? '{}')));
      if (url.startsWith('https://photon.komoot.io/')) return jsonRes(photonBody);
      return jsonRes({ error: 'unexpected' }, 500);
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const fnCalls = () => calls.filter((c) => c.url.startsWith(FN));
const bodyOf = (c: Call) => JSON.parse(String(c.init?.body));

describe('venue search through the places function', () => {
  it('calls the function with the user session and maps Google results', async () => {
    const res = await searchVenues('Blue Note', undefined, { sessionToken: TOKEN });
    expect(res).toEqual([{ name: 'Blue Note', fullAddress: 'Blue Note, Via Pietro Borsieri, 37, Milano', placeId: 'ChIJ1', provider: 'google' }]);
    const [call] = fnCalls();
    expect(call.init?.method).toBe('POST');
    const headers = call.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer user-jwt');
    expect(headers.apikey).toBe('sb_publishable_test');
    expect(bodyOf(call)).toEqual({ op: 'autocomplete', input: 'Blue Note', sessionToken: TOKEN, languageCode: 'it', regionCode: 'it' });
  });

  it('never calls Google directly', async () => {
    await searchVenues('Blue Note');
    await getGooglePlaceDetails('ChIJ1', undefined, TOKEN);
    await calculateTravelDistance({ address: 'Milano' }, { address: 'Como' });
    expect(calls.some((c) => /googleapis\.com/.test(c.url))).toBe(false);
  });

  it('biases the search towards the last picked venue', async () => {
    rememberPickedPlace({ name: 'Blue Note', latitude: 45.4889, longitude: 9.1868, provider: 'google' });
    await searchVenues('Alcatraz');
    expect(bodyOf(fnCalls()[0]).bias).toEqual({ lat: 45.4889, lng: 9.1868 });
  });

  it('falls back to OpenStreetMap when the key is not set, and stops asking', async () => {
    fnReply = () => jsonRes({ configured: false });
    const first = await searchVenues('Via Borsieri');
    expect(first[0].provider).toBe('photon');
    await searchVenues('Via Borsieri 37');
    expect(fnCalls()).toHaveLength(1);
  });

  it('falls back to OpenStreetMap on an error, and tries again next time', async () => {
    fnReply = () => jsonRes({ error: 'boom' }, 502);
    expect((await searchVenues('Via Borsieri'))[0].provider).toBe('photon');
    await searchVenues('Via Borsieri 37');
    expect(fnCalls()).toHaveLength(2);
  });

  it('uses only OpenStreetMap when signed out or in demo mode', async () => {
    state.session = null;
    expect((await searchVenues('Via Borsieri'))[0].provider).toBe('photon');
    state.session = { access_token: 'user-jwt' };
    state.demo = true;
    expect((await searchVenues('Via Borsieri'))[0].provider).toBe('photon');
    expect(fnCalls()).toHaveLength(0);
  });

  it('asks for details with the same session token', async () => {
    fnReply = () => jsonRes({ place: { name: 'Blue Note', city: 'Milano', latitude: 45.4889, longitude: 9.1868, provider: 'google' } });
    const d = await getGooglePlaceDetails('ChIJ1', undefined, TOKEN);
    expect(d).toMatchObject({ name: 'Blue Note', city: 'Milano', latitude: 45.4889 });
    expect(bodyOf(fnCalls()[0])).toEqual({ op: 'details', placeId: 'ChIJ1', sessionToken: TOKEN, languageCode: 'it' });
  });
});

describe('travel distance', () => {
  it('asks Google for the driving route, with addresses when there are no coordinates', async () => {
    fnReply = () => jsonRes({ route: { distanceKm: 48.3, durationMinutes: 45 } });
    const r = await calculateTravelDistance({ latitude: 45.46, longitude: 9.19 }, { address: 'Como' });
    expect(r).toEqual({ distanceKm: 48.3, durationMinutes: 45, provider: 'google' });
    expect(bodyOf(fnCalls()[0])).toEqual({ op: 'route', origin: { lat: 45.46, lng: 9.19 }, destination: { address: 'Como' } });
  });

  it('without Google, geocodes with OpenStreetMap and estimates the road distance', async () => {
    fnReply = () => jsonRes({ configured: false });
    const r = await calculateTravelDistance({ latitude: 45.4642, longitude: 9.19 }, { address: 'Via Borsieri 37, Milano' });
    expect(r?.provider).toBe('haversine');
    expect(r?.distanceKm).toBeGreaterThan(2);
    expect(r?.distanceKm).toBeLessThan(4);
    expect(calls.some((c) => c.url.startsWith('https://photon.komoot.io/'))).toBe(true);
  });
});
