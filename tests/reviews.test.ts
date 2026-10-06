/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
beforeEach(() => vi.stubEnv('ENABLE_DEMO_TRACKING', 'true'));
afterEach(() => vi.unstubAllEnvs());
async function setup(demo = false) {
  const t = convexTest(schema, modules);
  const [customerId, runnerId, otherId] = await t.run(async ctx => [await ctx.db.insert('users', { name: 'Customer' }), await ctx.db.insert('users', { name: 'Kojo' }), await ctx.db.insert('users', { name: 'Other' })]);
  const customer = t.withIdentity({ subject: `${customerId}|session` });
  const runner = t.withIdentity({ subject: `${runnerId}|session` });
  const other = t.withIdentity({ subject: `${otherId}|session` });
  const id = await customer.mutation(api.errands.create, { title: 'Collect groceries', description: '', category: 'groceries', pickup: 'Osu', dropoff: 'Labone', budgetPesewas: 5000, urgency: 'normal', requestId: 'completion-test-0001' });
  await t.run(ctx => ctx.db.patch('errands', id, demo ? { status: 'delivered', trackingMode: 'demo', deliveredAt: Date.now() } : { status: 'delivered', runnerId, deliveredAt: Date.now() }));
  const confirm = () => customer.mutation(api.errands.confirmCompletion, { id, expectedRevision: 0 });
  const review = { id, rating: 5, comment: 'Helpful and careful. Thank you!' };
  return { t, customer, runner, other, customerId, runnerId, otherId, id, confirm, review };
}

test('customer confirmation is separate from delivery and records its runner snapshot', async () => {
  const { t, customer, runnerId, id, confirm } = await setup();
  const locationId = await t.run(ctx => ctx.db.insert('runnerLocations', { errandId: id, publisherId: runnerId, source: 'runner_gps', receivedAt: Date.now(), sharing: true }));
  expect((await customer.query(api.errands.get, { id }))?.completion).toBeUndefined();
  await confirm();
  expect(await customer.query(api.errands.get, { id })).toMatchObject({ status: 'delivered', revision: 1, completion: { runnerId, isDemo: false } });
  expect((await customer.query(api.errands.get, { id }))?.completion?.confirmedAt).toBeTypeOf('number');
  expect(await t.run(ctx => ctx.db.get('runnerLocations', locationId))).toMatchObject({ sharing: false });
});

test('confirmation retries preserve the timestamp and create only one event', async () => {
  const { customer, id, confirm } = await setup();
  await confirm();
  const saved = await customer.query(api.errands.get, { id });
  await confirm();
  expect(await customer.query(api.errands.get, { id })).toEqual(saved);
  const history = await customer.query(api.errands.history, { id, paginationOpts: { numItems: 20, cursor: null } });
  expect(history.page.filter(event => event.kind === 'completed')).toHaveLength(1);
});

test.each(['posted', 'accepted', 'picked_up', 'cancelled'] as const)('cannot confirm or review an errand in %s state', async status => {
  const { t, customer, id, confirm, review } = await setup();
  await t.run(ctx => ctx.db.patch('errands', id, { status }));
  await expect(confirm()).rejects.toThrow('Delivery must be reported');
  await expect(customer.mutation(api.reviews.submit, review)).rejects.toThrow('Confirm receipt');
});

test('stale confirmation and live delivery without a runner are rejected', async () => {
  const { t, id, confirm } = await setup();
  await t.run(ctx => ctx.db.patch('errands', id, { revision: 1 }));
  await expect(confirm()).rejects.toThrow('changed');
  await t.run(ctx => ctx.db.patch('errands', id, { revision: 0, runnerId: undefined }));
  await expect(confirm()).rejects.toThrow('assigned runner');
});

test('only the customer can confirm, read their review form or submit a review', async () => {
  const { t, customer, runner, other, id, confirm, review } = await setup();
  for (const client of [t, runner, other]) await expect(client.mutation(api.errands.confirmCompletion, { id, expectedRevision: 0 })).rejects.toThrow();
  await confirm();
  for (const client of [t, runner, other]) {
    await expect(client.query(api.reviews.forErrand, { id })).rejects.toThrow();
    await expect(client.mutation(api.reviews.submit, review)).rejects.toThrow();
  }
  expect((await customer.query(api.reviews.forErrand, { id })).review).toBeNull();
});

test('reviews require customer confirmation, not just reported delivery', async () => {
  const { customer, id, review } = await setup();
  expect((await customer.query(api.reviews.forErrand, { id })).canWrite).toBe(false);
  await expect(customer.mutation(api.reviews.submit, review)).rejects.toThrow('Confirm receipt');
});

