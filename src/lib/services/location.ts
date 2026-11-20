/**
 * Location & Venue Autocomplete Service
 * - Google Places (New) and the Google Routes API through the `places` edge
 *   function (the Google key is a server secret, never in the app).
 * - Falls back to OpenStreetMap / Photon (free, no key) when the function
 *   has no key, fails, the user is signed out, or in demo mode.
 */
import { isDemoMode, supabase } from '@/lib/supabase';
import { getLocale } from '@/lib/i18n';
import { defaultRegion, type LatLng, type PlaceResult, type RouteResult, type Waypoint } from '@/lib/places';

export interface VenuePlace {
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
  provider: 'google' | 'photon';
}

// The function answered "no key": stop asking until the app restarts.
let googleUnconfigured = false;

const LAST_PICK_KEY = 'bw.places.lastPick';

/** For tests. */
export function _resetPlacesState() {
  googleUnconfigured = false;
}

/** Remembers where the last picked venue is, so the next search ranks nearby places first. */
export function rememberPickedPlace(place: VenuePlace) {
  if (typeof place.latitude !== 'number' || typeof place.longitude !== 'number') return;
  try {
    localStorage.setItem(LAST_PICK_KEY, JSON.stringify({ lat: place.latitude, lng: place.longitude }));
  } catch {
    /* storage blocked */
  }
}

function lastPick(): LatLng | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_PICK_KEY) ?? 'null');
    if (v && Number.isFinite(v.lat) && Number.isFinite(v.lng)) return { lat: v.lat, lng: v.lng };
  } catch {
    /* storage blocked or bad value */
  }
  return undefined;
}

function deviceTag(): string | undefined {
  try {
    return navigator.language;
  } catch {
    return undefined;
  }
}

type PlacesReply = { configured?: boolean; places?: PlaceResult[]; place?: Partial<PlaceResult>; route?: RouteResult | null };

/**
 * Calls the places function. null = use OpenStreetMap instead (no key, error,
 * signed out, demo). Aborts are rethrown so callers can ignore them.
 */
async function callPlaces(body: Record<string, unknown>, signal?: AbortSignal): Promise<PlacesReply | null> {
  if (isDemoMode || googleUnconfigured) return null;
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!base || !apikey) return null;
  let token: string | undefined;
  try {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token;
  } catch {
    return null;
  }
  if (!token) return null;
  try {
    const res = await fetch(`${base}/functions/v1/places`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PlacesReply;
    if (data?.configured === false) {
      googleUnconfigured = true;
      return null;
    }
    return data;
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err;
    return null;
  }
}

/**
 * Searches venues and addresses: Google Places when available, else OpenStreetMap.
 * `sessionToken` (a UUID kept from the first keystroke until a pick) groups the
 * searches and the details call into one Google session.
 */
export async function searchVenues(
  query: string,
  signal?: AbortSignal,
  opts: { sessionToken?: string } = {},
): Promise<VenuePlace[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return [];

  const language = getLocale();
  const regionCode = defaultRegion(deviceTag(), language);
  const bias = lastPick();
  const reply = await callPlaces(
    {
      op: 'autocomplete',
      input: trimmed.slice(0, 200),
      ...(opts.sessionToken ? { sessionToken: opts.sessionToken } : {}),
      languageCode: language,
      ...(regionCode ? { regionCode } : {}),
      ...(bias ? { bias } : {}),
    },
    signal,
  );
  if (reply?.places && reply.places.length > 0) return reply.places;

  return searchPhotonPlaces(trimmed, signal);
}

/** The full address and coordinates of a Google place (ends the Google session). */
export async function getGooglePlaceDetails(
  placeId: string,
  signal?: AbortSignal,
  sessionToken?: string,
): Promise<Partial<VenuePlace> | null> {
  if (!placeId) return null;
  try {
    const reply = await callPlaces(
      { op: 'details', placeId, ...(sessionToken ? { sessionToken } : {}), languageCode: getLocale() },
      signal,
    );
    return reply?.place ? { ...reply.place, provider: 'google' } : null;
  } catch {
    return null;
  }
}

/**
 * Photon / OpenStreetMap Geocoder (Free, zero-config fallback)
 */
