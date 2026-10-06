/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import schema from '../convex/schema';
import { endTrackingMember } from '../convex/lib/trackingLifecycle';
const modules = import.meta.glob('../convex/**/*.{ts,js}');
beforeEach(() => { vi.stubEnv('ENABLE_LOCATION_ACCOUNTABILITY', 'true'); vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 8, 30, 10)); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup(devices = false) {
  const t = convexTest(schema, modules);
  const [a, b, r, stranger] = await t.run(async ctx => Promise.all(['buyer', 'buyer', 'runner', 'buyer'].map((role, i) => ctx.db.insert('users', { role: role as 'buyer' | 'runner', name: `Person ${i}` }))));
  const accounts = [a, b, r, stranger].map(id => t.withIdentity({ subject: `${id}|session` }));
  const [first, second, runner, other] = accounts;
  await runner.mutation(api.runners.register, { phone: '0241234567', area: 'Osu', transport: 'motorbike', services: ['delivery'] });
  await runner.mutation(api.pricing.saveRates, { rates: [{ category: 'delivery', startingFeePesewas: 1000 }] });
  if (devices) for (const [i, account] of accounts.entries()) await account.mutation(api.push.register, {
    installationId: `shared-tracking-installation-${i}`, token: `ExpoPushToken[shared-tracking-token-${i}]`, platform: 'android', messages: true, updates: true,
  });
  await runner.mutation(api.runners.startAvailability, { sessionId: 'shared-online-session' });
  await runner.mutation(api.runners.updateLocation, { lat: 5.56, lng: -0.2, capturedAt: Date.now(), status: 'online', sessionId: 'shared-online-session' });
  const ids = await Promise.all([first, second].map((account, i) => account.mutation(api.errands.create, {
    title: `Private title ${i}`, description: '', category: 'delivery', pickup: `Private pickup ${i}`, dropoff: `Private delivery ${i}`,
    budgetPesewas: 0, budgetPurpose: 'items', urgency: 'normal', requestId: `shared-tracking-request-${i}`,
  })));
  for (const [i, account] of [first, second].entries()) await account.mutation(api.share.join, {
    id: ids[i], expectedRevision: 0, pickup: { lat: 5.56 + i * 0.0005, lng: -0.2 }, dropoff: { lat: 5.56 + i * 0.0005, lng: -0.18 },
  });
  const groupId = (await first.query(api.errands.get, { id: ids[0] }))!.shareGroupId!;
  const offerId = await runner.mutation(api.share.quote, { groupId, fees: [1800, 2000], note: '', expectedVersion: 0 });
  await first.mutation(api.share.approve, { id: ids[0], offerId, expectedVersion: 1 });
  await second.mutation(api.share.approve, { id: ids[1], offerId, expectedVersion: 1 });
  const group = (await runner.query(api.share.runner, { id: groupId }))!.group;
  const A = group.errandIds[0], B = group.errandIds[1];
  const buyer = (id: Id<'errands'>) => id === ids[0] ? first : second;
  const buyerId = (id: Id<'errands'>) => id === ids[0] ? a : b;
  // A valid pickup/pickup/delivery/delivery route makes mixed stages deterministic.
  await t.run(ctx => ctx.db.patch('shareGroups', groupId, { route: [
    group.route.find(s => s.errandId === A && s.kind === 'pickup')!, group.route.find(s => s.errandId === B && s.kind === 'pickup')!,
    group.route.find(s => s.errandId === A && s.kind === 'dropoff')!, group.route.find(s => s.errandId === B && s.kind === 'dropoff')!,
  ] }));
  const sessionId = 'shared-private-session';
  await runner.mutation(api.locations.startRunner, { id: A, sessionId });
  vi.setSystemTime(Date.now() + 1000);
  const publish = (session = sessionId) => runner.mutation(api.locations.publishRunner, { id: A, sessionId: session, point: { latitude: 5.56, longitude: -0.2, capturedAt: Date.now() } });
  await publish();
  async function approve(id: Id<'errands'>) {
    await runner.mutation(api.pickup.request, { id });
    const request = (await buyer(id).query(api.pickup.current, { id }))!;
    const errand = (await buyer(id).query(api.errands.get, { id }))!;
    await buyer(id).mutation(api.pickup.approve, { id, expectedRevision: errand.revision!, expectedRequestVersion: request.requestVersion });
  }
  async function advance(id: Id<'errands'>, nextStatus: 'picked_up' | 'delivered') {
    const e = (await buyer(id).query(api.errands.get, { id }))!;
    if (nextStatus === 'delivered') await t.run(async ctx => {
      const storageId = await ctx.storage.store(new Blob(['proof'], { type: 'image/jpeg' }));
      await ctx.db.insert('deliveryProofs', { errandId: id, runnerId: r, storageId, mimeType: 'image/jpeg', size: 5, requestId: `proof-${id}` });
    });
    await runner.mutation(api.runnerJobs.advance, { id, expectedRevision: e.revision!, nextStatus });
  }
  const obligation = () => t.run(ctx => ctx.db.query('trackingObligations').unique());
  const row = (id: Id<'errands'>) => t.run(ctx => ctx.db.query('runnerLocations').withIndex('by_errandId', q => q.eq('errandId', id)).unique());
  const jobs = () => t.run(ctx => ctx.db.query('pushJobs').collect());
  const refresh = async () => { const o = (await obligation())!; await t.mutation(internal.tracking.checkDeadline, { obligationId: o._id, generation: o.generation }); };
  const recover = async () => { await publish(); vi.setSystemTime(Date.now() + 10_000); await publish(); };
  const cleanup = () => t.mutation(internal.locations.cleanupRunner, { publisherId: r, cursor: null });
  return { t, runner, other, A, B, r, buyer, buyerId, groupId, sessionId, publish, approve, advance, obligation, row, jobs, refresh, recover, cleanup };
}

