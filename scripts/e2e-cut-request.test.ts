import { describe, it, expect } from 'vitest';
import { isCutStubbedRequest } from '../e2e/support/network';

// The e2e fixture skips WebKit's page error for a stubbed request cut short by
// a reload (CI run 44912536203, iPad: min-version, plan-limits, plans).
describe('isCutStubbedRequest', () => {
  it('matches the WebKit message for a stubbed host', () => {
    expect(isCutStubbedRequest('/geocoding-api.open-meteo.com/v1/search?name=Milano&count=10&language=en&format=json due to access control checks.')).toBe(true);
    expect(isCutStubbedRequest('Fetch API cannot load https://api.open-meteo.com/v1/forecast?latitude=45 due to access control checks.')).toBe(true);
    expect(isCutStubbedRequest('https://photon.komoot.io/api/?q=Blue due to access control checks.')).toBe(true);
  });

  it('keeps real errors and other hosts', () => {
    expect(isCutStubbedRequest('TypeError: undefined is not an object')).toBe(false);
    expect(isCutStubbedRequest('https://evil.example.com/x due to access control checks.')).toBe(false);
    expect(isCutStubbedRequest('/geocoding-api.open-meteo.com/v1/search?name=Milano failed')).toBe(false);
  });
});
