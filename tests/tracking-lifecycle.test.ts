/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import type { Id } from '../convex/_generated/dataModel';
const modules = import.meta.glob('../convex/**/*.{ts,js}');
const fields = { title: 'Collect parcel', description: 'Keep upright', category: 'delivery' as const, pickup: 'Osu shop', dropoff: 'Labone office', budgetPesewas: 0, budgetPurpose: 'items' as const, urgency: 'normal' as const };
const pickup = { lat: 5.56, lng: -0.2 }, dropoff = { lat: 5.56, lng: -0.18 };
beforeEach(() => { vi.stubEnv('ENABLE_LOCATION_ACCOUNTABILITY', 'true'); vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 8, 22, 10)); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
async function setup(pair = true) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => Promise.all(['buyer', 'buyer', 'runner', 'runner', 'buyer'].map((role, i) => ctx.db.insert('users', { role: role as 'buyer' | 'runner', name: `Person ${i}` }))));
  const [buyer, second, runner, other, stranger] = ids.map(id => t.withIdentity({ subject: `${id}|session` }));
  for (const account of [runner, other]) {
    await account.mutation(api.runners.register, { phone: '0241234567', area: 'Osu', transport: 'motorbike', services: ['delivery'] });
    await account.mutation(api.pricing.saveRates, { rates: [{ category: 'delivery', startingFeePesewas: 1500 }] });
  }
  for (const account of [runner, other]) {
    await account.mutation(api.runners.startAvailability, { sessionId: 'availability-tracking-test' });
    await account.mutation(api.runners.updateLocation, { lat: 5.56, lng: -0.2, capturedAt: Date.now(), status: 'online', sessionId: 'availability-tracking-test' });
  }
  const firstId = await buyer.mutation(api.errands.create, { ...fields, requestId: 'share-first-0001' });
  const secondId = await second.mutation(api.errands.create, { ...fields, requestId: 'share-second-0001' });
  if (pair) {
    await buyer.mutation(api.share.join, { id: firstId, expectedRevision: 0, pickup, dropoff });
    await second.mutation(api.share.join, { id: secondId, expectedRevision: 0, pickup: { ...pickup, lat: 5.5605 }, dropoff: { ...dropoff, lat: 5.5605 } });
  }
  const groupId = (await buyer.query(api.errands.get, { id: firstId }))?.shareGroupId;
  const offer = (account = runner, fees = [1800, 2100]) => account.mutation(api.share.quote, { groupId: groupId!, fees, note: 'Shared route fee; items separate', expectedVersion: 0 });
  const approve = (account: typeof buyer, id: Id<'errands'>, offerId: Id<'shareOffers'>) => account.mutation(api.share.approve, { id, offerId, expectedVersion: 1 });
  async function activate() { const offerId = await offer(); await approve(buyer, firstId, offerId); await approve(second, secondId, offerId); return offerId; }
  return { t, ids, buyer, second, runner, other, stranger, firstId, secondId, groupId, offer, approve, activate };
}

test('stale solo assignment is rejected without partial writes', async () => {
  const { buyer, runner, firstId } = await setup(false);
  const quoteId = await runner.mutation(api.pricing.submitQuote, { id: firstId, expectedRevision: 0, expectedVersion: 0, serviceFeePesewas: 2000, note: '' });
  vi.setSystemTime(Date.now() + 30_001);
  await expect(buyer.mutation(api.pricing.approveQuote, { quoteId, expectedRevision: 0, expectedVersion: 1 })).rejects.toThrow('fresh location');
  expect((await buyer.query(api.errands.get, { id: firstId }))?.status).toBe('posted');
});

