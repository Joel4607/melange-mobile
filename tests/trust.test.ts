/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import schema from '../convex/schema';
import { approveJob } from './helpers/approve-job';
import { rankBuyerQuotes } from '../convex/lib/trustScore';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
const fields = { title: 'Collect parcel', description: '', category: 'delivery' as const, pickup: 'Osu', dropoff: 'Labone', budgetPesewas: 5000, urgency: 'normal' as const };
const paginationOpts = { numItems: 30, cursor: null };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 8, 22, 10)); });
afterEach(() => vi.useRealTimers());
async function setup() {
  const t = convexTest(schema, modules);
  const [buyerId, firstId, secondId, outsiderId] = await t.run(async ctx => [
    await ctx.db.insert('users', { name: 'Buyer', role: 'buyer' }),
    await ctx.db.insert('users', { name: 'Ama', role: 'runner' }),
    await ctx.db.insert('users', { name: 'Kojo', role: 'runner' }),
    await ctx.db.insert('users', { name: 'Other buyer', role: 'buyer' }),
  ]);
  const identity = (id: Id<'users'>) => t.withIdentity({ subject: `${id}|session` });
  const buyer = identity(buyerId), first = identity(firstId), second = identity(secondId), outsider = identity(outsiderId);
  for (const runner of [first, second]) {
    await runner.mutation(api.runners.register, { phone: '0241234567', area: 'Osu', transport: 'walking', services: ['delivery'] });
    await runner.mutation(api.pricing.saveRates, { rates: [{ category: 'delivery', startingFeePesewas: 2000 }] });
  }
  await t.mutation(internal.trust.refreshClock, {});
  let count = 0;
  const create = () => buyer.mutation(api.errands.create, { ...fields, requestId: `trust-errand-${++count}` });
  async function past(runnerId: Id<'users'>, rating = 5, buyer = buyerId) {
    return t.run(async ctx => {
      const id = await ctx.db.insert('errands', { ...fields, customerId: buyer, runnerId, requestId: `historical-${++count}`, status: 'delivered', updatedAt: Date.now(), completion: { isDemo: false, runnerId, confirmedAt: Date.now() } });
      await ctx.db.insert('reviews', { errandId: id, customerId: buyer, runnerId, isDemo: false, rating, comment: '' });
      return id;
    });
  }
  return { t, buyer, first, second, outsider, buyerId, firstId, secondId, outsiderId, create, past };
}

test('historical confirmed jobs count immediately; demo, self, pending and mismatched records do not', async () => {
  const { t, first, firstId, secondId, create, past } = await setup();
  await past(firstId); const demo = await past(firstId); const self = await past(firstId, 5, firstId); const mismatch = await past(firstId);
  const waiting = await create();
  await t.run(async ctx => {
    await ctx.db.patch('errands', demo, { trackingMode: 'demo' });
    await ctx.db.patch('errands', mismatch, { completion: { isDemo: false, runnerId: secondId, confirmedAt: Date.now() } });
    await ctx.db.patch('errands', waiting, { runnerId: firstId, status: 'delivered' });
  });
  expect(await first.query(api.trust.mine, {})).toMatchObject({ completedJobs: 1, ratingCount: 1, responseCount: 0, distinctBuyers: 1, history: 'limited' });
  expect(self).toBeTruthy();
});

test('real text and image replies are measured once, then confirmation and review update trust', async () => {
  const { t, buyer, first, firstId, create } = await setup();
  const id = await create(); await approveJob(t, first, { id, expectedRevision: 0 });
  const channel = (await buyer.query(api.messages.context, { errandId: id })).channel!;
  const request = { errandId: id, channel, clientId: 'trust-buyer-message', text: 'Please confirm the pickup.' };
  await buyer.mutation(api.messages.sendText, request);
  const firstAt = Date.now(); vi.advanceTimersByTime(60_000);
  await buyer.mutation(api.messages.sendText, request);
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(['test image'], { type: 'image/jpeg' })));
  const reply = { errandId: id, channel, clientId: 'trust-runner-image', text: '', image: { storageId, mimeType: 'image/jpeg', size: 10 } };
  await first.mutation(internal.messages.commitImage, reply);
  vi.advanceTimersByTime(120_000); await first.mutation(internal.messages.commitImage, reply);
  expect((await t.run(ctx => ctx.db.get('errands', id)))?.trustResponse).toEqual({ runnerId: firstId, buyerMessageAt: firstAt, runnerReplyAt: firstAt + 60_000 });
  expect((await first.query(api.trust.mine, {})).score).toBe(50);
  await t.run(ctx => ctx.db.patch('errands', id, { status: 'delivered' }));
  await buyer.mutation(api.errands.confirmCompletion, { id, expectedRevision: 1 });
  await buyer.mutation(api.reviews.submit, { id, rating: 5, comment: 'Helpful runner' });
  await buyer.mutation(api.reviews.submit, { id, rating: 5, comment: 'Helpful runner' });
  expect(await first.query(api.trust.mine, {})).toMatchObject({ completedJobs: 1, ratingCount: 1, responseCount: 1, repliedCount: 1, averageReplyMinutes: 1 });
  expect((await buyer.query(api.trust.forErrand, { id }))?.score).toBeGreaterThan(50);
});

