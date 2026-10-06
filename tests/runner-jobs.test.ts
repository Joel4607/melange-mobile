import { approveJob } from './helpers/approve-job';
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
const paginationOpts = { numItems: 10, cursor: null };
const fields = { title: 'Collect shopping', description: 'Two bags at the counter', category: 'groceries' as const, pickup: 'Osu market', dropoff: 'Labone office', budgetPesewas: 8000, urgency: 'normal' as const };

test('runner history separates active, awaiting and completed jobs and excludes other accounts', async () => {
  const { t, first, second, buyer, incomplete, firstId, secondId, create } = await setup();
  const ids = await Promise.all(Array.from({ length: 7 }, create));
  await t.run(async ctx => {
    for (const [i, id] of ids.entries()) await ctx.db.patch('errands', id, { runnerId: firstId, status: 'delivered', updatedAt: i + 1 });
    await ctx.db.patch('errands', ids[0], { status: 'accepted' });
    await ctx.db.patch('errands', ids[1], { status: 'picked_up' });
    await ctx.db.patch('errands', ids[3], { completion: { confirmedAt: 10, runnerId: firstId, isDemo: false } });
    await ctx.db.patch('errands', ids[4], { status: 'cancelled' });
    await ctx.db.patch('errands', ids[5], { runnerId: secondId });
    await ctx.db.patch('errands', ids[6], { trackingMode: 'demo' });
  });
  for (const [filter, expected] of [['active', [ids[1], ids[0]]], ['awaiting', [ids[2]]], ['completed', [ids[3]]], ['cancelled', [ids[4]]], ['all', [ids[4], ids[3], ids[2], ids[1], ids[0]]]] as const) {
    const page = await first.query(api.runnerJobs.history, { filter, paginationOpts });
    expect(page.page.map(item => item.id)).toEqual(expected);
  }
  expect((await second.query(api.runnerJobs.history, { filter: 'all', paginationOpts })).page.map(item => item.id)).toEqual([ids[5]]);
  for (const caller of [t, buyer, incomplete]) await expect(caller.query(api.runnerJobs.history, { filter: 'all', paginationOpts })).rejects.toThrow();
});

test('runner history paginates beyond the dashboard limit without duplicate records', async () => {
  const { t, first, firstId, create } = await setup();
  for (let i = 0; i < 13; i++) {
    const id = await create();
    await t.run(ctx => ctx.db.patch('errands', id, { runnerId: firstId, status: 'delivered', updatedAt: i }));
  }
  const firstPage = await first.query(api.runnerJobs.history, { filter: 'awaiting', paginationOpts });
  const next = await first.query(api.runnerJobs.history, { filter: 'awaiting', paginationOpts: { numItems: 10, cursor: firstPage.continueCursor } });
  expect(firstPage.isDone).toBe(false);
  expect(firstPage.page).toHaveLength(10);
  expect(next.page).toHaveLength(3);
  expect(new Set([...firstPage.page, ...next.page].map(item => item.id)).size).toBe(13);
});

