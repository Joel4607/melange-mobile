/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import type { Doc, Id } from '../convex/_generated/dataModel';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
async function setup() {
  const t = convexTest(schema, modules);
  const [runnerId, customerId, otherId] = await t.run(async ctx => [
    await ctx.db.insert('users', { name: 'Kojo Runner', email: 'runner@example.test' }),
    await ctx.db.insert('users', { name: 'Customer', email: 'buyer@example.test' }),
    await ctx.db.insert('users', { name: 'Other Runner' }),
  ]);
  const runner = t.withIdentity({ subject: `${runnerId}|session` });
  const customer = t.withIdentity({ subject: `${customerId}|session` });
  async function assign(status: Doc<'errands'>['status'], overrides: Partial<Doc<'errands'>> = {}) {
    return t.run(ctx => ctx.db.insert('errands', {
      title: 'Collect parcel', description: '', category: 'delivery', pickup: 'Osu', dropoff: 'Labone',
      budgetPesewas: 5000, urgency: 'normal', requestId: 'dashboard-test', customerId, runnerId, status,
      ...overrides,
    }));
  }
  return { t, runner, customer, runnerId, customerId, otherId, assign };
}

test('anonymous callers get no account or dashboard information', async () => {
  const { t } = await setup();
  expect(await t.query(api.runners.access, {})).toBeNull();
  expect(await t.query(api.runners.dashboard, {})).toBeNull();
});

test('customer accounts stay customers until they explicitly complete runner registration', async () => {
  const { runner, t, assign } = await setup();
  await assign('accepted');
  expect(await runner.query(api.runners.access, {})).toMatchObject({ state: 'not_enrolled', email: 'runner@example.test' });
  expect(await runner.query(api.runners.dashboard, {})).toBeNull();
  expect(await t.run(ctx => ctx.db.query('runnerAccess').collect())).toEqual([]);
});

const runnerDetails = { phone: '024 123 4567', area: ' Osu, Accra ', transport: 'walking' as const, services: ['delivery', 'food'] as const };
const registration = () => ({ ...runnerDetails, services: [...runnerDetails.services] });

test('legacy accounts without a saved role can complete runner setup without losing records', async () => {
  const { t, customer, customerId, assign } = await setup();
  const errandId = await assign('posted', { runnerId: undefined });
  await customer.mutation(api.customers.updateDeliveryAddress, { deliveryAddress: 'My saved address' });
  await customer.mutation(api.runners.register, registration());
  expect(await customer.query(api.runners.access, {})).toMatchObject({ userId: customerId, state: 'approved', hasProfile: true });
  expect(await customer.query(api.runners.dashboard, {})).not.toBeNull();
  expect(await customer.query(api.runners.profile, {})).toEqual({ phone: '0241234567', area: 'Osu, Accra', transport: 'walking', services: ['delivery', 'food'], photoId: null, photoUrl: null });
  expect(await customer.query(api.customers.preferences, {})).toEqual({ deliveryAddress: 'My saved address' });
  expect((await t.run(ctx => ctx.db.get('errands', errandId)))?.customerId).toBe(customerId);
  expect(await t.run(ctx => ctx.db.query('errandRunners').collect())).toEqual([]);
});

test('runner profile stays private to its owner', async () => {
  const { t, runner, customer } = await setup();
  await runner.mutation(api.runners.register, registration());
  expect(await runner.query(api.runners.profile, {})).not.toBeNull();
  expect(await customer.query(api.runners.profile, {})).toBeNull();
  expect(await t.query(api.runners.profile, {})).toBeNull();
  await expect(t.mutation(api.runners.register, registration())).rejects.toThrow('Sign in');
});

test('repeated registration updates one profile and one membership', async () => {
  const { t, runner } = await setup();
  await runner.mutation(api.runners.register, registration());
  await runner.mutation(api.runners.register, registration());
  await runner.mutation(api.runners.register, { ...registration(), area: 'Labone', transport: 'bicycle', services: ['delivery', 'delivery'] });
  expect(await t.run(ctx => ctx.db.query('runnerProfiles').collect())).toHaveLength(1);
  expect(await t.run(ctx => ctx.db.query('runnerAccess').collect())).toHaveLength(1);
  expect(await runner.query(api.runners.profile, {})).toMatchObject({ area: 'Labone', transport: 'bicycle', services: ['delivery'] });
});

test('invalid profiles never enable a runner account or overwrite valid details', async () => {
  const { t, runner } = await setup();
  for (const invalid of [{ phone: 'abc123' }, { area: ' ' }, { area: 'x'.repeat(101) }, { services: [] }]) {
    await expect(runner.mutation(api.runners.register, { ...registration(), ...invalid })).rejects.toThrow();
  }
  expect(await t.run(ctx => ctx.db.query('runnerAccess').collect())).toEqual([]);
  expect(await runner.query(api.runners.profile, {})).toBeNull();
  await runner.mutation(api.runners.register, registration());
  await expect(runner.mutation(api.runners.register, { ...registration(), phone: 'invalid' })).rejects.toThrow();
  expect(await runner.query(api.runners.profile, {})).toMatchObject({ phone: '0241234567' });
});