test('mixed-stage interruption locks B independently and keeps one cumulative run allowance', async () => {
  const s = await setup(); await s.approve(s.A); await s.advance(s.A, 'picked_up');
  const firstPickup = (await s.obligation())!.firstPickedUpAt;
  await s.runner.mutation(api.pickup.request, { id: s.B });
  vi.setSystemTime(Date.now() + 90_000); await s.refresh();
  const view = await s.buyer(s.B).query(api.tracking.current, { id: s.B });
  expect(view).toMatchObject({ condition: 'interrupted', blockPickup: true, blockDelivery: false, remainingMs: 1_740_000 });
  expect(await s.buyer(s.A).query(api.pickup.current, { id: s.B })).toBeNull();
  expect(await s.buyer(s.A).query(api.errands.destinations, { id: s.B })).toBeNull();
  expect(await s.buyer(s.B).query(api.tracking.current, { id: s.A })).toBeNull();
  const b = (await s.buyer(s.B).query(api.errands.get, { id: s.B }))!;
  await expect(s.runner.mutation(api.runnerJobs.advance, { id: s.B, expectedRevision: b.revision!, nextStatus: 'picked_up' })).rejects.toThrow('approval');
  await s.approve(s.B);
  await expect(s.advance(s.B, 'picked_up')).rejects.toThrow('Restore fresh');
  await s.recover(); await s.advance(s.B, 'picked_up');
  expect(await s.obligation()).toMatchObject({ firstPickedUpAt: firstPickup, spentMs: 70_000, budgetMs: 1_800_000 });
  expect(await s.buyer(s.B).query(api.tracking.current, { id: s.B })).toMatchObject({ condition: 'current', remainingMs: 1_730_000 });
});

test('pickup requests notify only their buyer, once per request version', async () => {
  const s = await setup(true);
  await s.runner.mutation(api.pickup.request, { id: s.B }); await s.runner.mutation(api.pickup.request, { id: s.B });
  let requests = (await s.jobs()).filter(j => j.kind === 'pickup_request');
  expect(requests).toHaveLength(1); expect(requests[0]).toMatchObject({ userId: s.buyerId(s.B), errandId: s.B, pickupRequestVersion: 1 });
  expect(await s.buyer(s.A).query(api.push.target, { notificationId: requests[0]._id })).toBeNull();
  await s.approve(s.B); vi.setSystemTime(Date.now() + 600_000);
  await s.runner.mutation(api.pickup.request, { id: s.B });
  requests = (await s.jobs()).filter(j => j.kind === 'pickup_request'); expect(requests).toHaveLength(2);
  expect(await s.t.mutation(internal.push.claim, { id: requests[0]._id })).toBeNull();
});

test('one incident sends one interruption, attention and recovery notice per recipient', async () => {
  const s = await setup(true); await s.approve(s.A); await s.advance(s.A, 'picked_up');
  vi.setSystemTime(Date.now() + 90_000); await s.refresh(); await s.refresh();
  let jobs = (await s.jobs()).filter(j => j.kind === 'tracking_interrupted');
  expect(jobs).toHaveLength(3); expect(jobs.filter(j => j.userId === s.r)).toHaveLength(1);
  expect(new Set(jobs.map(j => j.eventKey)).size).toBe(1);
  expect(await s.other.query(api.push.target, { notificationId: jobs[0]._id })).toBeNull();
  vi.setSystemTime(Date.now() + 1_800_000); await s.refresh(); await s.refresh();
  expect((await s.jobs()).filter(j => j.kind === 'tracking_attention')).toHaveLength(3);
  await s.recover(); vi.setSystemTime(Date.now() + 5000); await s.publish();
  expect((await s.jobs()).filter(j => j.kind === 'tracking_recovered')).toHaveLength(3);
  expect((await s.jobs()).filter(j => j.kind === 'tracking_interrupted')).toHaveLength(3);
  expect(await s.t.mutation(internal.push.claim, { id: jobs[0]._id })).toBeNull();
});

