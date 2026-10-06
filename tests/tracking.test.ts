/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
const fields = { title: 'Collect groceries', description: '', category: 'groceries' as const, pickup: 'Osu market', dropoff: 'Oxford Street', budgetPesewas: 5000, urgency: 'normal' as const };
beforeEach(() => vi.stubEnv('ENABLE_DEMO_TRACKING', 'true'));
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules);
  const [customerId, otherId] = await t.run(async (ctx) => [await ctx.db.insert('users', { name: 'Customer' }), await ctx.db.insert('users', { name: 'Other' })]);
  const customer = t.withIdentity({ subject: `${customerId}|session` });
  const other = t.withIdentity({ subject: `${otherId}|other-session` });
  const id = await customer.mutation(api.errands.create, { ...fields, requestId: 'tracking-test-0001' });
  return { t, customer, other, otherId, id };
}

test('saves the complete demo journey with timestamps and labelled history', async () => {
  const { customer, id } = await setup();
  for (const [expectedRevision, nextStatus] of (['accepted', 'picked_up', 'delivered'] as const).entries()) {
    await customer.mutation(api.errands.advanceDemoTracking, { id, expectedRevision, nextStatus });
    const errand = await customer.query(api.errands.get, { id });
    expect(errand).toMatchObject({ status: nextStatus, trackingMode: 'demo', revision: expectedRevision + 1 });
  }
  const saved = await customer.query(api.errands.get, { id });
  expect(saved?.acceptedAt).toBeTypeOf('number');
  expect(saved?.pickedUpAt).toBeGreaterThanOrEqual(saved!.acceptedAt!);
  expect(saved?.deliveredAt).toBeGreaterThanOrEqual(saved!.pickedUpAt!);
  expect(saved?.runnerId).toBeUndefined();
  const activity = await customer.query(api.errands.history, { id, paginationOpts: { numItems: 10, cursor: null } });
  expect(activity.page.map((event) => event.kind)).toEqual(['delivered', 'picked_up', 'accepted']);
  expect(activity.page.every((event) => event.isDemo && event.summary.startsWith('Demo:'))).toBe(true);
});

test('demo controls are disabled unless explicitly enabled', async () => {
  const { customer, id } = await setup();
  vi.stubEnv('ENABLE_DEMO_TRACKING', 'false');
  expect(await customer.query(api.errands.trackingOptions)).toEqual({ demoEnabled: false });
  await expect(customer.mutation(api.errands.advanceDemoTracking, { id, expectedRevision: 0, nextStatus: 'accepted' })).rejects.toThrow('not enabled');
  expect((await customer.query(api.errands.get, { id }))?.status).toBe('posted');
});

test('only the owner can advance a request', async () => {
  const { t, other, id } = await setup();
  for (const client of [t, other]) await expect(client.mutation(api.errands.advanceDemoTracking, { id, expectedRevision: 0, nextStatus: 'accepted' })).rejects.toThrow();
});

test('retries do not skip a stage or duplicate its history', async () => {
  const { customer, id } = await setup();
  for (let i = 0; i < 2; i++) await customer.mutation(api.errands.advanceDemoTracking, { id, expectedRevision: 0, nextStatus: 'accepted' });
  expect((await customer.query(api.errands.get, { id }))?.revision).toBe(1);
  expect((await customer.query(api.errands.history, { id, paginationOpts: { numItems: 10, cursor: null } })).page).toHaveLength(1);
});

test('rejects skipped stages, stale edits and backwards transitions', async () => {
  const { customer, id } = await setup();
  await expect(customer.mutation(api.errands.advanceDemoTracking, { id, expectedRevision: 0, nextStatus: 'delivered' })).rejects.toThrow('one step');
  await customer.mutation(api.errands.update, { id, expectedRevision: 0, ...fields, title: 'Updated groceries' });
  await expect(customer.mutation(api.errands.advanceDemoTracking, { id, expectedRevision: 0, nextStatus: 'accepted' })).rejects.toThrow('has changed');
  await customer.mutation(api.errands.advanceDemoTracking, { id, expectedRevision: 1, nextStatus: 'accepted' });
  await customer.mutation(api.errands.advanceDemoTracking, { id, expectedRevision: 2, nextStatus: 'picked_up' });
  await expect(customer.mutation(api.errands.advanceDemoTracking, { id, expectedRevision: 3, nextStatus: 'accepted' })).rejects.toThrow('one step');
});

test('acceptance locks editing and cancellation', async () => {
  const { customer, id } = await setup();
  await customer.mutation(api.errands.advanceDemoTracking, { id, expectedRevision: 0, nextStatus: 'accepted' });
  await expect(customer.mutation(api.errands.update, { id, expectedRevision: 1, ...fields })).rejects.toThrow('unassigned');
  await expect(customer.mutation(api.errands.cancel, { id, expectedRevision: 1, reason: '' })).rejects.toThrow('unassigned');
});

test('cancelled requests cannot start tracking', async () => {
  const { customer, id } = await setup();
  await customer.mutation(api.errands.cancel, { id, expectedRevision: 0, reason: '' });
  await expect(customer.mutation(api.errands.advanceDemoTracking, { id, expectedRevision: 1, nextStatus: 'accepted' })).rejects.toThrow('one step');
});

test('demo controls cannot mutate assigned or live requests', async () => {
  const { t, customer, otherId, id } = await setup();
  await t.run(async (ctx) => ctx.db.patch('errands', id, { runnerId: otherId }));
  await expect(customer.mutation(api.errands.advanceDemoTracking, { id, expectedRevision: 0, nextStatus: 'accepted' })).rejects.toThrow('assigned');
  await t.run(async (ctx) => ctx.db.patch('errands', id, { runnerId: undefined, status: 'accepted' }));
  await expect(customer.mutation(api.errands.advanceDemoTracking, { id, expectedRevision: 0, nextStatus: 'picked_up' })).rejects.toThrow('live errand');
});

test('delivered requests cannot restart or duplicate the final event', async () => {
  const { customer, id } = await setup();
  for (const [expectedRevision, nextStatus] of (['accepted', 'picked_up', 'delivered'] as const).entries()) await customer.mutation(api.errands.advanceDemoTracking, { id, expectedRevision, nextStatus });
  await customer.mutation(api.errands.advanceDemoTracking, { id, expectedRevision: 2, nextStatus: 'delivered' });
  await expect(customer.mutation(api.errands.advanceDemoTracking, { id, expectedRevision: 3, nextStatus: 'accepted' })).rejects.toThrow('one step');
  expect((await customer.query(api.errands.history, { id, paginationOpts: { numItems: 10, cursor: null } })).page).toHaveLength(3);
});
