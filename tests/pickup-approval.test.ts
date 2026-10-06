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


async function solo() {
  const s = await setup(false);
  const quoteId = await s.runner.mutation(api.pricing.submitQuote, { id: s.firstId, expectedRevision: 0, expectedVersion: 0, serviceFeePesewas: 2000, note: '' });
  await s.buyer.mutation(api.pricing.approveQuote, { quoteId, expectedRevision: 0, expectedVersion: 1 });
  const revision = async () => (await s.buyer.query(api.errands.get, { id: s.firstId }))!.revision!;
  const request = () => s.runner.mutation(api.pickup.request, { id: s.firstId });
  const approve = async (expectedRequestVersion = 1) => s.buyer.mutation(api.pickup.approve, { id: s.firstId, expectedRevision: await revision(), expectedRequestVersion });
  const advance = async () => s.runner.mutation(api.runnerJobs.advance, { id: s.firstId, expectedRevision: await revision(), nextStatus: 'picked_up' });
  const view = () => s.buyer.query(api.pickup.current, { id: s.firstId });
  const row = () => s.t.run(ctx => ctx.db.query('pickupApprovals').unique());
  return { ...s, revision, request, approve, advance, view, row };
}

test('runner cannot advance without this buyer approval and cannot approve their own request', async () => {
  const s = await solo();
  await expect(s.advance()).rejects.toThrow('approval');
  await s.request();
  for (const actor of [s.t, s.runner, s.second, s.stranger]) {
    await expect(actor.mutation(api.pickup.approve, { id: s.firstId, expectedRevision: 1, expectedRequestVersion: 1 })).rejects.toThrow();
  }
  expect((await s.view())?.status).toBe('requested');
  expect(await s.stranger.query(api.pickup.current, { id: s.firstId })).toBeNull();
});

test('unused approval expires at ten minutes and a stale page cannot approve the replacement request', async () => {
  const s = await solo(); await s.request(); await s.approve();
  const row = (await s.row())!;
  vi.setSystemTime(row.expiresAt!);
  expect((await s.view())?.status).toBe('expired');
  await expect(s.advance()).rejects.toThrow('expired');
  await s.request();
  expect((await s.row())?.requestVersion).toBe(2);
  await expect(s.approve(1)).rejects.toThrow('request changed');
  await s.approve(2);
  expect((await s.view())?.status).toBe('approved');
});

test('requests and approvals retry without duplicate events and pickup consumes once', async () => {
  const s = await solo(); await s.request(); await s.request(); await s.approve(); await s.approve();
  const before = await s.revision();
  await s.advance();
  await s.runner.mutation(api.runnerJobs.advance, { id: s.firstId, expectedRevision: before, nextStatus: 'picked_up' });
  expect(await s.row()).toMatchObject({ state: 'consumed', requestVersion: 1, consumedAt: Date.now() });
  const events = await s.t.run(ctx => ctx.db.query('errandActivity').withIndex('by_errandId', q => q.eq('errandId', s.firstId)).collect());
  expect(events.filter(e => e.kind === 'picked_up')).toHaveLength(1);
  expect(events.filter(e => e.summary.includes('requested collection'))).toHaveLength(1);
  expect(events.filter(e => e.summary.includes('approved collection'))).toHaveLength(1);
});

test('a valid approval does not bypass location locks and is consumed only after recovery', async () => {
  const s = await solo();
  vi.setSystemTime(Date.now() + 90_000);
  await s.request(); await s.approve();
  expect((await s.runner.query(api.pickup.current, { id: s.firstId }))?.canConfirm).toBe(false);
  await expect(s.advance()).rejects.toThrow('Restore');
  expect((await s.row())?.state).toBe('approved');
  const sessionId = 'pickup-recovery-session';
  await s.runner.mutation(api.locations.startRunner, { id: s.firstId, sessionId });
  const publish = () => s.runner.mutation(api.locations.publishRunner, { id: s.firstId, sessionId, point: { latitude: 5.56, longitude: -0.2, capturedAt: Date.now() } });
  await publish(); vi.setSystemTime(Date.now() + 10_000); await publish();
  expect((await s.runner.query(api.pickup.current, { id: s.firstId }))?.canConfirm).toBe(true);
  await s.advance();
  expect((await s.row())?.state).toBe('consumed');
});

test('unused expiry is materialized without an open app; obsolete expiry cannot alter new approval', async () => {
  const s = await solo(); await s.request(); await s.approve();
  const first = (await s.row())!;
  await s.t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect((await s.row())?.state).toBe('expired');
  await s.request(); await s.approve(2);
  const second = (await s.row())!;
  expect(second.approvedAt).not.toBe(first.approvedAt);
  await s.t.mutation(internal.pickup.expire, { approvalId: first._id, requestVersion: first.requestVersion });
  expect(await s.row()).toEqual(second);
});

test('requesting again while approved does not renew the ten-minute window', async () => {
  const s = await solo(); await s.request(); await s.approve();
  const first = await s.row();
  vi.setSystemTime(Date.now() + 15_000);
  await s.request(); await s.approve();
  expect(await s.row()).toEqual(first);
});

test('owner must review the current revision and request version', async () => {
  const s = await solo(); await s.request();
  await expect(s.buyer.mutation(api.pickup.approve, { id: s.firstId, expectedRevision: 0, expectedRequestVersion: 1 })).rejects.toThrow('errand changed');
  await expect(s.buyer.mutation(api.pickup.approve, { id: s.firstId, expectedRevision: 1, expectedRequestVersion: 1.5 })).rejects.toThrow('request changed');
  expect((await s.row())?.state).toBe('requested');
});

