/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
const modules = import.meta.glob('../convex/**/*.{ts,js}');
const fields = { title: 'Legacy parcel', description: '', category: 'delivery' as const, pickup: 'Old written shop', dropoff: 'Old written office', budgetPesewas: 1000, urgency: 'normal' as const };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 8, 30, 10)); vi.stubEnv('ENABLE_LOCATION_ACCOUNTABILITY', 'true'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
async function setup(stage: 'posted' | 'accepted' | 'picked_up' | 'delivered' | 'completed') {
  const t = convexTest(schema, modules);
  const [buyerId, runnerId] = await t.run(async ctx => [await ctx.db.insert('users', { role: 'buyer', name: 'Buyer' }), await ctx.db.insert('users', { role: 'runner', name: 'Runner' })]);
  const buyer = t.withIdentity({ subject: buyerId + '|test' }), runner = t.withIdentity({ subject: runnerId + '|test' });
  await runner.mutation(api.runners.register, { phone: '0241234567', area: 'Osu', transport: 'motorbike', services: ['delivery'] });
  await runner.mutation(api.pricing.saveRates, { rates: [{ category: 'delivery', startingFeePesewas: 1000 }] });
  // Deliberately omit all newer optional fields, including pins and revision.
  const id = await t.run(ctx => ctx.db.insert('errands', { ...fields, customerId: buyerId, requestId: 'old-record-' + stage,
    status: stage === 'completed' ? 'delivered' : stage, ...(stage === 'posted' ? {} : { runnerId }),
    ...(stage === 'completed' ? { completion: { confirmedAt: Date.now() - 1000, isDemo: false, runnerId } } : {}) }));
  const proof = async () => t.run(async ctx => { const storageId = await ctx.storage.store(new Blob(['proof'], { type: 'image/jpeg' })); await ctx.db.insert('deliveryProofs', { errandId: id, runnerId, storageId, size: 5, mimeType: 'image/jpeg', requestId: 'legacy-proof' }); });
  return { t, id, buyer, runner, buyerId, runnerId, proof };
}

test.each(['posted', 'accepted', 'picked_up', 'delivered', 'completed'] as const)('old %s record remains readable without tracking backfill or fabricated pins', async stage => {
  const s = await setup(stage);
  const before = await s.t.run(ctx => ctx.db.get('errands', s.id));
  expect(await s.buyer.query(api.errands.get, { id: s.id })).toEqual(before);
  expect(await s.buyer.query(api.tracking.current, { id: s.id })).toBeNull();
  expect(await s.buyer.query(api.pickup.current, { id: s.id })).toBeNull();
  expect(await s.buyer.query(api.errands.destinations, { id: s.id })).toMatchObject({ pickupPoint: null, dropoffPoint: null });
  if (stage === 'accepted' || stage === 'picked_up') {
    expect(await s.runner.query(api.runnerJobs.capacity, {})).toMatchObject({ trackingRequired: false });
    await expect(s.runner.mutation(api.pickup.request, { id: s.id })).rejects.toThrow();
    vi.setSystemTime(Date.now() + 3_600_000);
    if (stage === 'picked_up') await s.proof();
    await s.runner.mutation(api.runnerJobs.advance, { id: s.id, expectedRevision: 0, nextStatus: stage === 'accepted' ? 'picked_up' : 'delivered' });
  } else if (stage === 'delivered') {
    await s.buyer.mutation(api.errands.confirmCompletion, { id: s.id, expectedRevision: 0 });
    expect((await s.buyer.query(api.errands.get, { id: s.id }))?.completion?.isDemo).toBe(false);
  } else expect(await s.t.run(ctx => ctx.db.get('errands', s.id))).toEqual(before);
  expect(await s.t.run(ctx => ctx.db.query('trackingObligations').collect())).toHaveLength(0);
});

test('an old posted request gets policy only at new assignment after rollout', async () => {
  const s = await setup('posted');
  await s.runner.mutation(api.runners.startAvailability, { sessionId: 'compatibility-online-session' });
  await s.runner.mutation(api.runners.updateLocation, { lat: 5.56, lng: -0.2, capturedAt: Date.now(), status: 'online', sessionId: 'compatibility-online-session' });
  const quoteId = await s.runner.mutation(api.pricing.submitQuote, { id: s.id, expectedRevision: 0, expectedVersion: 0, serviceFeePesewas: 1000, note: '' });
  await s.buyer.mutation(api.pricing.approveQuote, { quoteId, expectedRevision: 0, expectedVersion: 1 });
  expect(await s.runner.query(api.runnerJobs.capacity, {})).toMatchObject({ trackingRequired: true, trackingMemberId: s.id });
  expect(await s.buyer.query(api.tracking.current, { id: s.id })).toMatchObject({ policyVersion: 1, condition: 'awaiting_location' });
  expect(await s.t.run(ctx => ctx.db.query('trackingObligations').collect())).toHaveLength(1);
  await expect(s.runner.mutation(api.runnerJobs.advance, { id: s.id, expectedRevision: 1, nextStatus: 'picked_up' })).rejects.toThrow('approval');
});

test('old-client live buyer endpoints deny reads and writes before and after retirement cleanup', async () => {
  const s = await setup('accepted'), sessionId = 'compatibility-buyer-session';
  const point = { latitude: 5.56, longitude: -0.2, capturedAt: Date.now() };
  await s.t.run(ctx => ctx.db.insert('buyerLocations', { errandId: s.id, buyerId: s.buyerId, runnerId: s.runnerId, sessionId, point, receivedAt: Date.now(), sharing: true, expiryScheduled: true }));
  for (const actor of [s.buyer, s.runner]) {
    expect(await actor.query(api.buyerLocations.current, { id: s.id })).toBeNull();
    await expect(actor.mutation(api.buyerLocations.start, { id: s.id, sessionId })).rejects.toThrow('retired');
    expect(await actor.mutation(api.buyerLocations.publish, { id: s.id, sessionId, point })).toBe(false);
  }
  await s.t.mutation(internal.buyerLocations.purgeRetired, {});
  expect(await s.t.run(ctx => ctx.db.query('buyerLocations').collect())).toHaveLength(0);
  expect(await s.runner.query(api.buyerLocations.current, { id: s.id })).toBeNull();
  expect(await s.buyer.mutation(api.buyerLocations.publish, { id: s.id, sessionId, point })).toBe(false);
});
