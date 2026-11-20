// Venue search and driving distance for the app, with Google.
//
// POST /functions/v1/places   (signed-in users only)
//   { op: 'autocomplete', input, sessionToken?, languageCode?, regionCode?, bias?: {lat,lng} }
//       → { places: PlaceResult[] }   Google Places (New) autocomplete
//   { op: 'details', placeId, sessionToken?, languageCode? }
//       → { place: PlaceResult }      Google Places (New) place details
//   { op: 'route', origin, destination }   each {lat,lng} or {address}
//       → { route: {distanceKm, durationMinutes} | null }   Google Routes API
//
// The Google key is the server secret GOOGLE_PLACES_API_KEY and never reaches
// the app. Without it the function answers { configured: false } and the app
// keeps using OpenStreetMap (Photon). Session tokens group an autocomplete
// session with its details call, so Google bills it as one session.
//
// Deploy with: supabase functions deploy places --no-verify-jwt
// (the caller is checked in code, see _shared/auth.ts).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient, corsHeaders, errorResponse, json, requireCaller } from "../_shared/auth.ts";
import {
  autocompleteBody,
  DETAILS_FIELDS,
  detailsUrl,
  mapAutocomplete,
  mapDetails,
  mapRoute,
  parsePlacesRequest,
  PLACES_API,
  ROUTE_FIELDS,
  routeBody,
  ROUTES_API,
} from "../_shared/places.ts";

const TIMEOUT_MS = 8000;

async function google(url: string, key: string, init: { method: string; body?: unknown; fieldMask?: string }) {
  const res = await fetch(url, {
    method: init.method,
    headers: {
      "X-Goog-Api-Key": key,
      ...(init.fieldMask ? { "X-Goog-FieldMask": init.fieldMask } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // Log the status only: Google's error body can echo the request.
    console.warn(`[places] Google HTTP ${res.status} for ${new URL(url).pathname}`);
    return null;
  }
  return await res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    await requireCaller(req, adminClient());

    const parsed = parsePlacesRequest(await req.json().catch(() => null));
    if ("error" in parsed) return json({ error: parsed.error }, 400);

    const key = (Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "").trim();
    if (!key) return json({ configured: false });

    switch (parsed.op) {
      case "autocomplete": {
        const data = await google(`${PLACES_API}/places:autocomplete`, key, { method: "POST", body: autocompleteBody(parsed) });
        if (!data) return json({ error: "Search unavailable" }, 502);
        return json({ places: mapAutocomplete(data) });
      }
      case "details": {
        const data = await google(detailsUrl(parsed), key, { method: "GET", fieldMask: DETAILS_FIELDS });
        if (!data) return json({ error: "Details unavailable" }, 502);
        return json({ place: mapDetails(data) });
      }
      case "route": {
        const data = await google(ROUTES_API, key, { method: "POST", body: routeBody(parsed), fieldMask: ROUTE_FIELDS });
        if (!data) return json({ error: "Route unavailable" }, 502);
        return json({ route: mapRoute(data) });
      }
    }
  } catch (e) {
    return errorResponse(e);
  }
});
