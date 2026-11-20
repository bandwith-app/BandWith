// Venue search with Google Places (New) and driving distance with the Routes
// API, through the `places` edge function. Shared with the app
// (src/lib/places.ts re-exports it): request validation, the Google request
// builders and the response mappers. No imports, so both Deno and Vite can
// load it. The Google key never leaves the server.

export interface LatLng {
  lat: number;
  lng: number;
}

export type Waypoint = LatLng | { address: string };

export type PlacesRequest =
  | {
      op: 'autocomplete';
      input: string;
      sessionToken?: string;
      languageCode?: string;
      regionCode?: string;
      bias?: LatLng;
    }
  | { op: 'details'; placeId: string; sessionToken?: string; languageCode?: string }
  | { op: 'route'; origin: Waypoint; destination: Waypoint };

/** A place as the app uses it (= VenuePlace in src/lib/services/location.ts). */
export interface PlaceResult {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postcode?: string;
  fullAddress?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  provider: 'google';
}

export interface RouteResult {
  distanceKm: number;
  durationMinutes: number;
}

export const PLACES_API = 'https://places.googleapis.com/v1';
export const ROUTES_API = 'https://routes.googleapis.com/directions/v2:computeRoutes';
export const DETAILS_FIELDS = 'id,displayName,formattedAddress,addressComponents,location';
export const ROUTE_FIELDS = 'routes.distanceMeters,routes.duration';
export const BIAS_RADIUS_M = 50_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACE_ID = /^[A-Za-z0-9_-]{1,300}$/;
const LANG = /^[a-z]{2}$/i;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

function latLng(v: unknown): LatLng | null {
  if (!isObj(v) || !num(v.lat, -90, 90) || !num(v.lng, -180, 180)) return null;
  return { lat: v.lat as number, lng: v.lng as number };
}

function waypoint(v: unknown): Waypoint | null {
  const ll = latLng(v);
  if (ll) return ll;
  if (isObj(v) && typeof v.address === 'string') {
    const address = v.address.trim();
    if (address.length >= 2 && address.length <= 300) return { address };
  }
  return null;
}

type Bad = { error: string };

/** Checks what the app sent; anything unexpected is refused. */
export function parsePlacesRequest(body: unknown): PlacesRequest | Bad {
  if (!isObj(body)) return { error: 'Bad request' };
  const opt = (key: string, re: RegExp): string | undefined | Bad => {
    const v = body[key];
    if (v === undefined || v === null || v === '') return undefined;
    return typeof v === 'string' && re.test(v) ? v : { error: `Bad ${key}` };
  };
  const sessionToken = opt('sessionToken', UUID);
  const languageCode = opt('languageCode', LANG);
  for (const v of [sessionToken, languageCode]) if (isObj(v)) return v as Bad;
  const common = {
    ...(sessionToken ? { sessionToken: sessionToken as string } : {}),
    ...(languageCode ? { languageCode: (languageCode as string).toLowerCase() } : {}),
  };

  switch (body.op) {
    case 'autocomplete': {
      const input = typeof body.input === 'string' ? body.input.trim() : '';
      if (input.length < 2 || input.length > 200) return { error: 'Bad input' };
      const regionCode = opt('regionCode', LANG);
      if (isObj(regionCode)) return regionCode as Bad;
      let bias: LatLng | undefined;
      if (body.bias !== undefined && body.bias !== null) {
        const b = latLng(body.bias);
        if (!b) return { error: 'Bad bias' };
        bias = b;
      }
      return {
        op: 'autocomplete',
        input,
        ...common,
        ...(regionCode ? { regionCode: (regionCode as string).toLowerCase() } : {}),
        ...(bias ? { bias } : {}),
      };
    }
    case 'details': {
      if (typeof body.placeId !== 'string' || !PLACE_ID.test(body.placeId)) return { error: 'Bad placeId' };
      return { op: 'details', placeId: body.placeId, ...common };
    }
    case 'route': {
      const origin = waypoint(body.origin);
      const destination = waypoint(body.destination);
      if (!origin || !destination) return { error: 'Bad route' };
      return { op: 'route', origin, destination };
    }
    default:
      return { error: 'Bad op' };
  }
}

export function autocompleteBody(req: Extract<PlacesRequest, { op: 'autocomplete' }>): Record<string, unknown> {
  return {
    input: req.input,
    ...(req.sessionToken ? { sessionToken: req.sessionToken } : {}),
    ...(req.languageCode ? { languageCode: req.languageCode } : {}),
    ...(req.regionCode ? { regionCode: req.regionCode } : {}),
    ...(req.bias
      ? { locationBias: { circle: { center: { latitude: req.bias.lat, longitude: req.bias.lng }, radius: BIAS_RADIUS_M } } }
      : {}),
  };
}