test('assigned runner details show completion timestamps and their buyer review only', async () => {
  const { t, first, second, buyer, firstId, create } = await setup();
  const id = await create();
  expect((await first.query(api.runnerJobs.get, { id }))?.record).toBeNull();
  await t.run(ctx => ctx.db.patch('errands', id, { runnerId: firstId, status: 'delivered', acceptedAt: 10, pickedUpAt: 20, deliveredAt: 30 }));
  await buyer.mutation(api.errands.confirmCompletion, { id, expectedRevision: 0 });
  await buyer.mutation(api.reviews.submit, { id, rating: 5, comment: 'Careful delivery' });
  expect((await first.query(api.runnerJobs.get, { id }))?.record).toMatchObject({ acceptedAt: 10, pickedUpAt: 20, deliveredAt: 30, confirmedAt: expect.any(Number), review: { rating: 5, comment: 'Careful delivery' } });
  expect(await second.query(api.runnerJobs.get, { id })).toBeNull();
  expect((await first.query(api.messages.context, { errandId: id })).canSend).toBe(false);
});
async function setup() {
  const t = convexTest(schema, modules);
  const [buyerId, firstId, secondId, incompleteId] = await t.run(async ctx => [
    await ctx.db.insert('users', { name: 'Buyer', role: 'buyer' }),
    await ctx.db.insert('users', { name: 'First runner', role: 'runner' }),
    await ctx.db.insert('users', { name: 'Second runner', role: 'runner' }),
    await ctx.db.insert('users', { name: 'Incomplete runner', role: 'runner' }),
  ]);
  const buyer = t.withIdentity({ subject: `${buyerId}|session` });
  const first = t.withIdentity({ subject: `${firstId}|session` });
  const second = t.withIdentity({ subject: `${secondId}|session` });
  const incomplete = t.withIdentity({ subject: `${incompleteId}|session` });
  for (const runner of [first, second]) await runner.mutation(api.runners.register, { phone: '0241234567', area: 'Osu', transport: 'walking', services: ['delivery'] });
  for (const account of [first, second]) await account.mutation(api.pricing.saveRates, { rates: [{ category: 'groceries', startingFeePesewas: 2000 }, { category: 'delivery', startingFeePesewas: 2000 }] });
  let counter = 0;
  const create = () => buyer.mutation(api.errands.create, { ...fields, requestId: `runner-jobs-test-${++counter}` });
  return { t, buyer, first, second, incomplete, buyerId, firstId, secondId, create };
}

test('only enrolled runners can browse, inspect or accept jobs', async () => {
  const { t, buyer, first, incomplete, firstId, create } = await setup();
  const id = await create();
  for (const caller of [t, buyer, incomplete]) {
    await expect(caller.query(api.runnerJobs.availableErrands, { paginationOpts })).rejects.toThrow();
    await expect(caller.query(api.runnerJobs.get, { id })).rejects.toThrow();
    await expect(caller.mutation(api.runnerJobs.accept, { id, expectedRevision: 0 })).rejects.toThrow();
  }
  await t.mutation(internal.runners.setRunnerAccess, { userId: firstId, enabled: false });
  await expect(approveJob(t, first, { id, expectedRevision: 0 })).rejects.toThrow();
});

test('available feed excludes demo, cancelled, assigned and self-owned jobs', async () => {
  const { t, first, firstId, create } = await setup();
  const available = await create();
  const cancelled = await create(); const demo = await create(); const assigned = await create(); const own = await create();
  await t.run(async ctx => {
    await ctx.db.patch('errands', cancelled, { status: 'cancelled' });
    await ctx.db.patch('errands', demo, { trackingMode: 'demo' });
    await ctx.db.patch('errands', assigned, { runnerId: firstId, status: 'accepted' });
    await ctx.db.patch('errands', own, { customerId: firstId });
  });
  const page = await first.query(api.runnerJobs.availableErrands, { paginationOpts });
  expect(page.page.map(item => item.id)).toEqual([available]);
  expect(page.page[0]).not.toHaveProperty('customerId');
  expect(page.page[0]).not.toHaveProperty('requestId');
  for (const id of [cancelled, demo, own]) await expect(approveJob(t, first, { id, expectedRevision: 0 })).rejects.toThrow('no longer available');
});

test('service filters and pagination return the correct available requests', async () => {
  const { t, first, create } = await setup();
  await create(); await create();
  const food = await create();
  await t.run(ctx => ctx.db.patch('errands', food, { category: 'food' }));
  const filtered = await first.query(api.runnerJobs.availableErrands, { category: 'food', paginationOpts });
  expect(filtered.page.map(item => item.id)).toEqual([food]);
  const firstPage = await first.query(api.runnerJobs.availableErrands, { paginationOpts: { numItems: 1, cursor: null } });
  const secondPage = await first.query(api.runnerJobs.availableErrands, { paginationOpts: { numItems: 10, cursor: firstPage.continueCursor } });
  expect(firstPage.page).toHaveLength(1);
  expect(secondPage.page).toHaveLength(2);
  expect(new Set([...firstPage.page, ...secondPage.page].map(item => item.id)).size).toBe(3);
});