test('saves one review with server-selected participants and updates history and list summary', async () => {
  const { customer, customerId, runnerId, id, confirm, review } = await setup();
  await confirm();
  await customer.mutation(api.reviews.submit, { ...review, comment: '  Great service!  ' });
  expect(await customer.query(api.reviews.forErrand, { id })).toMatchObject({ canWrite: false, runnerName: 'Kojo', review: { errandId: id, customerId, runnerId, isDemo: false, rating: 5, comment: 'Great service!' } });
  expect(await customer.query(api.errands.get, { id })).toMatchObject({ reviewRating: 5 });
  const history = await customer.query(api.errands.history, { id, paginationOpts: { numItems: 20, cursor: null } });
  expect(history.page.map(event => event.kind)).toEqual(['reviewed', 'completed']);
});

test('review retries do not duplicate or overwrite feedback', async () => {
  const { t, customer, confirm, review } = await setup();
  await confirm();
  const savedId = await customer.mutation(api.reviews.submit, review);
  expect(await customer.mutation(api.reviews.submit, review)).toBe(savedId);
  await expect(customer.mutation(api.reviews.submit, { ...review, rating: 1 })).rejects.toThrow('already reviewed');
  expect(await t.run(ctx => ctx.db.query('reviews').collect())).toHaveLength(1);
  expect((await t.run(ctx => ctx.db.query('errandActivity').collect())).filter(event => event.kind === 'reviewed')).toHaveLength(1);
});

test('validates whole star ratings and comment length while accepting an optional blank comment', async () => {
  const { customer, id, confirm, review } = await setup();
  await confirm();
  for (const rating of [0, 6, 2.5, NaN, Infinity]) await expect(customer.mutation(api.reviews.submit, { ...review, rating })).rejects.toThrow('1 to 5');
  await expect(customer.mutation(api.reviews.submit, { ...review, comment: 'x'.repeat(1001) })).rejects.toThrow('1,000');
  await customer.mutation(api.reviews.submit, { ...review, rating: 1, comment: '   ' });
  expect((await customer.query(api.reviews.forErrand, { id })).review).toMatchObject({ rating: 1, comment: '' });
});

test('the reviewed runner comes from the completion snapshot, not a later assignment edit', async () => {
  const { t, customer, runnerId, otherId, id, confirm, review } = await setup();
  await confirm();
  await t.run(ctx => ctx.db.patch('errands', id, { runnerId: otherId }));
  await customer.mutation(api.reviews.submit, review);
  expect((await customer.query(api.reviews.forErrand, { id })).review?.runnerId).toBe(runnerId);
});

test('demo completion and reviews are clearly labelled and never reference a real runner', async () => {
  const { t, customer, runnerId, id, confirm, review } = await setup(true);
  await confirm();
  await customer.mutation(api.reviews.submit, review);
  const saved = (await customer.query(api.reviews.forErrand, { id })).review;
  expect(saved).toMatchObject({ isDemo: true, rating: 5 });
  expect(saved?.runnerId).toBeUndefined();
  expect(await t.run(ctx => ctx.db.query('reviews').withIndex('by_runnerId', q => q.eq('runnerId', runnerId)).collect())).toHaveLength(0);
  expect((await customer.query(api.errands.history, { id, paginationOpts: { numItems: 20, cursor: null } })).page.every(event => event.isDemo)).toBe(true);
});

test('demo flag gates both completion and new reviews', async () => {
  const { customer, confirm, review } = await setup(true);
  vi.stubEnv('ENABLE_DEMO_TRACKING', 'false');
  await expect(confirm()).rejects.toThrow('Demo completion');
  vi.stubEnv('ENABLE_DEMO_TRACKING', 'true');
  await confirm();
  vi.stubEnv('ENABLE_DEMO_TRACKING', 'false');
  await expect(customer.mutation(api.reviews.submit, review)).rejects.toThrow('Demo reviews');
});

test('delivery questions can be sent until confirmation, then chat becomes read-only', async () => {
  const { customer, runnerId, id, confirm } = await setup();
  expect((await customer.query(api.messages.context, { errandId: id })).canSend).toBe(true);
  await customer.mutation(api.messages.sendText, { errandId: id, channel: String(runnerId), clientId: 'completion-chat-0001', text: 'Where did you leave the parcel?' });
  await confirm();
  expect((await customer.query(api.messages.context, { errandId: id })).canSend).toBe(false);
  await expect(customer.mutation(api.messages.sendText, { errandId: id, channel: String(runnerId), clientId: 'completion-chat-0002', text: 'Thank you' })).rejects.toThrow('read-only');
});
