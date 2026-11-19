import type { BrowserContext, Route } from '@playwright/test';

/**
 * The suite never talks to the internet: the demo app is local, and the few
 * outside services it calls get canned answers here, so results don't depend
 * on someone else's server.
 *
 * - Photon (venue autocomplete fallback, src/lib/services/location.ts): two
 *   venues named after the query, in Milan.
 * - Open-Meteo (weather on gigs, WeatherWidget.tsx): Milan, 14°, dry.
 * - Anything else outside 127.0.0.1 is aborted.
 */

// The app reads these cross-origin: without the CORS header WebKit blocks the
// read and reports "due to access control checks" as a page error.
const json = (route: Route, body: unknown) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

export const FAKE_VENUES = (q: string) => [
  { name: `${q} Studios`, street: 'Via Ventura', housenumber: '4', city: 'Milano', country: 'Italy', lon: 9.24, lat: 45.48 },
  { name: `${q} Hall`, street: 'Via Tortona', housenumber: '27', city: 'Milano', country: 'Italy', lon: 9.16, lat: 45.45 },
];

export async function stubNetwork(context: BrowserContext) {
  await context.route(
    (url) => !/^(127\.0\.0\.1|localhost)$/.test(url.hostname) && /^https?:$/.test(url.protocol),
    async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'photon.komoot.io') {
        const q = url.searchParams.get('q') || 'Venue';
        return json(route, {
          type: 'FeatureCollection',
          features: FAKE_VENUES(q).map((v) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
            properties: { name: v.name, street: v.street, housenumber: v.housenumber, city: v.city, country: v.country },
          })),
        });
      }
      if (url.hostname === 'geocoding-api.open-meteo.com') {
        return json(route, {
          results: [{ name: 'Milano', latitude: 45.46, longitude: 9.19, country: 'Italy', country_code: 'IT', admin1: 'Lombardy' }],
        });
      }
      if (url.hostname === 'api.open-meteo.com') {
        return json(route, {
          daily: {
            time: [url.searchParams.get('start_date')],
            weather_code: [1],
            temperature_2m_max: [14],
            precipitation_probability_max: [5],
            wind_speed_10m_max: [9],
          },
        });
      }
      return route.abort('blockedbyclient');
    },
  );
}