test('shared reservation stays private and needs a fresh fix at second approval', async () => {
  const { t, ids, buyer, second, runner, firstId, secondId, offer, approve } = await setup();
  const offerId = await offer();
  await approve(buyer, firstId, offerId);
  expect(await t.run(ctx => ctx.db.query('trackingObligations').collect())).toHaveLength(0);
  vi.setSystemTime(Date.now() + 30_001);
  await expect(approve(second, secondId, offerId)).rejects.toThrow('fresh location');
  await runner.mutation(api.runners.updateLocation, { lat: 5.56, lng: -0.2, capturedAt: Date.now(), status: 'online', sessionId: 'availability-tracking-test' });
  expect((await buyer.query(api.runners.getNearbyRunners, { riderLat: 5.56, riderLng: -0.2 })).some(r => r.runnerId === ids[2])).toBe(false);
  await approve(second, secondId, offerId);
  const obligations = await t.run(ctx => ctx.db.query('trackingObligations').collect());
  expect(obligations).toHaveLength(1);
  expect(obligations[0].memberIds).toEqual(expect.arrayContaining([firstId, secondId]));
  expect(await runner.mutation(api.runners.updateLocation, { lat: 5.56, lng: -0.2, capturedAt: Date.now()+1, status: 'online', sessionId: 'availability-tracking-test' })).toBe(false);
});

async function assigned() {
  const s = await setup(false);
  const quoteId = await s.runner.mutation(api.pricing.submitQuote, { id: s.firstId, expectedRevision: 0, expectedVersion: 0, serviceFeePesewas: 2000, note: '' });
  await s.buyer.mutation(api.pricing.approveQuote, { quoteId, expectedRevision: 0, expectedVersion: 1 });
  const sessionId = 'private-tracking-session';
  const obligation = async () => (await s.t.run(ctx => ctx.db.query('trackingObligations').collect()))[0];
  const view = () => s.buyer.query(api.tracking.current, { id: s.firstId });
  const start = (session = sessionId) => s.runner.mutation(api.locations.startRunner, { id: s.firstId, sessionId: session });
  const publish = (capturedAt = Date.now(), session = sessionId) => s.runner.mutation(api.locations.publishRunner, {
    id: s.firstId, sessionId: session, point: { latitude: 5.56, longitude: -0.2, capturedAt },
  });
  const advance = async (nextStatus: 'picked_up' | 'delivered') => {
    const e = (await s.buyer.query(api.errands.get, { id: s.firstId }))!;
    if (nextStatus === 'picked_up' && e.status === 'accepted' && e.trackingObligationId) {
      await s.runner.mutation(api.pickup.request, { id: s.firstId });
      const request = (await s.buyer.query(api.pickup.current, { id: s.firstId }))!;
      await s.buyer.mutation(api.pickup.approve, { id: s.firstId, expectedRevision: e.revision!, expectedRequestVersion: request.requestVersion });
    }
    return s.runner.mutation(api.runnerJobs.advance, { id: s.firstId, expectedRevision: e.revision!, nextStatus });
  };
  return { ...s, quoteId, sessionId, obligation, view, start, publish, advance };
}

test('assignment snapshots policy once, retry is idempotent and public session is fenced', async () => {
  const s = await assigned(); const o = await s.obligation();
  expect(await s.runner.query(api.runnerJobs.capacity, {})).toMatchObject({ id: s.firstId, trackingRequired: true, trackingMemberId: s.firstId });
  expect(o).toMatchObject({ policyVersion: 1, budgetMs: 1_800_000, transport: 'motorbike', condition: 'awaiting_location' });
  await s.buyer.mutation(api.pricing.approveQuote, { quoteId: s.quoteId, expectedRevision: 0, expectedVersion: 1 });
  expect(await s.t.run(ctx => ctx.db.query('trackingObligations').collect())).toHaveLength(1);
  await expect(s.runner.mutation(api.runners.startAvailability, { sessionId: 'new-online-session' })).rejects.toThrow('private');
  await s.runner.mutation(api.runners.register, { phone: '0241234567', area: 'Osu', transport: 'walking', services: ['delivery'] });
  expect((await s.obligation()).budgetMs).toBe(1_800_000);
  expect(await s.stranger.query(api.tracking.current, { id: s.firstId })).toBeNull();
  expect(await s.t.query(api.tracking.current, { id: s.firstId })).toBeNull();
});