test('an approval belongs to the assignment and cannot survive a replaced obligation', async () => {
  const s = await solo(); await s.request(); await s.approve();
  await s.t.run(async ctx => {
    const e = (await ctx.db.get('errands', s.firstId))!;
    const o = (await ctx.db.get('trackingObligations', e.trackingObligationId!))!;
    const { _id, _creationTime, ...fields } = o;
    const replacement = await ctx.db.insert('trackingObligations', fields);
    await ctx.db.patch('errands', e._id, { trackingObligationId: replacement });
  });
  expect((await s.view())?.status).toBe('not_requested');
  await expect(s.advance()).rejects.toThrow('approval');
  await expect(s.approve()).rejects.toThrow('request changed');
  await s.request(); await s.approve(2); await s.advance();
});

test('revocation and terminal errands reject approval actions and reveal no request', async () => {
  const s = await solo(); await s.request();
  for (const actor of [s.t, s.buyer, s.second, s.other]) await expect(actor.mutation(api.pickup.request, { id: s.firstId })).rejects.toThrow();
  await s.t.mutation(internal.runners.setRunnerAccess, { userId: s.ids[2], enabled: false });
  expect(await s.view()).toBeNull(); await expect(s.approve()).rejects.toThrow();
  await s.t.mutation(internal.runners.setRunnerAccess, { userId: s.ids[2], enabled: true });
  await s.t.run(ctx => ctx.db.patch('errands', s.firstId, { status: 'delivered' }));
  expect(await s.view()).toBeNull(); await expect(s.request()).rejects.toThrow();
});

test('shared buyers authorize only their own pickup and stop-order failure rolls back consumption', async () => {
  const s = await setup(); await s.activate();
  const g = (await s.runner.query(api.share.runner, { id: s.groupId! }))!.group;
  const first = g.route[0].errandId, second = g.route[1].errandId;
  expect(g.route[1].kind).toBe('pickup');
  const owner = (id: Id<'errands'>) => id === s.firstId ? s.buyer : s.second;
  const revision = async (id: Id<'errands'>) => (await owner(id).query(api.errands.get, { id }))!.revision!;
  for (const id of [first, second]) await s.runner.mutation(api.pickup.request, { id });
  const firstView = await owner(first).query(api.pickup.current, { id: first });
  expect(JSON.stringify(firstView)).not.toContain(second);
  expect(await owner(first).query(api.pickup.current, { id: second })).toBeNull();
  await expect(owner(first).mutation(api.pickup.approve, { id: second, expectedRevision: await revision(second), expectedRequestVersion: 1 })).rejects.toThrow();
  await owner(second).mutation(api.pickup.approve, { id: second, expectedRevision: await revision(second), expectedRequestVersion: 1 });
  await expect(s.runner.mutation(api.runnerJobs.advance, { id: second, expectedRevision: await revision(second), nextStatus: 'picked_up' })).rejects.toThrow('next stop');
  expect(await s.t.run(ctx => ctx.db.query('pickupApprovals').withIndex('by_errandId', q => q.eq('errandId', second)).unique())).toMatchObject({ state: 'approved' });
  await expect(s.runner.mutation(api.runnerJobs.advance, { id: first, expectedRevision: await revision(first), nextStatus: 'picked_up' })).rejects.toThrow('approval');
  await owner(first).mutation(api.pickup.approve, { id: first, expectedRevision: await revision(first), expectedRequestVersion: 1 });
  await s.runner.mutation(api.runnerJobs.advance, { id: first, expectedRevision: await revision(first), nextStatus: 'picked_up' });
  expect((await s.runner.query(api.pickup.current, { id: second }))?.canConfirm).toBe(true);
  await s.runner.mutation(api.runnerJobs.advance, { id: second, expectedRevision: await revision(second), nextStatus: 'picked_up' });
  expect(await s.t.run(ctx => ctx.db.query('pickupApprovals').collect())).toHaveLength(2);
  expect((await s.t.run(ctx => ctx.db.query('pickupApprovals').collect())).every(p => p.state === 'consumed')).toBe(true);
});

test('legacy assignment needs no approval and does not expose the new flow', async () => {
  vi.stubEnv('ENABLE_LOCATION_ACCOUNTABILITY', 'false');
  const s = await solo();
  expect(await s.view()).toBeNull();
  await expect(s.request()).rejects.toThrow();
  vi.stubEnv('ENABLE_LOCATION_ACCOUNTABILITY', 'true');
  await s.advance();
  expect((await s.buyer.query(api.errands.get, { id: s.firstId }))?.status).toBe('picked_up');
});


test('competing approval and revision writes leave old pages unable to consume pickup', async () => {
  const s = await solo(); await s.request();
  const revision = await s.revision();
  const outcomes = await Promise.allSettled([
    s.t.run(ctx => ctx.db.patch('errands', s.firstId, { revision: revision + 1 })),
    s.buyer.mutation(api.pickup.approve, { id: s.firstId, expectedRevision: revision, expectedRequestVersion: 1 }),
  ]);
  expect(outcomes[0].status).toBe('fulfilled');
  await expect(s.runner.mutation(api.runnerJobs.advance, { id: s.firstId, expectedRevision: revision, nextStatus: 'picked_up' })).rejects.toThrow('changed');
  expect((await s.row())?.state).not.toBe('consumed');
  await s.approve();
  await Promise.all([s.advance(), s.advance()]);
  const events = await s.t.run(ctx => ctx.db.query('errandActivity').withIndex('by_errandId', q => q.eq('errandId', s.firstId)).collect());
  expect(events.filter(e => e.kind === 'picked_up')).toHaveLength(1);
  expect(events.filter(e => e.summary.includes('approved collection'))).toHaveLength(1);
  expect((await s.row())?.state).toBe('consumed');
});
