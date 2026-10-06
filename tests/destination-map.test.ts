/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import { destinationMarkers, navigationDestination } from '../src/lib/errand-destinations';
import { trackingMapData } from '../src/lib/leaflet-document';
import { runnersToGeoJSON } from '../src/lib/runner-geojson';
import { mapMarkerRegion } from '../src/lib/delivery-map-region';
const modules = import.meta.glob('../convex/**/*.{ts,js}');
const pickup = { lat: 5.56, lng: -0.19 }, dropoff = { lat: 5.57, lng: -0.18 };
const request = { title: 'Collect parcel', description: '', category: 'delivery' as const, pickup: 'Osu', dropoff: 'Labone', budgetPesewas: 1000, urgency: 'express' as const, requestId: 'destination-test-001' };
test('missing pins never invent coordinates; navigation falls back to the written address', () => {
  expect(destinationMarkers()).toEqual([]);
  expect(navigationDestination('Osu, Accra')).toBe('Osu, Accra');
  expect(navigationDestination('Osu', pickup)).toBe('5.56,-0.19');
});
test('saved stops and runner stay distinct even when coincident; no live buyer marker', () => {
  const map = trackingMapData({ center: { latitude: pickup.lat, longitude: pickup.lng },
    runners: runnersToGeoJSON([{ runnerId: 'r', name: 'Runner', lat: pickup.lat, lng: pickup.lng }]),
    destinations: destinationMarkers(pickup, pickup), fitToMarkers: true, stale: true });
  expect(map.pins.map(p => p.kind)).toEqual(['runner', 'stop', 'stop']);
  expect(new Set(map.pins.map(p => p.id)).size).toBe(3);
  expect(map.pins[1].stale).toBeUndefined();
  expect(map.button).toBe('Show route');
  expect(map.line).toBeUndefined();
});
test('ordinary pins are owner-only, revision protected, immutable after assignment, and separately scoped', async () => {
  const t = convexTest(schema, modules);
  const [a,b,r] = await t.run(async ctx => Promise.all(['Buyer A','Buyer B','Runner'].map(name => ctx.db.insert('users', { name }))));
  const buyer = t.withIdentity({ subject: `${a}|test` }), other = t.withIdentity({ subject: `${b}|test` }), runner = t.withIdentity({ subject: `${r}|test` });
  const id = await buyer.mutation(api.errands.create, request);
  const args = { id, expectedRevision: 0, pickup, dropoff };
  await expect(other.mutation(api.errands.saveDestinations, args)).rejects.toThrow();
  await expect(buyer.mutation(api.errands.saveDestinations, { ...args, pickup: { lat: NaN, lng: 0 } })).rejects.toThrow();
  await buyer.mutation(api.errands.saveDestinations, args);
  await expect(buyer.mutation(api.errands.saveDestinations, args)).rejects.toThrow();
  expect(await other.query(api.errands.destinations, { id })).toBeNull();
  expect(await runner.query(api.errands.destinations, { id })).toBeNull();
  await t.mutation(internal.runners.setRunnerAccess, { userId: r, enabled: true });
  await t.run(ctx => ctx.db.patch('errands', id, { status: 'accepted', runnerId: r }));
  await expect(buyer.mutation(api.errands.saveDestinations, { ...args, expectedRevision: 1 })).rejects.toThrow();
  expect(await runner.query(api.errands.destinations, { id })).toMatchObject({ pickupPoint: pickup, dropoffPoint: dropoff });
  expect(await other.query(api.errands.destinations, { id })).toBeNull();
});

test('native map framing includes every stop and keeps date-line pins close', () => {
  const center = { latitude: 5, longitude: 179.9 };
  const points = [center, { latitude: 5.2, longitude: -179.8 }, { latitude: 5.1, longitude: 179.7 }];
  const region = mapMarkerRegion(points, center);
  expect(region.latitude).toBeCloseTo(5.1);
  expect(region.latitudeDelta).toBeGreaterThan(0.2);
  expect(region.longitudeDelta).toBeCloseTo(0.8);
  expect(mapMarkerRegion([center, center], center).longitudeDelta).toBeGreaterThan(0);
  expect(mapMarkerRegion([], center).latitude).toBe(5);
});

test('saving pins invalidates older quotes, address editing clears pins, and shared matching locks edits', async () => {
  const t = convexTest(schema, modules);
  const a = await t.run(ctx => ctx.db.insert('users', { name: 'Buyer' }));
  const buyer = t.withIdentity({ subject: `${a}|test` });
  const id = await buyer.mutation(api.errands.create, request);
  await buyer.mutation(api.errands.saveDestinations, { id, expectedRevision: 0, pickup, dropoff });
  expect((await buyer.query(api.errands.get, { id }))?.revision).toBe(1);
  const { requestId: _requestId, ...fields } = request;
  await buyer.mutation(api.errands.update, { ...fields, pickup: 'New pickup address', id, expectedRevision: 1 });
  expect((await buyer.query(api.errands.destinations, { id }))?.pickupPoint).toBeNull();
  await t.run(ctx => ctx.db.patch('errands', id, { shareState: 'waiting' }));
  await expect(buyer.mutation(api.errands.saveDestinations, { id, expectedRevision: 2, pickup, dropoff })).rejects.toThrow('shared matching');
});