test('prototype registration replaces the previous manual approval requirement', async () => {
  const { t, runner, runnerId } = await setup();
  await t.mutation(internal.runners.setRunnerAccess, { userId: runnerId, enabled: false });
  await runner.mutation(api.runners.register, registration());
  expect(await runner.query(api.runners.access, {})).toMatchObject({ state: 'approved', hasProfile: true });
  expect(await runner.query(api.runners.dashboard, {})).not.toBeNull();
});

test('approved runner gets truthful empty state without a fabricated location', async () => {
  const { t, runner, runnerId, customer } = await setup();
  await t.mutation(internal.runners.setRunnerAccess, { userId: runnerId, enabled: true });
  expect(await runner.query(api.runners.access, {})).toMatchObject({ userId: runnerId, state: 'approved' });
  expect(await runner.query(api.runners.dashboard, {})).toEqual({
    availability: 'offline', locationUpdatedAt: null, locationLabel: null, active: [], hasMoreActive: false, recentDeliveries: [], recentReviews: [],
  });
  expect(await customer.query(api.runners.dashboard, {})).toBeNull();
  expect(await t.run(ctx => ctx.db.query('errandRunners').collect())).toEqual([]);
});

test('dashboard includes only own assigned work and separates delivery from customer confirmation', async () => {
  const { t, runner, runnerId, otherId, assign } = await setup();
  await t.mutation(internal.runners.setRunnerAccess, { userId: runnerId, enabled: true });
  const accepted = await assign('accepted');
  const pickedUp = await assign('picked_up');
  const delivered = await assign('delivered', { deliveredAt: 300 });
  const completed = await assign('delivered', { deliveredAt: 200, completion: { confirmedAt: 250, runnerId, isDemo: false } });
  await assign('accepted', { runnerId: otherId });
  await assign('cancelled');
  await assign('posted', { runnerId: undefined });
  const result = (await runner.query(api.runners.dashboard, {}))!;
  expect(result.active.map(item => item.id)).toEqual([pickedUp, accepted]);
  expect(result.recentDeliveries.map(item => item.id)).toEqual([delivered, completed]);
  expect(result.recentDeliveries.map(item => item.confirmedAt)).toEqual([null, 250]);
  expect(result.active[0]).not.toHaveProperty('customerId');
});

test('only real feedback for this runner is returned, newest first', async () => {
  const { t, runner, runnerId, otherId, customerId, assign } = await setup();
  await t.mutation(internal.runners.setRunnerAccess, { userId: runnerId, enabled: true });
  const errandId = await assign('delivered');
  await t.run(async ctx => {
    await ctx.db.insert('reviews', { errandId, customerId, runnerId: otherId, isDemo: false, rating: 1, comment: 'Not for this runner' });
    await ctx.db.insert('reviews', { errandId, customerId, isDemo: true, rating: 5, comment: 'Demo' });
    await ctx.db.insert('reviews', { errandId, customerId, runnerId, isDemo: false, rating: 4, comment: 'Thank you' });
  });
  expect((await runner.query(api.runners.dashboard, {}))?.recentReviews).toMatchObject([{ rating: 4, comment: 'Thank you' }]);
});

test('revocation hides all dashboard data; reapproval restores own data', async () => {
  const { t, runner, runnerId, assign } = await setup();
  await assign('accepted');
  await t.mutation(internal.runners.setRunnerAccess, { userId: runnerId, enabled: true });
  expect((await runner.query(api.runners.dashboard, {}))?.active).toHaveLength(1);
  await t.mutation(internal.runners.setRunnerAccess, { userId: runnerId, enabled: false });
  expect(await runner.query(api.runners.access, {})).toMatchObject({ state: 'disabled' });
  expect(await runner.query(api.runners.dashboard, {})).toBeNull();
  await t.mutation(internal.runners.setRunnerAccess, { userId: runnerId, enabled: true });
  expect((await runner.query(api.runners.dashboard, {}))?.active).toHaveLength(1);
});

test('deleted accounts cannot retain runner access through a stale identity', async () => {
  const { t, runner, runnerId } = await setup();
  await t.mutation(internal.runners.setRunnerAccess, { userId: runnerId, enabled: true });
  await t.run(ctx => ctx.db.delete('users', runnerId));
  expect(await runner.query(api.runners.access, {})).toBeNull();
  expect(await runner.query(api.runners.dashboard, {})).toBeNull();
});

test('dashboard reads are bounded and delivery order follows delivery time', async () => {
  const { t, runner, runnerId, customerId, assign } = await setup();
  await t.mutation(internal.runners.setRunnerAccess, { userId: runnerId, enabled: true });
  let errandId: Id<'errands'> | undefined;
  for (let i = 0; i < 12; i++) {
    await assign('accepted');
    await assign('picked_up');
    errandId = await assign('delivered', { deliveredAt: 100 - i });
  }
  await t.run(async ctx => {
    for (let i = 0; i < 6; i++) await ctx.db.insert('reviews', { errandId: errandId!, customerId, runnerId, isDemo: false, rating: 5, comment: '' });
  });
  const result = (await runner.query(api.runners.dashboard, {}))!;
  expect(result.active).toHaveLength(20);
  expect(result.hasMoreActive).toBe(true);
  expect(result.recentDeliveries.map(item => item.deliveredAt)).toEqual([100, 99, 98, 97, 96]);
  expect(result.recentReviews).toHaveLength(3);
});