test('discovery combines timing, address, text and inclusive budget filters', async () => {
  const { t, first, create } = await setup();
  const match = await create(); const expensive = await create(); const flexible = await create();
  await t.run(async ctx => {
    await ctx.db.patch('errands', match, { urgency: 'express', budgetPesewas: 0, title: 'Collect parcel', category: 'delivery' });
    await ctx.db.patch('errands', expensive, { urgency: 'express', budgetPesewas: 30000 });
    await ctx.db.patch('errands', flexible, { urgency: 'low' });
  });
  const result = await first.query(api.runnerJobs.availableErrands, { search: ' PARCEL ', area: 'OSU', urgency: 'express', minBudget: 0, maxBudget: 10000, preferredServices: true, paginationOpts });
  expect(result.page.map(e => e.id)).toEqual([match]);
  const deliveryArea = await first.query(api.runnerJobs.availableErrands, { area: 'labone', paginationOpts });
  expect(deliveryArea.page).toHaveLength(3);
  const preferred = await first.query(api.runnerJobs.availableErrands, { preferredServices: true, paginationOpts });
  expect(preferred.page.map(e => e.id)).toEqual([match]);
  await expect(first.query(api.runnerJobs.availableErrands, { minBudget: 200, maxBudget: 100, paginationOpts })).rejects.toThrow('Minimum');
  await expect(first.query(api.runnerJobs.availableErrands, { minBudget: -1, paginationOpts })).rejects.toThrow('budget');
});

test('text search preserves continuation across empty pages and supports oldest first', async () => {
  const { t, first, create } = await setup();
  const oldest = await create(); const newest = await create();
  await t.run(ctx => ctx.db.patch('errands', oldest, { title: 'Unique medicine pickup' }));
  const firstPage = await first.query(api.runnerJobs.availableErrands, { search: 'medicine', paginationOpts: { numItems: 1, cursor: null } });
  expect(firstPage.page).toEqual([]); expect(firstPage.isDone).toBe(false);
  const next = await first.query(api.runnerJobs.availableErrands, { search: 'medicine', paginationOpts: { numItems: 1, cursor: firstPage.continueCursor } });
  expect(next.page.map(e => e.id)).toEqual([oldest]);
  const ordered = await first.query(api.runnerJobs.availableErrands, { order: 'oldest', paginationOpts });
  expect(ordered.page.map(e => e.id)).toEqual([oldest, newest]);
});

test('acceptance immediately connects buyer, dashboard, activity and private chat', async () => {
  const { t, first, second, buyer, firstId, create } = await setup();
  const id = await create();
  expect(await first.query(api.runnerJobs.get, { id })).toMatchObject({ description: fields.description, canAccept: true, assignedToMe: false });
  await expect(first.query(api.messages.context, { errandId: id })).rejects.toThrow();
  await approveJob(t, first, { id, expectedRevision: 0 });
  expect(await buyer.query(api.errands.get, { id })).toMatchObject({ status: 'accepted', runnerId: firstId, revision: 1 });
  expect((await first.query(api.runners.dashboard, {}))?.active[0]).toMatchObject({ id, status: 'accepted' });
  expect(await first.query(api.runnerJobs.get, { id })).toMatchObject({ assignedToMe: true, canAccept: false });
  expect(await second.query(api.runnerJobs.get, { id })).toBeNull();
  expect((await second.query(api.runnerJobs.availableErrands, { paginationOpts })).page).toEqual([]);
  expect(await first.query(api.messages.context, { errandId: id })).toMatchObject({ canSend: true, partnerName: 'Buyer', demo: false });
  expect(await buyer.query(api.messages.context, { errandId: id })).toMatchObject({ canSend: true, partnerName: 'First runner' });
  expect((await buyer.query(api.errands.history, { id, paginationOpts })).page).toMatchObject([{ kind: 'accepted', isDemo: false }]);
});

test('a repeated acceptance is idempotent and never duplicates activity', async () => {
  const { t, first, buyer, create } = await setup();
  const id = await create();
  await approveJob(t, first, { id, expectedRevision: 0 });
  await approveJob(t, first, { id, expectedRevision: 0 });
  expect((await buyer.query(api.errands.history, { id, paginationOpts })).page).toHaveLength(1);
  expect((await buyer.query(api.errands.get, { id }))?.revision).toBe(1);
});