test('trust suggestions rank evidence over cheap fees', async () => {
  const { buyer, first, second, firstId, secondId, create, past } = await setup();
  await past(firstId, 5); await past(firstId, 5); await past(secondId, 1);
  const id = await create();
  const good = await first.mutation(api.pricing.submitQuote, { id, expectedRevision: 0, expectedVersion: 0, serviceFeePesewas: 4000, note: '' });
  await second.mutation(api.pricing.submitQuote, { id, expectedRevision: 0, expectedVersion: 0, serviceFeePesewas: 1000, note: '' });
  const recommendations = await buyer.query(api.trust.recommendations, { id });
  expect(recommendations.candidates[0].quoteId).toBe(good);
  expect(recommendations.assessed).toBe(2);
  const cards = await buyer.query(api.pricing.forBuyer, { id, paginationOpts });
  expect(cards.page.every(q => q.trust && q.canApprove)).toBe(true);
  await buyer.mutation(api.pricing.approveQuote, { quoteId: good, expectedVersion: 1, expectedRevision: 0 });
  expect((await buyer.query(api.trust.recommendations, { id })).candidates).toEqual([]);
});

test('ranking all quote pages leaves assignment to the buyer, including a lower-ranked choice', async () => {
  const { t, buyer, first, second, outsider, firstId, secondId, create, past } = await setup();
  await past(firstId, 5); await past(firstId, 5); await past(secondId, 1);
  const id = await create();
  const top = await first.mutation(api.pricing.submitQuote, { id, expectedRevision: 0, expectedVersion: 0, serviceFeePesewas: 4000, note: '' });
  vi.advanceTimersByTime(1);
  const lower = await second.mutation(api.pricing.submitQuote, { id, expectedRevision: 0, expectedVersion: 0, serviceFeePesewas: 1000, note: '' });
  const page1 = await buyer.query(api.pricing.forBuyer, { id, paginationOpts: { numItems: 1, cursor: null } });
  const page2 = await buyer.query(api.pricing.forBuyer, { id, paginationOpts: { numItems: 1, cursor: page1.continueCursor } });
  expect(page1.page[0]._id).toBe(lower);
  const ranked = rankBuyerQuotes([...page1.page, ...page2.page, ...page2.page]);
  expect(ranked.map(q => q._id)).toEqual([top, lower]);
  expect(ranked.every(q => q.canApprove)).toBe(true);
  expect((await t.run(ctx => ctx.db.get('errands', id)))?.runnerId).toBeUndefined();
  for (const account of [first, second, outsider]) {
    await expect(account.mutation(api.pricing.approveQuote, { quoteId: lower, expectedVersion: 1, expectedRevision: 0 })).rejects.toThrow();
  }
  await buyer.mutation(api.pricing.approveQuote, { quoteId: lower, expectedVersion: 1, expectedRevision: 0 });
  expect(await t.run(ctx => ctx.db.get('errands', id))).toMatchObject({ status: 'accepted', runnerId: secondId });
});

test('nearby discovery ranks trust and publishes only aggregate evidence', async () => {
  const { buyer, first, second, firstId, secondId, past } = await setup();
  await past(firstId, 5); await past(secondId, 1);
  for (const runner of [second, first]) {
    await runner.mutation(api.runners.startAvailability, { sessionId: 'trust-discovery-session' });
    await runner.mutation(api.runners.updateLocation, { lat: 5.56, lng: -0.19, capturedAt: Date.now(), status: 'online', sessionId: 'trust-discovery-session' });
  }
  const nearby = await buyer.query(api.runners.getNearbyRunners, { riderLat: 5.56, riderLng: -0.19 });
  expect(nearby.map(r => r.runnerId)).toEqual([firstId, secondId]);
  expect(nearby[0].trust.score).toBeGreaterThan(nearby[1].trust.score);
  expect(nearby[0].trust).not.toHaveProperty('buyerId');
  await second.mutation(api.runners.setOffline, {});
  expect((await buyer.query(api.runners.getNearbyRunners, { riderLat: 5.56, riderLng: -0.19 })).map(r => r.runnerId)).toEqual([firstId]);
});