test('late scheduler cannot permit pickup and restarting does not move the assignment deadline', async () => {
  const s = await assigned(); const o = await s.obligation();
  vi.setSystemTime(o.assignedAt + 90_000);
  await expect(s.advance('picked_up')).rejects.toThrow('Restore fresh');
  await s.start();
  expect(await s.view()).toMatchObject({ condition: 'pickup_locked', blockPickup: true, remainingMs: o.budgetMs });
  expect((await s.obligation()).assignedAt).toBe(o.assignedAt);
  await s.start('another-private-session');
  expect((await s.obligation()).openInterruptionAt).toBe(o.assignedAt + 30_000);
});

test('scheduler materializes a lost connection and ignores stale generations', async () => {
  const s = await assigned(); const o = await s.obligation();
  await s.t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const locked = await s.obligation();
  expect(locked.condition).toBe('pickup_locked');
  expect(locked.openInterruptionAt).toBe(o.assignedAt + 30_000);
  const events = await s.t.run(ctx => ctx.db.query('errandActivity').collect());
  await s.t.mutation(internal.tracking.checkDeadline, { obligationId: o._id, generation: o.generation });
  expect(await s.obligation()).toEqual(locked);
  expect(await s.t.run(ctx => ctx.db.query('errandActivity').collect())).toEqual(events);
});

test('stationary fresh fixes recover after ten seconds; replay and a short reconnect do not', async () => {
  const s = await assigned(); const o = await s.obligation();
  vi.setSystemTime(o.assignedAt + 90_000); await s.start();
  expect(await s.publish()).toBe(true);
  expect((await s.view())?.blockPickup).toBe(true);
  vi.setSystemTime(Date.now() + 5_000);
  expect(await s.publish()).toBe(true);
  expect((await s.view())?.blockPickup).toBe(true);
  await s.start('replacement-session');
  expect(await s.publish(Date.now(), 'replacement-session')).toBe(false);
  vi.setSystemTime(Date.now() + 5_000);
  expect(await s.publish(Date.now(), 'replacement-session')).toBe(true);
  expect(await s.view()).toMatchObject({ condition: 'current', blockPickup: false, remainingMs: o.budgetMs });
  expect((await s.obligation()).openInterruptionAt).toBeUndefined();
  await s.advance('picked_up');
});

test('stale/future fixes and obsolete sessions cannot renew private tracking', async () => {
  const s = await assigned(); await s.start();
  vi.setSystemTime(Date.now() + 1_000);
  expect(await s.publish()).toBe(true);
  const o = await s.obligation();
  vi.setSystemTime(Date.now() + 31_000);
  expect(await s.publish(Date.now() - 30_001)).toBe(false);
  await expect(s.publish(Date.now() + 10_001)).rejects.toThrow('timestamp');
  await s.runner.mutation(api.locations.stopRunner, { id: s.firstId, sessionId: s.sessionId });
  expect(await s.publish()).toBe(false);
  await s.start('fresh-session-again');
  expect(await s.publish(o.lastCapturedAt, 'fresh-session-again')).toBe(false);
  expect((await s.obligation()).endedAt).toBeUndefined();
  expect((await s.obligation()).lastFreshReceivedAt).toBe(o.lastFreshReceivedAt);
});

