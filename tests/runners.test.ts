/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cellToLatLng, gridDisk, latLngToCell } from 'h3-js';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import { runnersToGeoJSON } from '../src/lib/runner-geojson';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
const origin = { riderLat: 5.56, riderLng: -0.19 };
const reading = () => ({ lat: origin.riderLat, lng: origin.riderLng, capturedAt: Date.now(), status: 'online' as const, sessionId: 'availability-test-session' });
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
async function setup() {
  const t = convexTest(schema, modules);
  const [runnerId, customerId] = await t.run(async ctx => [await ctx.db.insert('users', { name: 'Kojo' }), await ctx.db.insert('users', { name: 'Customer' })]);
  await t.mutation(internal.runners.setRunnerAccess, { userId: runnerId, enabled: true });
  await t.withIdentity({ subject: `${runnerId}|session` }).mutation(api.runners.startAvailability, { sessionId: 'availability-test-session' });
  return { t, runnerId, customerId, runner: t.withIdentity({ subject: `${runnerId}|session` }), customer: t.withIdentity({ subject: `${customerId}|session` }) };
}

test('requires authentication and trusted runner enrollment', async () => {
  const { t, customer } = await setup();
  await expect(t.query(api.runners.getNearbyRunners, origin)).rejects.toThrow('Sign in');
  await expect(t.mutation(api.runners.updateLocation, reading())).rejects.toThrow('Sign in');
  await expect(customer.mutation(api.runners.updateLocation, reading())).rejects.toThrow('publishing access');
});