test('trust is private to the runner and buyers with a relevant errand', async () => {
  const { t, buyer, first, outsider, firstId, create, past } = await setup();
  await past(firstId);
  const id = await create();
  for (const caller of [t, buyer, outsider]) await expect(caller.query(api.trust.mine, {})).rejects.toThrow();
  for (const caller of [t, first, outsider]) await expect(caller.query(api.trust.recommendations, { id })).rejects.toThrow();
  expect(await buyer.query(api.trust.forErrand, { id })).toBeNull();
  await approveJob(t, first, { id, expectedRevision: 0 });
  await expect(outsider.query(api.trust.forErrand, { id })).rejects.toThrow();
  expect(await first.query(api.trust.forErrand, { id })).toMatchObject({ completedJobs: 1 });
});

test('stale, withdrawn, busy and disabled runners are not recommended', async () => {
  const { t, buyer, first, second, firstId, create } = await setup();
  const id = await create();
  const quote = await first.mutation(api.pricing.submitQuote, { id, expectedRevision: 0, expectedVersion: 0, serviceFeePesewas: 2000, note: '' });
  await second.mutation(api.pricing.submitQuote, { id, expectedRevision: 0, expectedVersion: 0, serviceFeePesewas: 2000, note: '' });
  await t.mutation(internal.runners.setRunnerAccess, { userId: firstId, enabled: false });
  expect((await buyer.query(api.trust.recommendations, { id })).candidates.map(c => c.name)).toEqual(['Kojo']);
  await t.mutation(internal.runners.setRunnerAccess, { userId: firstId, enabled: true });
  await first.mutation(api.pricing.closeQuote, { quoteId: quote, expectedVersion: 1 });
  expect((await buyer.query(api.trust.recommendations, { id })).assessed).toBe(1);
  await approveJob(t, second, { id: await create(), expectedRevision: 0 });
  expect((await buyer.query(api.trust.recommendations, { id })).assessed).toBe(0);
  await buyer.mutation(api.errands.update, { ...fields, id, expectedRevision: 0, title: 'Updated request' });
  expect((await buyer.query(api.trust.recommendations, { id })).assessed).toBe(0);
});

test('materialized daily date decays scores without editing history and clock refresh is idempotent', async () => {
  const { t, first, firstId, past } = await setup();
  await past(firstId); const score = (await first.query(api.trust.mine, {})).score;
  vi.advanceTimersByTime(180 * 86_400_000);
  await t.mutation(internal.trust.refreshClock, {}); await t.mutation(internal.trust.refreshClock, {});
  expect((await first.query(api.trust.mine, {})).score).toBeLessThan(score);
  expect(await t.run(ctx => ctx.db.query('trustClock').collect())).toHaveLength(1);
});

test('the recent-history limit is explicit instead of claiming an all-time count', async () => {
  const { first, firstId, past } = await setup();
  for (let i = 0; i < 101; i++) await past(firstId);
  expect(await first.query(api.trust.mine, {})).toMatchObject({ completedJobs: 100, limitedToRecent: true });
});

test('new runners start at neutral trust and can still receive buyer approval', async () => {
  const { buyer, first, create } = await setup();
  const id = await create();
  const quoteId = await first.mutation(api.pricing.submitQuote, { id, expectedRevision: 0, expectedVersion: 0, serviceFeePesewas: 2000, note: '' });
  expect((await buyer.query(api.trust.recommendations, { id })).candidates[0].trust).toMatchObject({ score: 50, history: 'new', completedJobs: 0 });
  expect((await buyer.query(api.pricing.forBuyer, { id, paginationOpts })).page[0].canApprove).toBe(true);
  await buyer.mutation(api.pricing.approveQuote, { quoteId, expectedVersion: 1, expectedRevision: 0 });
  expect((await buyer.query(api.errands.get, { id }))?.status).toBe('accepted');
});

test('more than twenty current quotes exposes the recommendation comparison limit', async () => {
  const { t, buyer, firstId, create } = await setup();
  const id = await create();
  await t.run(async ctx => {
    for (let i = 0; i < 21; i++) {
      const runnerId = i === 0 ? firstId : await ctx.db.insert('users', { name: `Runner ${i}`, role: 'runner' });
      if (i > 0) {
        await ctx.db.insert('runnerAccess', { userId: runnerId, enabled: true });
        await ctx.db.insert('runnerProfiles', { userId: runnerId, phone: '0241234567', area: 'Osu', services: ['delivery'], transport: 'walking', updatedAt: Date.now() });
      }
      await ctx.db.insert('runnerQuotes', { errandId: id, runnerId, serviceFeePesewas: 2000, note: '', errandRevision: 0, version: 1, updatedAt: Date.now(), status: 'pending' });
    }
  });
  const result = await buyer.query(api.trust.recommendations, { id });
  expect(result).toMatchObject({ capped: true, assessed: 20 }); expect(result.candidates).toHaveLength(3);
  expect((await buyer.query(api.pricing.forBuyer, { id, paginationOpts })).page).toHaveLength(21);
});
