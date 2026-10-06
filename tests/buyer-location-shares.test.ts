/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import { clearMemberLocation } from '../convex/lib/locationCleanup';
const modules = import.meta.glob('../convex/**/*.{ts,js}');
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const sessionId = 'optional-buyer-location-001';
const fix = () => ({ latitude: 5.56, longitude: -0.19, accuracy: 8, capturedAt: Date.now() });
async function setup() {
  const t = convexTest(schema, modules);
  const [a, b, r] = await t.run(async ctx => Promise.all(['Buyer A', 'Buyer B', 'Runner'].map(name => ctx.db.insert('users', { name }))));
  const buyer = t.withIdentity({ subject: `${a}|test` }), other = t.withIdentity({ subject: `${b}|test` }), runner = t.withIdentity({ subject: `${r}|test` });
  await t.mutation(internal.runners.setRunnerAccess, { userId: r, enabled: true });
  const ids = [];
  for (const [owner, requestId] of [[buyer, 'buyer-share-request-001'], [other, 'buyer-share-request-002']] as const) {
    const id = await owner.mutation(api.errands.create, { title: 'Collect parcel', description: '', category: 'delivery', pickup: 'Osu', dropoff: 'Labone', budgetPesewas: 1000, urgency: 'normal', requestId });
    await t.run(ctx => ctx.db.patch('errands', id, { status: 'accepted', runnerId: r })); ids.push(id);
  }
  return { t, buyer, other, runner, id: ids[0], secondId: ids[1], runnerId: r };
}

test('live buyer sharing is off until explicitly started and visible only to owner and assigned runner', async () => {
  const { t, buyer, other, runner, id } = await setup();
  expect(await runner.query(api.buyerLocationShares.current, { id })).toBeNull();
  await expect(other.mutation(api.buyerLocationShares.start, { id, sessionId, consent: true })).rejects.toThrow();
  await buyer.mutation(api.buyerLocationShares.start, { id, sessionId, consent: true });
  expect(await buyer.mutation(api.buyerLocationShares.publish, { id, sessionId, point: fix() })).toBe(true);
  expect(await runner.query(api.buyerLocationShares.current, { id })).toMatchObject({ point: fix() });
  expect(await buyer.query(api.buyerLocationShares.current, { id })).toMatchObject({ point: fix() });
  expect(await other.query(api.buyerLocationShares.current, { id })).toBeNull();
  await expect(t.query(api.buyerLocationShares.current, { id })).rejects.toThrow('Sign in');
});

test('replacement and stop fence old sessions; retired clients remain unable to publish', async () => {
  const { buyer, runner, id } = await setup();
  await buyer.mutation(api.buyerLocationShares.start, { id, sessionId, consent: true });
  await buyer.mutation(api.buyerLocationShares.start, { id, sessionId: sessionId + '-new', consent: true });
  expect(await buyer.mutation(api.buyerLocationShares.publish, { id, sessionId, point: fix() })).toBe(false);
  await buyer.mutation(api.buyerLocationShares.stop, { id, sessionId });
  await buyer.mutation(api.buyerLocationShares.publish, { id, sessionId: sessionId + '-new', point: fix() });
  expect(await runner.query(api.buyerLocationShares.current, { id })).not.toBeNull();
  await buyer.mutation(api.buyerLocationShares.stop, { id, sessionId: sessionId + '-new' });
  expect(await runner.query(api.buyerLocationShares.current, { id })).toBeNull();
  expect(await buyer.mutation(api.buyerLocations.publish, { id, sessionId, point: fix() })).toBe(false);
});

test('GPS must be fresh, valid and monotonic; paused clients expire and coordinates are erased', async () => {
  const { t, buyer, runner, id } = await setup();
  await buyer.mutation(api.buyerLocationShares.start, { id, sessionId, consent: true });
  await expect(buyer.mutation(api.buyerLocationShares.publish, { id, sessionId, point: { ...fix(), latitude: NaN } })).rejects.toThrow();
  await expect(buyer.mutation(api.buyerLocationShares.publish, { id, sessionId, point: { ...fix(), capturedAt: Date.now() - 31000 } })).rejects.toThrow();
  await buyer.mutation(api.buyerLocationShares.publish, { id, sessionId, point: fix() });
  expect(await buyer.mutation(api.buyerLocationShares.publish, { id, sessionId, point: fix() })).toBe(false);
  vi.setSystemTime(Date.now() + 31000);
  expect(await runner.query(api.buyerLocationShares.current, { id })).toBeNull();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await t.run(ctx => ctx.db.query('buyerLocationShares').unique()))?.point).toBeUndefined();
});

test('each shared buyer stays isolated and delivery or runner revocation ends access immediately', async () => {
  const { t, buyer, other, runner, id, secondId, runnerId } = await setup();
  await buyer.mutation(api.buyerLocationShares.start, { id, sessionId, consent: true });
  await other.mutation(api.buyerLocationShares.start, { id: secondId, sessionId, consent: true });
  await buyer.mutation(api.buyerLocationShares.publish, { id, sessionId, point: fix() });
  await other.mutation(api.buyerLocationShares.publish, { id: secondId, sessionId, point: { ...fix(), latitude: 5.57 } });
  expect(await buyer.query(api.buyerLocationShares.current, { id: secondId })).toBeNull();
  await t.run(async ctx => { await ctx.db.patch('errands', id, { status: 'delivered' }); await clearMemberLocation(ctx, id); });
  expect(await runner.query(api.buyerLocationShares.current, { id })).toBeNull();
  expect((await t.run(ctx => ctx.db.query('buyerLocationShares').withIndex('by_errandId', q => q.eq('errandId', id)).unique()))?.point).toBeUndefined();
  expect(await runner.query(api.buyerLocationShares.current, { id: secondId })).not.toBeNull();
  await t.mutation(internal.runners.setRunnerAccess, { userId: runnerId, enabled: false });
  expect(await runner.query(api.buyerLocationShares.current, { id: secondId })).toBeNull();
});

test('sharing requires consent and tolerates small device clock differences without extending the lease', async () => {
  const { buyer, runner, id } = await setup();
  await expect(buyer.mutation(api.buyerLocationShares.start, { id, sessionId, consent: false as never })).rejects.toThrow();
  await buyer.mutation(api.buyerLocationShares.start, { id, sessionId, consent: true });
  await buyer.mutation(api.buyerLocationShares.publish, { id, sessionId, point: { ...fix(), capturedAt: Date.now() - 2000 } });
  expect(await runner.query(api.buyerLocationShares.current, { id })).not.toBeNull();
  vi.setSystemTime(Date.now() + 29000);
  expect(await runner.query(api.buyerLocationShares.current, { id })).toBeNull();
});
