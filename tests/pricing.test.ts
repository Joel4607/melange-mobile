/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
const modules = import.meta.glob('../convex/**/*.{ts,js}');
const paginationOpts = { numItems: 10, cursor: null };
const fields = { title: 'Collect a parcel', description: '', category: 'delivery' as const, pickup: 'Osu shop', dropoff: 'Labone office', budgetPesewas: 0, budgetPurpose: 'items' as const, urgency: 'normal' as const };
async function setup() {
  const t = convexTest(schema, modules);
  const [buyerId, runnerId, otherId, strangerId] = await t.run(async ctx => Promise.all(['buyer', 'runner', 'runner', 'buyer'].map((role, i) => ctx.db.insert('users', { name: `Person ${i}`, role: role as 'buyer' | 'runner' }))));
  const [buyer, runner, other, stranger] = [buyerId, runnerId, otherId, strangerId].map(id => t.withIdentity({ subject: `${id}|session` }));
  for (const account of [runner, other]) {
    await account.mutation(api.runners.register, { phone: '0241234567', area: 'Osu', transport: 'walking', services: ['delivery'] });
    await account.mutation(api.pricing.saveRates, { rates: [{ category: 'delivery', startingFeePesewas: 1500 }] });
  }
  const id = await buyer.mutation(api.errands.create, { ...fields, requestId: 'pricing-test-0001' });
  const quote = (account = runner, amount = 2000, expectedVersion = 0, expectedRevision = 0) => account.mutation(api.pricing.submitQuote, { id, serviceFeePesewas: amount, note: 'Includes distance', expectedVersion, expectedRevision });
  return { t, buyer, runner, other, stranger, runnerId, id, quote };
}
test('a quote leaves the job posted and private chat closed until the owner approves', async () => {
  const { t, buyer, runner, other, stranger, runnerId, id, quote } = await setup();
  const quoteId = await quote();
  expect(await buyer.query(api.errands.get, { id })).toMatchObject({ status: 'posted', budgetPesewas: 0 });
  await expect(runner.query(api.messages.context, { errandId: id })).rejects.toThrow();
  await expect(runner.mutation(api.runnerJobs.accept, { id, expectedRevision: 0 })).rejects.toThrow('buyer approval');
  for (const account of [t, runner, other, stranger]) await expect(account.mutation(api.pricing.approveQuote, { quoteId, expectedRevision: 0, expectedVersion: 1 })).rejects.toThrow();
  await buyer.mutation(api.pricing.approveQuote, { quoteId, expectedRevision: 0, expectedVersion: 1 });
  expect(await buyer.query(api.errands.get, { id })).toMatchObject({ runnerId, status: 'accepted', agreedPricing: { quoteId, serviceFeePesewas: 2000 } });
  expect(await runner.query(api.messages.context, { errandId: id })).toMatchObject({ canSend: true });
});
test('price changes and buyer edits invalidate stale approval; accepted fees are immutable', async () => {
  const { buyer, runner, id, quote } = await setup();
  const quoteId = await quote();
  await quote(runner, 2500, 1);
  await expect(buyer.mutation(api.pricing.approveQuote, { quoteId, expectedRevision: 0, expectedVersion: 1 })).rejects.toThrow('changed');
  await buyer.mutation(api.errands.update, { ...fields, id, expectedRevision: 0, description: 'Extra parcel' });
  expect((await buyer.query(api.pricing.forBuyer, { id, paginationOpts })).page[0].canApprove).toBe(false);
  await expect(buyer.mutation(api.pricing.approveQuote, { quoteId, expectedRevision: 1, expectedVersion: 2 })).rejects.toThrow('changed');
  await quote(runner, 3000, 2, 1);
  await buyer.mutation(api.pricing.approveQuote, { quoteId, expectedRevision: 1, expectedVersion: 3 });
  await runner.mutation(api.pricing.saveRates, { rates: [{ category: 'delivery', startingFeePesewas: 9000 }] });
  await expect(quote(runner, 4000, 3, 2)).rejects.toThrow();
  expect((await buyer.query(api.pricing.payment, { id }))?.agreed?.serviceFeePesewas).toBe(3000);
  await buyer.mutation(api.pricing.approveQuote, { quoteId, expectedRevision: 1, expectedVersion: 3 });
  expect((await buyer.query(api.errands.history, { id, paginationOpts })).page.filter(e => e.kind === 'accepted')).toHaveLength(1);
});
test('withdrawn, declined, disabled and cancelled quotes cannot be approved', async () => {
  const { t, buyer, runner, runnerId, id, quote } = await setup();
  const quoteId = await quote();
  await runner.mutation(api.pricing.closeQuote, { quoteId, expectedVersion: 1 });
  await expect(buyer.mutation(api.pricing.approveQuote, { quoteId, expectedRevision: 0, expectedVersion: 2 })).rejects.toThrow();
  await quote(runner, 2000, 2);
  await buyer.mutation(api.pricing.closeQuote, { quoteId, expectedVersion: 3 });
  await expect(buyer.mutation(api.pricing.approveQuote, { quoteId, expectedRevision: 0, expectedVersion: 4 })).rejects.toThrow();
  await quote(runner, 2000, 4);
  await t.mutation(internal.runners.setRunnerAccess, { userId: runnerId, enabled: false });
  await expect(buyer.mutation(api.pricing.approveQuote, { quoteId, expectedRevision: 0, expectedVersion: 5 })).rejects.toThrow('no longer available');
  await buyer.mutation(api.errands.cancel, { id, expectedRevision: 0, reason: '' });
  await expect(buyer.mutation(api.pricing.approveQuote, { quoteId, expectedRevision: 0, expectedVersion: 5 })).rejects.toThrow();
});
test('duplicate quotes and concurrent approvals produce a single assignment', async () => {
  const { t, buyer, runner, other, id, quote } = await setup();
  const first = await quote(); expect(await quote()).toBe(first);
  const second = await quote(other);
  const results = await Promise.allSettled([first, second].map(quoteId => buyer.mutation(api.pricing.approveQuote, { quoteId, expectedVersion: 1, expectedRevision: 0 })));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect((await t.run(ctx => ctx.db.query('runnerQuotes').collect()))).toHaveLength(2);
  expect((await buyer.query(api.errands.history, { id, paginationOpts })).page).toHaveLength(1);
});
test('manual payment records require the correct participant and do not imply provider verification', async () => {
  const { t, buyer, runner, other, stranger, id, quote } = await setup();
  const quoteId = await quote(); await buyer.mutation(api.pricing.approveQuote, { quoteId, expectedVersion: 1, expectedRevision: 0 });
  await expect(runner.mutation(api.pricing.confirmReceived, { id })).rejects.toThrow();
  for (const user of [t, runner, other, stranger]) await expect(user.mutation(api.pricing.markSent, { id, method: 'MoMo' })).rejects.toThrow();
  expect(await stranger.query(api.pricing.payment, { id })).toBeNull();
  await expect(stranger.query(api.pricing.forBuyer, { id, paginationOpts })).rejects.toThrow();
  await buyer.mutation(api.pricing.markSent, { id, method: 'MTN MoMo' });
  const sent = await buyer.query(api.pricing.payment, { id });
  await buyer.mutation(api.pricing.markSent, { id, method: 'Another method' });
  expect(await buyer.query(api.pricing.payment, { id })).toEqual(sent);
  for (const user of [t, buyer, other, stranger]) await expect(user.mutation(api.pricing.confirmReceived, { id })).rejects.toThrow();
  await runner.mutation(api.pricing.confirmReceived, { id });
  const record = await runner.query(api.pricing.earnings, { paginationOpts });
  expect(record.page[0]).toMatchObject({ agreed: { serviceFeePesewas: 2000 }, payment: { method: 'MTN MoMo', receivedAt: expect.any(Number) } });
  await runner.mutation(api.pricing.confirmReceived, { id });
  expect(await runner.query(api.pricing.earnings, { paginationOpts })).toEqual(record);
  expect((await other.query(api.pricing.earnings, { paginationOpts })).page).toHaveLength(0);
  expect((await buyer.query(api.errands.get, { id }))?.revision).toBe(1);
});
test('prices validate minor units and require enrolled runner access', async () => {
  const { t, buyer, runner, id, quote } = await setup();
  for (const amount of [0, -100, 100.5, 1000001, Infinity, NaN]) await expect(quote(runner, amount)).rejects.toThrow();
  for (const user of [t, buyer]) await expect(user.mutation(api.pricing.saveRates, { rates: [] })).rejects.toThrow();
  await expect(runner.mutation(api.pricing.saveRates, { rates: [{ category: 'delivery', startingFeePesewas: 1000 }, { category: 'delivery', startingFeePesewas: 2000 }] })).rejects.toThrow();
  await runner.mutation(api.pricing.saveRates, { rates: [] });
  await expect(quote()).rejects.toThrow('starting price');
  expect(await runner.query(api.pricing.myQuote, { id })).toBeNull();
});