/** The details URL (the key goes in a header, never in the URL). */
export function detailsUrl(req: Extract<PlacesRequest, { op: 'details' }>): string {
  const q = new URLSearchParams();
  if (req.sessionToken) q.set('sessionToken', req.sessionToken);
  if (req.languageCode) q.set('languageCode', req.languageCode);
  const qs = q.toString();
  return `${PLACES_API}/places/${encodeURIComponent(req.placeId)}${qs ? `?${qs}` : ''}`;
}

const googleWaypoint = (w: Waypoint) =>
  'address' in w ? { address: w.address } : { location: { latLng: { latitude: w.lat, longitude: w.lng } } };

export function routeBody(req: Extract<PlacesRequest, { op: 'route' }>): Record<string, unknown> {
  return { origin: googleWaypoint(req.origin), destination: googleWaypoint(req.destination), travelMode: 'DRIVE' };
}

const text = (v: unknown): string | undefined => {
  if (isObj(v) && typeof v.text === 'string' && v.text.trim()) return v.text.trim();
  return undefined;
};

/** Autocomplete suggestions → places (only real places, not query suggestions). */
export function mapAutocomplete(json: unknown): PlaceResult[] {
  const suggestions = isObj(json) && Array.isArray(json.suggestions) ? json.suggestions : [];
  const out: PlaceResult[] = [];
  for (const s of suggestions) {
    const p = isObj(s) ? s.placePrediction : null;
    if (!isObj(p) || typeof p.placeId !== 'string') continue;
    const fmt = isObj(p.structuredFormat) ? p.structuredFormat : {};
    const name = text(fmt.mainText) ?? text(p.text);
    if (!name) continue;
    const secondary = text(fmt.secondaryText);
    out.push({
      name,
      fullAddress: text(p.text) ?? [name, secondary].filter(Boolean).join(', '),
      placeId: p.placeId,
      provider: 'google',
    });
  }
  return out;
}

// Countries that write the house number before the street ("131 West 3rd Street").
const NUMBER_FIRST = new Set(['US', 'CA', 'GB', 'IE', 'AU', 'NZ', 'FR', 'IN', 'ZA', 'SG', 'PH', 'IL', 'MY']);

/** Place details → the place with its postal address split into fields. */
export function mapDetails(json: unknown): Omit<PlaceResult, 'name'> & { name?: string } {
  const d = isObj(json) ? json : {};
  const comps = Array.isArray(d.addressComponents) ? d.addressComponents.filter(isObj) : [];
  const find = (...types: string[]) => {
    for (const t of types) {
      const c = comps.find((x) => Array.isArray(x.types) && x.types.includes(t));
      if (c) return c;
    }
    return undefined;
  };
  const long = (c?: Record<string, unknown>) => (c && typeof c.longText === 'string' && c.longText.trim() ? c.longText.trim() : undefined);

  const country = find('country');
  const code = country && typeof country.shortText === 'string' ? country.shortText.toUpperCase() : '';
  const number = long(find('street_number'));
  const route = long(find('route'));
  const street = (NUMBER_FIRST.has(code) ? [number, route] : [route, number]).filter(Boolean).join(' ') || undefined;
  const loc = isObj(d.location) ? d.location : {};

  const out: Omit<PlaceResult, 'name'> & { name?: string } = {
    name: text(d.displayName),
    address: street,
    city: long(find('locality', 'postal_town', 'administrative_area_level_3')),
    state: long(find('administrative_area_level_1')),
    country: long(country),
    postcode: long(find('postal_code')),
    fullAddress: typeof d.formattedAddress === 'string' ? d.formattedAddress : undefined,
    latitude: num(loc.latitude, -90, 90) ? (loc.latitude as number) : undefined,
    longitude: num(loc.longitude, -180, 180) ? (loc.longitude as number) : undefined,
    provider: 'google',
  };
  for (const k of Object.keys(out) as (keyof typeof out)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/** computeRoutes → km (one decimal) and minutes. */
export function mapRoute(json: unknown): RouteResult | null {
  const r = isObj(json) && Array.isArray(json.routes) && isObj(json.routes[0]) ? json.routes[0] : null;
  if (!r || typeof r.distanceMeters !== 'number') return null;
  const secs = typeof r.duration === 'string' ? parseFloat(r.duration) : NaN;
  return {
    distanceKm: Math.round((r.distanceMeters / 1000) * 10) / 10,
    durationMinutes: Number.isFinite(secs) ? Math.round(secs / 60) : 0,
  };
}

const LANGUAGE_REGION: Record<string, string> = { it: 'it', es: 'es', fr: 'fr', de: 'de', pt: 'pt' };

/** The region to rank results by: the device's region ("en-GB" → gb), else the app language's country. */
export function defaultRegion(deviceTag: string | undefined, language: string): string | undefined {
  const m = /^[a-z]{2,3}[-_]([a-z]{2})\b/i.exec(deviceTag ?? '');
  if (m) return m[1].toLowerCase();
  return LANGUAGE_REGION[language.slice(0, 2).toLowerCase()];
}
