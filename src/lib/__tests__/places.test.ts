import { describe, expect, it } from 'vitest';
import {
  autocompleteBody,
  defaultRegion,
  detailsUrl,
  mapAutocomplete,
  mapDetails,
  mapRoute,
  parsePlacesRequest,
  routeBody,
} from '../places';

const TOKEN = '3f2b6c1e-9a4d-4c7b-8e21-0f5a6b7c8d9e';

describe('places request validation', () => {
  it('accepts a clean autocomplete request', () => {
    expect(
      parsePlacesRequest({ op: 'autocomplete', input: '  Blue Note ', sessionToken: TOKEN, languageCode: 'it', regionCode: 'IT', bias: { lat: 45.48, lng: 9.18 } }),
    ).toEqual({ op: 'autocomplete', input: 'Blue Note', sessionToken: TOKEN, languageCode: 'it', regionCode: 'it', bias: { lat: 45.48, lng: 9.18 } });
  });

  it('rejects bad input', () => {
    expect(parsePlacesRequest(null)).toHaveProperty('error');
    expect(parsePlacesRequest({ op: 'nope' })).toHaveProperty('error');
    expect(parsePlacesRequest({ op: 'autocomplete', input: 'a' })).toHaveProperty('error');
    expect(parsePlacesRequest({ op: 'autocomplete', input: 'x'.repeat(201) })).toHaveProperty('error');
    expect(parsePlacesRequest({ op: 'autocomplete', input: 'Blue Note', sessionToken: 'not-a-uuid' })).toHaveProperty('error');
    expect(parsePlacesRequest({ op: 'autocomplete', input: 'Blue Note', languageCode: 'ita' })).toHaveProperty('error');
    expect(parsePlacesRequest({ op: 'autocomplete', input: 'Blue Note', bias: { lat: 91, lng: 0 } })).toHaveProperty('error');
    expect(parsePlacesRequest({ op: 'details', placeId: '../../etc' })).toHaveProperty('error');
    expect(parsePlacesRequest({ op: 'route', origin: { lat: 45, lng: 9 }, destination: {} })).toHaveProperty('error');
  });

  it('accepts details and route requests', () => {
    expect(parsePlacesRequest({ op: 'details', placeId: 'ChIJ_abc-123', sessionToken: TOKEN })).toEqual({
      op: 'details',
      placeId: 'ChIJ_abc-123',
      sessionToken: TOKEN,
    });
    expect(parsePlacesRequest({ op: 'route', origin: { lat: 45.46, lng: 9.19 }, destination: { address: 'Via Borsieri 37, Milano' } })).toEqual({
      op: 'route',
      origin: { lat: 45.46, lng: 9.19 },
      destination: { address: 'Via Borsieri 37, Milano' },
    });
  });
});

describe('Google request builders', () => {
  it('builds the autocomplete body with a 50 km bias', () => {
    expect(
      autocompleteBody({ op: 'autocomplete', input: 'Blue Note', sessionToken: TOKEN, languageCode: 'it', regionCode: 'it', bias: { lat: 45.48, lng: 9.18 } }),
    ).toEqual({
      input: 'Blue Note',
      sessionToken: TOKEN,
      languageCode: 'it',
      regionCode: 'it',
      locationBias: { circle: { center: { latitude: 45.48, longitude: 9.18 }, radius: 50000 } },
    });
    expect(autocompleteBody({ op: 'autocomplete', input: 'Blue Note' })).toEqual({ input: 'Blue Note' });
  });

  it('builds the details URL without the key', () => {
    const url = detailsUrl({ op: 'details', placeId: 'ChIJ_abc', sessionToken: TOKEN, languageCode: 'it' });
    expect(url).toBe(`https://places.googleapis.com/v1/places/ChIJ_abc?sessionToken=${TOKEN}&languageCode=it`);
    expect(url).not.toContain('key=');
  });

  it('builds a driving route from coordinates or an address', () => {
    expect(routeBody({ op: 'route', origin: { lat: 45.46, lng: 9.19 }, destination: { address: 'Como' } })).toEqual({
      origin: { location: { latLng: { latitude: 45.46, longitude: 9.19 } } },
      destination: { address: 'Como' },
      travelMode: 'DRIVE',
    });
  });
});

describe('Google response mappers', () => {
  it('maps place predictions and skips query predictions', () => {
    const places = mapAutocomplete({
      suggestions: [
        {
          placePrediction: {
            placeId: 'ChIJ1',
            text: { text: 'Blue Note, Via Pietro Borsieri, 37, Milano, MI, Italia' },
            structuredFormat: { mainText: { text: 'Blue Note' }, secondaryText: { text: 'Via Pietro Borsieri, 37, Milano, MI, Italia' } },
          },
        },
        { queryPrediction: { text: { text: 'blue note jazz' } } },
      ],
    });
    expect(places).toEqual([
      { name: 'Blue Note', fullAddress: 'Blue Note, Via Pietro Borsieri, 37, Milano, MI, Italia', placeId: 'ChIJ1', provider: 'google' },
    ]);
  });

  it('maps place details: street order follows the country', () => {
    const milano = mapDetails({
      displayName: { text: 'Blue Note' },
      formattedAddress: 'Via Pietro Borsieri, 37, 20159 Milano MI, Italia',
      location: { latitude: 45.4889, longitude: 9.1868 },
      addressComponents: [
        { longText: '37', shortText: '37', types: ['street_number'] },
        { longText: 'Via Pietro Borsieri', shortText: 'Via Pietro Borsieri', types: ['route'] },
        { longText: 'Milano', shortText: 'Milano', types: ['locality', 'political'] },
        { longText: 'Lombardia', shortText: 'Lombardia', types: ['administrative_area_level_1'] },
        { longText: 'Italia', shortText: 'IT', types: ['country'] },
        { longText: '20159', shortText: '20159', types: ['postal_code'] },
      ],
    });
    expect(milano).toEqual({
      name: 'Blue Note',
      address: 'Via Pietro Borsieri 37',
      city: 'Milano',
      state: 'Lombardia',
      country: 'Italia',
      postcode: '20159',
      fullAddress: 'Via Pietro Borsieri, 37, 20159 Milano MI, Italia',
      latitude: 45.4889,
      longitude: 9.1868,
      provider: 'google',
    });

    const us = mapDetails({
      addressComponents: [
        { longText: '131', types: ['street_number'] },
        { longText: 'West 3rd Street', types: ['route'] },
        { longText: 'New York', types: ['locality'] },
        { longText: 'United States', shortText: 'US', types: ['country'] },
      ],
    });
    expect(us.address).toBe('131 West 3rd Street');
  });

  it('maps a route to km and minutes', () => {
    expect(mapRoute({ routes: [{ distanceMeters: 48_260, duration: '2712s' }] })).toEqual({ distanceKm: 48.3, durationMinutes: 45 });
    expect(mapRoute({ routes: [] })).toBeNull();
    expect(mapRoute({})).toBeNull();
  });
});

describe('default region', () => {
  it('uses the device region, else the language default', () => {
    expect(defaultRegion('en-GB', 'en')).toBe('gb');
    expect(defaultRegion('it', 'it')).toBe('it');
    expect(defaultRegion(undefined, 'pt')).toBe('pt');
    expect(defaultRegion('en', 'en')).toBeUndefined();
  });
});