test('materialized in-app status and neutral activity work without any push token', async () => {
  const s = await setup(); vi.setSystemTime(Date.now() + 90_000); await s.refresh();
  expect(await s.buyer(s.A).query(api.tracking.current, { id: s.A })).toMatchObject({ condition: 'pickup_locked' });
  const activity = await s.t.run(ctx => ctx.db.query('errandActivity').withIndex('by_errandId', q => q.eq('errandId', s.A)).collect());
  expect(activity.some(a => a.summary.includes('Pickup is paused'))).toBe(true);
  expect(JSON.stringify(activity)).not.toMatch(/latitude|longitude|suspicious/i);
  expect(await s.jobs()).toHaveLength(0);
});

test('first delivery clears its GPS while B keeps the original session, clock and notices', async () => {
  const s = await setup(true); await s.approve(s.A); await s.advance(s.A, 'picked_up'); await s.approve(s.B); await s.advance(s.B, 'picked_up');
  const before = (await s.obligation())!; const aRow = (await s.row(s.A))!;
  await s.advance(s.A, 'delivered');
  expect((await s.row(s.A))?.point).toBeUndefined(); expect((await s.row(s.A))?.sessionId).toBeUndefined();
  expect(await s.buyer(s.A).query(api.locations.current, { id: s.A })).toBeNull();
  await s.t.mutation(internal.locations.cleanupTerminal, { id: aRow._id });
  expect(await s.row(s.A)).toBeNull(); expect(await s.row(s.B)).toMatchObject({ sessionId: s.sessionId, sharing: true });
  vi.setSystemTime(Date.now() + 90_000); await s.refresh();
  const notices = (await s.jobs()).filter(j => j.kind === 'tracking_interrupted');
  expect(notices).toHaveLength(2); expect(notices.some(j => j.userId === s.buyerId(s.A))).toBe(false);
  expect(notices.every(j => j.errandId === s.B)).toBe(true);
  await s.recover(); expect(await s.obligation()).toMatchObject({ assignedAt: before.assignedAt, firstPickedUpAt: before.firstPickedUpAt, budgetMs: before.budgetMs });
});

test('queued run alert follows the remaining member for the runner, never for the delivered buyer', async () => {
  const s = await setup(true); await s.approve(s.A); await s.advance(s.A, 'picked_up'); await s.approve(s.B); await s.advance(s.B, 'picked_up');
  vi.setSystemTime(Date.now() + 90_000); await s.refresh();
  const jobs = (await s.jobs()).filter(j => j.kind === 'tracking_interrupted');
  const runnerJob = jobs.find(j => j.userId === s.r)!;
  const buyerJob = jobs.find(j => j.userId === s.buyerId(s.A))!;
  expect(runnerJob.errandId).toBe(s.A);
  await s.advance(s.A, 'delivered');
  expect(await s.runner.query(api.push.target, { notificationId: runnerJob._id })).toMatchObject({ role: 'runner', errandId: s.B });
  expect(await s.t.mutation(internal.push.claim, { id: runnerJob._id })).not.toBeNull();
  expect(await s.buyer(s.A).query(api.push.target, { notificationId: buyerJob._id })).toBeNull();
  expect(await s.t.mutation(internal.push.claim, { id: buyerJob._id })).toBeNull();
  expect((await s.jobs()).filter(j => j.kind === 'tracking_interrupted' && j.userId === s.r)).toHaveLength(1);
  await s.advance(s.B, 'delivered');
  expect(await s.runner.query(api.push.target, { notificationId: runnerJob._id })).toBeNull();
});