test('older assignments have no fabricated fee and cannot acquire manual payment records', async () => {
  const { t, buyer, runner, runnerId, id } = await setup();
  await t.run(ctx => ctx.db.patch('errands', id, { status: 'accepted', runnerId }));
  expect(await buyer.query(api.pricing.payment, { id })).toMatchObject({ agreed: null, payment: null, canRecord: false });
  expect((await runner.query(api.pricing.earnings, { paginationOpts })).page).toHaveLength(0);
  await expect(buyer.mutation(api.pricing.markSent, { id, method: 'MoMo' })).rejects.toThrow();
  await runner.mutation(api.runnerJobs.advance, { id, expectedRevision: 0, nextStatus: 'picked_up' });
  expect((await buyer.query(api.errands.get, { id }))?.status).toBe('picked_up');
});

test('quote history stays private and supports pagination', async () => {
  const { buyer, runner, other, id, quote } = await setup();
  await quote();
  expect(await other.query(api.pricing.myQuote, { id })).toBeNull();
  for (let i = 0; i < 11; i++) {
    const errandId = await buyer.mutation(api.errands.create, { ...fields, requestId: `quote-history-${i}` });
    await runner.mutation(api.pricing.submitQuote, { id: errandId, expectedVersion: 0, expectedRevision: 0, serviceFeePesewas: 2000, note: '' });
  }
  const first = await runner.query(api.pricing.myQuotes, { paginationOpts });
  const next = await runner.query(api.pricing.myQuotes, { paginationOpts: { numItems: 10, cursor: first.continueCursor } });
  expect(first.page).toHaveLength(10); expect(next.page).toHaveLength(2);
  expect(new Set([...first.page, ...next.page].map(q => q._id)).size).toBe(12);
  expect((await other.query(api.pricing.myQuotes, { paginationOpts })).page).toHaveLength(0);
});