test('upserts one runner using the authenticated identity and server profile', async () => {
  const { t, runner, runnerId, customer } = await setup();
  expect(await runner.mutation(api.runners.updateLocation, reading())).toBe(true);
  expect(await customer.query(api.runners.getNearbyRunners, origin)).toMatchObject([{ runnerId, name: 'Kojo', h3Index: latLngToCell(5.56, -0.19, 8) }]);
  vi.setSystemTime(Date.now() + 5000);
  await runner.mutation(api.runners.updateLocation, { ...reading(), lat: 5.561 });
  expect(await t.run(ctx => ctx.db.query('errandRunners').collect())).toHaveLength(1);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

test('queries adjacent H3 cells and drops runners after moving outside the ring', async () => {
  const { t, runner, customer } = await setup();
  const cell = latLngToCell(origin.riderLat, origin.riderLng, 8);
  const neighbor = gridDisk(cell, 1).find(value => value !== cell)!;
  const [lat, lng] = cellToLatLng(neighbor);
  await runner.mutation(api.runners.updateLocation, { ...reading(), lat, lng });
  expect(await customer.query(api.runners.getNearbyRunners, origin)).toHaveLength(1);
  vi.setSystemTime(Date.now() + 5000);
  await runner.mutation(api.runners.updateLocation, { ...reading(), lat: 6.7, lng: -1.6 });
  expect(await customer.query(api.runners.getNearbyRunners, origin)).toHaveLength(0);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

test.each(['busy', 'offline'] as const)('never returns %s runners', async status => {
  const { t, runner, customer } = await setup();
  await runner.mutation(api.runners.updateLocation, { ...reading(), status });
  expect(await customer.query(api.runners.getNearbyRunners, origin)).toHaveLength(0);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

test('ignores old readings and rejects invalid coordinates and timestamps', async () => {
  const { t, runner, customer } = await setup();
  const initial = reading();
  await runner.mutation(api.runners.updateLocation, initial);
  for (const invalid of [{ lat: NaN }, { lat: 91 }, { lng: Infinity }, { lng: -181 }, { capturedAt: Date.now() - 31000 }, { capturedAt: Date.now() + 11000 }]) {
    await expect(runner.mutation(api.runners.updateLocation, { ...reading(), ...invalid })).rejects.toThrow();
  }
  vi.setSystemTime(Date.now() + 5000);
  expect(await runner.mutation(api.runners.updateLocation, initial)).toBe(false);
  await expect(customer.query(api.runners.getNearbyRunners, { ...origin, riderLat: NaN })).rejects.toThrow('coordinates');
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

test('expires availability reactively without a customer query clock', async () => {
  const { t, runner, customer } = await setup();
  await runner.mutation(api.runners.updateLocation, reading());
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await customer.query(api.runners.getNearbyRunners, origin)).toHaveLength(0);
  expect(await t.run(ctx => ctx.db.query('errandRunners').unique())).toMatchObject({ status: 'offline', expiryScheduled: false });
});

test('a renewed location survives the original expiry check then expires later', async () => {
  const { t, runner, customer } = await setup();
  await runner.mutation(api.runners.updateLocation, reading());
  vi.advanceTimersByTime(30_000);
  await runner.mutation(api.runners.updateLocation, reading());
  vi.advanceTimersByTime(15_000);
  await t.finishInProgressScheduledFunctions();
  expect(await customer.query(api.runners.getNearbyRunners, origin)).toHaveLength(1);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await customer.query(api.runners.getNearbyRunners, origin)).toHaveLength(0);
});

test('stop and access revocation immediately remove nearby locations', async () => {
  const { t, runner, runnerId, customer } = await setup();
  await runner.mutation(api.runners.updateLocation, reading());
  await runner.mutation(api.runners.setOffline, {});
  expect(await customer.query(api.runners.getNearbyRunners, origin)).toHaveLength(0);
  vi.setSystemTime(Date.now() + 5000);
  expect(await runner.mutation(api.runners.updateLocation, reading())).toBe(false);
  await runner.mutation(api.runners.startAvailability, { sessionId: reading().sessionId });
  await runner.mutation(api.runners.updateLocation, reading());
  await t.mutation(internal.runners.setRunnerAccess, { userId: runnerId, enabled: false });
  expect(await customer.query(api.runners.getNearbyRunners, origin)).toHaveLength(0);
  await expect(runner.mutation(api.runners.updateLocation, reading())).rejects.toThrow('publishing access');
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

test('an assigned runner cannot advertise online while doing an active errand', async () => {
  const { t, runner, runnerId, customer } = await setup();
  const id = await customer.mutation(api.errands.create, { title: 'Collect parcel', description: '', category: 'delivery', pickup: 'Osu', dropoff: 'Labone', budgetPesewas: 5000, urgency: 'normal', requestId: 'nearby-test-0001' });
  await runner.mutation(api.runners.updateLocation, reading());
  await t.run(ctx => ctx.db.patch('errands', id, { runnerId, status: 'accepted' }));
  await runner.mutation(api.locations.startRunner, { id, sessionId: 'runner-test-gps-session' });
  await runner.mutation(api.locations.publishRunner, { id, sessionId: 'runner-test-gps-session', point: { latitude: 5.56, longitude: -0.19, capturedAt: Date.now() } });
  expect(await customer.query(api.runners.getNearbyRunners, origin)).toHaveLength(0);
  vi.setSystemTime(Date.now() + 5000);
  await runner.mutation(api.runners.updateLocation, reading());
  expect(await t.run(ctx => ctx.db.query('errandRunners').unique())).toMatchObject({ status: 'busy' });
  expect(await customer.query(api.locations.current, { id })).toMatchObject({ source: 'runner_gps' });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

test('GeoJSON uses longitude first, stable IDs and valid empty collections', () => {
  expect(runnersToGeoJSON([])).toEqual({ type: 'FeatureCollection', features: [] });
  expect(runnersToGeoJSON([{ runnerId: 'runner-1', name: 'Kojo', lat: 5.56, lng: -0.19 }]).features[0]).toEqual({
    type: 'Feature', id: 'runner-1', geometry: { type: 'Point', coordinates: [-0.19, 5.56] }, properties: { runnerId: 'runner-1', name: 'Kojo' },
  });
});

test('a previous availability session cannot publish or stop its replacement', async () => {
  const { t, runner, customer } = await setup();
  await runner.mutation(api.runners.startAvailability, { sessionId: 'replacement-session' });
  expect(await runner.mutation(api.runners.updateLocation, reading())).toBe(false);
  await runner.mutation(api.runners.updateLocation, { ...reading(), sessionId: 'replacement-session' });
  await runner.mutation(api.runners.setOffline, { sessionId: reading().sessionId });
  expect(await customer.query(api.runners.getNearbyRunners, origin)).toHaveLength(1);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

test('shares an automatic street label with nearby buyers and the runner dashboard', async () => {
  const { t, runner, customer } = await setup();
  const fix = reading(); await runner.mutation(api.runners.updateLocation, fix);
  const { status: _status, ...point } = fix;
  expect(await runner.mutation(api.runners.updateAddress, { ...point, city: ' Accra ', street: 'Tawiah France Ln.' })).toBe(true);
  expect(await customer.query(api.runners.getNearbyRunners, origin)).toMatchObject([{ locationLabel: 'Accra, Tawiah France Ln.' }]);
  expect(await runner.query(api.runners.dashboard, {})).toMatchObject({ locationLabel: 'Accra, Tawiah France Ln.' });
  const visible = (await customer.query(api.runners.getNearbyRunners, origin))[0];
  expect(visible).not.toHaveProperty('address'); expect(visible).not.toHaveProperty('locationSessionId');
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

test('address updates require runner access and cannot revive stopped or replaced sessions', async () => {
  const { t, runner, customer } = await setup();
  const fix = reading(); await runner.mutation(api.runners.updateLocation, fix);
  const { status: _status, ...point } = fix;
  const address = { ...point, city: 'Accra', street: 'Tawiah France Ln.' };
  await expect(customer.mutation(api.runners.updateAddress, address)).rejects.toThrow('publishing access');
  await runner.mutation(api.runners.updateAddress, address);
  await runner.mutation(api.runners.startAvailability, { sessionId: 'replacement-session' });
  expect(await runner.mutation(api.runners.updateAddress, address)).toBe(false);
  expect(await customer.query(api.runners.getNearbyRunners, origin)).toHaveLength(0);
  vi.advanceTimersByTime(5000);
  await runner.mutation(api.runners.updateLocation, { ...reading(), sessionId: 'replacement-session' });
  expect(await customer.query(api.runners.getNearbyRunners, origin)).toMatchObject([{ locationLabel: null }]);
  await runner.mutation(api.runners.setOffline, {});
  expect(await runner.mutation(api.runners.updateAddress, { ...address, sessionId: 'replacement-session', capturedAt: Date.now() })).toBe(false);
  expect(await runner.query(api.runners.dashboard, {})).toMatchObject({ locationLabel: null });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

test('rejects delayed, invalid and out-of-order addresses and hides a street after movement', async () => {
  const { t, runner, customer } = await setup();
  const fix = reading(); await runner.mutation(api.runners.updateLocation, fix);
  const { status: _status, ...point } = fix;
  const address = { ...point, city: 'Accra', street: 'Tawiah France Ln.' };
  await expect(runner.mutation(api.runners.updateAddress, { ...address, lat: NaN })).rejects.toThrow('coordinates');
  await expect(runner.mutation(api.runners.updateAddress, { ...address, city: 'x'.repeat(121) })).rejects.toThrow('too long');
  expect(await runner.mutation(api.runners.updateAddress, { ...address, capturedAt: NaN })).toBe(false);
  expect(await runner.mutation(api.runners.updateAddress, { ...address, capturedAt: Date.now() + 10000 })).toBe(false);
  expect(await runner.mutation(api.runners.updateAddress, { ...address, city: '', street: '' })).toBe(false);
  await runner.mutation(api.runners.updateAddress, address);
  expect(await runner.mutation(api.runners.updateAddress, address)).toBe(false);
  vi.advanceTimersByTime(5000);
  await runner.mutation(api.runners.updateLocation, { ...reading(), lat: 5.562 });
  expect(await customer.query(api.runners.getNearbyRunners, { ...origin, riderLat: 5.562 })).toMatchObject([{ locationLabel: null }]);
  expect(await runner.mutation(api.runners.updateAddress, { ...address, capturedAt: Date.now() })).toBe(false);
  vi.advanceTimersByTime(31000);
  expect(await runner.mutation(api.runners.updateAddress, { ...address, lat: 5.562 })).toBe(false);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});