test('post-pickup interruptions accumulate across recovery and exhaustion only clears after sustained recovery', async () => {
  const s = await assigned(); await s.start(); vi.setSystemTime(Date.now() + 1_000);
  await s.publish(); await s.advance('picked_up');
  const first = await s.obligation();
  vi.setSystemTime(first.lastFreshReceivedAt! + 30_000 + 600_000);
  await s.publish(); vi.setSystemTime(Date.now() + 10_000); await s.publish();
  expect((await s.obligation()).spentMs).toBe(610_000);
  const recovered = await s.obligation();
  vi.setSystemTime(recovered.lastFreshReceivedAt! + 30_000 + (recovered.budgetMs - recovered.spentMs));
  expect(await s.view()).toMatchObject({ condition: 'needs_attention', blockDelivery: true, remainingMs: 0 });
  await s.t.run(async ctx => { const storageId = await ctx.storage.store(new Blob(['proof'], { type: 'image/jpeg' })); await ctx.db.insert('deliveryProofs', { errandId: s.firstId, runnerId: s.ids[2], storageId, mimeType: 'image/jpeg', size: 5, requestId: 'proof-tracking-001' }); });
  await expect(s.advance('delivered')).rejects.toThrow('Restore fresh');
  await s.publish();
  expect((await s.view())?.blockDelivery).toBe(true);
  vi.setSystemTime(Date.now() + 10_000); await s.publish();
  expect(await s.view()).toMatchObject({ condition: 'current', remainingMs: 0, blockDelivery: false });
  const spent = (await s.obligation()).spentMs;
  vi.setSystemTime(Date.now() + 30_001);
  expect((await s.view())?.condition).toBe('needs_attention');
  await s.publish(); vi.setSystemTime(Date.now() + 10_000); await s.publish();
  expect((await s.obligation()).spentMs).toBeGreaterThan(spent);
  await s.advance('delivered');
  const ended = await s.obligation(); expect(ended.condition).toBe('ended');
  expect(ended.openInterruptionAt).toBeUndefined(); expect(ended.scheduledFor).toBeUndefined();
  expect(await s.view()).toBeNull(); expect(await s.buyer.query(api.locations.current, { id: s.firstId })).toBeNull();
  vi.setSystemTime(Date.now() + 500_000);
  await s.t.mutation(internal.tracking.checkDeadline, { obligationId: ended._id, generation: ended.generation });
  expect(await s.obligation()).toEqual(ended);
});

test('a recovery candidate expires when readings stop again', async () => {
  const s = await assigned(); vi.setSystemTime(Date.now() + 90_000); await s.start(); await s.publish();
  vi.setSystemTime(Date.now() + 31_000); await s.publish();
  expect((await s.view())?.blockPickup).toBe(true);
  vi.setSystemTime(Date.now() + 10_000); await s.publish();
  expect((await s.view())?.blockPickup).toBe(false);
});

test('revoking runner access immediately denies publication and participant tracking reads', async () => {
  const s = await assigned(); await s.start(); vi.setSystemTime(Date.now() + 1_000); await s.publish();
  await s.t.mutation(internal.runners.setRunnerAccess, { userId: s.ids[2], enabled: false });
  expect(await s.view()).toBeNull();
  expect(await s.buyer.query(api.locations.current, { id: s.firstId })).toBeNull();
  await expect(s.publish()).rejects.toThrow('access');
});

test('rollout disabled creates legacy assignments without retroactive locks', async () => {
  vi.stubEnv('ENABLE_LOCATION_ACCOUNTABILITY', 'false');
  const s = await assigned();
  expect(await s.obligation()).toBeUndefined();
  expect(await s.runner.query(api.runnerJobs.capacity, {})).toMatchObject({ trackingRequired: false });
  vi.setSystemTime(Date.now() + 3_600_000);
  vi.stubEnv('ENABLE_LOCATION_ACCOUNTABILITY', 'true');
  expect(await s.view()).toBeNull();
  await s.advance('picked_up');
});

test('first shared approval also requires freshness and cannot reserve a stale runner', async () => {
  const s = await setup(); const offerId = await s.offer();
  vi.setSystemTime(Date.now() + 30_001);
  await expect(s.approve(s.buyer, s.firstId, offerId)).rejects.toThrow('fresh location');
  expect((await s.t.run(ctx => ctx.db.get('shareGroups', s.groupId!)))?.status).toBe('open');
});