test('competing runners cannot both accept the same errand', async () => {
  const { t, first, second, buyer, create } = await setup();
  const id = await create();
  const results = await Promise.allSettled([first, second].map(runner => approveJob(t, runner, { id, expectedRevision: 0 })));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect((await buyer.query(api.errands.history, { id, paginationOpts })).page).toHaveLength(1);
});

test('simultaneous attempts to accept two jobs produce only one active assignment', async () => {
  const { t, first, buyer, create } = await setup();
  const ids = [await create(), await create()];
  const results = await Promise.allSettled(ids.map(id => approveJob(t, first, { id, expectedRevision: 0 })));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const jobs = await Promise.all(ids.map(id => buyer.query(api.errands.get, { id })));
  expect(jobs.filter(job => job?.status === 'accepted')).toHaveLength(1);
  expect(jobs.filter(job => job?.status === 'posted')).toHaveLength(1);
});

test('picked-up errands block new acceptance; delivered errands free capacity', async () => {
  const { t, first, create } = await setup();
  const active = await create(); const next = await create();
  await approveJob(t, first, { id: active, expectedRevision: 0 });
  await t.run(ctx => ctx.db.patch('errands', active, { status: 'picked_up' }));
  expect(await first.query(api.runnerJobs.capacity, {})).toMatchObject({ id: active });
  expect(await first.query(api.runnerJobs.get, { id: next })).toMatchObject({ canAccept: false, activeErrandId: active });
  await expect(approveJob(t, first, { id: next, expectedRevision: 0 })).rejects.toThrow('active errand');
  await t.run(ctx => ctx.db.patch('errands', active, { status: 'delivered' }));
  await approveJob(t, first, { id: next, expectedRevision: 0 });
  expect(await first.query(api.runnerJobs.capacity, {})).toMatchObject({ id: next });
});

test('a buyer edit must be reviewed before accepting and accepted jobs cannot be edited', async () => {
  const { t, buyer, first, create } = await setup();
  const id = await create();
  await buyer.mutation(api.errands.update, { ...fields, id, expectedRevision: 0, budgetPesewas: 9000 });
  await expect(approveJob(t, first, { id, expectedRevision: 0 })).rejects.toThrow('buyer updated');
  expect(await first.query(api.runnerJobs.get, { id })).toMatchObject({ revision: 1, budgetPesewas: 9000 });
  await approveJob(t, first, { id, expectedRevision: 1 });
  await expect(buyer.mutation(api.errands.update, { ...fields, id, expectedRevision: 2 })).rejects.toThrow('unassigned');
  await expect(buyer.mutation(api.errands.cancel, { id, expectedRevision: 2, reason: '' })).rejects.toThrow('unassigned');
});

test('cancelled requests and invalid detail links are unavailable', async () => {
  const { t, buyer, first, create } = await setup();
  const id = await create();
  await buyer.mutation(api.errands.cancel, { id, expectedRevision: 0, reason: '' });
  expect(await first.query(api.runnerJobs.get, { id })).toBeNull();
  expect(await first.query(api.runnerJobs.get, { id: 'not-an-errand' })).toBeNull();
  await expect(approveJob(t, first, { id, expectedRevision: 0 })).rejects.toThrow('no longer available');
});

test('acceptance marks an online map entry busy without fabricating an offline runner location', async () => {
  const { t, first, second, firstId, create } = await setup();
  await t.run(ctx => ctx.db.insert('errandRunners', { runnerId: firstId, name: 'First runner', status: 'online', lat: 5.56, lng: -0.19, h3Index: 'test-cell', updatedAt: 100, capturedAt: 100, expiryScheduled: false }));
  await approveJob(t, first, { id: await create(), expectedRevision: 0 });
  await approveJob(t, second, { id: await create(), expectedRevision: 0 });
  const positions = await t.run(ctx => ctx.db.query('errandRunners').collect());
  expect(positions).toHaveLength(1);
  expect(positions[0]).toMatchObject({ runnerId: firstId, status: 'busy', lat: 5.56 });
});
