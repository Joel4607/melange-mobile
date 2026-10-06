/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import { deliveryMapRegion } from '../src/lib/delivery-map-region';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
const sessionId = 'buyer-location-test-session';
const point = () => ({ latitude: 5.56, longitude: -0.19, capturedAt: Date.now(), accuracy: 8 });
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
async function setup() {
  const t = convexTest(schema, modules);
  const [buyerId, runnerId, otherId] = await t.run(async ctx => [await ctx.db.insert('users', { name: 'Buyer', role: 'buyer' }), await ctx.db.insert('users', { name: 'Runner', role: 'runner' }), await ctx.db.insert('users', { name: 'Other', role: 'buyer' })]);
  const buyer = t.withIdentity({ subject: `${buyerId}|test` }); const runner = t.withIdentity({ subject: `${runnerId}|test` }); const other = t.withIdentity({ subject: `${otherId}|test` });
  const id = await buyer.mutation(api.errands.create, { title: 'Collect parcel', description: '', category: 'delivery', pickup: 'Osu', dropoff: 'Labone', budgetPesewas: 1000, urgency: 'normal', requestId: 'buyer-location-request-001' });
  await t.mutation(internal.runners.setRunnerAccess, { userId: runnerId, enabled: true });
  await t.run(ctx => ctx.db.patch('errands', id, { status: 'accepted', runnerId }));
  return { t, id, buyer, runner, other, buyerId, runnerId, otherId };
}


test('retired buyer sharing is denied for old clients and existing points stay private', async () => {
  const { t, id, buyer, runner, other, buyerId, runnerId } = await setup();
  await t.run(ctx => ctx.db.insert('buyerLocations', { errandId: id, buyerId, runnerId, sessionId, point: point(), receivedAt: Date.now(), sharing: true, expiryScheduled: false }));
  for (const client of [buyer, runner, other]) {
    expect(await client.query(api.buyerLocations.current, { id })).toBeNull();
    await expect(client.mutation(api.buyerLocations.start, { id, sessionId })).rejects.toThrow('retired');
    expect(await client.mutation(api.buyerLocations.publish, { id, sessionId, point: point() })).toBe(false);
  }
});
test('cleanup is bounded, scheduled and safe to repeat', async () => {
  const { t, id, buyerId, runnerId } = await setup();
  await t.run(async ctx => { for(let i=0;i<105;i++) await ctx.db.insert('buyerLocations', { errandId:id, buyerId, runnerId, sessionId, point:point(), receivedAt:Date.now(), sharing:true, expiryScheduled:false }); });
  await t.mutation(internal.buyerLocations.purgeRetired, {});
  expect(await t.run(ctx => ctx.db.query('buyerLocations').collect())).toHaveLength(5);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run(ctx => ctx.db.query('buyerLocations').collect())).toHaveLength(0);
  await t.mutation(internal.buyerLocations.purgeRetired, {});
});
test('legacy stop only clears its owner session and is idempotent', async () => {
  const { t, id, buyer, other, buyerId, runnerId } = await setup();
  const row = await t.run(ctx => ctx.db.insert('buyerLocations', { errandId:id, buyerId, runnerId, sessionId, point:point(), receivedAt:Date.now(), sharing:true, expiryScheduled:false }));
  await other.mutation(api.buyerLocations.stop, { id, sessionId });
  expect((await t.run(ctx => ctx.db.get('buyerLocations',row)))?.point).toBeDefined();
  await buyer.mutation(api.buyerLocations.stop, { id, sessionId });
  await buyer.mutation(api.buyerLocations.stop, { id, sessionId });
  await t.mutation(internal.buyerLocations.expire, { id:row, sessionId });
  expect((await t.run(ctx => ctx.db.get('buyerLocations',row)))?.point).toBeUndefined();
});
test('map frames both pins with padding, including coincident pins and the date line', () => {
  const region = deliveryMapRegion({ latitude: 5.56, longitude: -0.19 }, { latitude: 5.58, longitude: -0.17 });
  expect(region.latitude).toBeCloseTo(5.57); expect(region.longitude).toBeCloseTo(-0.18);
  expect(region.latitudeDelta).toBeGreaterThan(0.02); expect(region.longitudeDelta).toBeGreaterThan(0.02);
  expect(deliveryMapRegion(point(), point()).latitudeDelta).toBe(0.004);
  expect(deliveryMapRegion({ latitude: 0, longitude: 179.99 }, { latitude: 0, longitude: -179.99 }).longitudeDelta).toBeLessThan(0.1);
});