test('walking assignment gets forty minutes and transport changes do not alter its budget', async () => {
  const s = await setup(false);
  await s.runner.mutation(api.runners.register, { phone: '0241234567', area: 'Osu', transport: 'walking', services: ['delivery'] });
  const quoteId = await s.runner.mutation(api.pricing.submitQuote, { id: s.firstId, expectedRevision: 0, expectedVersion: 0, serviceFeePesewas: 2000, note: '' });
  await s.buyer.mutation(api.pricing.approveQuote, { quoteId, expectedRevision: 0, expectedVersion: 1 });
  expect(await s.t.run(ctx => ctx.db.query('trackingObligations').unique())).toMatchObject({ transport: 'walking', budgetMs: 2_400_000 });
});

test('scheduler charges from first pickup and materializes exhaustion without client requests', async () => {
  const s = await assigned(); const o = await s.obligation();
  vi.setSystemTime(o.assignedAt + 60_000); await s.advance('picked_up');
  await s.t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(await s.obligation()).toMatchObject({ condition: 'needs_attention', firstPickedUpAt: o.assignedAt + 60_000,
    openInterruptionAt: o.assignedAt + 30_000 });
  expect(await s.view()).toMatchObject({ remainingMs: 0, blockDelivery: true });
});

test('shared run keeps one budget and first pickup time; each delivered buyer immediately loses access', async () => {
  const s = await setup(); await s.activate();
  const group = (await s.runner.query(api.share.runner, { id: s.groupId! }))!.group;
  const anchor = group.errandIds[0], sessionId = 'shared-private-tracking';
  const account = (id: Id<'errands'>) => id === s.firstId ? s.buyer : s.second;
  const obligation = () => s.t.run(ctx => ctx.db.query('trackingObligations').unique());
  await s.runner.mutation(api.locations.startRunner, { id: anchor, sessionId });
  vi.setSystemTime(Date.now() + 1_000);
  const publish = () => s.runner.mutation(api.locations.publishRunner, { id: anchor, sessionId, point: { latitude: 5.56, longitude: -0.2, capturedAt: Date.now() } });
  await publish();
  let firstPickup: number | undefined; let spent: number | undefined; let deliveredId: Id<'errands'> | undefined;
  let deliveredEvents = 0;
  async function authorize(id: Id<'errands'>) {
    await s.runner.mutation(api.pickup.request, { id });
    const request = (await account(id).query(api.pickup.current, { id }))!;
    const e = (await account(id).query(api.errands.get, { id }))!;
    await account(id).mutation(api.pickup.approve, { id, expectedRevision: e.revision!, expectedRequestVersion: request.requestVersion });
  }
  for (const stop of group.route) {
    if (stop.kind === 'pickup') await authorize(stop.errandId);
    const e = (await account(stop.errandId).query(api.errands.get, { id: stop.errandId }))!;
    if (stop.kind === 'dropoff') await s.t.run(async ctx => {
      const storageId = await ctx.storage.store(new Blob(['proof'], { type: 'image/jpeg' }));
      await ctx.db.insert('deliveryProofs', { errandId: e._id, runnerId: s.ids[2], storageId, mimeType: 'image/jpeg', size: 5, requestId: 'shared-proof-' + e._id });
    });
    await s.runner.mutation(api.runnerJobs.advance, { id: e._id, expectedRevision: e.revision!, nextStatus: stop.kind === 'pickup' ? 'picked_up' : 'delivered' });
    const o = (await obligation())!;
    if (!firstPickup) {
      firstPickup = o.firstPickedUpAt;
      vi.setSystemTime(Date.now() + 90_000);
      const next = group.route[1];
      if (next.kind === 'pickup') {
        await authorize(next.errandId);
        const second = (await account(next.errandId).query(api.errands.get, { id: next.errandId }))!;
        await expect(s.runner.mutation(api.runnerJobs.advance, { id: next.errandId, expectedRevision: second.revision!, nextStatus: 'picked_up' })).rejects.toThrow('Restore fresh');
      }
      await publish(); vi.setSystemTime(Date.now() + 10_000); await publish();
      spent = (await obligation())!.spentMs; expect(spent).toBe(70_000);
    } else {
      expect(o.firstPickedUpAt).toBe(firstPickup); expect(o.spentMs).toBe(spent);
    }
    if (stop.kind === 'dropoff') {
      expect(await account(e._id).query(api.tracking.current, { id: e._id })).toBeNull();
      expect(await account(e._id).query(api.locations.current, { id: e._id })).toBeNull();
      if (!deliveredId) {
        deliveredId = e._id;
        deliveredEvents = (await s.t.run(ctx => ctx.db.query('errandActivity').withIndex('by_errandId', q => q.eq('errandId', e._id)).collect())).length;
        const remainingId = group.errandIds.find(id => id !== e._id)!;
        expect(await s.runner.query(api.runnerJobs.capacity, {})).toMatchObject({ id: anchor, trackingRequired: true, trackingMemberId: remainingId });
        const projection = await account(remainingId).query(api.tracking.current, { id: remainingId });
        expect(projection).toBeTruthy(); expect(JSON.stringify(projection)).not.toContain(e._id);
        expect(await account(e._id).query(api.tracking.current, { id: remainingId })).toBeNull();
        vi.setSystemTime(Date.now() + 5_000); expect(await publish()).toBe(true);
      }
    }
  }
  expect((await obligation())?.condition).toBe('ended');
  expect(await s.runner.query(api.runnerJobs.capacity, {})).toBeNull();
  expect((await s.t.run(ctx => ctx.db.query('errandActivity').withIndex('by_errandId', q => q.eq('errandId', deliveredId!)).collect())).length).toBe(deliveredEvents);
  expect(await s.t.run(ctx => ctx.db.query('trackingObligations').collect())).toHaveLength(1);
});

