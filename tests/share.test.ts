/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import type { Id } from '../convex/_generated/dataModel';
const modules = import.meta.glob('../convex/**/*.{ts,js}');
const fields = { title: 'Collect parcel', description: 'Keep upright', category: 'delivery' as const, pickup: 'Osu shop', dropoff: 'Labone office', budgetPesewas: 0, budgetPurpose: 'items' as const, urgency: 'normal' as const };
const pickup = { lat: 5.56, lng: -0.2 }, dropoff = { lat: 5.56, lng: -0.18 };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 8, 22, 10)); });
afterEach(() => vi.useRealTimers());
async function setup(pair = true) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => Promise.all(['buyer', 'buyer', 'runner', 'runner', 'buyer'].map((role, i) => ctx.db.insert('users', { role: role as 'buyer' | 'runner', name: `Person ${i}` }))));
  const [buyer, second, runner, other, stranger] = ids.map(id => t.withIdentity({ subject: `${id}|session` }));
  for (const account of [runner, other]) {
    await account.mutation(api.runners.register, { phone: '0241234567', area: 'Osu', transport: 'motorbike', services: ['delivery'] });
    await account.mutation(api.pricing.saveRates, { rates: [{ category: 'delivery', startingFeePesewas: 1500 }] });
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
test('compatible errands pair once; regular discovery and quotes cannot split a pair', async () => {
  const { buyer, runner, firstId, secondId, groupId } = await setup();
  expect(groupId).toBeTruthy();
  const route = await runner.query(api.share.runner, { id: groupId! });
  expect(new Set(route!.group.errandIds)).toEqual(new Set([firstId, secondId])); expect(route!.group.route).toHaveLength(4);
  expect(route!.group.savedKm).toBeGreaterThan(0);
  expect((await runner.query(api.runnerJobs.availableErrands, { paginationOpts: { cursor: null, numItems: 10 } })).page).toHaveLength(0);
  await expect(runner.mutation(api.pricing.submitQuote, { id: firstId, expectedRevision: 1, expectedVersion: 0, serviceFeePesewas: 2000, note: '' })).rejects.toThrow();
  const view = await buyer.query(api.share.buyer, { id: firstId }); expect(view.group?.status).toBe('open');
  expect(JSON.stringify(view)).not.toContain(secondId);
});

test('shared offers rank by trust but both buyers may choose the lower-ranked runner', async () => {
  const { t, ids, buyer, second, runner, other, firstId, secondId, groupId, offer, approve } = await setup();
  await t.run(async ctx => {
    const id = await ctx.db.insert('errands', { ...fields, customerId: ids[0], runnerId: ids[2], requestId: 'shared-trust-history', status: 'delivered', updatedAt: Date.now(), completion: { isDemo: false, runnerId: ids[2], confirmedAt: Date.now() } });
    await ctx.db.insert('reviews', { errandId: id, customerId: ids[0], runnerId: ids[2], isDemo: false, rating: 5, comment: '' });
  });
  const high = await offer(runner, [3000, 3000]);
  vi.advanceTimersByTime(1);
  const low = await offer(other, [1500, 1500]);
  const ranked = (await buyer.query(api.share.buyer, { id: firstId })).offers;
  expect(ranked.map(o => o.id)).toEqual([high, low]);
  expect(ranked.every(o => o.canApprove)).toBe(true);
  expect((await t.run(ctx => ctx.db.get('shareGroups', groupId!)))?.status).toBe('open');
  await approve(buyer, firstId, low);
  expect((await t.run(ctx => ctx.db.get('errands', firstId)))?.runnerId).toBeUndefined();
  await approve(second, secondId, low);
  expect((await t.run(ctx => ctx.db.get('errands', firstId)))?.runnerId).toBe(ids[3]);
});
test('both independent fees must be approved; reservation freezes the offer and holds runner capacity', async () => {
  const { buyer, second, runner, firstId, secondId, groupId, offer, approve, t, ids } = await setup();
  const offerId = await offer();
  const group = (await runner.query(api.share.runner, { id: groupId! }))!.group;
  await approve(buyer, firstId, offerId); await approve(buyer, firstId, offerId);
  expect((await buyer.query(api.errands.get, { id: firstId }))?.status).toBe('posted');
  expect((await runner.query(api.share.current, {}))?.status).toBe('reserved');
  await expect(runner.query(api.messages.context, { errandId: firstId })).rejects.toThrow();
  await expect(runner.mutation(api.share.quote, { groupId: groupId!, fees: [2200, 2500], note: '', expectedVersion: 1 })).rejects.toThrow();
  const solo = await buyer.mutation(api.errands.create, { ...fields, requestId: 'share-solo-000001' });
  await expect(runner.mutation(api.pricing.submitQuote, { id: solo, expectedRevision: 0, expectedVersion: 0, serviceFeePesewas: 2200, note: '' })).rejects.toThrow();
  await approve(second, secondId, offerId); await approve(second, secondId, offerId);
  for (const [index, id] of group.errandIds.entries()) {
    const e = await t.run(ctx => ctx.db.get('errands', id));
    expect(e).toMatchObject({ runnerId: ids[2], status: 'accepted', agreedPricing: { serviceFeePesewas: [1800, 2100][index] }, trustResponse: { runnerId: ids[2] } });
  }
  expect((await runner.query(api.messages.context, { errandId: secondId })).canSend).toBe(true);
});
test('competing first approvals can reserve only one runner; unselected buyer can release the pair', async () => {
  const { t, buyer, second, runner, other, firstId, secondId, groupId, offer, approve } = await setup();
  const one = await offer(); const two = await offer(other);
  const outcomes = await Promise.allSettled([approve(buyer, firstId, one), approve(second, secondId, two)]);
  expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1);
  const g = await t.run(ctx => ctx.db.get('shareGroups', groupId!)); expect(g?.approvedIds).toHaveLength(1);
  await second.mutation(api.share.leave, { id: secondId });
  for (const r of [runner, other]) expect(await r.query(api.share.current, {})).toBeNull();
  expect((await buyer.query(api.errands.get, { id: firstId }))?.shareState).toBe('released');
  await expect(approve(buyer, firstId, one)).rejects.toThrow();
});
test('unauthorized users cannot see buyer offers, approve them, or enroll someone else’s errand', async () => {
  const { t, buyer, runner, stranger, second, firstId, secondId, groupId, offer, approve } = await setup();
  const offerId = await offer();
  for (const account of [t, runner, stranger, second]) {
    await expect(account.query(api.share.buyer, { id: firstId })).rejects.toThrow();
    await expect(approve(account, firstId, offerId)).rejects.toThrow();
    await expect(account.mutation(api.share.join, { id: firstId, expectedRevision: 1, pickup, dropoff })).rejects.toThrow();
  }
  await expect(buyer.query(api.share.runner, { id: groupId! })).rejects.toThrow();
  const view = await buyer.query(api.share.buyer, { id: firstId });
  expect(view.offers).toHaveLength(1); expect(view.offers[0].trust.score).toBe(50);
  expect(view.offers[0]).not.toHaveProperty('fees'); expect(JSON.stringify(view)).not.toContain(secondId);
});
test('editing and cancellation dissolve the pair and invalidate every old shared offer', async () => {
  for (const cancel of [false, true]) {
    const { buyer, second, runner, firstId, secondId, offer, approve } = await setup(); const offerId = await offer();
    await approve(buyer, firstId, offerId);
    const e = (await second.query(api.errands.get, { id: secondId }))!;
    if (cancel) await second.mutation(api.errands.cancel, { id: secondId, expectedRevision: e.revision!, reason: '' });
    else await second.mutation(api.errands.update, { ...fields, id: secondId, expectedRevision: e.revision!, pickup: 'Different shop' });
    expect((await buyer.query(api.errands.get, { id: firstId }))?.shareGroupId).toBeUndefined();
    expect(await runner.query(api.share.current, {})).toBeNull(); await expect(approve(second, secondId, offerId)).rejects.toThrow();
  }
});
test('scheduled timeouts release unmatched requests and half-approved pairs', async () => {
  const first = await setup(false);
  await first.buyer.mutation(api.share.join, { id: first.firstId, expectedRevision: 0, pickup, dropoff });
  await first.t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect((await first.buyer.query(api.errands.get, { id: first.firstId }))?.shareState).toBe('released');
  const s = await setup(); const offerId = await s.offer(); await s.approve(s.buyer, s.firstId, offerId);
  await s.t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect((await s.buyer.query(api.errands.get, { id: s.firstId }))?.shareState).toBe('released');
  expect(await s.runner.query(api.share.current, {})).toBeNull();
});
test('four-stop route requires separate proof and keeps GPS private after each delivery', async () => {
  const s = await setup(); await s.activate();
  const group = (await s.runner.query(api.share.runner, { id: s.groupId! }))!.group;
  const anchor = group.errandIds[0], sessionId = 'shared-gps-session';
  const account = (id: Id<'errands'>) => id === s.firstId ? s.buyer : s.second;
  await s.runner.mutation(api.locations.startRunner, { id: anchor, sessionId });
  await s.runner.mutation(api.locations.publishRunner, { id: anchor, sessionId, point: { latitude: 5.56, longitude: -0.2, capturedAt: Date.now() } });
  for (const id of group.errandIds) expect((await account(id).query(api.locations.current, { id }))?.sharing).toBe(true);
  expect(await s.stranger.query(api.locations.current, { id: anchor })).toBeNull();
  const wrong = group.errandIds.find(id => id !== group.route[0].errandId)!;
  await expect(s.runner.mutation(api.runnerJobs.advance, { id: wrong, expectedRevision: (await account(wrong).query(api.errands.get, { id: wrong }))!.revision!, nextStatus: 'picked_up' })).rejects.toThrow('next stop');
  const delivered: Id<'errands'>[] = [];
  for (const stop of group.route) {
    const e = (await account(stop.errandId).query(api.errands.get, { id: stop.errandId }))!;
    if (stop.kind === 'dropoff') {
      await expect(s.runner.mutation(api.runnerJobs.advance, { id: e._id, expectedRevision: e.revision!, nextStatus: 'delivered' })).rejects.toThrow('handover');
      await s.t.run(async ctx => { const storageId = await ctx.storage.store(new Blob(['proof'], { type: 'image/jpeg' })); await ctx.db.insert('deliveryProofs', { errandId: e._id, runnerId: s.ids[2], storageId, mimeType: 'image/jpeg', size: 5, requestId: `proof-${e._id}` }); });
    }
    await s.runner.mutation(api.runnerJobs.advance, { id: e._id, expectedRevision: e.revision!, nextStatus: stop.kind === 'pickup' ? 'picked_up' : 'delivered' });
    if (stop.kind === 'dropoff') {
      delivered.push(e._id); expect(await account(e._id).query(api.locations.current, { id: e._id })).toBeNull();
      const latest = (await account(e._id).query(api.errands.get, { id: e._id }))!;
      await account(e._id).mutation(api.errands.confirmCompletion, { id: e._id, expectedRevision: latest.revision! });
      await account(e._id).mutation(api.reviews.submit, { id: e._id, rating: 5, comment: 'Good shared delivery' });
      if (delivered.length === 1) {
        expect((await s.runner.query(api.runnerJobs.capacity, {}))?.id).toBe(anchor);
        vi.advanceTimersByTime(5000);
        expect(await s.runner.mutation(api.locations.publishRunner, { id: anchor, sessionId, point: { latitude: 5.57, longitude: -0.19, capturedAt: Date.now() } })).toBe(true);
        const remaining = group.errandIds.find(id => id !== e._id)!;
        expect((await account(remaining).query(api.locations.current, { id: remaining }))?.point?.latitude).toBe(5.57);
        expect(await account(e._id).query(api.locations.current, { id: e._id })).toBeNull();
      }
    }
  }
  expect(await s.runner.query(api.runnerJobs.capacity, {})).toBeNull();
  expect((await s.runner.query(api.trust.mine, {}))).toMatchObject({ completedJobs: 2, distinctBuyers: 2, ratingCount: 2 });
  expect((await s.runner.query(api.pricing.earnings, { paginationOpts: { cursor: null, numItems: 10 } })).page).toHaveLength(2);
  await expect(s.runner.mutation(api.locations.publishRunner, { id: anchor, sessionId, point: { latitude: 5.57, longitude: -0.19, capturedAt: Date.now() } })).rejects.toThrow();
});
test('express, invalid coordinates and same-buyer errands cannot form shared pairs', async () => {
  const s = await setup(false);
  const express = await s.buyer.mutation(api.errands.create, { ...fields, urgency: 'express', requestId: 'express-share-001' });
  await expect(s.buyer.mutation(api.share.join, { id: express, expectedRevision: 0, pickup, dropoff })).rejects.toThrow();
  await expect(s.buyer.mutation(api.share.join, { id: s.firstId, expectedRevision: 0, pickup: { lat: 91, lng: 0 }, dropoff })).rejects.toThrow();
  const same = await s.buyer.mutation(api.errands.create, { ...fields, requestId: 'same-buyer-share-001' });
  for (const id of [s.firstId, same]) await s.buyer.mutation(api.share.join, { id, expectedRevision: 0, pickup, dropoff });
  expect((await s.runner.query(api.share.available, {}))).toHaveLength(0);
});
test('disabling a reserved runner prevents the second approval from assigning either job', async () => {
  const s = await setup(); const offerId = await s.offer(); await s.approve(s.buyer, s.firstId, offerId);
  await s.t.mutation(internal.runners.setRunnerAccess, { userId: s.ids[2], enabled: false });
  await expect(s.approve(s.second, s.secondId, offerId)).rejects.toThrow();
  expect((await s.second.query(api.errands.get, { id: s.secondId }))?.status).toBe('posted');
});
test('withdrawing a reserved offer releases both buyers and cannot mutate an assigned run', async () => {
  const s = await setup(); const offerId = await s.offer(); await s.approve(s.buyer, s.firstId, offerId);
  await expect(s.other.mutation(api.share.withdraw, { offerId, expectedVersion: 1 })).rejects.toThrow();
  await s.runner.mutation(api.share.withdraw, { offerId, expectedVersion: 1 });
  expect((await s.second.query(api.errands.get, { id: s.secondId }))?.shareState).toBe('released');
  expect(await s.runner.query(api.runnerJobs.capacity, {})).toBeNull();
  await expect(s.approve(s.second, s.secondId, offerId)).rejects.toThrow();
  const a = await setup(); const activeOffer = await a.activate();
  await expect(a.runner.mutation(api.share.withdraw, { offerId: activeOffer, expectedVersion: 1 })).rejects.toThrow();
});
test('stale fees cannot be approved and concurrent approvals of the current fee assign only once', async () => {
  const s = await setup(); const offerId = await s.offer();
  await s.runner.mutation(api.share.quote, { groupId: s.groupId!, expectedVersion: 1, fees: [2300, 2600], note: 'Updated fee' });
  await expect(s.approve(s.buyer, s.firstId, offerId)).rejects.toThrow('changed');
  await Promise.all([[s.buyer, s.firstId], [s.second, s.secondId]].map(([account, id]) => (account as typeof s.buyer).mutation(api.share.approve, { id: id as Id<'errands'>, offerId, expectedVersion: 2 })));
  expect((await s.runner.query(api.share.current, {}))?.status).toBe('active');
  expect((await s.t.run(ctx => ctx.db.query('runnerQuotes').collect()))).toHaveLength(2);
  await expect(s.second.mutation(api.pricing.markSent, { id: s.firstId, method: 'MoMo' })).rejects.toThrow();
  await s.buyer.mutation(api.pricing.markSent, { id: s.firstId, method: 'MoMo' });
  expect((await s.second.query(api.pricing.payment, { id: s.secondId }))?.payment).toBeNull();
  await expect(s.second.query(api.messages.context, { errandId: s.firstId })).rejects.toThrow();
});
test('concurrent compatible joins cannot attach one errand to two pairs', async () => {
  const s = await setup(false);
  const third = await s.stranger.mutation(api.errands.create, { ...fields, requestId: 'share-third-00001' });
  await s.buyer.mutation(api.share.join, { id: s.firstId, expectedRevision: 0, pickup, dropoff });
  await Promise.all([s.second.mutation(api.share.join, { id: s.secondId, expectedRevision: 0, pickup, dropoff }), s.stranger.mutation(api.share.join, { id: third, expectedRevision: 0, pickup, dropoff })]);
  const groups = await s.t.run(ctx => ctx.db.query('shareGroups').collect());
  expect(groups).toHaveLength(1); expect(groups[0].errandIds).toContain(s.firstId);
  const waiting = await s.t.run(ctx => ctx.db.query('errands').withIndex('by_shareState', q => q.eq('shareState', 'waiting')).collect());
  expect(waiting).toHaveLength(1); expect(groups[0].errandIds).not.toContain(waiting[0]._id);
});

test('a shared run reveals only each buyer’s own saved destinations and no live buyer GPS', async () => {
  const { t, buyer, second, runner, other, firstId, secondId, activate } = await setup();
  await activate();
  const first = await buyer.query(api.errands.destinations, { id: firstId });
  const last = await second.query(api.errands.destinations, { id: secondId });
  expect(first?.pickupPoint).toEqual(pickup);
  expect(last?.pickupPoint).not.toBeNull();
  expect(await runner.query(api.errands.destinations, { id: firstId })).toEqual(first);
  expect(await runner.query(api.errands.destinations, { id: secondId })).toEqual(last);
  expect(await second.query(api.errands.destinations, { id: firstId })).toBeNull();
  expect(await buyer.query(api.errands.destinations, { id: secondId })).toBeNull();
  expect(await other.query(api.errands.destinations, { id: firstId })).toBeNull();
  await expect(buyer.mutation(api.buyerLocations.start, { id: firstId, sessionId: 'retired-buyer-session' })).rejects.toThrow('retired');
  expect(await runner.query(api.buyerLocations.current, { id: firstId })).toBeNull();
  expect(await runner.query(api.buyerLocations.current, { id: secondId })).toBeNull();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});
