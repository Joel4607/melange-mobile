import { expect, test } from 'vitest';
import { freshPoint, tokenExpiresAt } from '../src/lib/runner-location-data';

test('background location drops stale, invalid and excessively future GPS fixes', () => {
  const fix = { timestamp: Date.now(), coords: { latitude: 5.56, longitude: -0.19, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null } };
  expect(freshPoint(fix)).toMatchObject({ latitude: 5.56, longitude: -0.19, accuracy: 8 });
  for (const timestamp of [Date.now() - 31_000, Date.now() + 11_000, NaN]) expect(freshPoint({ ...fix, timestamp })).toBeNull();
  expect(freshPoint({ ...fix, coords: { ...fix.coords, latitude: 91 } })).toBeNull();
});
test('background credentials use JWT expiry and malformed tokens cannot run indefinitely', () => {
  expect(tokenExpiresAt(`header.${btoa(JSON.stringify({ exp: 1234 }))}.signature`)).toBe(1234000);
  expect(tokenExpiresAt('broken')).toBe(0);
  expect(tokenExpiresAt(`header.${btoa('{}')}.signature`)).toBe(0);
});