test('fractional device timestamps are accepted; countdowns still use integer server time', async () => {
  const s = await assigned(); await s.start();
  vi.setSystemTime(Date.now() + 1_000);
  expect(await s.publish(Date.now() - 0.25)).toBe(true);
  expect((await s.obligation()).lastFreshReceivedAt).toBe(Date.now());
});

test('disabling rollout does not remove policy from an already assigned run', async () => {
  const s = await assigned(); vi.stubEnv('ENABLE_LOCATION_ACCOUNTABILITY', 'false');
  vi.setSystemTime(Date.now() + 90_000);
  await expect(s.advance('picked_up')).rejects.toThrow('Restore fresh');
});

test('terminal cancellation settles an open interval once and revokes participant reads', async () => {
  const s = await assigned(); await s.advance('picked_up');
  const { endTrackingMember } = await import('../convex/lib/trackingLifecycle');
  vi.setSystemTime(Date.now() + 60_000);
  // Existing public cancellation intentionally forbids active errands. Exercise the
  // lifecycle hook for a trusted terminal transition without adding such an API.
  await s.t.run(async ctx => { await ctx.db.patch('errands', s.firstId, { status: 'cancelled' }); await endTrackingMember(ctx, s.firstId); });
  const ended = await s.obligation();
  expect(ended).toMatchObject({ condition: 'ended', spentMs: 30_000 });
  expect(await s.view()).toBeNull();
  vi.setSystemTime(Date.now() + 50_000);
  await s.t.run(ctx => endTrackingMember(ctx, s.firstId));
  expect(await s.obligation()).toEqual(ended);
});


