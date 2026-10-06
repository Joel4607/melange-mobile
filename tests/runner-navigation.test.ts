import { expect, test } from 'vitest';
import { directionsUrl, nextRunnerStop, travelModeFor } from '../src/lib/runner-navigation';
import { parseBudgetFilter } from '../src/lib/runner-discovery';

test('directions encode addresses as data and let Maps choose current origin', () => {
  const address = 'Osu & Sons #2, Accra?mode=other';
  const url = new URL(directionsUrl(address, 'walking'));
  expect(url.origin).toBe('https://www.google.com');
  expect(url.searchParams.get('api')).toBe('1');
  expect(url.searchParams.get('destination')).toBe(address);
  expect(url.searchParams.get('origin')).toBeNull();
  expect(url.searchParams.get('travelmode')).toBe('walking');
  const preview = new URL(directionsUrl('Labone', 'bicycling', 'Osu'));
  expect(preview.searchParams.get('origin')).toBe('Osu');
  expect(preview.searchParams.get('destination')).toBe('Labone');
});

test('only active stages select a next stop and transport retains its intended mode', () => {
  expect(nextRunnerStop('accepted')).toBe('pickup');
  expect(nextRunnerStop('picked_up')).toBe('dropoff');
  for (const status of ['posted', 'delivered', 'cancelled', 'completed']) expect(nextRunnerStop(status)).toBeNull();
  expect(['walking', 'bicycle', 'motorbike', 'car'].map(travelModeFor)).toEqual(['walking', 'bicycling', 'two-wheeler', 'driving']);
});

test('missing or overlong map addresses produce actionable errors', () => {
  expect(() => directionsUrl(' ', 'walking')).toThrow('address');
  expect(() => directionsUrl('Osu', 'walking', '')).toThrow('address');
  expect(() => directionsUrl('x'.repeat(2048), 'walking')).toThrow('too long');
});

test('budget filters allow zero and blank bounds, reject invalid currency input', () => {
  expect(parseBudgetFilter('')).toBeUndefined();
  expect(parseBudgetFilter('0')).toBe(0);
  expect(parseBudgetFilter(' 10.25 ')).toBe(1025);
  for (const value of ['-1', 'abc', '1.001', '1e4', '1000001', 'Infinity']) expect(() => parseBudgetFilter(value)).toThrow();
});