test('final delivery ends tracking, removes GPS and cannot resurrect access through late callbacks', async () => {
  const s = await setup(true); await s.approve(s.A); await s.advance(s.A, 'picked_up'); await s.approve(s.B); await s.advance(s.B, 'picked_up');
  const o = (await s.obligation())!, old = (await s.row(s.B))!;
  await s.advance(s.A, 'delivered'); await s.advance(s.B, 'delivered'); await s.cleanup();
  expect(await s.row(s.A)).toBeNull(); expect(await s.row(s.B)).toBeNull();
  expect(await s.t.run(ctx => ctx.db.query('errandRunners').withIndex('by_runnerId', q => q.eq('runnerId', s.r)).unique())).toBeNull();
  expect(await s.obligation()).toMatchObject({ condition: 'ended' });
  await s.t.mutation(internal.locations.expireRunner, { id: old._id, sessionId: s.sessionId });
  await s.t.mutation(internal.tracking.checkDeadline, { obligationId: o._id, generation: o.generation });
  await expect(s.publish()).rejects.toThrow('active errand');
  await expect(s.runner.mutation(api.locations.startRunner, { id: s.A, sessionId: 'late-private-session' })).rejects.toThrow();
  expect(await s.buyer(s.B).query(api.tracking.current, { id: s.B })).toBeNull();
  await s.runner.mutation(api.runners.startAvailability, { sessionId: 'next-online-session' });
  vi.setSystemTime(Date.now() + 5000);
  await s.runner.mutation(api.runners.updateLocation, { lat: 5.56, lng: -0.2, status: 'online', capturedAt: Date.now(), sessionId: 'next-online-session' });
  await s.cleanup();
  expect(await s.t.run(ctx => ctx.db.query('errandRunners').unique())).toMatchObject({ status: 'online', locationSessionId: 'next-online-session' });
});

test('terminal cancellation hook clears one member without resetting the remaining run', async () => {
  const s = await setup(); const before = (await s.obligation())!;
  // Exercise the existing terminal hook; this does not introduce active-job cancellation UI.
  await s.t.run(async ctx => { await ctx.db.patch('errands', s.A, { status: 'cancelled' }); await endTrackingMember(ctx, s.A); });
  expect((await s.row(s.A))?.point).toBeUndefined(); await s.cleanup(); expect(await s.row(s.A)).toBeNull();
  expect(await s.obligation()).toMatchObject({ assignedAt: before.assignedAt, budgetMs: before.budgetMs });
  expect((await s.obligation())?.endedAt).toBeUndefined();
  vi.setSystemTime(Date.now() + 5000); expect(await s.publish()).toBe(true);
  await s.t.run(async ctx => { await ctx.db.patch('errands', s.B, { status: 'cancelled' }); await endTrackingMember(ctx, s.B); });
  await s.cleanup(); expect(await s.row(s.B)).toBeNull(); expect(await s.obligation()).toMatchObject({ condition: 'ended' });
});

test('revocation fences both old sessions; late cleanup preserves fresh authorized recovery', async () => {
  const s = await setup(true); const o = (await s.obligation())!;
  await s.t.mutation(internal.runners.setRunnerAccess, { userId: s.r, enabled: false });
  expect((await s.row(s.A))?.point).toBeUndefined(); expect((await s.row(s.B))?.sessionId).toBeUndefined();
  expect(await s.buyer(s.A).query(api.locations.current, { id: s.A })).toBeNull();
  await expect(s.publish()).rejects.toThrow('access');
  await s.t.mutation(internal.runners.setRunnerAccess, { userId: s.r, enabled: true });
  vi.setSystemTime(Date.now() + 5000); expect(await s.publish()).toBe(false);
  await s.runner.mutation(api.locations.startRunner, { id: s.A, sessionId: 'restored-private-session' });
  await s.publish('restored-private-session'); await s.cleanup();
  expect(await s.row(s.B)).toMatchObject({ sessionId: 'restored-private-session', sharing: true });
  expect(await s.obligation()).toMatchObject({ assignedAt: o.assignedAt, budgetMs: o.budgetMs });
});

test('revocation fences active rows even behind a large history, and cleanup drains bounded batches', async () => {
  const s = await setup();
  await s.t.run(async ctx => {
    const original = (await ctx.db.get('errands', s.A))!;
    for (let i = 0; i < 61; i++) {
      const id = await ctx.db.insert('errands', { title: original.title, description: '', category: 'delivery', pickup: 'Old pickup', dropoff: 'Old delivery',
        budgetPesewas: 1000, urgency: 'normal', requestId: `old-job-${i}`, customerId: original.customerId, runnerId: s.r, status: 'delivered' });
      await ctx.db.insert('runnerLocations', { errandId: id, publisherId: s.r, source: 'runner_gps', sharing: false, receivedAt: Date.now(),
        point: { latitude: 5.56, longitude: -0.2, capturedAt: Date.now() } });
    }
  });
  await s.t.mutation(internal.runners.setRunnerAccess, { userId: s.r, enabled: false });
  expect((await s.row(s.A))?.point).toBeUndefined(); expect((await s.row(s.B))?.sessionId).toBeUndefined();
  await s.cleanup(); await s.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await s.t.run(ctx => ctx.db.query('runnerLocations').collect())).toHaveLength(0);
  expect((await s.obligation())?.endedAt).toBeUndefined();
});