test.each([true, false])('recovery at exhaustion is authoritative with scheduler first=%s', async schedulerFirst => {
  const s = await assigned(); await s.start(); vi.setSystemTime(Date.now() + 1000); await s.publish(); await s.advance('picked_up');
  const original = await s.obligation();
  const exhaustion = original.lastFreshReceivedAt! + 30_000 + original.budgetMs;
  vi.setSystemTime(exhaustion - 10_000); await s.publish();
  const candidate = await s.obligation();
  vi.setSystemTime(exhaustion);
  const deadline = () => s.t.mutation(internal.tracking.checkDeadline, { obligationId: candidate._id, generation: candidate.generation });
  if (schedulerFirst) { await deadline(); await s.publish(); } else { await s.publish(); await deadline(); }
  await deadline();
  expect(await s.view()).toMatchObject({ condition: 'current', remainingMs: 0, blockDelivery: false });
  expect(await s.obligation()).toMatchObject({ spentMs: original.budgetMs, firstPickedUpAt: original.firstPickedUpAt });
  const events = await s.t.run(ctx => ctx.db.query('errandActivity').withIndex('by_errandId', q => q.eq('errandId', s.firstId)).collect());
  expect(events.filter(e => e.summary === 'Runner location updates are current.')).toHaveLength(2);
});

test.each([-1, 0])('delivery and deadline at exhaustion offset %s cannot double-commit or bypass policy', async offset => {
  const s = await assigned(); await s.start(); vi.setSystemTime(Date.now() + 1000); await s.publish(); await s.advance('picked_up');
  const original = await s.obligation();
  await s.t.run(async ctx => { const storageId = await ctx.storage.store(new Blob(['proof'], { type: 'image/jpeg' })); await ctx.db.insert('deliveryProofs', { errandId: s.firstId, runnerId: s.ids[2], storageId, mimeType: 'image/jpeg', size: 5, requestId: 'deadline-proof' }); });
  vi.setSystemTime(original.lastFreshReceivedAt! + 90_000);
  await s.t.mutation(internal.tracking.checkDeadline, { obligationId: original._id, generation: original.generation });
  const o = await s.obligation();
  vi.setSystemTime(original.lastFreshReceivedAt! + 30_000 + original.budgetMs + offset);
  const results = await Promise.allSettled([s.advance('delivered'), s.t.mutation(internal.tracking.checkDeadline, { obligationId: o._id, generation: o.generation })]);
  expect(results[0].status).toBe(offset < 0 ? 'fulfilled' : 'rejected');
  expect(results[1].status).toBe('fulfilled');
  const events = await s.t.run(ctx => ctx.db.query('errandActivity').withIndex('by_errandId', q => q.eq('errandId', s.firstId)).collect());
  expect(events.filter(e => e.kind === 'delivered')).toHaveLength(offset < 0 ? 1 : 0);
  expect((await s.obligation()).condition).toBe(offset < 0 ? 'ended' : 'needs_attention');
  if (offset < 0) { await s.advance('delivered'); expect(await s.view()).toBeNull(); }
  else expect(await s.view()).toMatchObject({ remainingMs: 0, blockDelivery: true });
});

test('competing second approvals cannot assign stale eligibility and refreshed retries assign once', async () => {
  const s = await setup(); const offerId = await s.offer(); await s.approve(s.buyer, s.firstId, offerId);
  vi.setSystemTime(Date.now() + 30_001);
  const rejected = await Promise.allSettled([s.approve(s.second, s.secondId, offerId), s.approve(s.second, s.secondId, offerId)]);
  expect(rejected.every(r => r.status === 'rejected')).toBe(true);
  expect(await s.t.run(ctx => ctx.db.query('trackingObligations').collect())).toHaveLength(0);
  expect((await s.t.run(ctx => ctx.db.get('shareGroups', s.groupId!)))?.status).toBe('reserved');
  await s.runner.mutation(api.runners.updateLocation, { lat: 5.56, lng: -0.2, capturedAt: Date.now(), status: 'online', sessionId: 'availability-tracking-test' });
  await Promise.all([s.approve(s.second, s.secondId, offerId), s.approve(s.second, s.secondId, offerId)]);
  expect(await s.t.run(ctx => ctx.db.query('trackingObligations').collect())).toHaveLength(1);
  for (const id of [s.firstId, s.secondId]) {
    const events = await s.t.run(ctx => ctx.db.query('errandActivity').withIndex('by_errandId', q => q.eq('errandId', id)).collect());
    expect(events.filter(e => e.kind === 'accepted')).toHaveLength(1);
  }
});