async function searchPhotonPlaces(query: string, signal?: AbortSignal): Promise<VenuePlace[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Photon HTTP ${response.status}`);
  }

  const data = await response.json();
  const features = data.features || [];

  return features.map((f: any): VenuePlace => {
    const p = f.properties || {};
    const geom = f.geometry || {};
    const coords = geom.coordinates || [];

    const name = p.name || p.street || query;
    const streetAddress = [p.street, p.housenumber].filter(Boolean).join(' ') || undefined;
    const city = p.city || p.town || p.village || p.municipality || p.district || undefined;
    const state = p.state || undefined;
    const country = p.country || undefined;
    const postcode = p.postcode || undefined;

    const fullParts = [
      p.name,
      streetAddress,
      city,
      p.state,
      p.country
    ].filter(Boolean);

    // Deduplicate consecutive parts
    const uniqueParts = fullParts.filter((item, idx, arr) => arr.indexOf(item) === idx);

    return {
      name,
      address: streetAddress,
      city,
      state,
      country,
      postcode,
      fullAddress: uniqueParts.join(', '),
      latitude: coords[1],
      longitude: coords[0],
      provider: 'photon',
    };
  });
}

export interface DistanceCalculationResult {
  distanceKm: number;
  durationMinutes?: number;
  provider: 'google' | 'haversine';
}

type Point = { latitude?: number; longitude?: number; address?: string };

const hasCoords = (p: Point) => typeof p.latitude === 'number' && typeof p.longitude === 'number';

function toWaypoint(p: Point): Waypoint | null {
  if (hasCoords(p)) return { lat: p.latitude as number, lng: p.longitude as number };
  const address = p.address?.trim();
  return address && address.length >= 2 ? { address: address.slice(0, 300) } : null;
}

/** Coordinates for a point: its own, else the first OpenStreetMap match for its address. */
async function resolveCoords(p: Point): Promise<LatLng | null> {
  if (hasCoords(p)) return { lat: p.latitude as number, lng: p.longitude as number };
  if (!p.address?.trim()) return null;
  try {
    const [first] = await searchPhotonPlaces(p.address.trim());
    if (typeof first?.latitude === 'number' && typeof first?.longitude === 'number') {
      return { lat: first.latitude, lng: first.longitude };
    }
  } catch {
    /* no match */
  }
  return null;
}

/**
 * Driving distance in km between the band's home base and the venue: the
 * Google Routes API through the places function when available, else a
 * straight-line distance times a road factor of 1.28.
 */
export async function calculateTravelDistance(origin: Point, destination: Point): Promise<DistanceCalculationResult | null> {
  const from = toWaypoint(origin);
  const to = toWaypoint(destination);
  if (!from || !to) return null;

  try {
    const reply = await callPlaces({ op: 'route', origin: from, destination: to });
    if (reply?.route) {
      return { distanceKm: reply.route.distanceKm, durationMinutes: reply.route.durationMinutes, provider: 'google' };
    }
  } catch {
    /* fall back below */
  }

  const [a, b] = await Promise.all([resolveCoords(origin), resolveCoords(destination)]);
  if (!a || !b) return null;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  const straightLineKm = R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  const estimatedDrivingKm = Math.round(straightLineKm * 1.28 * 10) / 10;
  return {
    distanceKm: estimatedDrivingKm,
    durationMinutes: Math.round((estimatedDrivingKm / 75) * 60),
    provider: 'haversine',
  };
}

const normPlace = (s?: string): string =>
  (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** One of the two texts contains the other (ignoring case, accents, punctuation). */
const overlaps = (a?: string, b?: string): boolean => {
  const x = normPlace(a);
  const y = normPlace(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
};

export interface VenueFields {
  /** What goes in the Location / venue field: the venue name, or the street when the pick is just an address. */
  location: string;
  /** The rest of the postal address, never repeating what `location` already says. */
  address: string;
  /** The pick is a named place (venue, studio, club), not only an address. */
  isNamedPlace: boolean;
}

/**
 * Splits a picked place into the Location and Address fields so the two
 * complement each other ("Blackbox Studios" + "Via Ventura 4, 20134 Milano,
 * Italy") instead of repeating the same text.
 */
export function venueFields(place: VenuePlace): VenueFields {
  const name = (place.name || '').trim();
  const street = place.address?.trim();
  const isNamedPlace = !!name && !overlaps(name, street) && normPlace(name) !== normPlace(place.city);
  const location = isNamedPlace ? name : street || name;

  const locality = [place.postcode, place.city].filter(Boolean).join(' ');
  let parts: string[] = [isNamedPlace ? street : undefined, locality, place.country].filter(
    (p): p is string => !!p && !!p.trim(),
  );
  if (parts.length === 0 && place.fullAddress) {
    parts = place.fullAddress.split(',').map((p) => p.trim()).filter(Boolean);
  }

  const seen = new Set<string>([normPlace(location), normPlace(name)]);
  const address = parts
    .filter((p) => {
      const key = normPlace(p);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(', ');

  return { location, address, isNamedPlace };
}
